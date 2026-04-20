"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";

export function useNamPrice() {
  const { data, isLoading } = useQuery({
    queryKey: ["nam-price"],
    queryFn: () => fetchApi<{ priceUsd: string }>("/markets/nam-price"),
    refetchInterval: 10_000,
  });

  const price = data ? parseFloat(data.priceUsd) : null;
  return { price, isLoading };
}
