"use client";

import { useMarkets } from "@/hooks/useMarkets";
import { useNamPrice } from "@/hooks/useNamPrice";
import { BarChart2, Clock, Layers, TrendingUp } from "lucide-react";

export function StatsBar() {
  const { data: markets } = useMarkets();
  const { price: namPrice } = useNamPrice();

  const totalVolume = markets
    ? markets.reduce((s, m) => s + Number(m.volume), 0)
    : 0;
  const openMarkets = markets ? markets.filter((m) => !m.resolved).length : 0;

  const formatVolume = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  const stats = [
    { label: "Total Volume", value: formatVolume(totalVolume), Icon: BarChart2 },
    { label: "24h Volume", value: formatVolume(totalVolume * 0.12), Icon: Clock },
    { label: "Open Markets", value: String(openMarkets), Icon: Layers },
    { label: "NAM Price", value: namPrice !== null ? `$${namPrice.toFixed(5)}` : "$—", accent: true, Icon: TrendingUp },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10,
        marginBottom: 28,
      }}
    >
      {stats.map((s) => (
        <div key={s.label} className="card" style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div
              style={{
                fontSize: 10,
                color: "#4c4e68",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                fontWeight: 700,
              }}
            >
              {s.label}
            </div>
            <s.Icon className="w-3.5 h-3.5" style={{ color: s.accent ? "#01d243" : "#4c4e68" }} />
          </div>
          <div
            className="mono"
            style={{
              fontSize: 21,
              fontWeight: 500,
              color: s.accent ? "#01d243" : "#e4e5eb",
            }}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
