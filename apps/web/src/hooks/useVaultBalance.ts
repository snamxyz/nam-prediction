"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { fetchApi } from "@/lib/api";
import { useUserSocket } from "./useUserSocket";

interface BalanceData {
  wallet: string;
  usdcBalance: string;
}

export function useVaultBalance() {
  const { address } = useAccount();
  const { balanceUpdated } = useUserSocket(address);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["vault-balance", address, balanceUpdated],
    queryFn: () => fetchApi<BalanceData>(`/trading/balance/${address}`),
    enabled: !!address,
    refetchInterval: 30000,
  });

  return {
    usdcBalance: data?.usdcBalance || "0",
    isLoading,
    refetch,
  };
}
