"use client";

import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { MarketFactoryABI } from "@nam-prediction/shared";
import { MARKET_FACTORY_ADDRESS } from "@/lib/contracts";

interface PositionRowProps {
  marketId: number;
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
  const { writeContract, data: txHash } = useWriteContract();
  const { isLoading } = useWaitForTransactionReceipt({ hash: txHash });

  const yBal = Number(yesBalance);
  const nBal = Number(noBalance);
  const currentValue = yBal * yesPrice + nBal * noPrice;
  const pnlNum = Number(pnl);

  const canRedeem =
    resolved &&
    ((result === 1 && yBal > 0) || (result === 2 && nBal > 0));

  const handleRedeem = () => {
    if (!MARKET_FACTORY_ADDRESS) return;
    writeContract({
      address: MARKET_FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      functionName: "redeem",
      args: [BigInt(marketId)],
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
