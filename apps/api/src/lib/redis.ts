import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

// Separate pub/sub connections (ioredis requires dedicated connections for sub)
export const redisPub = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const redisSub = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export function createRedisConnection() {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

// ─── Cache helpers ───

const DEFAULT_TTL = 60; // seconds

export async function setCache(key: string, value: string, ttl = DEFAULT_TTL): Promise<void> {
  await redis.set(key, value, "EX", ttl);
}

export async function getCache(key: string): Promise<string | null> {
  return redis.get(key);
}

// ─── Pub/Sub helpers ───

export async function publishEvent(channel: string, data: Record<string, unknown>): Promise<void> {
  await redisPub.publish(channel, JSON.stringify(data));
}

// ─── Balance cache keys ───

export const cacheKeys = {
  userUsdcBalance: (wallet: string) => `user_usdc_balance:${wallet.toLowerCase()}`,
  userEscrow: (wallet: string) => `user_escrow:${wallet.toLowerCase()}`,
  userYesBalance: (wallet: string, marketId: number) => `user_yes_balance:${wallet.toLowerCase()}:${marketId}`,
  userNoBalance: (wallet: string, marketId: number) => `user_no_balance:${wallet.toLowerCase()}:${marketId}`,
  marketYesPrice: (marketId: number) => `market_yes_price:${marketId}`,
  marketNoPrice: (marketId: number) => `market_no_price:${marketId}`,
} as const;

// ─── Redis lock for resolution ───

export async function acquireLock(key: string, ttlSeconds = 120): Promise<boolean> {
  const result = await redis.set(key, "true", "EX", ttlSeconds, "NX");
  return result === "OK";
}

export async function releaseLock(key: string): Promise<void> {
  await redis.del(key);
}
