/**
 * Fallback cron: reconciles markets that are marked resolved in the DB
 * but whose on-chain state still shows unresolved.
 *
 * This catches edge cases such as:
 *   - a resolution TX that was submitted but reverted / never confirmed
 *   - the indexer missing a MarketResolved event and updating the DB directly
 *     while the chain call was dropped
 *   - race conditions between the resolution worker and the indexer
 *
 * Runs on a repeating BullMQ schedule (every 15 min in prod/staging, 30 min
 * in dev).  Uses multicall to batch on-chain reads, then fires one TX per
 * stale market while honouring the same Redis locks used by the primary
 * resolution workers so that concurrent resolution is impossible.
 */
import { Queue, Worker } from "bullmq";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { createRedisConnection, acquireLock, releaseLock } from "../../lib/redis";
import { db } from "../../db/client";
import { markets, rangeMarkets } from "../../db/schema";
import { MarketFactoryABI, RangeMarketFactoryABI } from "@nam-prediction/shared";
import { resolveMarketOnChain } from "../resolution";
import { getInitializedNonceManager } from "../../lib/nonce-manager.instance";
import { runtimeConfig } from "../../config/runtime";

const QUEUE_NAME = "resolution-fallback";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const BINARY_FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}` | undefined;
const RANGE_FACTORY_ADDRESS = (
  process.env.RANGE_FACTORY_ADDRESS || process.env.MARKET_FACTORY_ADDRESS
) as `0x${string}` | undefined;
const RANGE_MARKET_ONCHAIN = process.env.RANGE_MARKET_ONCHAIN !== "false";

// ─── Queue ───

const connection = createRedisConnection();

export const resolutionFallbackQueue = new Queue(QUEUE_NAME, { connection });

export async function setupResolutionFallbackSchedule(): Promise<void> {
  const existing = await resolutionFallbackQueue.getRepeatableJobs();
  for (const job of existing) {
    await resolutionFallbackQueue.removeRepeatableByKey(job.key);
  }

  const repeatEveryMs = runtimeConfig.intervals.resolutionFallbackMs;

  await resolutionFallbackQueue.add(
    "fallback-check",
    {},
    {
      repeat: { every: repeatEveryMs },
      removeOnComplete: 50,
      removeOnFail: 25,
    }
  );

  console.log(`[ResolutionFallback] Scheduled every ${repeatEveryMs / 1000}s`);
}

// ─── Worker ───

export function startResolutionFallbackWorker() {
  const workerConnection = createRedisConnection();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[ResolutionFallback] Processing job ${job.id}`);
      try {
        await runResolutionFallback();
      } catch (err) {
        console.error("[ResolutionFallback] Job failed:", err);
        throw err;
      }
    },
    { connection: workerConnection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    console.log(`[ResolutionFallback] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[ResolutionFallback] Job ${job?.id} failed:`, err.message);
  });

  console.log("[ResolutionFallback] Worker started");
  return worker;
}

// ─── Core reconciliation logic ───

export async function runResolutionFallback(): Promise<void> {
  console.log("[ResolutionFallback] Starting reconciliation sweep...");

  await reconcileBinaryMarkets();
  await reconcileRangeMarkets();

  console.log("[ResolutionFallback] Sweep complete");
}

// ─── Binary markets ───────────────────────────────────────────────────────────

async function reconcileBinaryMarkets(): Promise<void> {
  if (!BINARY_FACTORY_ADDRESS) {
    console.log("[ResolutionFallback] No MARKET_FACTORY_ADDRESS — skipping binary markets");
    return;
  }

  const now = new Date();

  // Only consider markets that are DB-resolved with a valid result (1=YES,2=NO)
  // and whose endTime has already passed (time is up).
  const candidates = await db
    .select({
      id: markets.id,
      onChainId: markets.onChainId,
      result: markets.result,
      endTime: markets.endTime,
    })
    .from(markets)
    .where(
      and(
        eq(markets.resolved, true),
        lt(markets.endTime, now)
      )
    );

  const actionable = candidates.filter((m) => m.result === 1 || m.result === 2);

  if (actionable.length === 0) {
    console.log("[ResolutionFallback] No binary market candidates");
    return;
  }

  console.log(`[ResolutionFallback] Checking ${actionable.length} binary market(s) on-chain...`);

  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });

  // Batch all on-chain reads in a single multicall.
  const calls = actionable.map((m) => ({
    address: BINARY_FACTORY_ADDRESS as `0x${string}`,
    abi: MarketFactoryABI,
    functionName: "getMarket" as const,
    args: [BigInt(m.onChainId)] as const,
  }));

  const results = await publicClient.multicall({ contracts: calls, allowFailure: true });

  let fixedCount = 0;

  for (let i = 0; i < actionable.length; i++) {
    const market = actionable[i];
    const call = results[i];

    if (call.status === "failure") {
      console.warn(
        `[ResolutionFallback] getMarket(${market.onChainId}) failed on-chain — skipping`,
        call.error
      );
      continue;
    }

    const onChainMarket = call.result as { resolved: boolean };

    if (onChainMarket.resolved) {
      // Already resolved on-chain — nothing to do.
      continue;
    }

    console.log(
      `[ResolutionFallback] Binary market onChainId=${market.onChainId} is resolved in DB ` +
        `(result=${market.result}) but NOT on-chain — fixing...`
    );

    try {
      // resolveMarketOnChain already holds a Redis lock and waits for the
      // receipt, so calling it here is safe even if the primary worker races.
      await resolveMarketOnChain(market.onChainId, market.result as 1 | 2);
      fixedCount++;
    } catch (err) {
      console.error(
        `[ResolutionFallback] Failed to resolve binary market onChainId=${market.onChainId}:`,
        err
      );
    }
  }

  console.log(`[ResolutionFallback] Binary markets reconciled: ${fixedCount} fixed`);
}

