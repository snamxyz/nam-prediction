import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../lib/redis";
import { db } from "../../db/client";
import { dailyMarkets, markets } from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveMarketOnChain } from "../resolution";
import { fetchNamPrice, createDailyMarket, getActiveDailyMarket } from "../daily-market";

const QUEUE_NAME = "daily-resolution";

// ─── Queue ───

const connection = createRedisConnection();

export const resolutionQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Set up the repeatable job that runs at 00:00 UTC every day.
 */
export async function setupResolutionSchedule() {
  // Remove any stale repeatable jobs first
  const existing = await resolutionQueue.getRepeatableJobs();
  for (const job of existing) {
    await resolutionQueue.removeRepeatableByKey(job.key);
  }

  // Add the daily resolution job at 00:00 UTC
  await resolutionQueue.add(
    "resolve-daily",
    {},
    {
      repeat: {
        pattern: "0 0 * * *", // every day at 00:00 UTC
        tz: "UTC",
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  console.log("[BullMQ] Daily resolution job scheduled at 00:00 UTC");
}

// ─── Worker ───

export function startResolutionWorker() {
  const workerConnection = createRedisConnection();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[BullMQ] Processing job: ${job.name} (${job.id})`);

      try {
        await processDailyResolution();
      } catch (err) {
        console.error("[BullMQ] Job failed:", err);
        throw err; // BullMQ will retry based on config
      }
    },
    {
      connection: workerConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[BullMQ] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[BullMQ] Job ${job?.id} failed:`, err.message);
  });

  console.log("[BullMQ] Resolution worker started");
  return worker;
}

// ─── Core resolution logic ───

export async function processDailyResolution() {
  console.log("[DailyResolution] Starting daily resolution...");

  // 1. Find the active daily market
  const activeDailyMarket = await getActiveDailyMarket();
  if (!activeDailyMarket) {
    console.log("[DailyResolution] No active daily market found — skipping");
    return;
  }

  // 2. Fetch current NAM price
  const currentPrice = await fetchNamPrice();
  if (currentPrice === null) {
    console.error("[DailyResolution] Failed to fetch NAM price — cannot resolve");
    throw new Error("Failed to fetch NAM price");
  }

  console.log(`[DailyResolution] NAM price: $${currentPrice}, threshold: $${activeDailyMarket.threshold}`);

  // 3. Determine result
  const threshold = Number(activeDailyMarket.threshold);
  const result = currentPrice >= threshold ? 1 : 2; // 1=YES, 2=NO
  console.log(`[DailyResolution] Result: ${result === 1 ? "YES" : "NO"} (price ${currentPrice >= threshold ? ">=" : "<"} ${threshold})`);

  // 4. Find the on-chain market ID
  // Look for a market that matches this daily market's date
  // The market question contains the date string
  let onChainMarketId: number | null = null;

  if (activeDailyMarket.marketId) {
    // If we have a direct link
    const market = await db
      .select()
      .from(markets)
      .where(eq(markets.id, activeDailyMarket.marketId))
      .limit(1);
    if (market.length > 0) {
      onChainMarketId = market[0].onChainId;
    }
  }

  if (!onChainMarketId) {
    // Fallback: find by date in question text
    const allMarkets = await db
      .select()
      .from(markets)
      .where(eq(markets.resolved, false))
      .orderBy(desc(markets.createdAt));

    for (const m of allMarkets) {
      if (m.question.includes(activeDailyMarket.date) && m.resolutionSource === "dexscreener") {
        onChainMarketId = m.onChainId;
        // Link it for future reference
        await db
          .update(dailyMarkets)
          .set({ marketId: m.id })
          .where(eq(dailyMarkets.id, activeDailyMarket.id));
        break;
      }
    }
  }

  if (!onChainMarketId) {
    console.error("[DailyResolution] Could not find on-chain market for daily market:", activeDailyMarket.date);
    throw new Error(`No on-chain market found for date ${activeDailyMarket.date}`);
  }

  // 5. Resolve on-chain
  const txHash = await resolveMarketOnChain(onChainMarketId, result);
  console.log(`[DailyResolution] Market resolved on-chain, tx: ${txHash}`);

  // 6. Update daily_markets record
  await db
    .update(dailyMarkets)
    .set({
      status: "resolved",
      settlementPrice: currentPrice.toString(),
    })
    .where(eq(dailyMarkets.id, activeDailyMarket.id));

  console.log(`[DailyResolution] Daily market ${activeDailyMarket.date} resolved. Settlement price: $${currentPrice}`);

  // 7. Create next day's market using current price as new threshold
  try {
    console.log(`[DailyResolution] Creating next day's market with threshold $${currentPrice}`);
    await createDailyMarket(currentPrice);
    console.log("[DailyResolution] Next day's market created successfully");
  } catch (err) {
    console.error("[DailyResolution] Failed to create next day's market:", err);
    // Don't throw — the resolution itself succeeded
  }
}
