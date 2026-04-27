"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { useSocket } from "./useSocket";
import type { RangeMarket, RangePosition, RangeTrade } from "@nam-prediction/shared";

// ─── Data hooks ───

export function useRangeMarkets(type?: string) {
  return useQuery<RangeMarket[]>({
    queryKey: ["range-markets", type ?? "all"],
    queryFn: () =>
      fetchApi<RangeMarket[]>(type ? `/range-markets?type=${type}` : "/range-markets"),
    refetchInterval: 15_000,
  });
}

export function useActiveRangeMarkets() {
  return useQuery<RangeMarket[]>({
    queryKey: ["range-markets-active"],
    queryFn: () => fetchApi<RangeMarket[]>("/range-markets/active"),
    refetchInterval: 10_000,
  });
}

export function useRangeMarket(id: number | undefined) {
  return useQuery<RangeMarket>({
    queryKey: ["range-market", id],
    queryFn: () => fetchApi<RangeMarket>(`/range-markets/${id}`),
    enabled: id != null,
    refetchInterval: 10_000,
  });
}

export function useRangeMarketByType(type: string) {
  const { data: markets } = useRangeMarkets();
  return markets?.find((m) => m.marketType === type && m.status === "active") ?? null;
}

export function useRangePositions(marketId: number | undefined, userAddress: string | undefined) {
  return useQuery<RangePosition[]>({
    queryKey: ["range-positions", marketId, userAddress],
    queryFn: () =>
      fetchApi<RangePosition[]>(`/range-markets/${marketId}/positions/${userAddress}`),
    enabled: marketId != null && !!userAddress,
    refetchInterval: 15_000,
  });
}

export function useRangeTrades(marketId: number | undefined) {
  return useQuery<RangeTrade[]>({
    queryKey: ["range-trades", marketId],
    queryFn: () => fetchApi<RangeTrade[]>(`/range-markets/${marketId}/trades`),
    enabled: marketId != null,
    refetchInterval: 10_000,
  });
}

// ─── Live socket hook ───

interface RangePriceUpdate {
  marketId: number;
  rangePrices?: number[];
  ranges?: { index: number; label: string }[];
  marketType?: string;
  status?: string;
  type?: string;
}

interface RangeResolvedUpdate {
  marketId: number;
  winningRangeIndex?: number;
  winningLabel?: string;
  type?: string;
}

export interface LiveRangeStats {
  rangePrices: number[];
  winningRangeIndex?: number;
  resolved?: boolean;
}

export function useRangeMarketSocket(marketId: number | undefined) {
  const { socket, connected } = useSocket();
  const queryClient = useQueryClient();
  const [livePrices, setLivePrices] = useState<number[] | null>(null);
  const [resolved, setResolved] = useState<RangeResolvedUpdate | null>(null);

  useEffect(() => {
    setLivePrices(null);
    setResolved(null);
  }, [marketId]);

  useEffect(() => {
    if (!socket || !marketId || !connected) return;

    socket.emit("join:market", marketId);

    const patchRangeMarket = (data: RangePriceUpdate | RangeResolvedUpdate) => {
      const hasPrices = "rangePrices" in data && Array.isArray(data.rangePrices);
      const prices = hasPrices ? data.rangePrices : undefined;

      if (prices) setLivePrices(prices);

      queryClient.setQueryData<RangeMarket>(["range-market", data.marketId], (current) =>
        current
          ? {
              ...current,
              ...(prices ? { rangePrices: prices } : {}),
              ...("status" in data && data.status ? { status: data.status } : {}),
              ...("winningRangeIndex" in data && data.winningRangeIndex != null
                ? {
                    winningRangeIndex: data.winningRangeIndex,
                    resolved: true,
                    status: "resolved",
                  }
                : {}),
            }
          : current
      );

      const patchList = (markets: RangeMarket[] | undefined) =>
        markets?.map((market) =>
          market.id === data.marketId
            ? {
                ...market,
                ...(prices ? { rangePrices: prices } : {}),
                ...("status" in data && data.status ? { status: data.status } : {}),
                ...("winningRangeIndex" in data && data.winningRangeIndex != null
                  ? {
                      winningRangeIndex: data.winningRangeIndex,
                      resolved: true,
                      status: "resolved",
                    }
                  : {}),
              }
            : market
        );

      queryClient.setQueryData<RangeMarket[]>(["range-markets-active"], patchList);
      queryClient.setQueriesData<RangeMarket[]>(
        { queryKey: ["range-markets"] },
        patchList
      );
    };

    const handlePrice = (data: RangePriceUpdate) => {
      if (data.marketId !== marketId || !data.rangePrices) return;
      if (data.type && data.type !== "range") return;
      patchRangeMarket(data);
      queryClient.invalidateQueries({ queryKey: ["range-markets-active"] });
      queryClient.refetchQueries({ queryKey: ["range-markets-active"] });
    };

    const handleResolved = (data: RangeResolvedUpdate) => {
      if (data.marketId !== marketId) return;
      setResolved(data);
      patchRangeMarket(data);
      queryClient.invalidateQueries({ queryKey: ["range-markets-active"] });
    };

    const handleUpdate = (data: RangePriceUpdate) => {
      if (data.marketId !== marketId) return;
      patchRangeMarket(data);
      queryClient.invalidateQueries({ queryKey: ["range-market", marketId] });
    };

    socket.on("market:price", handlePrice);
    socket.on("market:update", handleUpdate);
    socket.on("market:resolved", handleResolved);

    return () => {
      socket.emit("leave:market", marketId);
      socket.off("market:price", handlePrice);
      socket.off("market:update", handleUpdate);
      socket.off("market:resolved", handleResolved);
    };
  }, [socket, marketId, connected, queryClient]);

  return { livePrices, setLivePrices, resolved };
}
