"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, formatUnits, http } from "viem";
import { base } from "viem/chains";
import { VaultABI } from "@nam-prediction/shared";
import { useContractConfig } from "@/hooks/useContractConfig";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

export function useVaultUserBalances(addresses: `0x${string}`[]) {
  const { vaultAddress } = useContractConfig();
  const uniqueAddresses = Array.from(new Set(addresses.map((address) => address.toLowerCase()))) as `0x${string}`[];

  return useQuery({
    queryKey: ["vault-user-balances", vaultAddress, uniqueAddresses],
    queryFn: async () => {
      if (!vaultAddress) throw new Error("No vault address");
      if (uniqueAddresses.length === 0) return { balances: {}, total: "0" };

      const [rawBalances, rawTotal] = await publicClient.readContract({
        address: vaultAddress,
        abi: VaultABI,
        functionName: "balancesOf",
        args: [uniqueAddresses],
      });

      const balances: Record<string, string> = {};
      rawBalances.forEach((balance, index) => {
        balances[uniqueAddresses[index]] = formatUnits(balance, 6);
      });

      return {
        balances,
        total: formatUnits(rawTotal, 6),
      };
    },
    enabled: !!vaultAddress,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
