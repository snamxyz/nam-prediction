"use client";

import Link from "next/link";
import { TrendingUp, TrendingDown, DollarSign, Clock, Users } from "lucide-react";
import type { Market } from "@nam-prediction/shared";

function formatTimeRemaining(endTime: number): string {
  const now = Date.now() / 1000;
  const diff = endTime - now;
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600) / 60);
  return `${hours}h ${mins}m left`;
}

function formatVolume(vol: string): string {
  const n = Number(vol);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const SOURCE_ICONS: Record<string, string> = {
  admin: "👤",
  api: "🔗",
  dexscreener: "📈",
};

export function MarketCard({ market }: { market: Market }) {
  const yesPct = Math.round(market.yesPrice * 100);
  const noPct = 100 - yesPct;

  return (
    <Link href={`/market/${market.id}`}>
      <div className="glass-card p-5 transition-all cursor-pointer hover:scale-[1.01]"
        style={{ overflow: "hidden" }}>
        {/* Question + source badge */}
        <div className="flex items-start justify-between gap-2 mb-4">
          <h3 className="font-semibold text-sm line-clamp-2" style={{ color: "rgba(232,233,237,0.90)" }}>
            {market.question}
          </h3>
          {market.resolutionSource && market.resolutionSource !== "admin" && (
            <span className="text-xs shrink-0 px-2 py-1 rounded-md glass-card-inner" title={market.resolutionSource}>
              {SOURCE_ICONS[market.resolutionSource] || ""}
            </span>
          )}
        </div>

        {/* Probability display */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold" style={{ color: "#01d243" }}>{yesPct}%</span>
              <span className="text-xs" style={{ color: "#717182" }}>chance</span>
            </div>
            {market.resolved && (
              <span className="text-xs px-2 py-1 rounded-md font-semibold"
                style={market.result === 1
                  ? { background: "rgba(1,210,67,0.15)", color: "#01d243" }
                  : { background: "rgba(255,71,87,0.15)", color: "#ff4757" }}>
                {market.result === 1 ? "YES" : "NO"}
              </span>
            )}
          </div>
          {/* Price bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(31,32,40,0.60)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${yesPct}%`, background: "rgba(1,210,67,0.70)" }} />
            </div>
          </div>
          {/* Yes / No prices */}
          <div className="flex items-center justify-between mt-2 text-xs">
            <span style={{ color: "#01d243" }}>Yes {yesPct}¢</span>
            <span style={{ color: "#ff4757" }}>No {noPct}¢</span>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-4 pt-3 text-xs" style={{ borderTop: "0.5px solid rgba(255,255,255,0.05)", color: "#717182" }}>
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" style={{ color: "#01d243" }} />
            <span style={{ color: "rgba(232,233,237,0.70)" }}>{formatVolume(market.volume)}</span>
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" style={{ color: "#01d243" }} />
            {market.resolved ? "Resolved" : formatTimeRemaining(market.endTime)}
          </span>
        </div>
      </div>
    </Link>
  );
}
