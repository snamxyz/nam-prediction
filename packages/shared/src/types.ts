// ─── Resolution source types ───
export const ResolutionSource = {
  ADMIN: "admin",
  API: "api",
  DEXSCREENER: "dexscreener",
  UMA: "uma",
} as const;
export type ResolutionSourceType = (typeof ResolutionSource)[keyof typeof ResolutionSource];

// Resolution source on-chain IDs
export const ResolutionSourceId = {
  admin: 0,
  api: 1,
  dexscreener: 2,
  uma: 3,
} as const;

// ─── Market execution and lifecycle types ───
export const MarketExecutionMode = {
  AMM: "amm",
  CLOB: "clob",
} as const;
export type MarketExecutionModeType = (typeof MarketExecutionMode)[keyof typeof MarketExecutionMode];

export const MarketCadence = {
  DAILY: "daily",
  H24: "24h",
} as const;
export type MarketCadenceType = (typeof MarketCadence)[keyof typeof MarketCadence];

export const MarketStatus = {
  CREATED: "created",
  OPEN: "open",
  LOCKED: "locked",
  RESOLVING: "resolving",
  RESOLVED: "resolved",
  CANCELLED: "cancelled",
} as const;
export type MarketStatusType = (typeof MarketStatus)[keyof typeof MarketStatus];

export interface DexScreenerResolutionConfig {
  comparison: ">=" | "<=";
  threshold: number;
}

export type ResolutionConfig = DexScreenerResolutionConfig | Record<string, unknown> | null;

// ─── Market types ───
export interface Market {
  id: number;
  onChainId: number;
  question: string;
  yesToken: string;
  noToken: string;
  ammAddress: string;
  executionMode?: MarketExecutionModeType;
  cadence?: MarketCadenceType;
  status?: MarketStatusType;
  lockTime?: string;
  endTime: string;
  resolved: boolean;
  result: number; // 0 = unresolved, 1 = YES, 2 = NO
  yesPrice: number;
  noPrice: number;
  volume: string;
  liquidity: string;
  createdAt: string;
  resolutionSource: ResolutionSourceType;
  resolutionConfig: ResolutionConfig;
}

export interface Trade {
  id: number;
  marketId: number;
  trader: string;
  isYes: boolean;
  isBuy: boolean;
  shares: string;
  collateral: string;
  yesPrice: number;
  noPrice: number;
  txHash: string;
  timestamp: string;
}

export interface UserPosition {
  id: number;
  marketId: number;
  userAddress: string;
  yesBalance: string;
  noBalance: string;
  avgEntryPrice: number;
  pnl: string;
}

// ─── CLOB order types ───
export const OrderSide = {
  BUY: "buy",
  SELL: "sell",
} as const;
export type OrderSideType = (typeof OrderSide)[keyof typeof OrderSide];

export const OrderOutcome = {
  YES: "yes",
  NO: "no",
} as const;
export type OrderOutcomeType = (typeof OrderOutcome)[keyof typeof OrderOutcome];

export const OrderType = {
  LIMIT: "limit",
  MARKET: "market",
} as const;
export type OrderTypeType = (typeof OrderType)[keyof typeof OrderType];

export const OrderStatus = {
  OPEN: "open",
  PARTIALLY_FILLED: "partially_filled",
  FILLED: "filled",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  REJECTED: "rejected",
} as const;
export type OrderStatusType = (typeof OrderStatus)[keyof typeof OrderStatus];

