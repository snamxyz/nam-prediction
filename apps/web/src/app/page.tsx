"use client";

import { useState } from "react";
import { StatsBar } from "@/components/StatsBar";
import { HourlyMarketHero } from "@/components/HourlyMarketHero";
import { MarketCard } from "@/components/MarketCard";
import { useMarkets } from "@/hooks/useMarkets";

export default function HomePage() {
  const { data: markets } = useMarkets();
  const [tab, setTab] = useState<"all" | "open" | "resolved">("all");

  const nonHourly = markets?.filter((m) => m.cadence !== "1h") ?? [];
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
