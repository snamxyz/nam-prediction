"use client";

import dynamic from "next/dynamic";
import { usePortfolio } from "@/hooks/usePortfolio";
import { PositionRow } from "@/components/PositionRow";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { User, DollarSign, BarChart3, TrendingUp, Award } from "lucide-react";

export default function PortfolioPage() {
  const { isConnected, address } = useAccount();
  const { login, user } = usePrivy();
  const { data: positions, isLoading } = usePortfolio();

  if (!isConnected) {
    return (
      <div className="glass-card text-center py-20">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl mx-auto mb-4"
          style={{ background: "rgba(31,32,40,0.60)" }}>
          <User className="w-8 h-8" style={{ color: "#717182" }} />
        </div>
        <h1 className="text-2xl font-semibold mb-4" style={{ color: "#e8e9ed" }}>Portfolio</h1>
        <p className="text-sm mb-6" style={{ color: "#717182" }}>Connect your wallet to view positions</p>
        <button onClick={login}
          className="px-6 py-3 rounded-xl font-semibold text-sm transition-all"
          style={{ background: "#01d243", color: "#000" }}>
          Connect Wallet
        </button>
      </div>
    );
  }

  const totalValue = positions
    ? positions.reduce((s, p) => s + (Number(p.yesBalance) * p.yesPrice + Number(p.noBalance) * p.noPrice), 0)
    : 0;
  const totalPnl = positions
    ? positions.reduce((s, p) => s + Number(p.pnl), 0)
    : 0;
  const winRate = positions && positions.length > 0
    ? Math.round((positions.filter(p => Number(p.pnl) > 0).length / positions.length) * 100)
    : 0;

  const displayAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  return (
    <div>
      {/* Profile card */}
      <div className="glass-card p-8 mb-8">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #01d243, #00e676)" }}>
              <User className="w-10 h-10" style={{ color: "#0a0b0f" }} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold mb-1" style={{ color: "#e8e9ed" }}>Your Portfolio</h1>
              <p className="text-sm" style={{ color: "#717182" }}>{displayAddress}</p>
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: <DollarSign className="w-4 h-4" style={{ color: "#01d243" }} />, label: "Portfolio Value", value: `$${totalValue.toFixed(2)}`, color: "#e8e9ed" },
            { icon: <BarChart3 className="w-4 h-4" style={{ color: "#01d243" }} />, label: "Positions", value: String(positions?.length || 0), color: "#e8e9ed" },
            { icon: <TrendingUp className="w-4 h-4" style={{ color: "#00e676" }} />, label: "Total P&L", value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? "#00e676" : "#ff4757" },
            { icon: <Award className="w-4 h-4" style={{ color: "#01d243" }} />, label: "Win Rate", value: `${winRate}%`, color: "#e8e9ed" },
          ].map(s => (
            <div key={s.label} className="glass-card-inner p-4">
              <div className="flex items-center gap-2 mb-2">{s.icon}<span className="text-xs" style={{ color: "#717182" }}>{s.label}</span></div>
              <div className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Positions card */}
      <div className="glass-card p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold" style={{ color: "#e8e9ed" }}>Active Positions</h2>
          <span className="text-sm" style={{ color: "#717182" }}>{positions?.length || 0} positions</span>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="glass-card-inner p-5 animate-pulse h-20" />
            ))}
          </div>
        )}

        {positions && positions.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm mb-2" style={{ color: "rgba(232,233,237,0.80)" }}>No positions yet</p>
            <p className="text-xs" style={{ color: "#717182" }}>Start trading to build your portfolio</p>
          </div>
        )}

        {positions && positions.length > 0 && (
          <div className="space-y-4">
            {positions.map((pos) => (
              <PositionRow
                key={pos.id}
                marketId={pos.marketId}
                question={pos.question}
                yesBalance={pos.yesBalance}
                noBalance={pos.noBalance}
                yesPrice={pos.yesPrice}
                noPrice={pos.noPrice}
                resolved={pos.resolved}
                result={pos.result}
                pnl={pos.pnl}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
