import { createPublicClient, http, formatUnits, parseUnits, parseEventLogs } from "viem";
import { base } from "viem/chains";
import { db } from "../db/client";
import { markets, trades, userPositions, vaultTransactions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { MarketFactoryABI, CPMMABI, VaultABI } from "@nam-prediction/shared";
import { publishEvent, setCache, cacheKeys } from "../lib/redis";

// `RPC_URL` drives reads (indexer polling, multicalls, balance lookups).
// Writes can optionally go through a different endpoint via `WRITE_RPC_URL`
// (see trading.ts). This lets operators point reads at a paid/high-throughput
// provider while still broadcasting transactions via any URL they trust.
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}` | undefined;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS as `0x${string}` | undefined;

// Slow event polling by default. Base produces a block every ~2s, but the
// public RPC is rate-limited aggressively, so we back off unless the operator
// sets a dedicated endpoint.
const IS_PUBLIC_RPC = /mainnet\.base\.org$/.test(new URL(RPC_URL).host);
const POLLING_INTERVAL_MS = Number(
  // Public RPC: 12 s (heavily rate-limited). Dedicated (Alchemy etc.): 12 s by
  // default — each watchContractEvent creates one filter poller, so even with a
  // paid endpoint we conserve compute units. Override via INDEXER_POLLING_MS.
  process.env.INDEXER_POLLING_MS || 12_000
);

if (IS_PUBLIC_RPC) {
  console.warn(
    "[Indexer] Using the public Base RPC (mainnet.base.org). It is heavily " +
      "rate-limited and will drop event polling and readContract calls. " +
      "Set RPC_URL in apps/api/.env to a dedicated endpoint " +
      "(Alchemy / QuickNode / Ankr / Base paid tier)."
  );
}

export const publicClient = createPublicClient({
  chain: base,
  pollingInterval: POLLING_INTERVAL_MS,
  transport: http(RPC_URL, {
    // Coalesce concurrent reads into eth_multicall-style JSON-RPC batches.
    batch: { batchSize: 64, wait: 16 },
    // Retry transient 429 / network errors with exponential backoff.
    retryCount: 4,
    retryDelay: 400,
    timeout: 20_000,
  }),
});

// Track which pool addresses we're watching. A single global watchContractEvent
// covers ALL pools — restarted whenever the set changes. This cuts
// eth_getFilterChanges calls from O(N pools) down to O(1).
const watchedPools = new Set<string>();
let globalTradeUnwatch: (() => void) | null = null;

function restartGlobalTradeWatcher(): void {
  const addresses = [...watchedPools] as `0x${string}`[];

  // Start the new watcher BEFORE stopping the old one so there is no gap
  // where events could be missed. Duplicate trades are harmless — the UNIQUE
  // (marketId, txHash) index in the trades table drops any re-inserts.
  const newUnwatch =
    addresses.length === 0
      ? null
      : publicClient.watchContractEvent({
          address: addresses,
          abi: CPMMABI,
          eventName: "Trade",
          onLogs: (logs) => logs.forEach(handleTrade),
        });

  if (globalTradeUnwatch) globalTradeUnwatch();
  globalTradeUnwatch = newUnwatch;

  if (addresses.length > 0) {
    console.log(
      `[Indexer] Global Trade watcher active for ${addresses.length} pool(s)`
    );
  }
}

// ─── Balance math (decimal-string safe) ───
//
// Positions are stored as `numeric(30, 18)` decimal strings (e.g. "0.0001234").
// `BigInt(...)` only accepts integers, so we scale through wei before adding
// or subtracting and then format back to the DB's decimal representation.

function toWei(decimalStr: string | null | undefined): bigint {
  const s = (decimalStr ?? "0").trim();
  if (!s) return 0n;
  try {
    return parseUnits(s, 18);
  } catch {
    return 0n;
  }
}

function addBigIntStrings(a: string, b: string): string {
  return formatUnits(toWei(a) + toWei(b), 18);
}

function subBigIntStrings(a: string, b: string): string {
  const r = toWei(a) - toWei(b);
  return formatUnits(r < 0n ? 0n : r, 18);
}

// ─── Event handlers ───

async function handleMarketCreated(log: any) {
  const { marketId, yesToken, noToken, liquidityPool, question, endTime, resolutionSource, resolutionData } = log.args;
  console.log(`[Indexer] MarketCreated #${marketId}: "${question}" (source=${resolutionSource})`);

  // Map on-chain resolution source ID to string
  const sourceMap: Record<number, string> = {
    0: "admin",
    1: "api",
    2: "dexscreener",
  };
  const sourceStr = sourceMap[Number(resolutionSource)] || "admin";

  // Decode resolutionData as JSON config (if present)
  let resolutionConfig = null;
  if (resolutionData && resolutionData !== "0x") {
    try {
      const decoded = Buffer.from(resolutionData.slice(2), "hex").toString("utf-8");
      resolutionConfig = JSON.parse(decoded);
    } catch {
      // resolutionData may be raw bytes — store as-is
      resolutionConfig = { raw: resolutionData };
    }
  }

  await db
    .insert(markets)
    .values({
      onChainId: Number(marketId),
      question: question,
      yesToken: yesToken,
      noToken: noToken,
      ammAddress: liquidityPool,
      endTime: new Date(Number(endTime) * 1000),
      resolved: false,
      result: 0,
      yesPrice: 0.5,
      noPrice: 0.5,
      volume: "0",
      liquidity: "0",
      resolutionSource: sourceStr,
      resolutionConfig: resolutionConfig,
    })
    .onConflictDoNothing();

  // Start watching Trade events on this pool
  watchTradesForPool(liquidityPool as `0x${string}`);
}

