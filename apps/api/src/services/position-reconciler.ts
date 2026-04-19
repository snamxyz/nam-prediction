/**
 * Position reconciler — defense-in-depth for the share-balance accuracy bug.
 *
 * The primary fix for the double-count is the UNIQUE (market_id, tx_hash)
 * index on `trades` plus `INSERT ... ON CONFLICT DO NOTHING RETURNING`
 * in `processTradeFill`. This service is the belt on top of those
 * suspenders: every RECONCILE_INTERVAL_MS it pulls all non-resolved
 * positions, batch-reads the on-chain YES/NO OutcomeToken balances, and
 * rewrites the DB row on any divergence larger than ~1 wei. Each heal
 * emits a `position_divergence` entry to `risk_events` so operators can
 * see drift and publishes `user:shares` so the websocket client refetches.
 *
 * There is also an on-demand path — `reconcilePositionsForWallet(wallet)` —
 * triggered by the frontend `usePortfolio` hook (on mount + every 15s)
 * and by `POST /trading/reconcile/:wallet`.
 */
import { eq, and, ne } from "drizzle-orm";
import { formatUnits } from "viem";
import { OutcomeTokenABI } from "@nam-prediction/shared";
import { db } from "../db/client";
import { markets, userPositions, riskEvents } from "../db/schema";
import { publicClient } from "./indexer";
import { publishEvent } from "../lib/redis";

// Wei-level tolerance for "balance matches". Anything smaller than this
// is float / decimal-string rounding noise.
const WEI_TOLERANCE = 1_000n; // 1e-15 in 18-decimal units
const RECONCILE_INTERVAL_MS = Number(
  process.env.POSITION_RECONCILE_INTERVAL_MS || 30_000
);

let reconcilerStarted = false;

type PositionRow = typeof userPositions.$inferSelect;
type MarketRow = typeof markets.$inferSelect;

interface PositionWithMarket {
  position: PositionRow;
  market: MarketRow;
}

async function loadOpenPositions(
  wallet?: string
): Promise<PositionWithMarket[]> {
  const rows = await db
    .select({
      position: userPositions,
      market: markets,
    })
    .from(userPositions)
    .innerJoin(markets, eq(userPositions.marketId, markets.id))
    .where(
      wallet
        ? and(
            eq(markets.resolved, false),
            eq(userPositions.userAddress, wallet.toLowerCase())
          )
        : eq(markets.resolved, false)
    );
  return rows;
}

function toWeiString(dec: string | null | undefined): bigint {
  const s = (dec ?? "0").trim();
  if (!s) return 0n;
  // Reconstruct as 18-decimal integer without losing precision. We avoid
  // viem's `parseUnits` here because the DB can contain trailing zeros.
  const [intPart, fracPartRaw = ""] = s.split(".");
  const frac = (fracPartRaw + "000000000000000000").slice(0, 18);
  const normalized = `${intPart}${frac}`.replace(/^0+/, "") || "0";
  try {
    return BigInt(normalized);
  } catch {
    return 0n;
  }
}

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

/**
 * Apply pre-fetched on-chain balances to a position row, healing the DB if
 * they diverge. Extracted so the batch tick can share one multicall across all
 * positions instead of making a separate multicall per row.
 * Returns true iff the DB row was mutated.
 */
