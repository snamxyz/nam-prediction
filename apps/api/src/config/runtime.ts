type AppEnv = "dev" | "staging" | "prod";
type WorkerProfile = AppEnv;
type WorkerRole = "all" | "api" | "workers";

const truthy = ["1", "true", "yes", "y", "on"];
const falsy = ["0", "false", "no", "n", "off"];

function normalizeEnv(value: string | undefined): AppEnv {
  const normalized = (value || "").trim().toLowerCase();
  if (["prod", "production"].includes(normalized)) return "prod";
  if (["staging", "stage", "preview"].includes(normalized)) return "staging";
  return "dev";
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (truthy.includes(normalized)) return true;
  if (falsy.includes(normalized)) return false;
  return defaultValue;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseRole(value: string | undefined): WorkerRole {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "api" || normalized === "workers") return normalized;
  return "all";
}

const appEnv = normalizeEnv(
  process.env.APP_ENV || process.env.NODE_ENV || process.env.VERCEL_ENV
);
const workerProfile = normalizeEnv(process.env.WORKER_PROFILE || appEnv);
const workerRole = parseRole(process.env.WORKER_ROLE);
const runWorkers = parseBoolean(process.env.RUN_WORKERS, workerProfile === "prod");
const canRunBackgroundWork = runWorkers && workerRole !== "api";

function workerFlag(name: string, defaultValue: boolean): boolean {
  return parseBoolean(process.env[name], defaultValue);
}

function intervalFor(name: string, defaults: Record<WorkerProfile, number>): number {
  return parseNumber(process.env[name], defaults[workerProfile]);
}

export const runtimeConfig = {
  appEnv,
  workerProfile,
  workerRole,
  runWorkers,
  canRunBackgroundWork,
  workers: {
    namPricePoller: workerFlag("ENABLE_NAM_PRICE_POLLER", canRunBackgroundWork),
    nonceManager: workerFlag("ENABLE_NONCE_MANAGER", canRunBackgroundWork),
    vaultWhitelistBootstrap: workerFlag("ENABLE_VAULT_WHITELIST_BOOTSTRAP", canRunBackgroundWork),
    indexer: workerFlag("ENABLE_INDEXER", canRunBackgroundWork),
    priceReconciler: workerFlag("ENABLE_PRICE_RECONCILER", canRunBackgroundWork),
    positionReconciler: workerFlag("ENABLE_POSITION_RECONCILER", canRunBackgroundWork),
    resolutionPoller: workerFlag("ENABLE_RESOLUTION_POLLER", canRunBackgroundWork),
    dailyResolution: workerFlag("ENABLE_DAILY_RESOLUTION_WORKER", canRunBackgroundWork),
    nonceReconciliation: workerFlag("ENABLE_NONCE_RECONCILIATION", canRunBackgroundWork),
    liquidityDrain: workerFlag("ENABLE_LIQUIDITY_DRAIN_WORKER", canRunBackgroundWork),
    hourlyMarkets: workerFlag("ENABLE_24H_MARKETS", canRunBackgroundWork && workerProfile === "prod"),
    rangeMarkets: workerFlag("ENABLE_RANGE_MARKETS", canRunBackgroundWork && workerProfile === "prod"),
    adminSnapshots: workerFlag("ENABLE_ADMIN_SNAPSHOT_WORKER", canRunBackgroundWork),
    adminSnapshotSchedule: workerFlag(
      "ENABLE_ADMIN_SNAPSHOT_SCHEDULE",
      canRunBackgroundWork && workerProfile === "prod"
    ),
    resolutionFallback: workerFlag("ENABLE_RESOLUTION_FALLBACK_WORKER", canRunBackgroundWork),
  },
  intervals: {
    adminSnapshotMs: intervalFor("ADMIN_SNAPSHOT_INTERVAL_MS", {
      dev: 15 * 60_000,
      staging: 15 * 60_000,
      prod: 10 * 60_000,
    }),
    rangeMarketCatchupMs: intervalFor("RANGE_MARKET_CATCHUP_MS", {
      dev: 15 * 60_000,
      staging: 15 * 60_000,
      prod: 10 * 60_000,
    }),
    hourlyMarketCatchupMs: intervalFor("HOURLY_MARKET_CATCHUP_MS", {
      dev: 15 * 60_000,
      staging: 15 * 60_000,
      prod: 10 * 60_000,
    }),
    liquidityDrainMs: intervalFor("LIQUIDITY_DRAIN_POLL_MS", {
      dev: 15 * 60_000,
      staging: 10 * 60_000,
      prod: 5 * 60_000,
    }),
    nonceReconciliationMs: intervalFor("NONCE_RECONCILIATION_INTERVAL_MS", {
      dev: 5 * 60_000,
      staging: 5 * 60_000,
      prod: 2 * 60_000,
    }),
    positionReconcileMs: intervalFor("POSITION_RECONCILE_INTERVAL_MS", {
      dev: 5 * 60_000,
      staging: 5 * 60_000,
      prod: 2 * 60_000,
    }),
    priceReconcileMs: intervalFor("PRICE_RECONCILE_INTERVAL_MS", {
      dev: 5 * 60_000,
      staging: 5 * 60_000,
      prod: 2 * 60_000,
    }),
    resolutionPollMs: intervalFor("RESOLUTION_POLL_INTERVAL", {
      dev: 10 * 60_000,
      staging: 5 * 60_000,
      prod: 2 * 60_000,
    }),
    resolutionFallbackMs: intervalFor("RESOLUTION_FALLBACK_INTERVAL_MS", {
      dev: 30 * 60_000,
      staging: 15 * 60_000,
      prod: 15 * 60_000,
    }),
  },
} as const;

export function enabledWorkerNames(): string[] {
  return Object.entries(runtimeConfig.workers)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}
