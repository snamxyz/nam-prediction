import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../lib/redis";
import { refreshAdminSnapshots } from "../admin-snapshots";

const QUEUE_NAME = "admin-snapshots";

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
      repeat: { pattern: "* * * * *", tz: "UTC" },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  await adminSnapshotQueue.add("bootstrap", {}, { removeOnComplete: true, removeOnFail: true });

  console.log("[AdminSnapshots] Scheduled: every minute + bootstrap job enqueued");
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