// ─── Range markets ────────────────────────────────────────────────────────────

async function reconcileRangeMarkets(): Promise<void> {
  if (!RANGE_MARKET_ONCHAIN) {
    console.log("[ResolutionFallback] Range markets are off-chain only — skipping");
    return;
  }
  if (!RANGE_FACTORY_ADDRESS) {
    console.log("[ResolutionFallback] No RANGE_FACTORY_ADDRESS — skipping range markets");
    return;
  }

  const now = new Date();

  const candidates = await db
    .select({
      id: rangeMarkets.id,
      onChainMarketId: rangeMarkets.onChainMarketId,
      winningRangeIndex: rangeMarkets.winningRangeIndex,
      endTime: rangeMarkets.endTime,
    })
    .from(rangeMarkets)
    .where(
      and(
        eq(rangeMarkets.resolved, true),
        isNotNull(rangeMarkets.onChainMarketId),
        isNotNull(rangeMarkets.winningRangeIndex),
        lt(rangeMarkets.endTime, now)
      )
    );

  if (candidates.length === 0) {
    console.log("[ResolutionFallback] No range market candidates");
    return;
  }

  console.log(`[ResolutionFallback] Checking ${candidates.length} range market(s) on-chain...`);

  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });

  const calls = candidates.map((m) => ({
    address: RANGE_FACTORY_ADDRESS as `0x${string}`,
    abi: RangeMarketFactoryABI,
    functionName: "getMarket" as const,
    args: [BigInt(m.onChainMarketId!)] as const,
  }));

  const results = await publicClient.multicall({ contracts: calls, allowFailure: true });

  let fixedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const market = candidates[i];
    const call = results[i];

    if (call.status === "failure") {
      console.warn(
        `[ResolutionFallback] getMarket(range ${market.onChainMarketId}) failed on-chain — skipping`,
        call.error
      );
      continue;
    }

    const onChainMarket = call.result as { resolved: boolean };

    if (onChainMarket.resolved) {
      continue;
    }

    console.log(
      `[ResolutionFallback] Range market id=${market.id} onChainMarketId=${market.onChainMarketId} ` +
        `is resolved in DB (winningRangeIndex=${market.winningRangeIndex}) but NOT on-chain — fixing...`
    );

    const lockKey = `resolve:range-market:${market.id}`;
    const acquired = await acquireLock(lockKey, 120);
    if (!acquired) {
      console.log(
        `[ResolutionFallback] Range market id=${market.id} resolution already in progress — skipping`
      );
      continue;
    }

    try {
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) throw new Error("PRIVATE_KEY not set");

      const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
      const account = privateKeyToAccount(key as `0x${string}`);
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: http(RPC_URL),
      });

      const txHash = await (await getInitializedNonceManager()).withNonce((nonce) =>
        walletClient.writeContract({
          address: RANGE_FACTORY_ADDRESS as `0x${string}`,
          abi: RangeMarketFactoryABI,
          functionName: "resolveRangeMarket",
          args: [BigInt(market.onChainMarketId!), BigInt(market.winningRangeIndex!)],
          nonce,
        })
      );

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      console.log(
        `[ResolutionFallback] Range market id=${market.id} resolved on-chain, tx=${txHash}`
      );
      fixedCount++;
    } catch (err) {
      await releaseLock(lockKey);
      console.error(
        `[ResolutionFallback] Failed to resolve range market id=${market.id}:`,
        err
      );
    }
  }

  console.log(`[ResolutionFallback] Range markets reconciled: ${fixedCount} fixed`);
}
