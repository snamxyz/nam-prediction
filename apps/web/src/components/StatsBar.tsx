"use client";

import { useMarkets } from "@/hooks/useMarkets";
import { useNamPrice } from "@/hooks/useNamPrice";
import { useRangeMarkets } from "@/hooks/useRangeMarkets";
import { BarChart2, Clock, Layers, TrendingUp } from "lucide-react";

export function StatsBar() {
  const { data: markets, isLoading: isMarketsLoading } = useMarkets();
  const { data: rangeMarkets = [], isLoading: isRangeMarketsLoading } =
    useRangeMarkets();
  const { price: namPrice } = useNamPrice();

  const totalVolume = markets
    ? markets.reduce((s, m) => s + Number(m.volume), 0)
    : 0;
  const openBinaryMarkets = markets?.filter((m) => !m.resolved) ?? [];
  const openRangeMarkets = rangeMarkets.filter(
    (m) => !m.resolved && m.status === "active"
  );
  const openMarkets = openBinaryMarkets.length + openRangeMarkets.length;

  const formatVolume = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  const stats = [
    { label: "Total Volume", value: formatVolume(totalVolume), Icon: BarChart2 },
    { label: "Open Markets", value: String(openMarkets), Icon: Layers },
    { label: "NAM Price", value: namPrice !== null ? `$${namPrice.toFixed(5)}` : "$—", accent: true, Icon: TrendingUp },
  ];

  if (isMarketsLoading || isRangeMarketsLoading) {
    return (
      <div className="mb-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card px-[18px] py-3.5">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="h-2.5 w-20 animate-pulse rounded bg-[var(--surface-hover)]" />
              <div className="h-3.5 w-3.5 animate-pulse rounded bg-[var(--surface-hover)]" />
            </div>
            <div className="h-7 w-24 animate-pulse rounded bg-[var(--surface-hover)]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-7 grid grid-cols-1 gap-2.5 lg:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="card px-[18px] py-3.5">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
              {s.label}
            </div>
            <s.Icon
              className={`h-3.5 w-3.5 ${
                s.accent ? "text-yes" : "text-[var(--muted)]"
              }`}
            />
          </div>
          <div
            className={`mono text-[21px] font-medium ${
              s.accent ? "text-yes" : "text-[var(--foreground)]"
            }`}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
