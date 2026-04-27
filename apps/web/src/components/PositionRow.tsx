"use client";

import { useEffect, useRef } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { MarketFactoryABI } from "@nam-prediction/shared";
import { MARKET_FACTORY_ADDRESS } from "@/lib/contracts";
import { toast } from "sonner";
import type { BinaryPositionWithMarket } from "@/hooks/usePortfolio";

const DUST = 1e-6;

/** One leg (YES or NO) of a position. */
function PositionLeg({
  side,
  balance,
  avgPrice,
  currentPrice,
  currentValue,
  pnl,
  pnlPct,
  resolved,
  result,
  question,
  onChainId,
  marketId,
  address,
}: {
  side: "YES" | "NO";
  balance: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  resolved: boolean;
  result: number;
  question: string;
  onChainId: number;
  marketId: number;
  address: `0x${string}` | undefined;
}) {
  const queryClient = useQueryClient();
  const toastIdRef = useRef<string | null>(null);
  const { writeContract, data: txHash } = useWriteContract({
    mutation: {
      onError: (err: any) => {
        const msg = err?.shortMessage || err?.message || "Redeem failed";
        const isRejection = /user (rejected|denied)|rejected the request/i.test(msg);
        const display = isRejection ? "Redeem cancelled" : msg;
        if (toastIdRef.current) { toast.error(display, { id: toastIdRef.current }); toastIdRef.current = null; }
        else toast.error(display);
      },
    },
  });
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!isLoading || !toastIdRef.current) return;
    toast.loading("Redeeming…", { id: toastIdRef.current });
  }, [isLoading]);

  useEffect(() => {
    if (!isSuccess) return;
    if (toastIdRef.current) { toast.success("Redeemed. Payout added to your vault.", { id: toastIdRef.current }); toastIdRef.current = null; }
    else toast.success("Redeemed. Payout added to your vault.");
    const kick = () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio", address] });
      queryClient.invalidateQueries({ queryKey: ["vault-balance", address] });
    };
    kick();
    const t1 = setTimeout(kick, 1500);
    const t2 = setTimeout(kick, 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isSuccess, address, queryClient]);

  const handleRedeem = () => {
    if (!MARKET_FACTORY_ADDRESS) return;
    const id = `redeem-${onChainId}-${side}-${Date.now()}`;
    toastIdRef.current = id;
    toast.loading("Confirm redeem in your wallet…", { id });
    writeContract({
      address: MARKET_FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      functionName: "redeem",
      args: [BigInt(onChainId)],
    });
  };

  const isWinningSide = resolved && ((side === "YES" && result === 1) || (side === "NO" && result === 2));
  const isLosingSide = resolved && !isWinningSide;
  const canRedeem = isWinningSide && balance > DUST;
  const sideClasses =
    side === "YES"
      ? {
          border: "border-yes/15",
          bg: "bg-yes/15",
          text: "text-yes",
        }
      : {
          border: "border-[#ff4757]/15",
          bg: "bg-[#ff4757]/15",
          text: "text-[#ff4757]",
        };

  return (
    <div className={`rounded-lg border bg-[#1f2028]/45 p-4 ${sideClasses.border}`}>
      {/* Top row: side badge + shares + value */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${sideClasses.bg} ${sideClasses.text}`}
          >
            {side}
          </span>
          <span className="text-xs text-[#717182]">
            {balance.toFixed(4)} shares
          </span>
        </div>
        <span className="text-sm font-semibold text-[#e8e9ed]">
          ${currentValue.toFixed(2)}
        </span>
      </div>

      {/* Prices row */}
      <div className="mb-2 flex items-center justify-between text-xs text-[#717182]">
        <span>Avg: <span className="text-[#e8e9ed]">{(avgPrice * 100).toFixed(1)}¢</span></span>
        <span>Now: <span className="text-[#e8e9ed]">{(currentPrice * 100).toFixed(1)}¢</span></span>
        <span
          className={`font-semibold ${
            pnl >= 0 ? "text-[#00e676]" : "text-[#ff4757]"
          }`}
        >
          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
        </span>
      </div>

      {/* Action row */}
      <div className="flex justify-end">
        {canRedeem ? (
          <button
            onClick={handleRedeem}
            disabled={isLoading}
            className="rounded-lg bg-yes px-3 py-1 text-xs font-semibold text-black transition-all"
          >
            {isLoading ? "…" : "Redeem"}
          </button>
        ) : isLosingSide ? (
          <span className="text-xs text-[#ff4757]">Lost</span>
        ) : resolved && isWinningSide && balance <= DUST ? (
          <span className="text-xs text-[#00e676]">Redeemed</span>
        ) : null}
      </div>
    </div>
  );
}

interface PositionRowProps extends BinaryPositionWithMarket {}

export function PositionRow(props: PositionRowProps) {
  const { address } = useAccount();

  const {
    onChainId,
    marketId,
    question,
    yesBalance,
    noBalance,
    yesAvgPrice,
    noAvgPrice,
    yesCurrentValue,
    noCurrentValue,
    yesPnl,
    noPnl,
    yesPnlPct,
    noPnlPct,
    yesPrice,
    noPrice,
    resolved,
    result,
  } = props;

  const yesBal = Number(yesBalance || "0");
  const noBal = Number(noBalance || "0");
  const hasYes = yesBal >= DUST;
  const hasNo = noBal >= DUST;

  const resolvedLabel = resolved
    ? result === 1
      ? "YES won"
      : result === 2
      ? "NO won"
      : "Resolved"
    : null;

  return (
    <div className="glass-card-inner p-4">
      {/* Market question + resolved badge */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <p className="flex-1 text-sm leading-snug text-[#e8e9ed]">
          {question}
        </p>
        {resolvedLabel && (
          <span
            className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xs ${
              result === 1
                ? "bg-yes/15 text-yes"
                : "bg-[#ff4757]/15 text-[#ff4757]"
            }`}
          >
            {resolvedLabel}
          </span>
        )}
      </div>

      {/* Legs */}
      <div className={`grid gap-2 ${hasYes && hasNo ? "grid-cols-2" : "grid-cols-1"}`}>
        {hasYes && (
          <PositionLeg
            side="YES"
            balance={yesBal}
            avgPrice={yesAvgPrice}
            currentPrice={yesPrice}
            currentValue={Number(yesCurrentValue || "0")}
            pnl={Number(yesPnl || "0")}
            pnlPct={Number(yesPnlPct || "0")}
            resolved={resolved}
            result={result}
            question={question}
            onChainId={onChainId}
            marketId={marketId}
            address={address}
          />
        )}
        {hasNo && (
          <PositionLeg
            side="NO"
            balance={noBal}
            avgPrice={noAvgPrice}
            currentPrice={noPrice}
            currentValue={Number(noCurrentValue || "0")}
            pnl={Number(noPnl || "0")}
            pnlPct={Number(noPnlPct || "0")}
            resolved={resolved}
            result={result}
            question={question}
            onChainId={onChainId}
            marketId={marketId}
            address={address}
          />
        )}
      </div>
    </div>
  );
}
          
