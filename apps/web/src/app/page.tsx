"use client";

import { useState } from "react";
import { StatsBar } from "@/components/StatsBar";
import { HourlyMarketHero } from "@/components/HourlyMarketHero";
import { MarketCard } from "@/components/MarketCard";
import { RangeMarketCard } from "@/components/RangeMarketCard";
import { useMarkets } from "@/hooks/useMarkets";
import { useActiveRangeMarkets } from "@/hooks/useRangeMarkets";
import { getRangeMarketPath } from "@/lib/rangeMarketDisplay";

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--surface-hover)] ${className}`}
    />
  );
}

function RangeMarketCardSkeleton() {
  return (
    <div className="card h-full px-[22px] py-5">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-[18px] w-24" />
          <SkeletonBlock className="h-[18px] w-14" />
        </div>
        <SkeletonBlock className="h-3 w-16" />
      </div>
      <div className="mb-4 space-y-2">
        <SkeletonBlock className="h-3.5 w-full" />
        <SkeletonBlock className="h-3.5 w-4/5" />
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <div className="mb-1 flex items-center justify-between">
              <SkeletonBlock className="h-3 w-32" />
              <SkeletonBlock className="h-3 w-10" />
            </div>
            <SkeletonBlock className="h-[3px] w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="mt-3.5 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-3 w-12" />
      </div>
    </div>
  );
}

function MarketCardSkeleton() {
  return (
    <div className="card rounded-xl p-5">
      <div className="mb-[18px] space-y-2">
        <SkeletonBlock className="h-3.5 w-full" />
        <SkeletonBlock className="h-3.5 w-5/6" />
      </div>
      <div className="mb-3.5 grid grid-cols-[1fr_1px_1fr] overflow-hidden rounded-lg border border-[var(--border-subtle)]">
        <div className="px-3 py-2.5">
          <SkeletonBlock className="mx-auto h-8 w-14" />
          <SkeletonBlock className="mx-auto mt-2 h-2.5 w-12" />
        </div>
        <div className="bg-[var(--border-subtle)]" />
        <div className="px-3 py-2.5">
          <SkeletonBlock className="mx-auto h-8 w-14" />
          <SkeletonBlock className="mx-auto mt-2 h-2.5 w-12" />
        </div>
      </div>
      <SkeletonBlock className="h-[3px] w-full rounded-full" />
      <div className="mt-3 flex justify-between border-t border-[var(--border-subtle)] pt-3">
        <SkeletonBlock className="h-3 w-28" />
        <SkeletonBlock className="h-3 w-16" />
      </div>
    </div>
  );
}

export default function HomePage() {
  const { data: markets, isLoading: isMarketsLoading } = useMarkets();
  const { data: rangeMarkets = [], isLoading: isRangeMarketsLoading } =
    useActiveRangeMarkets();
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
      <div className="mb-7">
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            color: "var(--foreground)",
            marginBottom: 5,
          }}
        >
          Prediction Markets
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Trade on NAM ecosystem milestones. Backed by real outcomes.
        </p>
      </div>

      <StatsBar />

      {/* Featured markets */}
      <div className="mb-7 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <HourlyMarketHero />
        {isRangeMarketsLoading
          ? [0,1].map((i) => <RangeMarketCardSkeleton key={i} />)
          : rangeMarkets.map((m) => (
              <RangeMarketCard
                key={m.id}
                market={m}
                href={getRangeMarketPath(m.marketType)}
              />
            ))}
      </div>

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
              background: tab === key ? "var(--surface-hover)" : "transparent",
              color: tab === key ? "var(--foreground)" : "var(--muted)",
              border: `1px solid ${tab === key ? "var(--border)" : "transparent"}`,
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      
    </div>
  );
}
