"use client";

import dynamic from "next/dynamic";
import { useMarkets } from "@/hooks/useMarkets";
import { MarketCard } from "@/components/MarketCard";
import { StatsBar } from "@/components/StatsBar";

export default function HomePage() {
  const { data: markets, isLoading, error } = useMarkets();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "#e8e9ed" }}>NAM Prediction Markets</h1>
        <p className="text-sm" style={{ color: "#717182" }}>Trade on NAM ecosystem milestones. Backed by real outcomes.</p>
      </div>

      <StatsBar />

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass-card p-5 animate-pulse h-44" />
          ))}
        </div>
      )}

      {error && (
        <div className="glass-card p-4" style={{ borderColor: "rgba(255,71,87,0.3)" }}>
          <p className="text-sm" style={{ color: "#ff4757" }}>Failed to load markets. Is the API running?</p>
        </div>
      )}

      {markets && markets.length === 0 && (
        <div className="glass-card text-center py-20">
          <p className="text-lg mb-2" style={{ color: "rgba(232,233,237,0.80)" }}>No markets yet</p>
          <p className="text-sm" style={{ color: "#717182" }}>Create the first market from the admin page</p>
        </div>
      )}

      {markets && markets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
