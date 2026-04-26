"use client";

import { useState } from "react";
import { StatsBar } from "@/components/StatsBar";
import { HourlyMarketHero } from "@/components/HourlyMarketHero";
import { MarketCard } from "@/components/MarketCard";
import { RangeMarketCard } from "@/components/RangeMarketCard";
import { useMarkets } from "@/hooks/useMarkets";
import { useActiveRangeMarkets } from "@/hooks/useRangeMarkets";

export default function HomePage() {
  const { data: markets } = useMarkets();
  const { data: rangeMarkets = [] } = useActiveRangeMarkets();
  const [tab, setTab] = useState<"all" | "open" | "resolved">("all");

  const nonHourly = markets?.filter((m) => m.cadence !== "24h") ?? [];
  const filtered = nonHourly.filter((m) =>
    tab === "all" ? true : tab === "open" ? !m.resolved : m.resolved
  );

  const tabs = [
    { key: "all" as const, label: "All Markets" },
    { key: "open" as const, label: "Open" },
    { key: "resolved" as const, label: "Resolved" },
  ];

  return (
    <div className="fade-up">
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            color: "#e4e5eb",
            marginBottom: 5,
          }}
        >
          Prediction Markets
        </h1>
        <p style={{ fontSize: 13, color: "#4c4e68" }}>
          Trade on NAM ecosystem milestones. Backed by real outcomes.
        </p>
      </div>

      <StatsBar />
      <HourlyMarketHero />

      {/* Range markets section */}
      {rangeMarkets.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "#e4e5eb", margin: 0 }}>
              Range Markets
            </h2>
            <span style={{
              fontSize: 10, fontWeight: 700, color: "#6c7aff",
              background: "rgba(108,122,255,0.12)", padding: "2px 8px",
              borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.08em",
            }}>
              LMSR · Live
            </span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
            gap: 12,
          }}>
            {rangeMarkets.map((m) => (
              <RangeMarketCard
                key={m.id}
                market={m}
                href={m.marketType === "receipts" ? "/markets/receipts" : "/markets/nam-distribution"}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tab filters */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 500,
              background: tab === key ? "#111320" : "transparent",
              color: tab === key ? "#e4e5eb" : "#4c4e68",
              border: `1px solid ${tab === key ? "rgba(255,255,255,0.07)" : "transparent"}`,
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Market card grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
          gap: 12,
        }}
      >
        {filtered.map((m) => (
          <MarketCard key={m.id} market={m} />
        ))}
      </div>
    </div>
  );
}
