"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { ArrowLeft, DollarSign, Users, Clock, TrendingUp } from "lucide-react";
import { useMarket, useMarketTrades } from "@/hooks/useMarkets";
import { TradePanel } from "@/components/TradePanel";
import { PriceChart } from "@/components/PriceChart";
import { MarketFactoryABI, ERC20ABI } from "@nam-prediction/shared";
import { MARKET_FACTORY_ADDRESS, USDC_ADDRESS } from "@/lib/contracts";

const SOURCE_LABELS: Record<string, { icon: string; label: string }> = {
  admin: { icon: "👤", label: "Admin" },
  internal: { icon: "📊", label: "Internal Data" },
  dexscreener: { icon: "📈", label: "NAM Price" },
  uma: { icon: "⚖️", label: "UMA Oracle" },
};

export default function MarketPage() {
  const params = useParams();
  const id = params.id as string;
  const { address, isConnected } = useAccount();

  const { data: market, isLoading } = useMarket(id);
  const { data: trades } = useMarketTrades(id);

  const [umaResult, setUmaResult] = useState<1 | 2>(1);
  const [umaBond, setUmaBond] = useState("100");

  const { writeContract: writeApproveUma, data: umaApproveHash } = useWriteContract();
  const { writeContract: writeRequestUma, data: umaRequestHash } = useWriteContract();
  const { isLoading: isUmaApproving } = useWaitForTransactionReceipt({ hash: umaApproveHash });
  const { isLoading: isUmaRequesting } = useWaitForTransactionReceipt({ hash: umaRequestHash });
  const isUmaLoading = isUmaApproving || isUmaRequesting;

  const handleRequestUmaResolution = () => {
    if (!market || !MARKET_FACTORY_ADDRESS || !address) return;
    const bondAmount = parseUnits(umaBond, 6);

    writeApproveUma(
      {
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [MARKET_FACTORY_ADDRESS, bondAmount],
      },
      {
        onSuccess: () => {
          writeRequestUma({
            address: MARKET_FACTORY_ADDRESS,
            abi: MarketFactoryABI,
            functionName: "requestUmaResolution",
            args: [BigInt(market.onChainId), umaResult, bondAmount],
          });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 glass-card rounded w-2/3 animate-pulse" />
        <div className="h-64 glass-card animate-pulse" />
        <div className="h-48 glass-card animate-pulse" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="glass-card text-center py-20">
        <p style={{ color: "#717182" }}>Market not found</p>
      </div>
    );
  }

  const yesPct = Math.round(market.yesPrice * 100);
  const noPct = 100 - yesPct;
  const endDate = new Date(market.endTime * 1000);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back link */}
      <Link href="/" className="inline-flex items-center gap-2 text-sm mb-6 transition-colors"
        style={{ color: "#717182" }}
        onMouseEnter={e => (e.currentTarget.style.color = "#e8e9ed")}
        onMouseLeave={e => (e.currentTarget.style.color = "#717182")}>
        <ArrowLeft className="w-4 h-4" /> Back to Markets
      </Link>

      {/* Header */}
      <div className="glass-card p-6 mb-6" style={{ overflow: "hidden" }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="text-xl font-semibold" style={{ color: "#e8e9ed" }}>{market.question}</h1>
          {market.resolutionSource && (
            <span className="text-xs px-2.5 py-1 rounded-lg whitespace-nowrap glass-card-inner"
              style={{ color: "rgba(232,233,237,0.70)" }}>
              {SOURCE_LABELS[market.resolutionSource]?.icon}{" "}
              {SOURCE_LABELS[market.resolutionSource]?.label || market.resolutionSource}
            </span>
          )}
        </div>

        {/* Price bar */}
        <div className="flex items-center gap-4 mb-4">
          <div className="text-center">
            <div className="text-2xl font-bold" style={{ color: "#01d243" }}>{yesPct}¢</div>
            <div className="text-xs" style={{ color: "#717182" }}>YES</div>
          </div>
          <div className="flex-1 h-2 rounded-full overflow-hidden flex" style={{ background: "rgba(31,32,40,0.60)" }}>
            <div className="h-full rounded-l-full transition-all" style={{ width: `${yesPct}%`, background: "rgba(1,210,67,0.70)" }} />
            <div className="h-full rounded-r-full transition-all" style={{ width: `${noPct}%`, background: "rgba(255,71,87,0.50)" }} />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold" style={{ color: "#ff4757" }}>{noPct}¢</div>
            <div className="text-xs" style={{ color: "#717182" }}>NO</div>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-5 text-xs" style={{ color: "#717182" }}>
          <span className="flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" style={{ color: "#01d243" }} />
            <span style={{ color: "rgba(232,233,237,0.70)" }}>${Number(market.volume).toLocaleString()}</span> Vol.
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" style={{ color: "#01d243" }} />
            {market.resolved ? "Resolved" : `Ends ${endDate.toLocaleDateString()} ${endDate.toLocaleTimeString()}`}
          </span>
          {market.resolved && (
            <span className="flex items-center gap-1 font-semibold"
              style={{ color: market.result === 1 ? "#01d243" : "#ff4757" }}>
              <TrendingUp className="w-3.5 h-3.5" />
              {market.result === 1 ? "YES" : "NO"} Wins
            </span>
          )}
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart + trades */}
        <div className="lg:col-span-2 space-y-6">
          <PriceChart trades={trades || []} />

          {/* Recent trades */}
          <div className="glass-card p-5" style={{ overflow: "hidden" }}>
            <h3 className="font-semibold mb-4 text-sm" style={{ color: "#e8e9ed" }}>Recent Trades</h3>
            {trades && trades.length > 0 ? (
              <div className="space-y-1">
                {trades.slice(0, 20).map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between text-sm py-2.5 transition-colors"
                    style={{ borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-1 rounded"
                        style={trade.isBuy
                          ? { background: "rgba(1,210,67,0.12)", color: "#01d243" }
                          : { background: "rgba(255,71,87,0.12)", color: "#ff4757" }}>
                        {trade.isBuy ? "BUY" : "SELL"}
                      </span>
                      <span className="text-xs font-semibold"
                        style={{ color: trade.isYes ? "#01d243" : "#ff4757" }}>
                        {trade.isYes ? "YES" : "NO"}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs" style={{ color: "rgba(232,233,237,0.85)" }}>
                        ${Number(trade.collateral).toFixed(2)}
                      </div>
                      <div className="text-[10px]" style={{ color: "rgba(113,113,130,0.60)" }}>
                        {trade.trader.slice(0, 6)}…{trade.trader.slice(-4)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: "#717182" }}>No trades yet</p>
            )}
          </div>
        </div>

        {/* Trade panel */}
        <div className="space-y-4">
          {!market.resolved ? (
            <TradePanel
              marketId={market.id}
              ammAddress={market.ammAddress as `0x${string}`}
              yesPrice={market.yesPrice}
              noPrice={market.noPrice}
            />
          ) : (
            <div className="glass-card p-5 text-center">
              <p className="text-lg font-bold mb-2" style={{ color: "#e8e9ed" }}>Market Resolved</p>
              <p className="text-2xl font-bold"
                style={{ color: market.result === 1 ? "#01d243" : "#ff4757" }}>
                {market.result === 1 ? "YES" : "NO"} Wins
              </p>
              <p className="text-sm mt-2" style={{ color: "#717182" }}>
                Go to Portfolio to redeem your winnings
              </p>
            </div>
          )}

          {/* UMA Resolution Request */}
          {market.resolutionSource === "uma" &&
            !market.resolved &&
            Date.now() / 1000 >= market.endTime && (
              <div className="glass-card p-5">
                <h3 className="font-semibold mb-3 text-sm" style={{ color: "#e8e9ed" }}>⚖️ Request UMA Resolution</h3>
                <p className="text-xs mb-3" style={{ color: "#717182" }}>
                  Market has ended. Propose a resolution via UMA Optimistic Oracle.
                  Your bond is returned if not disputed.
                </p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button onClick={() => setUmaResult(1)}
                    className="py-2 rounded-lg text-sm font-bold transition-all inner-border"
                    style={umaResult === 1
                      ? { background: "rgba(1,210,67,0.20)", color: "#01d243", borderColor: "rgba(1,210,67,0.30)" }
                      : { background: "rgba(31,32,40,0.50)", color: "#717182" }}>
                    Propose YES
                  </button>
                  <button onClick={() => setUmaResult(2)}
                    className="py-2 rounded-lg text-sm font-bold transition-all inner-border"
                    style={umaResult === 2
                      ? { background: "rgba(255,71,87,0.20)", color: "#ff4757", borderColor: "rgba(255,71,87,0.30)" }
                      : { background: "rgba(31,32,40,0.50)", color: "#717182" }}>
                    Propose NO
                  </button>
                </div>
                <div className="mb-3">
                  <label className="block text-xs mb-1" style={{ color: "#717182" }}>Bond (USDC)</label>
                  <input type="number" min="1" step="1" value={umaBond}
                    onChange={(e) => setUmaBond(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none inner-border"
                    style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }} />
                </div>
                <button onClick={handleRequestUmaResolution}
                  disabled={!isConnected || isUmaLoading}
                  className="w-full py-2.5 rounded-lg font-bold text-sm transition-all"
                  style={isConnected && !isUmaLoading
                    ? { background: "#01d243", color: "#000", cursor: "pointer" }
                    : { background: "rgba(31,32,40,0.50)", color: "#717182", cursor: "not-allowed" }}>
                  {!isConnected
                    ? "Connect Wallet"
                    : isUmaLoading
                    ? "Processing..."
                    : `Propose ${umaResult === 1 ? "YES" : "NO"} Resolution`}
                </button>
                {umaRequestHash && (
                  <p className="text-xs text-center mt-2" style={{ color: "#717182" }}>
                    Tx:{" "}
                    <a href={`https://basescan.org/tx/${umaRequestHash}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: "#01d243" }} className="hover:underline">
                      {umaRequestHash.slice(0, 10)}...{umaRequestHash.slice(-8)}
                    </a>
                  </p>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
