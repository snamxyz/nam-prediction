"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLatestHourlyMarket } from "@/hooks/useMarkets";
import { ProbBar } from "@/components/ProbBar";
import { useNamPrice } from "@/hooks/useNamPrice";
import { formatMarketQuestion, getOutcomeLabels } from "@/lib/marketDisplay";
import { ArrowRight } from "lucide-react";

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
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${h}h ${m}m`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

function formatVolume(vol: number) {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export function HourlyMarketHero() {
  const { data: market, isLoading } = useLatestHourlyMarket();
  const countdown = useCountdown(market?.endTime);
  const { price: namPrice } = useNamPrice();

  if (isLoading) {
    return (
      <div className="mb-6">
        <div className="card h-80 p-7" />
      </div>
    );
  }

  if (!market) return null;

  const yp = (market.yesPrice * 100).toFixed(1);
  const np = (market.noPrice * 100).toFixed(1);
  const volume = Number(market.volume);
  const outcomeLabels = getOutcomeLabels(market);
  const question = formatMarketQuestion(market);

  return (
    <div className="card fade-up relative mb-6 overflow-hidden p-7">
      {/* Background accent glows */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-[400px] w-[400px] bg-[radial-gradient(circle,#01d24307_0%,transparent_65%)]" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-[400px] w-[400px] bg-[radial-gradient(circle,#f0324c05_0%,transparent_65%)]" />

      {/* Top row */}
      <div className="mb-[18px] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            24-Hour Market
          </span>
        </div>
        <span className="mono text-[11px] text-[var(--muted)]">
          {countdown} remaining
        </span>
      </div>

      {/* Question */}
      <h2 className="mb-7 max-w-[700px] text-xl font-semibold leading-[1.4] tracking-[-0.01em] text-[var(--foreground)]">
        {question}
      </h2>

      {/* Large probability display */}
      <div className="mb-[22px] grid grid-cols-[1fr_1px_1fr] gap-0">
        <div className="px-6 py-[18px] text-center">
          <div className="mono text-[60px] font-medium leading-none tracking-[-0.03em] text-yes">
            {yp}
          </div>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">
            {outcomeLabels.yes} %
          </div>
        </div>
        <div className="my-3 bg-white/[0.07]" />
        <div className="px-6 py-[18px] text-center">
          <div className="mono text-[60px] font-medium leading-none tracking-[-0.03em] text-no">
            {np}
          </div>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">
            {outcomeLabels.no} %
          </div>
        </div>
      </div>

      <ProbBar yes={parseFloat(yp)} height={4} />

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between">
        <div className="flex gap-5">
          <div>
            <div className="mb-[3px] text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
              Volume
            </div>
            <div className="mono text-[13px] text-[var(--foreground)]">
              {formatVolume(volume)}
            </div>
          </div>
          <div>
            <div className="mb-[3px] text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
              NAM Price
            </div>
            <div className="mono text-[13px] text-[var(--foreground)]">
              {namPrice !== null ? `$${namPrice.toFixed(5)}` : "$—"}
            </div>
          </div>
        </div>
        <Link
          href={`/market/${market.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-yes px-[22px] py-2.5 text-[13px] font-bold tracking-[0.01em] text-black"
      >
          Trade Now <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