async function applyReconcileResult(
  { position, market }: PositionWithMarket,
  onChainYes: bigint,
  onChainNo: bigint
): Promise<boolean> {
  const dbYes = toWeiString(position.yesBalance);
  const dbNo = toWeiString(position.noBalance);

  const yesDrift = absDiff(onChainYes, dbYes);
  const noDrift = absDiff(onChainNo, dbNo);

  if (yesDrift <= WEI_TOLERANCE && noDrift <= WEI_TOLERANCE) {
    // Still mark last_reconciled_at so operators can see the reconciler is
    // actually running — but only once per minute-ish to avoid churn.
    const last = position.lastReconciledAt?.getTime() ?? 0;
    if (Date.now() - last > 60_000) {
      await db
        .update(userPositions)
        .set({ lastReconciledAt: new Date() })
        .where(eq(userPositions.id, position.id));
    }
    return false;
  }

  const newYesStr = formatUnits(onChainYes, 18);
  const newNoStr = formatUnits(onChainNo, 18);

  console.warn(
    `[Reconciler] Healing position market=${market.id} user=${position.userAddress}: ` +
      `yes db=${position.yesBalance} chain=${newYesStr} / ` +
      `no db=${position.noBalance} chain=${newNoStr}`
  );

  // When the chain says the user holds fewer shares than the DB, shrink the
  // cost basis proportionally so the avg price stays meaningful. When the
  // chain says they hold more, we can't know where the extra shares came
  // from — leave cost basis alone; avg price will simply be lower until the
  // next trade re-anchors it.
  const dbYesNum = Number(position.yesBalance || "0");
  const dbNoNum = Number(position.noBalance || "0");
  const newYesNum = Number(newYesStr);
  const newNoNum = Number(newNoStr);

  let newYesCost = position.yesCostBasis;
  let newNoCost = position.noCostBasis;
  if (dbYesNum > 0 && newYesNum < dbYesNum) {
    const ratio = newYesNum / dbYesNum;
    newYesCost = (Number(position.yesCostBasis) * ratio).toFixed(6);
  }
  if (newYesNum < 1e-9) newYesCost = "0";
  if (dbNoNum > 0 && newNoNum < dbNoNum) {
    const ratio = newNoNum / dbNoNum;
    newNoCost = (Number(position.noCostBasis) * ratio).toFixed(6);
  }
  if (newNoNum < 1e-9) newNoCost = "0";

  const newYesAvg =
    newYesNum > 1e-9 ? Math.max(0, Math.min(1, Number(newYesCost) / newYesNum)) : 0;
  const newNoAvg =
    newNoNum > 1e-9 ? Math.max(0, Math.min(1, Number(newNoCost) / newNoNum)) : 0;

  await db
    .update(userPositions)
    .set({
      yesBalance: newYesStr,
      noBalance: newNoStr,
      yesCostBasis: newYesCost,
      noCostBasis: newNoCost,
      yesAvgPrice: newYesAvg,
      noAvgPrice: newNoAvg,
      lastReconciledAt: new Date(),
    })
    .where(eq(userPositions.id, position.id));

  // Operator-visible audit trail for any time the reconciler fired.
  try {
    await db.insert(riskEvents).values({
      marketId: market.id,
      userAddress: position.userAddress,
      eventType: "position_divergence",
      severity: "warning",
      metadata: {
        dbYes: position.yesBalance,
        dbNo: position.noBalance,
        chainYes: newYesStr,
        chainNo: newNoStr,
        yesDriftWei: yesDrift.toString(),
        noDriftWei: noDrift.toString(),
      },
    });
  } catch (err) {
    console.error("[Reconciler] Failed to log risk event:", err);
  }

  await publishEvent("user:shares", {
    wallet: position.userAddress,
    marketId: market.id,
  });

  return true;
}

/**
 * Reconcile one position row against on-chain OutcomeToken balances.
 * Issues its own multicall — used by the on-demand per-wallet path.
 * For bulk reconciliation, prefer the batched path in runTick().
 */
async function reconcileOne(row: PositionWithMarket): Promise<boolean> {
  const { position, market } = row;
  if (!market.yesToken || !market.noToken) return false;

  let onChainYes: bigint;
  let onChainNo: bigint;
  try {
    const result = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        {
          address: market.yesToken as `0x${string}`,
          abi: OutcomeTokenABI,
          functionName: "balanceOf",
          args: [position.userAddress as `0x${string}`],
        },
        {
          address: market.noToken as `0x${string}`,
          abi: OutcomeTokenABI,
          functionName: "balanceOf",
          args: [position.userAddress as `0x${string}`],
        },
      ],
    });
    onChainYes = result[0] as bigint;
    onChainNo = result[1] as bigint;
  } catch {
    return false;
  }

  return applyReconcileResult(row, onChainYes, onChainNo);
}

/**
 * On-demand reconcile for one wallet — drives the frontend 15s refresh and
 * the POST /trading/reconcile/:wallet endpoint.
 * Uses a single batched multicall for all of the wallet's open positions.
 */
