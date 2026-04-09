// ─── Resolution source types ───
export const ResolutionSource = {
  ADMIN: "admin",
  INTERNAL: "internal",
  DEXSCREENER: "dexscreener",
  UMA: "uma",
} as const;
export type ResolutionSourceType = (typeof ResolutionSource)[keyof typeof ResolutionSource];

// Resolution source on-chain IDs
export const ResolutionSourceId = {
  admin: 0,
  internal: 1,
  dexscreener: 2,
  uma: 3,
} as const;

// Source-specific resolution configs
export interface InternalResolutionConfig {
  metricName: string;
  comparison: ">=" | "<=" | "==" | ">";
  threshold: number;
}

export interface DexScreenerResolutionConfig {
  comparison: ">=" | "<=";
  threshold: number;
}

export interface UmaResolutionConfig {
  claim: string;
  bond: number;
}

export type ResolutionConfig =
  | InternalResolutionConfig
  | DexScreenerResolutionConfig
  | UmaResolutionConfig
  | null;

// ─── Market types ───
export interface Market {
  id: number;
  onChainId: number;
  question: string;
  yesToken: string;
  noToken: string;
  ammAddress: string;
  endTime: number;
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

// ─── Internal metrics ───
export interface InternalMetric {
  id: number;
  metricName: string;
  value: string;
  updatedAt: string;
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
