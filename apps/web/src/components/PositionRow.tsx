"use client";

import { useEffect, useRef } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { MarketFactoryABI } from "@nam-prediction/shared";
import { MARKET_FACTORY_ADDRESS } from "@/lib/contracts";
import { toast } from "sonner";

interface PositionRowProps {
  marketId: number;
  onChainId: number;
  question: string;
  yesBalance: string;
  noBalance: string;
  yesPrice: number;
  noPrice: number;
  resolved: boolean;
  result: number;
  pnl: string;
}

export function PositionRow({
  marketId,
  onChainId,
  question,
  yesBalance,
  noBalance,
  yesPrice,
  noPrice,
  resolved,
  result,
  pnl,
}: PositionRowProps) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const toastIdRef = useRef<string | null>(null);
  const { writeContract, data: txHash } = useWriteContract({
    mutation: {
      onError: (err: any) => {
        const msg = err?.shortMessage || err?.message || "Redeem failed";
        const isRejection = /user (rejected|denied)|rejected the request/i.test(msg);
        const display = isRejection ? "Redeem cancelled" : msg;
        if (toastIdRef.current) {
          toast.error(display, { id: toastIdRef.current });
          toastIdRef.current = null;
        } else {
          toast.error(display);
        }
      },
    },
  });
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Once the tx is in-flight, let the user know.
  useEffect(() => {
    if (!isLoading || !toastIdRef.current) return;
    toast.loading("Redeeming\u2026", { id: toastIdRef.current });
  }, [isLoading]);

  // Refresh portfolio + vault balance once the redemption tx confirms so the
  // payout that landed in the user's escrow is reflected immediately. The
  // backend indexer has a brief delay before it processes the Redeemed event,
  // so we re-invalidate on a short backoff to pick up the new USDC balance.
  useEffect(() => {
    if (!isSuccess) return;

    if (toastIdRef.current) {
      toast.success("Redeemed. Payout added to your vault.", {
        id: toastIdRef.current,
      });
      toastIdRef.current = null;
    } else {
      toast.success("Redeemed. Payout added to your vault.");
    }

    const kick = () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio", address] });
      queryClient.invalidateQueries({ queryKey: ["vault-balance", address] });
    };
    kick();
    const t1 = setTimeout(kick, 1500);
    const t2 = setTimeout(kick, 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isSuccess, address, queryClient]);

  const yBal = Number(yesBalance);
  const nBal = Number(noBalance);
  const currentValue = yBal * yesPrice + nBal * noPrice;
  const pnlNum = Number(pnl);

  const canRedeem =
    resolved &&
    ((result === 1 && yBal > 0) || (result === 2 && nBal > 0));

  const handleRedeem = () => {
    if (!MARKET_FACTORY_ADDRESS) return;
    const id = `redeem-${onChainId}-${Date.now()}`;
    toastIdRef.current = id;
    toast.loading("Confirm redeem in your wallet\u2026", { id });
    writeContract({
      address: MARKET_FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      functionName: "redeem",
      args: [BigInt(onChainId)],
    });
  };

  const side = yBal > nBal ? "Yes" : "No";
  const shares = yBal > nBal ? yBal : nBal;
  const avgPrice = yBal > nBal ? yesPrice : noPrice;

  return (
    <div className="glass-card-inner p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs px-2 py-1 rounded-md"
              style={side === "Yes"
                ? { background: "rgba(1,210,67,0.15)", color: "#01d243" }
                : { background: "rgba(255,71,87,0.15)", color: "#ff4757" }}>
              {side}
            </span>
            <span className="text-xs" style={{ color: "#717182" }}>
              {shares.toFixed(2)} shares @ {(avgPrice * 100).toFixed(1)}¢
            </span>
          </div>
          <p className="text-sm leading-tight" style={{ color: "#e8e9ed" }}>{question}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-semibold mb-1" style={{ color: "#e8e9ed" }}>${currentValue.toFixed(2)}</div>
          <div className="text-xs" style={{ color: pnlNum >= 0 ? "#00e676" : "#ff4757" }}>
            {pnlNum >= 0 ? "+" : ""}${pnlNum.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs pt-3"
        style={{ borderTop: "0.5px solid rgba(255,255,255,0.05)", color: "#717182" }}>
        <span>Current: {(yBal > nBal ? yesPrice * 100 : noPrice * 100).toFixed(1)}¢</span>
        <span>Avg: {(avgPrice * 100).toFixed(1)}¢</span>
        {canRedeem ? (
          <button onClick={handleRedeem} disabled={isLoading}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all"
            style={{ background: "#01d243", color: "#000" }}>
            {isLoading ? "..." : "Redeem"}
          </button>
        ) : resolved ? (
          <span style={{ color: result === 1 ? "#01d243" : "#ff4757" }}>
            {result === 1 ? "YES won" : "NO won"}
          </span>
        ) : (
          <span style={{ color: pnlNum >= 0 ? "#00e676" : "#ff4757" }}>
            {((pnlNum / (shares * avgPrice)) * 100).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
