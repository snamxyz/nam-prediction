"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useEffect, useRef } from "react";
import { fetchApi, authedPostApi } from "@/lib/api";
import { usePrivy } from "@privy-io/react-auth";

export interface BinaryPositionWithMarket {
  positionType?: "binary";
  id: number;
  marketId: number;
  onChainId: number;
  userAddress: string;
  // YES leg
  yesBalance: string;
  yesAvgPrice: number;
  yesCostBasis: string;
  yesCurrentValue: string;
  yesPnl: string;
  yesPnlPct: string;
  // NO leg
  noBalance: string;
  noAvgPrice: number;
  noCostBasis: string;
  noCurrentValue: string;
  noPnl: string;
  noPnlPct: string;
  totalCost: string;
  resolvedValue: string;
  redeemed: boolean;
  // Market
  question: string;
  resolved: boolean;
  result: number;
  yesPrice: number;
  noPrice: number;
  // Legacy
  avgEntryPrice: number;
  pnl: string;
  lastReconciledAt: string | null;
}

export interface RangePortfolioPosition {
  positionType: "range";
  id: number;
  marketId: number;
  onChainId: number | null;
  marketType: "receipts" | "participants" | string;
  question: string;
  resolved: boolean;
  status: string;
  winningRangeIndex: number | null;
  ranges: { index: number; label: string }[];
  rangePrices: number[];
  rangeIndex: number;
  rangeLabel: string;
  rangeBalance: string;
  rangeAvgPrice: number;
  rangeCostBasis: string;
  rangeCurrentPrice: number;
  rangeCurrentValue: string;
  rangePnl: string;
  rangePnlPct: string;
  totalCost: string;
  resolvedValue: string;
  pnl: string;
}

export type PositionWithMarket = BinaryPositionWithMarket | RangePortfolioPosition;

export interface PortfolioSummary {
  realisedPnl: string;
  winRate: string;
  wins: number;
  resolvedCount: number;
  resolvedCost: string;
  resolvedValue: string;
}

const RECONCILE_INTERVAL_MS = 15_000;

export function usePortfolioForAddress(targetAddress: string | undefined, options?: { refetchInterval?: number | false }) {
  return useQuery<PositionWithMarket[]>({
    queryKey: ["portfolio", targetAddress],
    queryFn: () => fetchApi<PositionWithMarket[]>(`/portfolio/${targetAddress}`),
    enabled: !!targetAddress,
    refetchInterval: options?.refetchInterval ?? false,
    select: (data) => data ?? [],
  });
}

export function usePortfolioSummaryForAddress(targetAddress: string | undefined, options?: { refetchInterval?: number | false }) {
  return useQuery<PortfolioSummary>({
    queryKey: ["portfolio-summary", targetAddress],
    queryFn: () => fetchApi<PortfolioSummary>(`/portfolio/${targetAddress}/summary`),
    enabled: !!targetAddress,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function usePortfolio() {
  const { address } = useAccount();
  const { getAccessToken } = usePrivy();
  const lastReconcileRef = useRef<number>(0);

  const query = usePortfolioForAddress(address, {
    refetchInterval: RECONCILE_INTERVAL_MS,
  });

  // On-demand reconcile: calls the backend to re-read on-chain OutcomeToken
  // balances and heal any drift before the next query fetch.
  useEffect(() => {
    if (!address) return;

    async function reconcile() {
      const now = Date.now();
      // Avoid hammering when multiple effects fire at once.
      if (now - lastReconcileRef.current < 5_000) return;
      lastReconcileRef.current = now;

      try {
        const token = await getAccessToken();
        if (!token) return;
        await authedPostApi(`/trading/reconcile/${address}`, {}, token);
      } catch {
        // Silently swallow — reconcile is best-effort
      }
    }

    reconcile();

    const interval = setInterval(reconcile, RECONCILE_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  return query;
}

export function usePortfolioSummary() {
  const { address } = useAccount();

  return usePortfolioSummaryForAddress(address, {
    refetchInterval: RECONCILE_INTERVAL_MS,
  });
}
