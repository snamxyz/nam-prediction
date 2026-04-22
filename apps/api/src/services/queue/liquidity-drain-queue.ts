/**
 * BullMQ recurring job that drains excess liquidity from resolved AMM pools.
 *
 * Schedule: every 60 seconds
 * Concurrency: 1 (serialised tx dispatch)
 *
 * Flow:
 *  1. Find markets where `resolved=true AND liquidityDrained=false`.
 *  2. Read outstanding winning claims + withdrawable liquidity via multicall.
 *     The on-chain `getWithdrawableLiquidity` already reserves outstanding
 *     claims plus `claimsBufferBps` headroom, so every tick can safely sweep
 *     whatever it reports — no time gate is needed.
 *  3. Call factory.drainMarketLiquidity(onChainId, ZeroAddress) so the excess
 *     USDC is routed to the factory-level treasury.
 *  4. Update DB fields (liquidityDrained / liquidityWithdrawn / reservedClaims /
 *     outstandingWinningClaims / drainedAt).
 */
import { Queue, Worker } from "bullmq";
import { createWalletClient, http, zeroAddress, formatUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { and, eq } from "drizzle-orm";
import { CPMMABI, MarketFactoryABI } from "@nam-prediction/shared";
import { createRedisConnection, acquireLock, releaseLock } from "../../lib/redis";
import { db } from "../../db/client";
import { markets } from "../../db/schema";
import { publicClient } from "../indexer";
import { getNonceManager } from "../../lib/nonce-manager.instance";

const QUEUE_NAME = "liquidity-drain";

const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}` | undefined;
const WRITE_RPC_URL =
  process.env.WRITE_RPC_URL ||
  process.env.RPC_URL ||
  "https://mainnet.base.org";

const POLL_INTERVAL_MS = Number(process.env.LIQUIDITY_DRAIN_POLL_MS) || 60_000;

// ─── Queue ───

const connection = createRedisConnection();

export const liquidityDrainQueue = new Queue(QUEUE_NAME, { connection });

export async function setupLiquidityDrainSchedule() {
  const existing = await liquidityDrainQueue.getRepeatableJobs();
  for (const job of existing) {
    await liquidityDrainQueue.removeRepeatableByKey(job.key);
  }

  await liquidityDrainQueue.add(
    "drain-liquidity",
    {},
    {
      repeat: { every: POLL_INTERVAL_MS },
      removeOnComplete: 50,
      removeOnFail: 20,
    }
  );

  console.log(`[LiquidityDrain] Scheduled every ${POLL_INTERVAL_MS / 1000}s`);
}

// ─── Worker ───

export function startLiquidityDrainWorker() {
  if (!FACTORY_ADDRESS) {
    console.warn("[LiquidityDrain] MARKET_FACTORY_ADDRESS not set — worker idle");
    return null;
  }

  const workerConnection = createRedisConnection();
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      try {
        await processPendingDrains();
      } catch (err) {
        console.error("[LiquidityDrain] Job failed:", err);
        throw err;
      }
    },
    { connection: workerConnection, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[LiquidityDrain] Job ${job?.id} failed:`, err.message);
  });

  console.log("[LiquidityDrain] Worker started");
  return worker;
}

// ─── Core logic ───

async function processPendingDrains() {
  if (!FACTORY_ADDRESS) return;

  // The on-chain `getWithdrawableLiquidity` already subtracts outstanding
  // claims plus the configured buffer, so we can sweep every tick without a
  // time-based gate. If the buffer hasn't yet released any excess, the call
  // returns 0 and we simply wait for the next tick.
  const pending = await db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.resolved, true),
        eq(markets.liquidityDrained, false)
      )
    );

  if (pending.length === 0) return;

  for (const market of pending) {
    try {
      await drainMarket(market);
    } catch (err) {
      console.error(
        `[LiquidityDrain] Market #${market.onChainId} drain failed:`,
        err
      );
      // Don't rethrow — one bad market shouldn't block the rest.
    }
  }
}

async function drainMarket(market: typeof markets.$inferSelect) {
  const lockKey = `drain:market:${market.id}`;
  const acquired = await acquireLock(lockKey, 300); // 5-min TTL
  if (!acquired) {
    console.log(`[LiquidityDrain] Market #${market.onChainId} already in progress — skipping`);
    return;
  }

  try {
    const ammAddress = market.ammAddress as `0x${string}`;

    // Read claims + withdrawable in one multicall so both numbers are consistent
    // with each other (same block).
    const [outstandingClaims, withdrawable, alreadyDrained] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: ammAddress, abi: CPMMABI, functionName: "getOutstandingWinningClaims" },
        { address: ammAddress, abi: CPMMABI, functionName: "getWithdrawableLiquidity" },
        { address: ammAddress, abi: CPMMABI, functionName: "liquidityDrained" },
      ],
    }) as [bigint, bigint, boolean];

    if (alreadyDrained) {
      console.log(
        `[LiquidityDrain] Market #${market.onChainId} already drained on-chain — healing DB`
      );
      const withdrawnOnChain = (await publicClient.readContract({
        address: ammAddress,
        abi: CPMMABI,
        functionName: "liquidityWithdrawn",
      })) as bigint;
      await db
        .update(markets)
        .set({
          liquidityDrained: true,
          liquidityWithdrawn: formatUnits(withdrawnOnChain, 6),
          reservedClaims: formatUnits(outstandingClaims, 6),
          outstandingWinningClaims: formatUnits(outstandingClaims, 6),
          drainedAt: new Date(),
        })
        .where(eq(markets.id, market.id));
      return;
    }

    if (withdrawable === 0n) {
      // Pool balance is still at or below claims + buffer. This is normal right
      // after resolution — as winners redeem, `claims` (and therefore the
      // reserved amount) decreases, releasing the excess for the next tick.
      // Do NOT mark the DB row as drained; just move on.
      return;
    }

    console.log(
      `[LiquidityDrain] Draining market #${market.onChainId}: ` +
        `withdrawable=${formatUnits(withdrawable, 6)} USDC, ` +
        `reservedClaims=${formatUnits(outstandingClaims, 6)} USDC`
    );

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not set");
    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(WRITE_RPC_URL, {
        retryCount: 3,
        retryDelay: 500,
        timeout: 30_000,
      }),
    });

    const txHash = await getNonceManager().withNonce((nonce) =>
      walletClient.writeContract({
        address: FACTORY_ADDRESS!,
        abi: MarketFactoryABI,
        functionName: "drainMarketLiquidity",
        args: [BigInt(market.onChainId), zeroAddress],
        nonce,
      })
    );

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`drainMarketLiquidity reverted (tx=${txHash})`);
    }

    await db
      .update(markets)
      .set({
        liquidityDrained: true,
        liquidityWithdrawn: formatUnits(withdrawable, 6),
        reservedClaims: formatUnits(outstandingClaims, 6),
        outstandingWinningClaims: formatUnits(outstandingClaims, 6),
        drainedAt: new Date(),
      })
      .where(eq(markets.id, market.id));

    console.log(
      `[LiquidityDrain] Market #${market.onChainId} drained — tx=${txHash}, ` +
        `amount=${formatUnits(withdrawable, 6)} USDC`
    );
  } finally {
    await releaseLock(lockKey);
  }
}
