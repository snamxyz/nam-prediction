"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Market, RangeMarket } from "@nam-prediction/shared";
import { useSocket } from "./useSocket";

type PriceStatus = "provisional" | "confirmed" | "corrected" | "reverted";

interface BinaryPriceUpdate {
  marketId: number;
  yesPrice?: number;
  noPrice?: number;
  volume?: number;
  status?: PriceStatus;
  type?: string;
}

interface RangePriceUpdate {
  marketId: number;
  rangePrices?: number[];
  status?: string;
  type?: string;
}

function isBinaryUpdate(data: BinaryPriceUpdate | RangePriceUpdate): data is BinaryPriceUpdate {
  return data.type !== "range";
}

function validBinaryPrices(data: BinaryPriceUpdate) {
  return Number.isFinite(data.yesPrice) && Number.isFinite(data.noPrice);
}

function validRangePrices(data: RangePriceUpdate) {
  return (
    Array.isArray(data.rangePrices) &&
    data.rangePrices.length > 0 &&
    data.rangePrices.every((price) => Number.isFinite(price))
  );
}

export function useLiveMarketPrices() {
  const { socket, connected } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket || !connected) return;

    const patchBinaryMarket = (data: BinaryPriceUpdate) => {
      if (!validBinaryPrices(data)) return;

      const patchMarket = <T extends Market | null | undefined>(market: T): T => {
        if (!market || market.id !== data.marketId) return market;
        return {
          ...market,
          yesPrice: data.yesPrice!,
          noPrice: data.noPrice!,
          ...(Number.isFinite(data.volume) ? { volume: String(data.volume) } : {}),
        } as T;
      };

      queryClient.setQueryData<Market | null>(["24h-latest"], patchMarket);
      queryClient.setQueryData<Market>(["market", String(data.marketId)], patchMarket);
      queryClient.setQueryData<Market>(["market", data.marketId], patchMarket);
      queryClient.setQueryData<Market[]>(["markets"], (markets) =>
        markets?.map((market) => patchMarket(market))
      );
    };

    const patchRangeMarket = (data: RangePriceUpdate) => {
      if (!validRangePrices(data)) return;

      const patchMarket = (market: RangeMarket): RangeMarket =>
        market.id === data.marketId
          ? {
              ...market,
              rangePrices: data.rangePrices!,
              ...(data.status ? { status: data.status } : {}),
            }
          : market;

      queryClient.setQueryData<RangeMarket>(["range-market", data.marketId], (market) =>
        market ? patchMarket(market) : market
      );
      queryClient.setQueryData<RangeMarket[]>(["range-markets-active"], (markets) =>
        markets?.map(patchMarket)
      );
      queryClient.setQueriesData<RangeMarket[]>(
        { queryKey: ["range-markets"] },
        (markets) => markets?.map(patchMarket)
      );
    };

    const handlePrice = (data: BinaryPriceUpdate | RangePriceUpdate) => {
      if (isBinaryUpdate(data)) patchBinaryMarket(data);
      else patchRangeMarket(data);
    };

    socket.on("market:price", handlePrice);
    return () => {
      socket.off("market:price", handlePrice);
    };
  }, [socket, connected, queryClient]);
}
