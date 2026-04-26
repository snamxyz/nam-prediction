/**
 * BullMQ queue for range market lifecycle:
 *  - Creates "receipts" and "nam-distribution" markets daily at 00:00 ET.
 *  - Ticks every minute to resolve active markets that have passed their endTime.
 *  - Resolution uses Math.random() (to be swapped for real API data later).
 *
 * Schedule: tick every minute (same pattern as hourly-queue.ts).
 * Creation trigger: checked inside each tick — if today's market for a type
 * doesn't exist yet AND we're past 00:00 ET, create it.
 */
import { Queue, Worker } from "bullmq";
import { eq, and, lt } from "drizzle-orm";
import { createWalletClient, createPublicClient, http, parseUnits, parseEventLogs } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createRedisConnection, publishEvent } from "../../lib/redis";
import { db } from "../../db/client";
import { rangeMarkets } from "../../db/schema";
import { RangeMarketFactoryABI, VaultABI, ERC20ABI } from "@nam-prediction/shared";
import { getNonceManager } from "../../lib/nonce-manager.instance";

const VAULT_ADDRESS = process.env.VAULT_ADDRESS as `0x${string}` | undefined;

const QUEUE_NAME = "range-market";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = (process.env.RANGE_FACTORY_ADDRESS || process.env.MARKET_FACTORY_ADDRESS) as `0x${string}`;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const DEFAULT_FEE_BPS = Number(process.env.DEFAULT_FEE_BPS) || 200;
const RANGE_MARKET_LIQUIDITY = Number(process.env.RANGE_MARKET_LIQUIDITY) || 1000;
// When false, markets are created and resolved in DB only (no on-chain txs).
const RANGE_MARKET_ONCHAIN = process.env.RANGE_MARKET_ONCHAIN !== "false";
const CREATING_RETRY_AFTER_MS =
  Number(process.env.RANGE_MARKET_CREATING_RETRY_AFTER_MS) || 30 * 60 * 1000;

// ─── Range definitions ───

interface RangeOutcome {
  index: number;
  min: number | null;
  max: number | null;
  label: string;
}

const RECEIPTS_RANGES: RangeOutcome[] = [
  { index: 0, min: 1, max: 10, label: "1–10" },
  { index: 1, min: 11, max: 20, label: "11–20" },
  { index: 2, min: 21, max: 25, label: "21–25" },
  { index: 3, min: null, max: null, label: ">25" },
];

const NAM_DISTRIBUTION_RANGES: RangeOutcome[] = [
  { index: 0, min: 0, max: 1000, label: "0–1K" },
  { index: 1, min: 1001, max: 5000, label: "1K–5K" },
  { index: 2, min: 5001, max: 10000, label: "5K–10K" },
  { index: 3, min: null, max: null, label: ">10K" },
];

// ─── Helpers ───

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);
  return createWalletClient({ account, chain: base, transport: http(RPC_URL) });
}

function getPublicClient() {
  return createPublicClient({ chain: base, transport: http(RPC_URL) });
}

/**
 * Returns the next 00:00 Eastern Time as a UTC Date, DST-aware.
 */
