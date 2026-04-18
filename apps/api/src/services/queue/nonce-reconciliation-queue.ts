/**
 * BullMQ recurring job that reconciles the NonceManager state against on-chain
 * nonce counts and handles stuck transactions.
 *
 * Schedule: every 30 seconds
 * Concurrency: 1
 *
 * Actions:
 * 1. Calls resyncNonce() to reconcile Redis vs on-chain state
 * 2. Detects transactions pending longer than stuckThresholdSecs
 * 3. Attempts to cancel stuck transactions via 0-value self-transfer with gas bump
 */
import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../lib/redis";
import { getNonceManager } from "../../lib/nonce-manager.instance";

const QUEUE_NAME = "nonce-reconciliation";

// ─── Queue ───

const connection = createRedisConnection();

export const nonceReconciliationQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Set up the repeatable reconciliation job (every 30 seconds).
 */
export async function setupNonceReconciliation() {
  // Remove stale repeatable jobs first
  const existing = await nonceReconciliationQueue.getRepeatableJobs();
  for (const job of existing) {
    await nonceReconciliationQueue.removeRepeatableByKey(job.key);
  }

  await nonceReconciliationQueue.add(
    "reconcile-nonces",
    {},
    {
      repeat: {
        every: 30_000, // every 30 seconds
      },
      removeOnComplete: 50,
      removeOnFail: 20,
    }
  );

  console.log("[BullMQ] Nonce reconciliation job scheduled (every 30s)");
}

// ─── Worker ───

export function startNonceReconciliationWorker() {
  const workerConnection = createRedisConnection();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      try {
        await processNonceReconciliation();
      } catch (err) {
        console.error("[NonceReconciliation] Job failed:", err);
        throw err;
      }
    },
    {
      connection: workerConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    // Quiet — reconciliation is frequent, only log issues
  });

  worker.on("failed", (job, err) => {
    console.error(`[NonceReconciliation] Job ${job?.id} failed:`, err.message);
  });

  console.log("[BullMQ] Nonce reconciliation worker started");
  return worker;
}

// ─── Core reconciliation logic ───

async function processNonceReconciliation() {
  const nm = getNonceManager();

  // Step 1: Reconcile state against on-chain (also clears stale active_tx)
  const result = await nm.resyncNonce();

  if (result.staleRemoved > 0 || result.nonceAdvanced) {
    console.log(
      `[NonceReconciliation] State reconciled — ` +
        `staleRemoved=${result.staleRemoved}, nonceAdvanced=${result.nonceAdvanced}, ` +
        `onChainLatest=${result.onChainLatest}, onChainPending=${result.onChainPending}`
    );
  }

  // Step 2: Verify active_tx consistency (defense-in-depth)
  const activeTx = await nm.getActiveTx();
  if (activeTx && result.onChainPending <= result.onChainLatest) {
    console.log(
      `[NonceReconciliation] Clearing stale active_tx (nonce=${activeTx.nonce}) — ` +
        `no in-flight tx on-chain`
    );
    await nm.clearActiveTx();
  }

  // Step 3: Detect and handle stuck transactions
  const stuck = await nm.getStuckTransactions();

  if (stuck.length === 0) return;

  console.log(
    `[NonceReconciliation] Found ${stuck.length} stuck transaction(s): ` +
      `nonces=[${stuck.map((s) => s.nonce).join(",")}]`
  );

  for (const { nonce, info } of stuck) {
    try {
      const ageSeconds = Math.floor((Date.now() - info.createdAt) / 1000);
      console.log(
        `[NonceReconciliation] Cancelling stuck nonce=${nonce} ` +
          `(age=${ageSeconds}s, txHash=${info.txHash})`
      );

      const cancelHash = await nm.cancelTransaction(nonce);
      console.log(
        `[NonceReconciliation] Cancel tx sent for nonce=${nonce} — cancelHash=${cancelHash}`
      );
    } catch (err) {
      console.error(
        `[NonceReconciliation] Failed to cancel nonce=${nonce}:`,
        err
      );
      // Continue with other stuck txs — don't let one failure block the rest
    }
  }
}