// ─── Core trade-fill processor (reused by event watcher + /trading routes) ───

export interface TradeFillInput {
  /// On-chain marketId (the `marketId` indexed event arg)
  onChainMarketId: bigint | number;
  trader: string;
  isYes: boolean;
  isBuy: boolean;
  shares: bigint; // 18 decimals
  collateral: bigint; // 6 decimals
  txHash: string;
  /// Block number the Trade event was emitted in. Used to pin the post-trade
  /// price snapshot so concurrent trades don't produce wrong-direction reads.
  blockNumber?: bigint;
}

/// Insert the trade, update the market prices + volume, publish the realtime
/// websocket events, and update the user's position.
///
/// Safe to call multiple times with the same `txHash` — it will no-op on the
/// second call, which lets the indexer and the trading route both fire
/// without double-booking anything.
export async function processTradeFill(input: TradeFillInput): Promise<void> {
  const { onChainMarketId, trader, isYes, isBuy, shares, collateral, txHash, blockNumber } = input;

  const market = await db
    .select()
    .from(markets)
    .where(eq(markets.onChainId, Number(onChainMarketId)))
    .limit(1);

  if (market.length === 0) {
    console.warn(`[Indexer] processTradeFill: no DB market for onChainId=${onChainMarketId}`);
    return;
  }
  const dbMarket = market[0];

  const traderAddr = trader.toLowerCase();
  const sharesStr = formatUnits(shares, 18);
  const collateralStr = formatUnits(collateral, 6);

  // Snapshot the AMM's post-trade YES/NO prices so the chart and the market
  // header share a single source of truth (see PriceChart).
  //
  // Critical: we pin the read to the trade's blockNumber when available. That
  // guarantees the snapshot reflects the *same* block as the Trade event we're
  // indexing, even when another trade lands in the interim. Without this,
  // concurrent trades race and we can record prices from the wrong block —
  // which the UI then sees as "price moved in the wrong direction".
  //
  // One multicall instead of three round-trips keeps us under the RPC rate
  // limit when trades arrive in bursts. On any RPC failure we retry once,
  // then fall back to `latest`, then to the market row's last known prices
  // so the trade row is never lost. Even on total failure we still publish
  // the realtime event so the UI sees *something* moving.
  const ammAddress = dbMarket.ammAddress as `0x${string}`;
  let yesPriceNum = dbMarket.yesPrice ?? 0.5;
  let noPriceNum = dbMarket.noPrice ?? 0.5;
  let yesReserve: bigint = 0n;
  let noReserve: bigint = 0n;
  let pricesFetched = false;

  const readReservesAt = async (bn?: bigint) => {
    return publicClient.multicall({
      allowFailure: false,
      ...(bn !== undefined ? { blockNumber: bn } : {}),
      contracts: [
        { address: ammAddress, abi: CPMMABI, functionName: "getPrices" },
        { address: ammAddress, abi: CPMMABI, functionName: "yesReserve" },
        { address: ammAddress, abi: CPMMABI, functionName: "noReserve" },
      ],
    });
  };

  const applyResults = (results: readonly unknown[]) => {
    const [yesPrice, noPrice] = results[0] as readonly [bigint, bigint];
    yesReserve = results[1] as bigint;
    noReserve = results[2] as bigint;
    yesPriceNum = Number(yesPrice) / 1e18;
    noPriceNum = Number(noPrice) / 1e18;
    pricesFetched = true;
  };

  try {
    applyResults(await readReservesAt(blockNumber));
  } catch (err) {
    console.warn(
      `[Indexer] Block-pinned price read failed (block=${blockNumber}), retrying:`,
      (err as Error)?.message || err
    );
    try {
      await new Promise((r) => setTimeout(r, 250));
      applyResults(await readReservesAt(blockNumber));
    } catch (err2) {
      console.warn(
        "[Indexer] Retry failed, falling back to latest block:",
        (err2 as Error)?.message || err2
      );
      try {
        applyResults(await readReservesAt(undefined));
      } catch (err3) {
        console.error(
          "[Indexer] Failed to fetch AMM prices even from latest, using cached:",
          err3
        );
      }
    }
  }

  // Atomic dedupe: the UNIQUE (market_id, tx_hash) index guarantees at most
  // one row per (market, tx) pair. The first racer lands the insert and gets
  // an id back; every subsequent racer sees `inserted.length === 0` and
  // returns early without double-applying the position delta. This replaces
  // the old SELECT-then-INSERT check that was racing between the trading
  // route and the Trade-event watcher.
  const inserted = await db
    .insert(trades)
    .values({
      marketId: dbMarket.id,
      trader: traderAddr,
      isYes,
      isBuy,
      shares: sharesStr,
      collateral: collateralStr,
      yesPrice: yesPriceNum,
      noPrice: noPriceNum,
      txHash,
    })
    .onConflictDoNothing({ target: [trades.marketId, trades.txHash] })
    .returning({ id: trades.id });

  if (inserted.length === 0) {
    // A concurrent caller already recorded this fill — nothing more to do.
    return;
  }

  // Always bump volume — we know `collateral` from the event itself, no RPC needed.
  // Only touch the price columns if we actually fetched on-chain prices.
  const newVolume = Number(dbMarket.volume) + Number(collateral) / 1e6;
  const liveLiquidity = pricesFetched
    ? Number(formatUnits((yesReserve + noReserve) / 2n, 18)).toFixed(6)
    : null;
  try {
    await db
      .update(markets)
      .set(
        pricesFetched
          ? { yesPrice: yesPriceNum, noPrice: noPriceNum, volume: newVolume.toString(), liquidity: liveLiquidity! }
          : { volume: newVolume.toString() }
      )
      .where(eq(markets.id, dbMarket.id));

    if (pricesFetched) {
      await setCache(cacheKeys.marketYesPrice(dbMarket.id), yesPriceNum.toString());
      await setCache(cacheKeys.marketNoPrice(dbMarket.id), noPriceNum.toString());
    }
  } catch (err) {
    console.error("[Indexer] Failed to update market row:", err);
  }

  // Always publish the realtime event — the socket is the only fast signal
  // to the UI, so even when we couldn't fetch fresh prices we still notify
  // with whatever we have (cached prices from the market row). The reconciler
  // will follow up and correct the prices within ~15s.
  try {
    const sharesNum = Number(shares) / 1e18;
    const collateralNum = Number(collateral) / 1e6;
    const lastTradePrice = sharesNum > 0 ? collateralNum / sharesNum : 0;

    const marketStatsPayload = {
      marketId: dbMarket.id,
      yesPrice: yesPriceNum,
      noPrice: noPriceNum,
      yesReserve: pricesFetched ? formatUnits(yesReserve, 18) : undefined,
      noReserve: pricesFetched ? formatUnits(noReserve, 18) : undefined,
      lastTradePrice,
      lastTradeSide: isYes ? "YES" : "NO",
      lastTradeIsBuy: isBuy,
      volume: newVolume,
      liquidity: liveLiquidity ? Number(liveLiquidity) : undefined,
      pricesStale: !pricesFetched,
    };

    await publishEvent("market:price", marketStatsPayload);
    await publishEvent("market:update", marketStatsPayload);
  } catch (err) {
    console.error("[Indexer] Failed to publish market:price event:", err);
  }

  await publishEvent("trade:new", {
    marketId: dbMarket.id,
    trader: traderAddr,
    isYes,
    isBuy,
    shares: sharesStr,
    collateral: collateralStr,
    txHash,
  });

  // ─── Update user position (per-side balance + cost basis) ───
  //
  // Per-side cost basis lets the portfolio show an accurate average price and
  // live PnL for a user who holds BOTH YES and NO on the same market. On BUY
  // we add the USDC collateral to the side's cost basis. On SELL we remove a
  // *proportional* slice of the cost basis so the remaining avg price stays
  // unchanged (same behavior as "average cost" accounting). avgEntryPrice is
  // maintained for backward compat — new UI code should read yes/noAvgPrice.
  const existing = await db
    .select()
    .from(userPositions)
    .where(
      and(
        eq(userPositions.marketId, dbMarket.id),
        eq(userPositions.userAddress, traderAddr)
      )
    )
    .limit(1);

  const collateralNumForPos = Number(collateral) / 1e6;
  const sharesNumForPos = Number(shares) / 1e18;

  if (existing.length === 0) {
    // First-ever interaction for (user, market). A fresh SELL here would mean
    // the chain gave the user shares we never indexed — treat it as a zero
    // starting point; the reconciler will fix the balance on its next pass.
    const yesBalance = isYes && isBuy ? sharesStr : "0";
    const noBalance = !isYes && isBuy ? sharesStr : "0";
    const yesCost = isYes && isBuy ? collateralStr : "0";
    const noCost = !isYes && isBuy ? collateralStr : "0";
    const yesAvg =
      isYes && isBuy && sharesNumForPos > 0
        ? Math.max(0, Math.min(1, collateralNumForPos / sharesNumForPos))
        : 0;
    const noAvg =
      !isYes && isBuy && sharesNumForPos > 0
        ? Math.max(0, Math.min(1, collateralNumForPos / sharesNumForPos))
        : 0;

    await db.insert(userPositions).values({
      marketId: dbMarket.id,
      userAddress: traderAddr,
      yesBalance,
      noBalance,
      avgEntryPrice: isBuy ? (isYes ? yesAvg : noAvg) : 0,
      pnl: "0",
      yesAvgPrice: yesAvg,
      noAvgPrice: noAvg,
      yesCostBasis: yesCost,
      noCostBasis: noCost,
    });
  } else {
    const pos = existing[0];
    let newYes = pos.yesBalance;
    let newNo = pos.noBalance;
    let newYesCost = pos.yesCostBasis;
    let newNoCost = pos.noCostBasis;

    if (isYes) {
      if (isBuy) {
        newYes = addBigIntStrings(pos.yesBalance, sharesStr);
        newYesCost = (Number(pos.yesCostBasis) + collateralNumForPos).toFixed(6);
      } else {
        // Proportional cost removal: cost_out = cost * (shares_sold / shares_before)
        const before = Number(pos.yesBalance);
        const sold = Math.min(sharesNumForPos, before);
        const costBefore = Number(pos.yesCostBasis);
        const costRemoved =
          before > 0 ? costBefore * (sold / before) : 0;
        newYes = subBigIntStrings(pos.yesBalance, sharesStr);
        newYesCost = Math.max(0, costBefore - costRemoved).toFixed(6);
        // If the remaining balance is dust, snap cost basis to zero so the
        // avg price doesn't explode from float residue.
        if (Number(newYes) < 1e-9) newYesCost = "0";
      }
    } else {
      if (isBuy) {
        newNo = addBigIntStrings(pos.noBalance, sharesStr);
        newNoCost = (Number(pos.noCostBasis) + collateralNumForPos).toFixed(6);
      } else {
        const before = Number(pos.noBalance);
        const sold = Math.min(sharesNumForPos, before);
        const costBefore = Number(pos.noCostBasis);
        const costRemoved =
          before > 0 ? costBefore * (sold / before) : 0;
        newNo = subBigIntStrings(pos.noBalance, sharesStr);
        newNoCost = Math.max(0, costBefore - costRemoved).toFixed(6);
        if (Number(newNo) < 1e-9) newNoCost = "0";
      }
    }

    const newYesBal = Number(newYes);
    const newNoBal = Number(newNo);
    const newYesAvg =
      newYesBal > 1e-9 ? Math.max(0, Math.min(1, Number(newYesCost) / newYesBal)) : 0;
    const newNoAvg =
      newNoBal > 1e-9 ? Math.max(0, Math.min(1, Number(newNoCost) / newNoBal)) : 0;

    // Legacy avgEntryPrice — pick whichever side the user actually holds so
    // older readers keep seeing something sensible. New UI uses per-side values.
    const legacyAvg =
      newYesBal > newNoBal ? newYesAvg : newNoBal > 0 ? newNoAvg : 0;

    await db
      .update(userPositions)
      .set({
        yesBalance: newYes,
        noBalance: newNo,
        yesCostBasis: newYesCost,
        noCostBasis: newNoCost,
        yesAvgPrice: newYesAvg,
        noAvgPrice: newNoAvg,
        avgEntryPrice: legacyAvg,
      })
      .where(eq(userPositions.id, pos.id));
  }

  // Invalidate user share balance cache and notify
  if (isYes) {
    await setCache(cacheKeys.userYesBalance(traderAddr, dbMarket.id), "0");
  } else {
    await setCache(cacheKeys.userNoBalance(traderAddr, dbMarket.id), "0");
  }
  await publishEvent("user:shares", {
    wallet: traderAddr,
    marketId: dbMarket.id,
  });
}