function getNextMidnightET(): Date {
  const now = new Date();
  const todayET = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [y, m, d] = todayET.split("-").map(Number);
  const nextDayUTC = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = nextDayUTC.getUTCFullYear();
  const nm = String(nextDayUTC.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(nextDayUTC.getUTCDate()).padStart(2, "0");
  let candidate = new Date(`${ny}-${nm}-${nd}T05:00:00Z`);
  const etHour =
    Number(
      candidate
        .toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
        .split(":")[0]
    ) % 24;
  if (etHour !== 0) {
    candidate = new Date(candidate.getTime() - etHour * 60 * 60 * 1000);
  }
  return candidate;
}

/** Returns today's date in ET as YYYY-MM-DD. */
function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Format tomorrow in ET as YYYY-MM-DD. */
function getTomorrowET(): string {
  const now = new Date();
  const todayET = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [y, m, d] = todayET.split("-").map(Number);
  const tmr = new Date(Date.UTC(y, m - 1, d + 1));
  return `${tmr.getUTCFullYear()}-${String(tmr.getUTCMonth() + 1).padStart(2, "0")}-${String(tmr.getUTCDate()).padStart(2, "0")}`;
}

/** Weighted random selection: given N equal-weight ranges, pick one. */
function randomRangeIndex(numRanges: number): number {
  return Math.floor(Math.random() * numRanges);
}

// ─── Market creation ───

/**
 * Create a range market on-chain and insert into DB.
 * @param marketType "receipts" | "nam-distribution"
 * @param ranges     Range outcome definitions.
 * @param date       YYYY-MM-DD resolution date key (used for dedup).
 * @param question   Human-readable market question.
 * @param endTime    Market end time (UTC Date).
 */
async function createRangeMarketOnChain(
  marketType: string,
  ranges: RangeOutcome[],
  date: string,
  question: string,
  endTime: Date,
): Promise<void> {
  if (!FACTORY_ADDRESS) throw new Error("RANGE_FACTORY_ADDRESS not set");

  // Skip only if market already exists in a non-failed state. A stale "creating"
  // row can be left behind if the worker dies before the catch block runs.
  const existing = await db
    .select({
      id: rangeMarkets.id,
      status: rangeMarkets.status,
      createdAt: rangeMarkets.createdAt,
      rangeCpmmAddress: rangeMarkets.rangeCpmmAddress,
      onChainMarketId: rangeMarkets.onChainMarketId,
    })
    .from(rangeMarkets)
    .where(and(eq(rangeMarkets.marketType, marketType), eq(rangeMarkets.date, date)))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    const creatingAgeMs = Date.now() - row.createdAt.getTime();
    const isRetryableStatus = ["cancelled", "failed"].includes(row.status);
    const isStaleCreating =
      row.status === "creating" &&
      creatingAgeMs > CREATING_RETRY_AFTER_MS &&
      !row.rangeCpmmAddress &&
      row.onChainMarketId == null;

    if (!isRetryableStatus && !isStaleCreating) {
      console.log(`[RangeMarketQueue] ${marketType} market for ${date} already exists (${row.status}) — skipping`);
      return;
    }

    if (isStaleCreating) {
      console.warn(
        `[RangeMarketQueue] Retrying stale ${marketType}/${date} creation row after ${Math.round(
          creatingAgeMs / 60000
        )} minutes`
      );
    }
  }

  const initialPrices = ranges.map(() => 1 / ranges.length);

  // Upsert: delete any cancelled/failed sentinel, then insert fresh
  if (existing.length > 0) {
    await db.delete(rangeMarkets).where(eq(rangeMarkets.id, existing[0].id));
  }

  // Insert "creating" sentinel so concurrent workers won't double-create
  await db.insert(rangeMarkets).values({
    marketType,
    date,
    question,
    ranges: ranges as unknown as typeof rangeMarkets.$inferInsert["ranges"],
    rangeTokenAddresses: [] as unknown as typeof rangeMarkets.$inferInsert["rangeTokenAddresses"],
    rangePrices: initialPrices as unknown as typeof rangeMarkets.$inferInsert["rangePrices"],
    status: "creating",
    totalLiquidity: RANGE_MARKET_LIQUIDITY.toString(),
    endTime,
  }).onConflictDoNothing();

  // Re-fetch to get the inserted id
  const inserted = await db
    .select()
    .from(rangeMarkets)
    .where(and(eq(rangeMarkets.marketType, marketType), eq(rangeMarkets.date, date)))
    .limit(1);

  if (inserted.length === 0) {
    console.log(`[RangeMarketQueue] ${marketType}/${date} already being created by another worker`);
    return;
  }
  const dbId = inserted[0].id;

  // ── Off-chain mode: skip on-chain tx, mark active immediately ──
  if (!RANGE_MARKET_ONCHAIN) {
    await db
      .update(rangeMarkets)
      .set({ status: "active", rangePrices: initialPrices as unknown as typeof rangeMarkets.$inferInsert["rangePrices"] })
      .where(eq(rangeMarkets.id, dbId));
    console.log(`[RangeMarketQueue] ${marketType} market created (off-chain mode). dbId=${dbId}`);
    await publishEvent("market:update", { marketId: dbId, marketType, rangePrices: initialPrices, ranges, status: "active" });
    return;
  }

  try {
    const walletClient = getWalletClient();
    const publicClient = getPublicClient();
    const nm = getNonceManager();
    const liquidityUsdc = parseUnits(String(RANGE_MARKET_LIQUIDITY), 6);
    const endTimeUnix = BigInt(Math.floor(endTime.getTime() / 1000));
    const rangeLabels = ranges.map((r) => r.label);

    console.log(`[RangeMarketQueue] Creating ${marketType} market on-chain: "${question}"`);

    // Step 1: Approve USDC
    const approveHash = await nm.withNonce((nonce) =>
      walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [FACTORY_ADDRESS, liquidityUsdc],
        nonce,
      })
    );
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Step 2: Create range market on-chain
    const createHash = await nm.withNonce((nonce) =>
      walletClient.writeContract({
        address: FACTORY_ADDRESS,
        abi: RangeMarketFactoryABI,
        functionName: "createRangeMarket",
        args: [question, endTimeUnix, liquidityUsdc, BigInt(DEFAULT_FEE_BPS), rangeLabels],
        nonce,
      })
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

    if (receipt.status !== "success") {
      throw new Error(`createRangeMarket tx reverted (status=${receipt.status})`);
    }

    // Parse RangeMarketCreated event using parseEventLogs (handles address[] correctly)
    const matchedLogs = parseEventLogs({
      abi: RangeMarketFactoryABI,
      logs: receipt.logs,
      eventName: "RangeMarketCreated",
      strict: false,
    });

    if (matchedLogs.length === 0) {
      console.error(
        `[RangeMarketQueue] Receipt has ${receipt.logs.length} logs but none matched RangeMarketCreated. txHash=${createHash}`
      );
      throw new Error("RangeMarketCreated event not found in receipt");
    }

    const createdArgs = matchedLogs[0].args as {
      marketId: bigint;
      cpmmPool: string;
      rangeTokens: string[];
    };
    const onChainMarketId = Number(createdArgs.marketId);
    const cpmmPool = createdArgs.cpmmPool;
    const tokenAddresses: string[] = [...createdArgs.rangeTokens];

    await db
      .update(rangeMarkets)
      .set({
        onChainMarketId,
        rangeCpmmAddress: cpmmPool,
        rangeTokenAddresses: tokenAddresses as unknown as typeof rangeMarkets.$inferInsert["rangeTokenAddresses"],
        rangePrices: initialPrices as unknown as typeof rangeMarkets.$inferInsert["rangePrices"],
        status: "active",
      })
      .where(eq(rangeMarkets.id, dbId));

    // Whitelist the new CPMM pool in the Vault so executeRangeBuy/Sell work.
    if (VAULT_ADDRESS && cpmmPool) {
      try {
        const whitelistHash = await nm.withNonce((nonce) =>
          walletClient.writeContract({
            address: VAULT_ADDRESS!,
            abi: VaultABI,
            functionName: "whitelistPool",
            args: [cpmmPool as `0x${string}`, true],
            nonce,
          })
        );
        await publicClient.waitForTransactionReceipt({ hash: whitelistHash });
        console.log(`[RangeMarketQueue] Pool ${cpmmPool} whitelisted in Vault.`);
      } catch (wlErr) {
        console.warn(`[RangeMarketQueue] Failed to whitelist pool ${cpmmPool} in Vault:`, wlErr);
      }
    }

    console.log(`[RangeMarketQueue] ${marketType} market created. onChainId=${onChainMarketId} pool=${cpmmPool}`);

    await publishEvent("market:update", {
      marketId: dbId,
      marketType,
      rangePrices: initialPrices,
      ranges,
      status: "active",
    });
  } catch (err) {
    console.error(`[RangeMarketQueue] Failed to create ${marketType} market on-chain:`, err);
    await db.update(rangeMarkets).set({ status: "cancelled" }).where(eq(rangeMarkets.id, dbId));
    throw err;
  }
}

