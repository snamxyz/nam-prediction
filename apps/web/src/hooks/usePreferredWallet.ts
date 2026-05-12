"use client";

import { useMemo } from "react";
import { useWallets } from "@privy-io/react-auth";

export function usePreferredWallet() {
  const { wallets } = useWallets();

  return useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === "privy") ?? wallets[0],
    [wallets],
  );
}
