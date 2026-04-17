"use client";

import { useEffect, useState } from "react";
import { useSocket } from "./useSocket";

interface BalanceUpdate {
  wallet: string;
  usdcBalance?: string;
  type?: string;
  amount?: string;
}

interface SharesUpdate {
  wallet: string;
  marketId: number;
}

export function useUserSocket(walletAddress: string | undefined) {
  const { socket, connected } = useSocket();
  const [balanceUpdated, setBalanceUpdated] = useState(0); // counter to trigger refetch

  useEffect(() => {
    if (!socket || !walletAddress || !connected) return;

    const wallet = walletAddress.toLowerCase();
    socket.emit("join:user", wallet);

    const handleBalance = (data: BalanceUpdate) => {
      if (data.wallet === wallet) {
        setBalanceUpdated((prev) => prev + 1);
      }
    };

    const handleShares = (data: SharesUpdate) => {
      if (data.wallet === wallet) {
        setBalanceUpdated((prev) => prev + 1);
      }
    };

    socket.on("user:balance", handleBalance);
    socket.on("user:shares", handleShares);

    return () => {
      socket.emit("leave:user", wallet);
      socket.off("user:balance", handleBalance);
      socket.off("user:shares", handleShares);
    };
  }, [socket, walletAddress, connected]);

  return { balanceUpdated };
}
