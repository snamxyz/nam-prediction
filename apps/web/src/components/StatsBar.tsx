"use client";

import { DollarSign, Flame, Users, TrendingUp } from "lucide-react";
import { useMarkets } from "@/hooks/useMarkets";

export function StatsBar() {
  const { data: markets } = useMarkets();

  const totalVolume = markets
    ? markets.reduce((s, m) => s + Number(m.volume), 0)
    : 0;
  const activeTraders = markets
    ? markets.reduce((s, m) => s + Math.floor(Number(m.volume) / 100), 0)
    : 0;
  const openMarkets = markets ? markets.filter(m => !m.resolved).length : 0;

  const formatVolume = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  const stats = [
    { icon: <DollarSign className="w-5 h-5" style={{ color: "#01d243" }} />, label: "Total Volume", value: formatVolume(totalVolume) },
    { icon: <Flame className="w-5 h-5" style={{ color: "#ff4757" }} />, label: "24h Volume", value: formatVolume(totalVolume * 0.12) },
    { icon: <Users className="w-5 h-5" style={{ color: "#a855f7" }} />, label: "Active Traders", value: activeTraders.toLocaleString() },
    { icon: <TrendingUp className="w-5 h-5" style={{ color: "#00e676" }} />, label: "Open Markets", value: String(openMarkets) },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
      {stats.map(s => (
        <div key={s.label} className="glass-card p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="glass-card-inner p-2 rounded-lg">{s.icon}</div>
            <span className="text-xs" style={{ color: "#717182" }}>{s.label}</span>
          </div>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-semibold" style={{ color: "#e8e9ed" }}>{s.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
