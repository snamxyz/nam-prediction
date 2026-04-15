type MarketExecutionMode = "amm" | "clob";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;

  return defaultValue;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseExecutionMode(value: string | undefined): MarketExecutionMode {
  return value === "clob" ? "clob" : "amm";
}

export const featureFlags = {
  enableAmmTrading: parseBoolean(process.env.ENABLE_AMM_TRADING, true),
  enableClobTrading: parseBoolean(process.env.ENABLE_CLOB_TRADING, false),
  defaultMarketExecutionMode: parseExecutionMode(process.env.DEFAULT_MARKET_EXECUTION_MODE),
  marketLockWindowSeconds: parseNumber(process.env.MARKET_LOCK_WINDOW_SECONDS, 10),
  settlementBatchIntervalMs: parseNumber(process.env.SETTLEMENT_BATCH_INTERVAL_MS, 30000),
} as const;

export function assertAmmEnabled() {
  if (!featureFlags.enableAmmTrading) {
    throw new Error("AMM trading is currently disabled");
  }
}

export function assertClobEnabled() {
  if (!featureFlags.enableClobTrading) {
    throw new Error("CLOB trading is currently disabled");
  }
}
