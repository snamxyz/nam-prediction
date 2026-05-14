"use client";

import { useEffect, useState } from "react";
import { useSocket } from "./useSocket";

interface MarketPriceUpdate {
  marketId: number;
  yesPrice: number;
  noPrice: number;
  yesReserve?: string;
  noReserve?: string;
  lastTradePrice?: number;
  lastTradeSide?: "YES" | "NO";
  lastTradeIsBuy?: boolean;
  volume?: number;
  liquidity?: number;
}

interface TradeUpdate {
  marketId: number;
  trader: string;
  isYes: boolean;
  isBuy: boolean;
  shares: string;
  collateral: string;
  txHash: string;
}

interface MarketResolvedUpdate {
  marketId: number;
  result: number;
}

export interface LiveMarketStats {
  yesPrice: number;
  noPrice: number;
  yesReserve?: string;
  noReserve?: string;
  lastTradePrice?: number;
  lastTradeSide?: "YES" | "NO";
  lastTradeIsBuy?: boolean;
  volume?: number;
  liquidity?: number;
}

export function useMarketSocket(marketId: number | undefined) {
  const { socket, connected } = useSocket();
  const [stats, setStats] = useState<LiveMarketStats | null>(null);
  const [lastTrade, setLastTrade] = useState<TradeUpdate | null>(null);
  const [resolved, setResolved] = useState<MarketResolvedUpdate | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!socket || !marketId || !connected) return;

    socket.emit("join:market", marketId);

    const handleMarketStats = (data: MarketPriceUpdate) => {
      if (data.marketId !== marketId) return;
      setStats({
        yesPrice: data.yesPrice,
        noPrice: data.noPrice,
        yesReserve: data.yesReserve,
        noReserve: data.noReserve,
        lastTradePrice: data.lastTradePrice,
        lastTradeSide: data.lastTradeSide,
        lastTradeIsBuy: data.lastTradeIsBuy,
        volume: data.volume,
        liquidity: data.liquidity,
      });
    };

    const handleTrade = (data: TradeUpdate) => {
      if (data.marketId === marketId) {
        setLastTrade(data);
      }
    };

    const handleResolved = (data: MarketResolvedUpdate) => {
      if (data.marketId === marketId) {
        setResolved(data);
      }
    };

    const handleLocked = (data: { marketId: number }) => {
      if (data.marketId === marketId) {
        setLocked(true);
      }
    };

    socket.on("market:price", handleMarketStats);
    socket.on("market:update", handleMarketStats);
    socket.on("trade:new", handleTrade);
    socket.on("market:resolved", handleResolved);
    socket.on("market:locked", handleLocked);

    return () => {
      socket.emit("leave:market", marketId);
      socket.off("market:price", handleMarketStats);
      socket.off("market:update", handleMarketStats);
      socket.off("trade:new", handleTrade);
      socket.off("market:resolved", handleResolved);
      socket.off("market:locked", handleLocked);
    };
  }, [socket, marketId, connected]);

  // Back-compat surface: `prices` remains a `{yesPrice,noPrice}` shape so existing
  // callers keep working; `stats` exposes the full realtime payload.
  const prices = stats ? { yesPrice: stats.yesPrice, noPrice: stats.noPrice } : null;

  return { prices, stats, lastTrade, resolved, locked };
}
