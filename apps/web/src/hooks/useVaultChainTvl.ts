"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { VaultABI } from "@nam-prediction/shared";
import { useContractConfig } from "@/hooks/useContractConfig";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

/** Sum of collateral (USDC) sitting in all vault UserEscrow contracts, tracked by the vault. */
export function useVaultChainTvl() {
  const { vaultAddress } = useContractConfig();

  return useQuery({
    queryKey: ["vault-chain-tvl", vaultAddress],
    queryFn: async () => {
      if (!vaultAddress) throw new Error("No vault address");
      const totalRaw = await publicClient.readContract({
        address: vaultAddress,
        abi: VaultABI,
        functionName: "totalVaultBalance",
      });
      return formatUnits(totalRaw, 6);
    },
    enabled: !!vaultAddress,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}
