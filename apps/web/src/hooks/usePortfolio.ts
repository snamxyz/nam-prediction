"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { fetchApi } from "@/lib/api";

interface PositionWithMarket {
  id: number;
  marketId: number;
  onChainId: number;
  userAddress: string;
  yesBalance: string;
  noBalance: string;
  avgEntryPrice: number;
  pnl: string;
  question: string;
  resolved: boolean;
  result: number;
  yesPrice: number;
  noPrice: number;
}

export function usePortfolio() {
  const { address } = useAccount();

  return useQuery<PositionWithMarket[]>({
    queryKey: ["portfolio", address],
    queryFn: () => fetchApi<PositionWithMarket[]>(`/portfolio/${address}`),
    enabled: !!address,
    refetchInterval: 15_000,
  });
}
