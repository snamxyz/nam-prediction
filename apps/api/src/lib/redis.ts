import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

export function createRedisConnection() {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}