export async function reconcilePositionsForWallet(wallet: string): Promise<{
  checked: number;
  healed: number;
}> {
  const rows = await loadOpenPositions(wallet);
  const candidates = rows.filter((r) => !!r.market.yesToken && !!r.market.noToken);
  if (candidates.length === 0) return { checked: rows.length, healed: 0 };

  // Single multicall: 2 balanceOf calls per candidate position.
  let results: unknown[];
  try {
    results = await publicClient.multicall({
      allowFailure: true,
      contracts: candidates.flatMap((r) => [
        {
          address: r.market.yesToken as `0x${string}`,
          abi: OutcomeTokenABI,
          functionName: "balanceOf" as const,
          args: [r.position.userAddress as `0x${string}`],
        },
        {
          address: r.market.noToken as `0x${string}`,
          abi: OutcomeTokenABI,
          functionName: "balanceOf" as const,
          args: [r.position.userAddress as `0x${string}`],
        },
      ]),
    });
  } catch (err) {
    console.error("[Reconciler] per-wallet batch multicall failed:", err);
    return { checked: rows.length, healed: 0 };
  }

  let healed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const yesResult = results[i * 2] as { status: string; result?: bigint };
    const noResult = results[i * 2 + 1] as { status: string; result?: bigint };
    if (yesResult.status !== "success" || noResult.status !== "success") continue;
    try {
      const changed = await applyReconcileResult(
        candidates[i],
        yesResult.result!,
        noResult.result!
      );
      if (changed) healed++;
    } catch (err) {
      console.error("[Reconciler] per-wallet reconcile failed:", err);
    }
  }
  return { checked: rows.length, healed };
}

async function runTick(): Promise<void> {
  let rows: PositionWithMarket[];
  try {
    rows = await loadOpenPositions();
  } catch (err) {
    console.error("[Reconciler] Failed to load open positions:", err);
    return;
  }
  if (rows.length === 0) return;

  // Dust-filter and skip positions whose market tokens aren't wired up.
  const candidates = rows.filter(
    (r) =>
      (Number(r.position.yesBalance) > 0 || Number(r.position.noBalance) > 0) &&
      !!r.market.yesToken &&
      !!r.market.noToken
  );
  if (candidates.length === 0) return;

  // Single multicall for all candidates: 2 balanceOf calls per position.
  // This collapses N separate RPC round-trips into one request.
  let results: unknown[];
  try {
    results = await publicClient.multicall({
      allowFailure: true,
      contracts: candidates.flatMap((r) => [
        {
          address: r.market.yesToken as `0x${string}`,
          abi: OutcomeTokenABI,
          functionName: "balanceOf" as const,
          args: [r.position.userAddress as `0x${string}`],
        },
        {
          address: r.market.noToken as `0x${string}`,
          abi: OutcomeTokenABI,
          functionName: "balanceOf" as const,
          args: [r.position.userAddress as `0x${string}`],
        },
      ]),
    });
  } catch (err) {
    console.error("[Reconciler] Batch multicall failed:", err);
    return;
  }

  let healed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const yesResult = results[i * 2] as { status: string; result?: bigint };
    const noResult = results[i * 2 + 1] as { status: string; result?: bigint };
    if (yesResult.status !== "success" || noResult.status !== "success") continue;
    try {
      const changed = await applyReconcileResult(
        candidates[i],
        yesResult.result!,
        noResult.result!
      );
      if (changed) healed++;
    } catch (err) {
      console.error("[Reconciler] reconcileOne failed:", err);
    }
  }

  if (healed > 0) {
    console.log(
      `[Reconciler] Pass complete: ${healed}/${candidates.length} positions healed`
    );
  }
}

export function startPositionReconciler(): void {
  if (reconcilerStarted) return;
  reconcilerStarted = true;

  console.log(
    `[Reconciler] Position reconciler started (interval=${RECONCILE_INTERVAL_MS}ms)`
  );

  // Don't block the boot path on the first pass.
  setTimeout(() => {
    runTick().catch((err) =>
      console.error("[Reconciler] Initial tick failed:", err)
    );
  }, 5_000);

  setInterval(() => {
    runTick().catch((err) =>
      console.error("[Reconciler] Tick failed:", err)
    );
  }, RECONCILE_INTERVAL_MS);
}

// Silence unused import warning in strict mode.
void ne;