export interface Order {
  id: number;
  orderId: string;
  marketId: number;
  userAddress: string;
  side: OrderSideType;
  outcome: OrderOutcomeType;
  orderType: OrderTypeType;
  price: string;
  quantity: string;
  filledQuantity: string;
  remainingQuantity: string;
  status: OrderStatusType;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderFill {
  id: number;
  marketId: number;
  makerOrderId: number;
  takerOrderId: number;
  makerAddress: string;
  takerAddress: string;
  outcome: OrderOutcomeType;
  price: string;
  quantity: string;
  makerFee: string;
  takerFee: string;
  settled: boolean;
  createdAt: string;
}

// ─── Custody and settlement types ───
export const SettlementStatus = {
  PENDING: "pending",
  SUBMITTED: "submitted",
  CONFIRMED: "confirmed",
  FAILED: "failed",
} as const;
export type SettlementStatusType = (typeof SettlementStatus)[keyof typeof SettlementStatus];

export interface Balance {
  id: number;
  userAddress: string;
  asset: string;
  available: string;
  locked: string;
  updatedAt: string;
}

export interface Holding {
  id: number;
  marketId: number;
  userAddress: string;
  yesAvailable: string;
  yesLocked: string;
  noAvailable: string;
  noLocked: string;
  updatedAt: string;
}

export interface Settlement {
  id: number;
  settlementId: string;
  marketId: number;
  status: SettlementStatusType;
  fillsCount: number;
  totalQuantity: string;
  totalNotional: string;
  txHash: string | null;
  errorMessage: string | null;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
}

// ─── Market data + risk types ───
export interface PriceSnapshot {
  id: number;
  pairAddress: string;
  priceUsd: string;
  liquidityUsd: string | null;
  volume24hUsd: string | null;
  sourceTimestamp: string | null;
  timestamp: string;
  stale: boolean;
  anomalyScore: number;
}

export interface LiquiditySnapshot {
  id: number;
  pairAddress: string;
  liquidityUsd: string;
  baseLiquidity: string | null;
  quoteLiquidity: string | null;
  timestamp: string;
}

export interface ResolutionLog {
  id: number;
  marketId: number;
  pairAddress: string | null;
  policy: string;
  lockTime: string;
  resolvedPrice: string | null;
  outcome: number | null;
  sourceSnapshotId: number | null;
  status: string;
  txHash: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export const RiskSeverity = {
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
} as const;
export type RiskSeverityType = (typeof RiskSeverity)[keyof typeof RiskSeverity];

export interface RiskEvent {
  id: number;
  marketId: number | null;
  userAddress: string | null;
  eventType: string;
  severity: RiskSeverityType;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ─── Range market types ───

export interface RangeOutcome {
  index: number;
  min: number | null;
  max: number | null;
  label: string;
}

export interface RangeMarket {
  id: number;
  marketType: string;          // "receipts" | "participants"
  date: string;                // YYYY-MM-DD resolution date
  question: string;
  ranges: RangeOutcome[];
  rangeTokenAddresses: string[];
  rangePrices: number[];       // current probabilities (0–1 each, sum to 1)
  rangeCpmmAddress: string | null;  // on-chain LMSR pool address
  onChainMarketId: number | null;
  totalLiquidity: string;
  status: string;              // "creating" | "active" | "resolved" | "cancelled"
  resolved: boolean;
  winningRangeIndex: number | null;
  endTime: string;             // ISO timestamp
  resolvedAt: string | null;
  createdAt: string;
}

export interface RangePosition {
  id: number;
  rangeMarketId: number;
  userAddress: string;
  rangeIndex: number;
  balance: string;       // decimal shares string (18 decimals)
  avgEntryPrice: number; // probability at time of purchase
  costBasis: string;     // total USDC spent
  pnl: string;
}

export interface RangeTrade {
  id: number;
  rangeMarketId: number;
  trader: string;
  rangeIndex: number;
  isBuy: boolean;
  shares: string;
  collateral: string;
  pricesSnapshot: number[];
  txHash: string;
  timestamp: string;
}

// ─── API response wrappers ───
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}

// ─── Market result enum ───
export const MarketResult = {
  UNRESOLVED: 0,
  YES: 1,
  NO: 2,
} as const;
export type MarketResultType = (typeof MarketResult)[keyof typeof MarketResult];
