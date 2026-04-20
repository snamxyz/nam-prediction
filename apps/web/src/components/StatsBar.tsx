"use client";

import { useMarkets } from "@/hooks/useMarkets";
import { useNamPrice } from "@/hooks/useNamPrice";

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
    { label: "Total Volume", value: formatVolume(totalVolume) },
    { label: "24h Volume", value: formatVolume(totalVolume * 0.12) },
    { label: "Open Markets", value: String(openMarkets) },
    { label: "NAM Price", value: namPrice !== null ? `$${namPrice.toFixed(5)}` : "$—", accent: true },
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
          <div
            style={{
              fontSize: 10,
              color: "#4c4e68",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            {s.label}
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
