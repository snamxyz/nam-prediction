"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface VaultTransaction {
  id: number;
  userAddress: string;
  type: "deposit" | "withdraw";
  amount: string;
  txHash: string;
  blockNumber: string;
  timestamp: string;
}

async function fetchTransactions(address: string): Promise<VaultTransaction[]> {
  const res = await fetch(
    `${API_URL}/trading/transactions/${address}?limit=50`
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data as VaultTransaction[]) ?? [];
}

export function useVaultTransactions() {
  const { address } = useAccount();

  const { data, isLoading } = useQuery({
    queryKey: ["vault-transactions", address],
    queryFn: () => fetchTransactions(address!),
    enabled: !!address,
    staleTime: 30_000,
  });

  return { transactions: data ?? [], isLoading };
}
