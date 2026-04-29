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

export interface AdminMarket {
  id: number;
  onChainId: number;
  question: string;
  cadence: string;
  category?: string;
  marketType?: string;
  status?: string;
  resolved: boolean;
  result: number;
  tradeCount: number;
  totalVolume: string;
  liquidity?: string;
  liquidityWithdrawn?: string;
  reservedClaims?: string;
  outstandingWinningClaims?: string;
  housePnl?: string;
  liquidityState?: string;
  createdAt: string;
}

export interface AdminTrade {
  id: number;
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

export function useAdminMarkets(status: "active" | "resolved" | "all" = "all") {
  const getAccessToken = useToken();
  return useQuery({
    queryKey: ["admin-markets", status],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const path = status === "all"
        ? "/admin/markets?limit=100"
        : `/admin/markets?limit=100&status=${status}`;
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
