"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type { Trade } from "@nam-prediction/shared";

export interface RecentTrade extends Trade {
  marketQuestion: string;
}

export function useRecentTrades(limit = 50) {
  return useQuery<RecentTrade[]>({
    queryKey: ["recent-trades", limit],
    queryFn: () => fetchApi<RecentTrade[]>(`/markets/recent-trades?limit=${limit}`),
    refetchInterval: 15_000,
  });
}
