"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, Clock, ArrowRight } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface DailyData {
  daily: {
    id: number;
    date: string;
    threshold: string;
    status: string;
  };
  market: {
    id: number;
    question: string;
    yesPrice: number;
    noPrice: number;
    volume: string;
    endTime: string;
  } | null;
}

function useCountdown(targetDate: string | null) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!targetDate) return;
    const update = () => {
      const now = new Date().getTime();
      const target = new Date(targetDate).getTime();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft("Resolving...");
        return;
      }
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${h}h ${m}m ${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

export function DailyMarketHero() {
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDaily() {
      try {
        const res = await fetch(`${API_URL}/markets/daily/active`);
        const json = await res.json();
        if (json.success && json.data?.daily) {
          setData(json.data);
        }
      } catch {
        // No daily market available
      } finally {
        setLoading(false);
      }
    }
    fetchDaily();
    const interval = setInterval(fetchDaily, 15000);
    return () => clearInterval(interval);
  }, []);

  const countdown = useCountdown(data?.market?.endTime ?? null);

  if (loading || !data) return null;

  const { daily, market } = data;
  const threshold = Number(daily.threshold);
  const yesPercent = market ? Math.round(market.yesPrice * 100) : 50;
  const noPercent = market ? Math.round(market.noPrice * 100) : 50;

  return (
    <div className="mb-8">
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(1,210,67,0.08) 0%, rgba(1,210,67,0.02) 100%)",
          border: "1px solid rgba(1,210,67,0.15)",
        }}
      >
        {/* Live badge */}
        <div className="flex items-center gap-2 mb-4">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(1,210,67,0.15)", color: "#01d243" }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#01d243" }} />
            Daily Market
          </span>
          {countdown && (
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: "#717182" }}>
              <Clock className="w-3 h-3" />
              {countdown}
            </span>
          )}
        </div>

        {/* Question */}
        <h2 className="text-lg font-semibold mb-4" style={{ color: "#e8e9ed" }}>
          Will NAM be above ${threshold.toFixed(6)} at 00:00 UTC?
        </h2>

        {/* Probability bar */}
        <div className="flex gap-3 mb-4">
          <div
            className="flex-1 py-3 rounded-lg text-center text-sm font-semibold"
            style={{
              background: "rgba(1,210,67,0.12)",
              color: "#01d243",
              border: "1px solid rgba(1,210,67,0.2)",
            }}
          >
            Yes {yesPercent}%
          </div>
          <div
            className="flex-1 py-3 rounded-lg text-center text-sm font-semibold"
            style={{
              background: "rgba(255,71,87,0.12)",
              color: "#ff4757",
              border: "1px solid rgba(255,71,87,0.2)",
            }}
          >
            No {noPercent}%
          </div>
        </div>

        {/* Stats + CTA */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs" style={{ color: "#717182" }}>
            <span>
              <TrendingUp className="w-3 h-3 inline mr-1" />
              Vol: ${market ? Number(market.volume).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0"}
            </span>
            <span>Resolves: {daily.date}</span>
          </div>
          {market && (
            <Link
              href={`/market/${market.id}`}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: "#01d243", color: "#000" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#00e676")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#01d243")}
            >
              Trade Now <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
