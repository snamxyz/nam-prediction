/**
 * Dedicated BullMQ queue + worker that owns the full 24-hour NAM market lifecycle:
 * - Flips open hourly markets to "locked" once past their lockTime.
 * - Resolves hourly markets on-chain after endTime using the DexScreener NAM price.
 * - Creates the next hourly market automatically when none is active.
 *
 * Scheduled to tick every minute. Also enqueues a one-shot bootstrap job on startup
 * so the first tick runs immediately without waiting up to a minute.
 */
import { Queue, Worker } from "bullmq";
import { eq, and } from "drizzle-orm";
import { createRedisConnection, publishEvent } from "../../lib/redis";
import { db } from "../../db/client";
import { markets } from "../../db/schema";
import { resolveMarketOnChain } from "../resolution";
import { fetchNamPrice } from "../daily-market";
import { createNextHourlyMarket, hasActiveHourlyMarket } from "../hourly-market";

const QUEUE_NAME = "hourly-resolution";

/**
 * Detect the "Already resolved" revert from the MarketFactory contract.
 * This happens when the DB row is out of sync with on-chain state
 * (e.g. indexer missed the MarketResolved event).
 */
function isAlreadyResolvedError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as {
    details?: unknown;
    shortMessage?: unknown;
    message?: unknown;
    cause?: { details?: unknown; shortMessage?: unknown; message?: unknown };
  };
  const candidates: unknown[] = [
    anyErr.details,
    anyErr.shortMessage,
    anyErr.message,
    anyErr.cause?.details,
    anyErr.cause?.shortMessage,
    anyErr.cause?.message,
  ];
  return candidates.some(
    (c) => typeof c === "string" && /already resolved/i.test(c)
  );
}

// ─── Queue ───

const connection = createRedisConnection();

export const hourlyQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Set up the repeatable job that ticks every minute, plus a one-shot bootstrap
 * job so the worker runs immediately on startup.
 */
export async function setupHourlySchedule() {
  // Remove any stale repeatable jobs first
  const existing = await hourlyQueue.getRepeatableJobs();
  for (const job of existing) {
    await hourlyQueue.removeRepeatableByKey(job.key);
  }

  await hourlyQueue.add(
    "tick-24h",
    {},
    {
      repeat: {
        pattern: "* * * * *", // every minute
        tz: "UTC",
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  await hourlyQueue.add(
    "tick-24h-bootstrap",
    {},
    {
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  console.log("[HourlyQueue] Repeatable 24h tick scheduled every minute (UTC) + bootstrap job enqueued");
}

// ─── Worker ───

export function startHourlyWorker() {
  const workerConnection = createRedisConnection();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[HourlyQueue] Processing job: ${job.name} (${job.id})`);
      await processHourlyTick();
    },
    {
      connection: workerConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[HourlyQueue] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[HourlyQueue] Job ${job?.id} failed:`, err.message);
  });

  console.log("[HourlyQueue] Worker started");
  return worker;
}

// ─── Core tick logic ───

/**
 * Process a single tick of the hourly market lifecycle:
 * 1. Find the active unresolved hourly market.
 * 2. If past lockTime and still "open", mark it "locked".
 * 3. If past endTime, fetch NAM price and resolve on-chain.
 * 4. If no active hourly market exists (cold start or post-resolution), create one.
 */
export async function processHourlyTick(): Promise<void> {
  try {
    const active = await db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.cadence, "24h"),
          eq(markets.resolved, false),
        )
      )
      .limit(1);

    let resolvedThisTick = false;
    let settlementPrice: number | null = null;

    if (active.length > 0) {
      const market = active[0];
      const now = new Date();

      // 1. Transition open -> locked once we're past the lockTime
      if (
        market.status === "open" &&
        market.lockTime &&
        now >= new Date(market.lockTime)
      ) {
        await db
          .update(markets)
          .set({ status: "locked" })
          .where(eq(markets.id, market.id));
        market.status = "locked";
        await publishEvent("market:locked", { marketId: market.id });
        console.log(`[HourlyQueue] Market #${market.onChainId} transitioned to locked`);
      }

      // 2. Resolve once past endTime
      if (now >= new Date(market.endTime)) {
        const config = market.resolutionConfig as {
          comparison?: string;
          threshold?: number;
        } | null;

        if (!config || typeof config.threshold !== "number" || !config.comparison) {
          console.warn(
            `[HourlyQueue] Market #${market.onChainId}: missing resolutionConfig — cannot resolve`
          );
        } else {
          const price = await fetchNamPrice();
          if (price === null) {
            console.error(
              `[HourlyQueue] Market #${market.onChainId}: failed to fetch NAM price — will retry next tick`
            );
          } else {
            let conditionMet: boolean;
            switch (config.comparison) {
              case ">=":
                conditionMet = price >= config.threshold;
                break;
              case "<=":
                conditionMet = price <= config.threshold;
                break;
              default:
                console.warn(
                  `[HourlyQueue] Market #${market.onChainId}: unknown comparison "${config.comparison}"`
                );
                return;
            }

            const result = conditionMet ? 1 : 2;
            console.log(
              `[HourlyQueue] Resolving market #${market.onChainId}: NAM price $${price} ${config.comparison} $${config.threshold} → ${result === 1 ? "YES" : "NO"}`
            );

            let shouldReconcile = false;
            try {
              const txHash = await resolveMarketOnChain(market.onChainId, result);
              // Empty string means another resolver held the Redis lock — skip this tick.
              if (txHash) shouldReconcile = true;
            } catch (err) {
              if (isAlreadyResolvedError(err)) {
                console.warn(
                  `[HourlyQueue] Market #${market.onChainId} is already resolved on-chain — reconciling DB`
                );
                shouldReconcile = true;
              } else {
                console.error(
                  `[HourlyQueue] Market #${market.onChainId}: on-chain resolution failed:`,
                  err
                );
              }
            }

            if (shouldReconcile) {
              // Resolve the DB ourselves rather than relying on the indexer's
              // MarketResolved event, which can be missed or arrive late.
              await db
                .update(markets)
                .set({
                  resolved: true,
                  result,
                  status: "resolved",
                  resolvedAt: new Date(),
                })
                .where(eq(markets.id, market.id));
              await publishEvent("market:resolved", {
                marketId: market.id,
                result,
              });
              resolvedThisTick = true;
              settlementPrice = price;
              console.log(
                `[HourlyQueue] Market #${market.onChainId} marked resolved in DB (result=${result === 1 ? "YES" : "NO"})`
              );
            }
          }
        }
      }
    }

    // 3. Create the next market if none is active.
    //    This covers cold starts AND the post-resolution rollover within the same tick.
    //    (After a successful resolve, the indexer will flip `resolved=true`; we also
    //    check `hasActiveHourlyMarket()` to avoid races where the DB still shows it unresolved.)
    if (active.length === 0 || resolvedThisTick) {
      const stillActive = await hasActiveHourlyMarket();
      if (!stillActive) {
        try {
          if (settlementPrice !== null) {
            console.log(
              `[HourlyQueue] Creating next hourly market with threshold $${settlementPrice}`
            );
            await createNextHourlyMarket(">=", settlementPrice);
          } else {
            console.log("[HourlyQueue] No active hourly market found — creating one");
            await createNextHourlyMarket();
          }
        } catch (err) {
          console.error("[HourlyQueue] Failed to create next hourly market:", err);
        }
      }
    }
  } catch (err) {
    console.error("[HourlyQueue] Tick error:", err);
    throw err;
  }
}