async function handleTrade(log: any) {
  const { marketId, trader, isYes, isBuy, shares, collateral: col } = log.args;
  console.log(`[Indexer] Trade on market #${marketId} by ${trader} (tx=${log.transactionHash})`);
  await processTradeFill({
    onChainMarketId: marketId as bigint,
    trader: trader as string,
    isYes: isYes as boolean,
    isBuy: isBuy as boolean,
    shares: shares as bigint,
    collateral: col as bigint,
    txHash: log.transactionHash as string,
    blockNumber: log.blockNumber as bigint | undefined,
  });
}

async function handleMarketResolved(log: any) {
  const { marketId, result } = log.args;
  console.log(`[Indexer] MarketResolved #${marketId} → ${result === 1 ? "YES" : "NO"}`);

  await db
    .update(markets)
    .set({ resolved: true, result: Number(result), status: "resolved" })
    .where(eq(markets.onChainId, Number(marketId)));

  // Find the DB market to get the internal ID and AMM address
  const market = await db
    .select()
    .from(markets)
    .where(eq(markets.onChainId, Number(marketId)))
    .limit(1);

  if (market.length > 0) {
    // Stop polling this pool — resolved markets receive no new trades
    if (market[0].ammAddress) {
      unwatchPool(market[0].ammAddress);
    }

    await publishEvent("market:resolved", {
      marketId: market[0].id,
      result: Number(result),
    });
  }
}

