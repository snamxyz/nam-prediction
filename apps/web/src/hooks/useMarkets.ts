"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type { Market, Trade } from "@nam-prediction/shared";

export function useMarkets() {
  return useQuery<Market[]>({
    queryKey: ["markets"],
    queryFn: () => fetchApi<Market[]>("/markets"),
    refetchInterval: 15_000,
  });
}

export function useLatestM15Market() {
  return useQuery<Market | null>({
    queryKey: ["m15-latest"],
    queryFn: () => fetchApi<Market | null>("/markets/m15/latest"),
    refetchInterval: 10_000,
  });
}

export function useM15History() {
  return useQuery<Market[]>({
    queryKey: ["m15-history"],
    queryFn: () => fetchApi<Market[]>("/markets/m15/history"),
    refetchInterval: 15_000,
  });
}

export function useMarket(id: string) {
  return useQuery<Market>({
    queryKey: ["market", id],
    queryFn: () => fetchApi<Market>(`/markets/${id}`),
    refetchInterval: 10_000,
  });
}

export function useMarketTrades(id: string) {
  return useQuery<Trade[]>({
    queryKey: ["market-trades", id],
    queryFn: () => fetchApi<Trade[]>(`/markets/${id}/trades`),
    refetchInterval: 10_000,
  });
}
