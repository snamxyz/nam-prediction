"use client";

import { useAdminOverview } from "@/hooks/useAdmin";
import { DollarSign, Users, Activity, BarChart3, TrendingUp, ArrowDownLeft, ArrowUpRight, Layers } from "lucide-react";

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-3">{icon}<span className="text-xs" style={{ color: "var(--muted)" }}>{label}</span></div>
      <div className="text-2xl font-semibold mb-1" style={{ color: "var(--foreground)" }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

function fmt(n: string | number) {
  const v = parseFloat(String(n));
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

export default function AdminDashboardPage() {
  const { data, isLoading } = useAdminOverview();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "#ff4757" }}>Not authorised or failed to load</p>
      </div>
    );
  }

  const stats = [
    { icon: <Users className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Users", value: String(data.totalUsers), sub: `+${data.users24h} today · +${data.users7d} this week` },
    { icon: <Activity className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Trades", value: String(data.totalTrades), sub: `+${data.trades24h} today` },
    { icon: <TrendingUp className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Volume", value: fmt(data.totalVolume), sub: `${fmt(data.volume24h)} today` },
    { icon: <BarChart3 className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Active Markets", value: String(data.activeMarkets), sub: `${data.resolvedMarkets} resolved` },
    { icon: <ArrowDownLeft className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Deposits", value: fmt(data.totalDeposits) },
    { icon: <ArrowUpRight className="w-4 h-4" style={{ color: "#ff4757" }} />, label: "Total Withdrawals", value: fmt(data.totalWithdrawals) },
    { icon: <DollarSign className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "TVL (Vault)", value: fmt(data.tvl) },
    { icon: <Layers className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Win Rate (avg)", value: "—" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6" style={{ color: "var(--foreground)" }}>Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}