async function handleRedeemed(log: any) {
  const { marketId, user, amount } = log.args;
  console.log(`[Indexer] Redeemed on market #${marketId} by ${user}: ${amount}`);

  // Find the DB market
  const market = await db
    .select()
    .from(markets)
    .where(eq(markets.onChainId, Number(marketId)))
    .limit(1);

  if (market.length === 0) return;
  const dbMarket = market[0];
  const userAddr = (user as string).toLowerCase();
  const usdcAmount = formatUnits(amount, 6);

  try {
    await db
      .insert(vaultTransactions)
      .values({
        userAddress: userAddr,
        type: "redemption",
        amount: usdcAmount,
        txHash: log.transactionHash as string,
        blockNumber:
          log.blockNumber !== undefined ? log.blockNumber.toString() : null,
      })
      .onConflictDoNothing({ target: vaultTransactions.txHash });
  } catch (err) {
    console.error("[Indexer] Failed to persist redemption:", err);
  }

  // Zero out the winning side balance for this user
  const updates: Record<string, string> =
    dbMarket.result === 1 ? { yesBalance: "0" } : { noBalance: "0" };

  await db
    .update(userPositions)
    .set(updates)
    .where(
      and(
        eq(userPositions.marketId, dbMarket.id),
        eq(userPositions.userAddress, userAddr)
      )
    );

  const balance = await refreshVaultBalance(user as `0x${string}`);
  await publishEvent("user:balance", {
    wallet: userAddr,
    type: "redemption",
    amount: usdcAmount,
    usdcBalance: balance,
    txHash: log.transactionHash,
  });
}

