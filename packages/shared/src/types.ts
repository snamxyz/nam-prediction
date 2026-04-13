// ─── Resolution source types ───
export const ResolutionSource = {
  ADMIN: "admin",
  API: "api",
  DEXSCREENER: "dexscreener",
} as const;
export type ResolutionSourceType = (typeof ResolutionSource)[keyof typeof ResolutionSource];

// Resolution source on-chain IDs
export const ResolutionSourceId = {
  admin: 0,
  api: 1,
  dexscreener: 2,
} as const;

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
