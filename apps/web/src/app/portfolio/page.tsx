"use client";

import dynamic from "next/dynamic";
import { usePortfolio } from "@/hooks/usePortfolio";
import { PositionRow } from "@/components/PositionRow";
import { DepositWithdrawPanel } from "@/components/DepositWithdrawPanel";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { User, DollarSign, BarChart3, TrendingUp, Award, Wallet, Shield, Zap, Copy, CheckCheck } from "lucide-react";
import { useState, useCallback } from "react";
import { toast } from "sonner";

const PrivyWalletCard = dynamic(() => import("@/components/PrivyWalletCard").then(m => ({ default: m.PrivyWalletCard })), { ssr: false });
const VaultTransactionHistory = dynamic(() => import("@/components/VaultTransactionHistory").then(m => ({ default: m.VaultTransactionHistory })), { ssr: false });

const DUST = 1e-6;

export default function PortfolioPage() {
  const { isConnected, address } = useAccount();
  const { login } = usePrivy();
  const { data: positions, isLoading } = usePortfolio();
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }, [address]);

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

  // Split into active (unresolved) and resolved
  const activePositions = positions?.filter(p => !p.resolved) ?? [];
  const resolvedPositions = positions?.filter(p => p.resolved) ?? [];

  // Only positions that actually have shares matter for stats
  const activeWithShares = activePositions.filter(
    p => Number(p.yesBalance || "0") >= DUST || Number(p.noBalance || "0") >= DUST
  );

  const totalActiveValue = activeWithShares.reduce(
    (s, p) => s + Number(p.yesCurrentValue || "0") + Number(p.noCurrentValue || "0"),
    0
  );
  const totalPnl = activeWithShares.reduce((s, p) => s + Number(p.pnl || "0"), 0);

  // Win rate: resolved positions where result matches the side user held
  const resolvedWithResult = resolvedPositions.filter(p => p.result === 1 || p.result === 2);
  const wins = resolvedWithResult.filter(p =>
    (p.result === 1 && Number(p.yesBalance || "0") >= DUST) ||
    (p.result === 2 && Number(p.noBalance || "0") >= DUST)
  ).length;
  const winRate = resolvedWithResult.length > 0
    ? Math.round((wins / resolvedWithResult.length) * 100)
    : 0;

  const displayAddress = address ? `${address.slice(0, 6)}â€¦${address.slice(-4)}` : "";

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
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono" style={{ color: "#717182" }}>{displayAddress}</p>
                <button
                  onClick={handleCopyAddress}
                  className="p-1 rounded transition-all"
                  style={{ color: copied ? "#01d243" : "#717182" }}
                  title="Copy address"
                >
                  {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: <DollarSign className="w-4 h-4" style={{ color: "#01d243" }} />, label: "Active Value", value: `$${totalActiveValue.toFixed(2)}`, color: "#e8e9ed" },
            { icon: <BarChart3 className="w-4 h-4" style={{ color: "#01d243" }} />, label: "Active Positions", value: String(activeWithShares.length), color: "#e8e9ed" },
            { icon: <TrendingUp className="w-4 h-4" style={{ color: "#00e676" }} />, label: "Unrealised P&L", value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? "#00e676" : "#ff4757" },
            { icon: <Award className="w-4 h-4" style={{ color: "#01d243" }} />, label: "Win Rate", value: resolvedWithResult.length > 0 ? `${winRate}%` : "â€”", color: "#e8e9ed" },
          ].map(s => (
            <div key={s.label} className="glass-card-inner p-4">
              <div className="flex items-center gap-2 mb-2">{s.icon}<span className="text-xs" style={{ color: "#717182" }}>{s.label}</span></div>
              <div className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Privy wallet balance card */}
      <div className="mb-8">
        <PrivyWalletCard />
      </div>

      {/* Vault: deposit/withdraw + info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <DepositWithdrawPanel />
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-5 h-5" style={{ color: "#01d243" }} />
            <h2 className="text-base font-semibold" style={{ color: "#e8e9ed" }}>About Your Vault</h2>
          </div>
          <p className="text-xs mb-4" style={{ color: "#717182" }}>
            Your vault is a per-user escrow contract that holds USDC on your behalf and enables
            gasless, one-click trading across all markets.
          </p>
          <ul className="space-y-3">
            {[
              { icon: <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#01d243" }} />, title: "Gasless trading", body: "Trades are signed off-chain and settled in batches â€” you never pay gas." },
              { icon: <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#01d243" }} />, title: "Isolated escrow", body: "Funds live in your own escrow clone, isolated from every other user." },
              { icon: <DollarSign className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#01d243" }} />, title: "Withdraw anytime", body: "Available balance can be pulled back to your wallet at any time." },
            ].map(item => (
              <li key={item.title} className="flex items-start gap-3">
                {item.icon}
                <div>
                  <p className="text-xs font-semibold" style={{ color: "#e8e9ed" }}>{item.title}</p>
                  <p className="text-[11px]" style={{ color: "#717182" }}>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Transaction history */}
      <div className="mb-8">
        <VaultTransactionHistory />
      </div>

      {/* Active Positions */}
      <div className="glass-card p-8 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold" style={{ color: "#e8e9ed" }}>Active Positions</h2>
          <span className="text-sm" style={{ color: "#717182" }}>{activeWithShares.length} positions</span>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="glass-card-inner p-5 animate-pulse h-20" />
            ))}
          </div>
        )}

        {!isLoading && activeWithShares.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm mb-2" style={{ color: "rgba(232,233,237,0.80)" }}>No active positions</p>
            <p className="text-xs" style={{ color: "#717182" }}>Start trading to build your portfolio</p>
          </div>
        )}

        {activeWithShares.length > 0 && (
          <div className="space-y-4">
            {activeWithShares.map((pos) => (
              <PositionRow key={pos.id} {...pos} />
            ))}
          </div>
        )}
      </div>

      {/* Resolved Positions */}
      {resolvedPositions.length > 0 && (
        <div className="glass-card p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold" style={{ color: "#e8e9ed" }}>Resolved Positions</h2>
            <span className="text-sm" style={{ color: "#717182" }}>{resolvedPositions.length} positions</span>
          </div>
          <div className="space-y-4">
            {resolvedPositions.map((pos) => (
              <PositionRow key={pos.id} {...pos} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