// ─── Start watching events ───

export async function startIndexer() {
  // Always watch pools for existing markets, even if the factory address isn't
  // configured (e.g. a dev left MARKET_FACTORY_ADDRESS unset) — trades still
  // need to be indexed.
  try {
    // Only watch pools for markets that are still active — resolved markets
    // will never emit new Trade events, so watching them just wastes RPC quota.
    const existingMarkets = await db
      .select()
      .from(markets)
      .where(eq(markets.resolved, false));
    for (const m of existingMarkets) {
      watchTradesForPool(m.ammAddress as `0x${string}`);
    }
    console.log(`[Indexer] Watching trades for ${existingMarkets.length} active pool(s)`);
  } catch (err) {
    console.error("[Indexer] Failed to load existing markets for trade watching:", err);
  }

  if (FACTORY_ADDRESS) {
    // ONE filter covers all three factory events — cuts eth_getFilterChanges
    // calls from 3× to 1× the polling interval.
    console.log(`[Indexer] Watching events on factory: ${FACTORY_ADDRESS}`);
    publicClient.watchEvent({
      address: FACTORY_ADDRESS,
      onLogs: (logs) => {
        const parsed = parseEventLogs({
          abi: MarketFactoryABI,
          logs,
          strict: false,
        });
        for (const log of parsed) {
          if (log.eventName === "MarketCreated") handleMarketCreated(log);
          else if (log.eventName === "MarketResolved") handleMarketResolved(log);
          else if (log.eventName === "Redeemed") handleRedeemed(log);
        }
      },
    });
  } else {
    console.warn("[Indexer] No MARKET_FACTORY_ADDRESS set — factory event watching disabled");
  }

  // Start watching Vault events
  startVaultWatcher();

  // Start the price reconciler — heals any market whose DB-cached prices
  // diverge from the on-chain AMM (e.g. a post-trade RPC failure left the
  // row stale) and fixes already-stuck markets on boot.
  startPriceReconciler();

  console.log("[Indexer] Event watchers started");
}

