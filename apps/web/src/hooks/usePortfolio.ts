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
  marketType: "receipts" | "nam-distribution" | string;
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
  pnl: string;
}

export type PositionWithMarket = BinaryPositionWithMarket | RangePortfolioPosition;

const RECONCILE_INTERVAL_MS = 15_000;

export function usePortfolio() {
  const { address } = useAccount();
  const { getAccessToken } = usePrivy();
  const lastReconcileRef = useRef<number>(0);

  const query = useQuery<PositionWithMarket[]>({
    queryKey: ["portfolio", address],
    queryFn: () => fetchApi<PositionWithMarket[]>(`/portfolio/${address}`),
    enabled: !!address,
    refetchInterval: RECONCILE_INTERVAL_MS,
    select: (data) => data ?? [],
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
