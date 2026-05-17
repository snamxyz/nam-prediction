"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { authedGetApi } from "@/lib/api";

export interface AdminOverview {
  snapshotAt?: string;
  snapshotSource?: "redis" | "db";
  stale?: boolean;
  totalUsers: number;
  users24h: number;
  users7d: number;
  totalTrades: number;
  trades24h: number;
  totalVolume: string;
  volume24h: string;
  activeMarkets: number;
  resolvedMarkets: number;
  totalDeposits: string;
  totalWithdrawals: string;
  tvl: string;
  activeLiquidity?: string;
  liquidityWithdrawn?: string;
  reservedClaims?: string;
  outstandingWinningClaims?: string;
  liquidityAtRisk?: string;
}

export interface AdminUser {
  id: number | string;
  privyUserId: string;
  walletAddress: string | null;
  displayName: string | null;
  loginMethod: string | null;
  tradeCount: number;
  totalVolume: string;
  createdAt: string;
}

export interface AdminUserDetail {
  user: Omit<AdminUser, "tradeCount" | "totalVolume"> & {
    tradeCount?: number;
    totalVolume?: string;
  };
  recentTrades: unknown[];
  positions: unknown[];
  vaultTxs: unknown[];
}

export interface AdminMarket {
  snapshotAt?: string;
  snapshotSource?: "redis" | "db";
  stale?: boolean;
  id: number;
  onChainId: number;
  question: string;
  resolutionSource?: string;
  cadence: string;
  category?: string;
  marketType?: string;
  date?: string;
  status?: string;
  resolved: boolean;
  result: number;
  tradeCount: number;
  distinctTraderCount: number;
  totalVolume: string;
  liquidity?: string;
  liquidityWithdrawn?: string;
  reservedClaims?: string;
  outstandingWinningClaims?: string;
  housePnl?: string | null;
  housePnlSource?: "final" | "estimated" | "pending";
  liquidityState?: string;
  seededLiquidity?: string;
  poolAddress?: string | null;
  endTime?: string;
  createdAt: string;
  holderCount?: number;
  openInterestShares?: string;
  largestHolderShares?: string;
  holderConcentrationPct?: string;
  liquidityAtRisk?: string;
  totalYesShares?: string;
  totalNoShares?: string;
  totalRangeShares?: string;
}

export type AdminMarketStatus = "active" | "resolved" | "all";
export type AdminMarketFamily = "token" | "participants" | "receipts";

interface UseAdminMarketsOptions {
  status?: AdminMarketStatus;
  family?: AdminMarketFamily;
  limit?: number;
}

export interface AdminTrade {
  id: number;
  /** Distinguishes id namespaces between `trades` and `range_trades` for list keys. */
  source?: "binary" | "range";
  traderAddress: string;
  marketId: number;
  question: string;
  side: string;
  isBuy: boolean;
  collateral: string;
  shares: string;
  txHash: string;
  createdAt: string;
}

export interface AdminMarketsResponse {
  snapshotAt?: string;
  snapshotSource?: "redis" | "db";
  stale?: boolean;
  markets: AdminMarket[];
}

export interface AdminUserHoldings {
  wallet: string;
  snapshotAt?: string;
  snapshotSource?: "redis" | "db";
  stale?: boolean;
  vault: {
    totalDeposits: string;
    totalWithdrawals: string;
    totalRedemptions: string;
    netDeposits: string;
    transactionCount: number;
    recentTransactions: Array<{
      id: number;
      type: string;
      amount: string;
      txHash: string;
      timestamp: string;
    }>;
  };
  binary: Array<{
    marketId: number;
    question: string;
    resolved: boolean;
    result: number;
    yesBalance: string;
    noBalance: string;
    yesCostBasis: string;
    noCostBasis: string;
  }>;
  range: Array<{
    marketId: number;
    question: string;
    marketType: string;
    rangeIndex: number;
    balance: string;
    costBasis: string;
    avgEntryPrice: number;
    resolved: boolean;
    winningRangeIndex: number | null;
  }>;
}

function useToken() {
  const { getAccessToken } = usePrivy();
  return getAccessToken;
}

export function useAdminOverview() {
  const getAccessToken = useToken();
  return useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      return authedGetApi<AdminOverview>("/admin/analytics/overview", token);
    },
    staleTime: 30_000,
  });
}

export function useAdminUsers(page = 0, limit = 25) {
  const getAccessToken = useToken();
  return useQuery({
    queryKey: ["admin-users", page],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const cursor = page > 0 ? page * limit : undefined;
      const path = `/admin/users?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`;
      return authedGetApi<{ users: AdminUser[]; nextCursor: number | null }>(path, token);
    },
    staleTime: 60_000,
  });
}

export function useAdminUser(id: string | number | undefined) {
  const getAccessToken = useToken();
  return useQuery({
    queryKey: ["admin-user", id],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      return authedGetApi<AdminUserDetail>(`/admin/users/${id}`, token);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useAdminMarkets(input: AdminMarketStatus | UseAdminMarketsOptions = "all") {
  const getAccessToken = useToken();
  const options = typeof input === "string" ? { status: input } : input;
  const status = options.status ?? "all";
  const limit = options.limit ?? 100;

  return useQuery({
    queryKey: ["admin-markets", status, options.family ?? "all", limit],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const params = new URLSearchParams({ limit: String(limit) });
      if (status !== "all") params.set("status", status);
      if (options.family) params.set("family", options.family);
      const path = `/admin/markets?${params.toString()}`;
      return authedGetApi<AdminMarketsResponse>(path, token);
    },
    staleTime: 60_000,
  });
}

export function useAdminUserHoldings(id: string | number | undefined) {
  const getAccessToken = useToken();
  return useQuery({
    queryKey: ["admin-user-holdings", id],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      return authedGetApi<AdminUserHoldings>(`/admin/users/${id}/holdings`, token);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useAdminTrades() {
  const getAccessToken = useToken();
  return useQuery({
    queryKey: ["admin-trades"],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      return authedGetApi<{ trades: AdminTrade[] }>("/admin/trades?limit=50", token);
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
}

