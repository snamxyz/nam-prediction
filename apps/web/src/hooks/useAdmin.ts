"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { authedGetApi } from "@/lib/api";

export interface AdminOverview {
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
  id: number;
  onChainId: number;
  question: string;
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
  housePnl?: string;
  liquidityState?: string;
  seededLiquidity?: string;
  poolAddress?: string | null;
  endTime?: string;
  createdAt: string;
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
      return authedGetApi<{ markets: AdminMarket[] }>(path, token);
    },
    staleTime: 60_000,
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

