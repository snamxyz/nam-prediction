/**
 * Dedicated BullMQ queue + worker that owns the full 15-minute NAM market lifecycle:
 * - Flips open m15 markets to "locked" once past their lockTime.
 * - Resolves m15 markets on-chain after endTime using the DexScreener NAM price.
 * - Creates the next m15 market automatically when none is active.
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
import { createNextM15Market, hasActiveM15Market } from "../m15-market";

const QUEUE_NAME = "m15-resolution";

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

export const m15Queue = new Queue(QUEUE_NAME, { connection });

/**
 * Set up the repeatable job that ticks every minute, plus a one-shot bootstrap
 * job so the worker runs immediately on startup.
 */
export async function setupM15Schedule() {
  // Remove any stale repeatable jobs first
  const existing = await m15Queue.getRepeatableJobs();
  for (const job of existing) {
    await m15Queue.removeRepeatableByKey(job.key);
  }

  await m15Queue.add(
    "tick-m15",
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

  await m15Queue.add(
    "tick-m15-bootstrap",
    {},
    {
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  console.log("[M15Queue] Repeatable m15 tick scheduled every minute (UTC) + bootstrap job enqueued");
}

// ─── Worker ───

export function startM15Worker() {
  const workerConnection = createRedisConnection();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[M15Queue] Processing job: ${job.name} (${job.id})`);
      await processM15Tick();
    },
    {
      connection: workerConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[M15Queue] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[M15Queue] Job ${job?.id} failed:`, err.message);
  });

  console.log("[M15Queue] Worker started");
  return worker;
}

// ─── Core tick logic ───

/**
 * Process a single tick of the m15 market lifecycle:
 * 1. Find the active unresolved m15 market.
 * 2. If past lockTime and still "open", mark it "locked".
 * 3. If past endTime, fetch NAM price and resolve on-chain.
 * 4. If no active m15 market exists (cold start or post-resolution), create one.
 */
export async function processM15Tick(): Promise<void> {
  try {
    const active = await db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.cadence, "m15"),
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
        console.log(`[M15Queue] Market #${market.onChainId} transitioned to locked`);
      }

      // 2. Resolve once past endTime
      if (now >= new Date(market.endTime)) {
        const config = market.resolutionConfig as {
          comparison?: string;
          threshold?: number;
        } | null;

        if (!config || typeof config.threshold !== "number" || !config.comparison) {
          console.warn(
            `[M15Queue] Market #${market.onChainId}: missing resolutionConfig — cannot resolve`
          );
        } else {
          const price = await fetchNamPrice();
          if (price === null) {
            console.error(
              `[M15Queue] Market #${market.onChainId}: failed to fetch NAM price — will retry next tick`
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
                  `[M15Queue] Market #${market.onChainId}: unknown comparison "${config.comparison}"`
                );
                return;
            }

            const result = conditionMet ? 1 : 2;
            console.log(
              `[M15Queue] Resolving market #${market.onChainId}: NAM price $${price} ${config.comparison} $${config.threshold} → ${result === 1 ? "YES" : "NO"}`
            );

            let shouldReconcile = false;
            try {
              const txHash = await resolveMarketOnChain(market.onChainId, result);
              // Empty string means another resolver held the Redis lock — skip this tick.
              if (txHash) shouldReconcile = true;
            } catch (err) {
              if (isAlreadyResolvedError(err)) {
                console.warn(
                  `[M15Queue] Market #${market.onChainId} is already resolved on-chain — reconciling DB`
                );
                shouldReconcile = true;
              } else {
                console.error(
                  `[M15Queue] Market #${market.onChainId}: on-chain resolution failed:`,
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
                `[M15Queue] Market #${market.onChainId} marked resolved in DB (result=${result === 1 ? "YES" : "NO"})`
              );
            }
          }
        }
      }
    }

    // 3. Create the next market if none is active.
    //    This covers cold starts AND the post-resolution rollover within the same tick.
    //    (After a successful resolve, the indexer will flip `resolved=true`; we also
    //    check `hasActiveM15Market()` to avoid races where the DB still shows it unresolved.)
    if (active.length === 0 || resolvedThisTick) {
      const stillActive = await hasActiveM15Market();
      if (!stillActive) {
        try {
          if (settlementPrice !== null) {
            console.log(
              `[M15Queue] Creating next m15 market with threshold $${settlementPrice}`
            );
            await createNextM15Market(">=", settlementPrice);
          } else {
            console.log("[M15Queue] No active m15 market found — creating one");
            await createNextM15Market();
          }
        } catch (err) {
          console.error("[M15Queue] Failed to create next m15 market:", err);
        }
      }
    }
  } catch (err) {
    console.error("[M15Queue] Tick error:", err);
    throw err;
  }
}
