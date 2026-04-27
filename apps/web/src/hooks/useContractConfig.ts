import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";

interface ContractConfig {
  contracts: {
    vaultAddress: `0x${string}` | null;
  };
}

export function useContractConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["contract-config"],
    queryFn: () => fetchApi<ContractConfig>("/config"),
    staleTime: 5 * 60 * 1000,
  });

  return {
    vaultAddress: data?.contracts.vaultAddress || undefined,
    isLoading,
    error,
  };
}