// ─── Vault event handlers ───

// Read the authoritative on-chain balance from the user's escrow and refresh cache.
async function refreshVaultBalance(user: `0x${string}`) {
  if (!VAULT_ADDRESS) return null;
  try {
    const balance = await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: VaultABI,
      functionName: "balanceOf",
      args: [user],
    }) as bigint;
    const formatted = formatUnits(balance, 6);
    await setCache(cacheKeys.userUsdcBalance(user.toLowerCase()), formatted);
    return formatted;
  } catch {
    return null;
  }
}

async function handleVaultDeposit(log: any) {
  const { user, amount } = log.args;
  const wallet = (user as string).toLowerCase();
  const usdcAmount = formatUnits(amount, 6);
  console.log(`[Indexer] Vault Deposit: ${wallet} deposited ${usdcAmount} USDC`);

  // Persist transaction history (unique on tx_hash → safe to call twice).
  try {
    await db
      .insert(vaultTransactions)
      .values({
        userAddress: wallet,
        type: "deposit",
        amount: usdcAmount,
        txHash: log.transactionHash as string,
        blockNumber:
          log.blockNumber !== undefined ? log.blockNumber.toString() : null,
      })
      .onConflictDoNothing({ target: vaultTransactions.txHash });
  } catch (err) {
    console.error("[Indexer] Failed to persist vault deposit:", err);
  }

  const balance = await refreshVaultBalance(user as `0x${string}`);

  await publishEvent("user:balance", {
    wallet,
    type: "deposit",
    amount: usdcAmount,
    usdcBalance: balance,
    txHash: log.transactionHash,
  });
}

