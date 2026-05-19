import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../lib/redis";
import { refreshAdminSnapshots } from "../admin-snapshots";
import { runtimeConfig } from "../../config/runtime";

const QUEUE_NAME = "admin-snapshots";
const REFRESH_INTERVAL_MS = runtimeConfig.intervals.adminSnapshotMs;

const connection = createRedisConnection();
export const adminSnapshotQueue = new Queue(QUEUE_NAME, { connection });

export async function setupAdminSnapshotSchedule(): Promise<void> {
  const existing = await adminSnapshotQueue.getRepeatableJobs();
  for (const job of existing) {
    await adminSnapshotQueue.removeRepeatableByKey(job.key);
  }

  await adminSnapshotQueue.add(
    "refresh",
    {},
    {
      repeat: { every: REFRESH_INTERVAL_MS },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  await adminSnapshotQueue.add("bootstrap", {}, { removeOnComplete: true, removeOnFail: true });

  console.log(`[AdminSnapshots] Scheduled: every ${REFRESH_INTERVAL_MS / 1000}s + bootstrap job enqueued`);
}

export function startAdminSnapshotWorker() {
  const workerConnection = createRedisConnection();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[AdminSnapshots] Processing job: ${job.name}`);
      await refreshAdminSnapshots(job.name);
    },
    { connection: workerConnection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    console.log(`[AdminSnapshots] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[AdminSnapshots] Job ${job?.id} failed:`, err.message);
  });

  console.log("[AdminSnapshots] Worker started");
  return worker;
}
