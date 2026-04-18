"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, Clock, ArrowRight } from "lucide-react";
import { useLatestM15Market } from "@/hooks/useMarkets";

function useCountdown(targetDate: string | null | undefined) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!targetDate) return;
    const update = () => {
      const now = Date.now();
      const target = new Date(targetDate).getTime();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft("Resolving...");
        return;
      }
      const m = Math.floor(diff / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${m}m ${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

export function M15MarketHero() {
  const { data: market, isLoading } = useLatestM15Market();
  const countdown = useCountdown(market?.endTime);

  if (isLoading) {
    return (
      <div className="mb-8">
        <div className="glass-card rounded-2xl p-6 animate-pulse h-48" />
      </div>
    );
  }

  if (!market) return null;

  const yesPercent = Math.round(market.yesPrice * 100);
  const noPercent = Math.round(market.noPrice * 100);
  const isResolved = market.resolved;
  const isLocked = market.status === "locked";

  return (
    <div className="mb-8">
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
        {/* Live badge */}
        <div className="flex items-center gap-2 mb-4">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(1,210,67,0.15)", color: "#01d243" }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#01d243" }} />
            15-Min Market
          </span>
          {isResolved ? (
            <span
              className="inline-flex items-center gap-1 text-xs font-semibold"
              style={{ color: market.result === 1 ? "#01d243" : "#ff4757" }}
            >
              {market.result === 1 ? "YES" : "NO"} Wins
            </span>
          ) : isLocked ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "#ffa500" }}>
              🔒 Locked
            </span>
          ) : countdown ? (
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: "#717182" }}>
              <Clock className="w-3 h-3" />
              {countdown}
            </span>
          ) : null}
        </div>

        {/* Question */}
        <h2 className="text-lg font-semibold mb-4" style={{ color: "#e8e9ed" }}>
          {market.question}
        </h2>

        {/* Probability bar */}
        <div className="mb-4">
          <div className="flex items-center gap-4 mb-2">
            <span className="text-sm font-semibold" style={{ color: "#01d243" }}>Yes {yesPercent}%</span>
            <div
              className="flex-1 h-2 rounded-full overflow-hidden flex"
              style={{ background: "rgba(31,32,40,0.60)" }}
            >
              <div
                className="h-full rounded-l-full transition-all"
                style={{ width: `${yesPercent}%`, background: "rgba(1,210,67,0.70)" }}
              />
              <div
                className="h-full rounded-r-full transition-all"
                style={{ width: `${noPercent}%`, background: "rgba(255,71,87,0.50)" }}
              />
            </div>
            <span className="text-sm font-semibold" style={{ color: "#ff4757" }}>No {noPercent}%</span>
          </div>
        </div>

        {/* Stats + CTA */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs" style={{ color: "#717182" }}>
            <span>
              <TrendingUp className="w-3 h-3 inline mr-1" />
              Vol: ${Number(market.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span>
              Ends: {new Date(market.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <Link
            href={`/market/${market.id}`}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{ background: "#01d243", color: "#000" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#00e676")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#01d243")}
          >
            Trade Now <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
