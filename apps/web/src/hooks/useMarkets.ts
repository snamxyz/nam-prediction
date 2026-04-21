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

export function useLatestHourlyMarket() {
  return useQuery<Market | null>({
    queryKey: ["24h-latest"],
    queryFn: () => fetchApi<Market | null>("/markets/24h/latest"),
    refetchInterval: 10_000,
  });
}

export function useHourlyHistory() {
  return useQuery<Market[]>({
    queryKey: ["24h-history"],
    queryFn: () => fetchApi<Market[]>("/markets/24h/history"),
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