async function handleVaultWithdraw(log: any) {
  const { user, amount } = log.args;
  const wallet = (user as string).toLowerCase();
  const usdcAmount = formatUnits(amount, 6);
  console.log(`[Indexer] Vault Withdraw: ${wallet} withdrew ${usdcAmount} USDC`);

  try {
    await db
      .insert(vaultTransactions)
      .values({
        userAddress: wallet,
        type: "withdraw",
        amount: usdcAmount,
        txHash: log.transactionHash as string,
        blockNumber:
          log.blockNumber !== undefined ? log.blockNumber.toString() : null,
      })
      .onConflictDoNothing({ target: vaultTransactions.txHash });
  } catch (err) {
    console.error("[Indexer] Failed to persist vault withdraw:", err);
  }

  const balance = await refreshVaultBalance(user as `0x${string}`);

  await publishEvent("user:balance", {
    wallet,
    type: "withdraw",
    amount: usdcAmount,
    usdcBalance: balance,
    txHash: log.transactionHash,
  });
}

async function handleVaultBalanceUpdated(log: any) {
  const { user, newBalance } = log.args;
  const wallet = (user as string).toLowerCase();
  const balance = formatUnits(newBalance, 6);

  await setCache(cacheKeys.userUsdcBalance(wallet), balance);
  await publishEvent("user:balance", {
    wallet,
    usdcBalance: balance,
  });
}

async function handleEscrowCreated(log: any) {
  const { user, escrow } = log.args;
  const wallet = (user as string).toLowerCase();
  console.log(`[Indexer] EscrowCreated: ${wallet} -> ${escrow}`);

  await setCache(cacheKeys.userEscrow(wallet), (escrow as string).toLowerCase());

  await publishEvent("user:escrow", {
    wallet,
    escrow: (escrow as string).toLowerCase(),
  });
}

function startVaultWatcher() {
  if (!VAULT_ADDRESS) {
    console.log("[Indexer] No VAULT_ADDRESS set — skipping vault event watching");
    return;
  }

  // ONE filter covers all four Vault events — cuts eth_getFilterChanges
  // calls from 4× to 1× the polling interval.
  console.log(`[Indexer] Watching Vault events on: ${VAULT_ADDRESS}`);
  publicClient.watchEvent({
    address: VAULT_ADDRESS,
    onLogs: (logs) => {
      const parsed = parseEventLogs({ abi: VaultABI, logs, strict: false });
      for (const log of parsed) {
        if (log.eventName === "Deposit") handleVaultDeposit(log);
        else if (log.eventName === "Withdraw") handleVaultWithdraw(log);
        else if (log.eventName === "BalanceUpdated") handleVaultBalanceUpdated(log);
        else if (log.eventName === "EscrowCreated") handleEscrowCreated(log);
      }
    },
  });
}

/// Add a CPMM pool to the global Trade watcher (idempotent).
/// Returns a function that removes it from the watcher when called.
export function watchTradesForPool(ammAddress: `0x${string}`): () => void {
  const key = ammAddress.toLowerCase();
  if (watchedPools.has(key)) {
    return () => unwatchPool(ammAddress);
  }

  console.log(`[Indexer] Adding pool to global Trade watcher: ${ammAddress}`);
  watchedPools.add(key);
  restartGlobalTradeWatcher();
  return () => unwatchPool(ammAddress);
}

/// Remove a pool from the global Trade watcher (called when its market resolves).
function unwatchPool(ammAddress: string): void {
  const key = ammAddress.toLowerCase();
  if (!watchedPools.has(key)) return;
  watchedPools.delete(key);
  restartGlobalTradeWatcher();
  console.log(`[Indexer] Removed resolved pool from Trade watcher: ${ammAddress}`);
}