// ─── Resolution ───

/**
 * Resolve any active range markets that have passed their endTime.
 * Uses Math.random() to pick the winning range (temporary; swap for real API data).
 */
async function resolveExpiredMarkets(): Promise<void> {
  const now = new Date();

  const expired = await db
    .select()
    .from(rangeMarkets)
    .where(
      and(
        eq(rangeMarkets.status, "active"),
        eq(rangeMarkets.resolved, false),
        lt(rangeMarkets.endTime, now)
      )
    );

  for (const market of expired) {
    console.log(`[RangeMarketQueue] Resolving market id=${market.id} type=${market.marketType}`);

    const ranges = market.ranges as RangeOutcome[];
    const winningIndex = randomRangeIndex(ranges.length);

    try {
      if (RANGE_MARKET_ONCHAIN && market.onChainMarketId != null && FACTORY_ADDRESS) {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();
        const nm = getNonceManager();

        const resolveHash = await nm.withNonce((nonce) =>
          walletClient.writeContract({
            address: FACTORY_ADDRESS,
            abi: RangeMarketFactoryABI,
            functionName: "resolveRangeMarket",
            args: [BigInt(market.onChainMarketId!), BigInt(winningIndex)],
            nonce,
          })
        );
        await publicClient.waitForTransactionReceipt({ hash: resolveHash });
        console.log(`[RangeMarketQueue] On-chain resolve tx: ${resolveHash}`);
      } else {
        console.log(`[RangeMarketQueue] Market id=${market.id} — resolving DB only (off-chain mode or no on-chain id)`);
      }

      const resolvedPrices = ranges.map((_, i) => (i === winningIndex ? 1 : 0));

      await db.update(rangeMarkets).set({
        resolved: true,
        status: "resolved",
        winningRangeIndex: winningIndex,
        rangePrices: resolvedPrices as unknown as typeof rangeMarkets.$inferInsert["rangePrices"],
        resolvedAt: now,
      }).where(eq(rangeMarkets.id, market.id));

      await publishEvent("market:resolved", {
        marketId: market.id,
        marketType: market.marketType,
        winningRangeIndex: winningIndex,
        winningLabel: ranges[winningIndex]?.label,
      });

      console.log(
        `[RangeMarketQueue] Market id=${market.id} resolved. Winner: range ${winningIndex} (${ranges[winningIndex]?.label})`
      );
    } catch (err) {
      console.error(`[RangeMarketQueue] Failed to resolve market id=${market.id}:`, err);
    }
  }
}