// ─── Price reconciler ───
//
// Safety net that protects against any `processTradeFill` call that failed to
// update the DB (e.g. RPC hiccup, blockNumber-pinned read into a pruned block,
// or a pre-fix stuck market). Every RECONCILE_INTERVAL_MS we batch-read
// `getPrices()` for every unresolved market in a single multicall and fix any
// row whose DB-cached price has drifted from the chain by more than
// PRICE_EPSILON.
const PRICE_EPSILON = 0.005;
const RECONCILE_INTERVAL_MS = Number(
  process.env.PRICE_RECONCILE_INTERVAL_MS || 15_000
);

let reconcilerStarted = false;

async function reconcilePrices(): Promise<void> {
  let active: typeof markets.$inferSelect[];
  try {
    active = await db.select().from(markets);
  } catch (err) {
    console.error("[Reconciler] Failed to load markets:", err);
    return;
  }

  // Only reconcile markets that can still move. Resolved / locked / cancelled
  // markets don't receive trades, so their prices are frozen by design.
  const candidates = active.filter(
    (m) =>
      !m.resolved &&
      m.status !== "locked" &&
      m.status !== "resolving" &&
      m.status !== "resolved" &&
      m.status !== "cancelled" &&
      !!m.ammAddress
  );
  if (candidates.length === 0) return;

  let results: unknown[];
  try {
    results = await publicClient.multicall({
      allowFailure: true,
      contracts: candidates.map((m) => ({
        address: m.ammAddress as `0x${string}`,
        abi: CPMMABI,
        functionName: "getPrices",
      })),
    });
  } catch (err) {
    console.error("[Reconciler] Batch getPrices multicall failed:", err);
    return;
  }

  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i];
    const r = results[i] as { status: string; result?: readonly [bigint, bigint] };
    if (!r || r.status !== "success" || !r.result) continue;

    const [yesPriceRaw, noPriceRaw] = r.result;
    const yesPriceNum = Number(yesPriceRaw) / 1e18;
    const noPriceNum = Number(noPriceRaw) / 1e18;
    if (!Number.isFinite(yesPriceNum) || !Number.isFinite(noPriceNum)) continue;

    const dbYes = m.yesPrice ?? 0.5;
    const dbNo = m.noPrice ?? 0.5;
    if (
      Math.abs(yesPriceNum - dbYes) < PRICE_EPSILON &&
      Math.abs(noPriceNum - dbNo) < PRICE_EPSILON
    ) {
      continue;
    }

    console.log(
      `[Reconciler] Healing drift on market #${m.id} (onChain=${m.onChainId}): ` +
        `db=(${dbYes.toFixed(4)}, ${dbNo.toFixed(4)}) → chain=(${yesPriceNum.toFixed(4)}, ${noPriceNum.toFixed(4)})`
    );

    try {
      await db
        .update(markets)
        .set({ yesPrice: yesPriceNum, noPrice: noPriceNum })
        .where(eq(markets.id, m.id));

      await setCache(cacheKeys.marketYesPrice(m.id), yesPriceNum.toString());
      await setCache(cacheKeys.marketNoPrice(m.id), noPriceNum.toString());

      await publishEvent("market:price", {
        marketId: m.id,
        yesPrice: yesPriceNum,
        noPrice: noPriceNum,
        volume: Number(m.volume),
        reconciled: true,
      });
    } catch (err) {
      console.error(`[Reconciler] Failed to heal market #${m.id}:`, err);
    }
  }
}

export function startPriceReconciler(): void {
  if (reconcilerStarted) return;
  reconcilerStarted = true;

  console.log(
    `[Reconciler] Starting price reconciler (interval=${RECONCILE_INTERVAL_MS}ms, epsilon=${PRICE_EPSILON})`
  );

  // Fire once on boot so any already-stuck markets heal immediately without
  // waiting a full interval.
  void reconcilePrices();

  setInterval(() => {
    void reconcilePrices().catch((err) =>
      console.error("[Reconciler] Uncaught error:", err)
    );
  }, RECONCILE_INTERVAL_MS);
}