// ─── Market creation check ───

/**
 * Check whether today's markets exist; if not, create them.
 * Only creates if we're at or past 00:00 ET today.
 */
async function ensureTodayMarketsExist(): Promise<void> {
  const date = getTomorrowET();
  const endTime = getNextMidnightET();
  const today = getTodayET();

  const receiptsQuestion = `Total receipts uploaded by ${date}?`;
  const namQuestion = `Number of NAM tokens distributed between ${today} and ${date}?`;

  await createRangeMarketOnChain(
    "receipts",
    RECEIPTS_RANGES,
    date,
    receiptsQuestion,
    endTime,
  ).catch((err: unknown) => console.error("[RangeMarketQueue] Receipts creation error:", err));

  await createRangeMarketOnChain(
    "nam-distribution",
    NAM_DISTRIBUTION_RANGES,
    date,
    namQuestion,
    endTime,
  ).catch((err: unknown) => console.error("[RangeMarketQueue] NAM distribution creation error:", err));
}

// ─── Core tick ───

export async function processRangeMarketTick(): Promise<void> {
  await resolveExpiredMarkets();
  await ensureTodayMarketsExist();
}

// ─── Vault bootstrap whitelist ───

/**
 * At startup, whitelist any active range market CPMM pools that are not yet
 * registered in the Vault's whitelistedPools mapping.
 */
export async function bootstrapVaultWhitelist(): Promise<void> {
  if (!VAULT_ADDRESS) return;

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const nm = getNonceManager();

  const active = await db
    .select({ id: rangeMarkets.id, rangeCpmmAddress: rangeMarkets.rangeCpmmAddress })
    .from(rangeMarkets)
    .where(eq(rangeMarkets.status, "active"));

  for (const market of active) {
    const pool = market.rangeCpmmAddress;
    if (!pool) continue;

    try {
      const alreadyListed = await publicClient.readContract({
        address: VAULT_ADDRESS!,
        abi: VaultABI,
        functionName: "whitelistedPools",
        args: [pool as `0x${string}`],
      }) as boolean;

      if (!alreadyListed) {
        console.log(`[RangeMarketQueue] Whitelisting pool ${pool} in Vault…`);
        const hash = await nm.withNonce((nonce) =>
          walletClient.writeContract({
            address: VAULT_ADDRESS!,
            abi: VaultABI,
            functionName: "whitelistPool",
            args: [pool as `0x${string}`, true],
            nonce,
          })
        );
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`[RangeMarketQueue] Pool ${pool} whitelisted (tx ${hash}).`);
      }
    } catch (err) {
      console.warn(`[RangeMarketQueue] Could not whitelist pool ${pool}:`, err);
    }
  }
}

// ─── Queue setup ───

const connection = createRedisConnection();
export const rangeMarketQueue = new Queue(QUEUE_NAME, { connection });

export async function setupRangeMarketSchedule(): Promise<void> {
  const existing = await rangeMarketQueue.getRepeatableJobs();
  for (const job of existing) {
    await rangeMarketQueue.removeRepeatableByKey(job.key);
  }

  await rangeMarketQueue.add(
    "tick",
    {},
    {
      repeat: { pattern: "* * * * *", tz: "UTC" },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  // One-shot bootstrap job so the first tick runs immediately on startup
  await rangeMarketQueue.add("bootstrap", {}, { removeOnComplete: true, removeOnFail: true });

  console.log("[RangeMarketQueue] Scheduled: every minute + bootstrap job enqueued");
}

export function startRangeMarketWorker() {
  const workerConnection = createRedisConnection();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[RangeMarketQueue] Processing job: ${job.name}`);
      await processRangeMarketTick();
    },
    { connection: workerConnection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    console.log(`[RangeMarketQueue] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[RangeMarketQueue] Job ${job?.id} failed:`, err.message);
  });

  console.log("[RangeMarketQueue] Worker started");
  return worker;
}
