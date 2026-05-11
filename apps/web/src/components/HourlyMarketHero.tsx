"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLatestHourlyMarket } from "@/hooks/useMarkets";
import { ProbBar } from "@/components/ProbBar";
import { useNamPrice } from "@/hooks/useNamPrice";
import { formatMarketQuestion, getOutcomeLabels } from "@/lib/marketDisplay";

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
      <div className="card h-full min-h-[260px] p-5">
        <div className="mb-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-[18px] w-28 animate-pulse rounded bg-[var(--surface-hover)]" />
            <div className="h-[18px] w-16 animate-pulse rounded bg-[var(--surface-hover)]" />
          </div>
          <div className="h-3 w-8 animate-pulse rounded bg-[var(--surface-hover)]" />
        </div>
        <div className="mb-4 space-y-2">
          <div className="h-3.5 w-full animate-pulse rounded bg-[var(--surface-hover)]" />
          <div className="h-3.5 w-4/5 animate-pulse rounded bg-[var(--surface-hover)]" />
        </div>
        <div className="mb-3.5 grid grid-cols-[1fr_1px_1fr] overflow-hidden rounded-lg border border-[var(--border-subtle)]">
          <div className="px-3 py-2.5">
            <div className="mx-auto h-9 w-16 animate-pulse rounded bg-[var(--surface-hover)]" />
            <div className="mx-auto mt-2 h-2.5 w-14 animate-pulse rounded bg-[var(--surface-hover)]" />
          </div>
          <div className="bg-[var(--border-subtle)]" />
          <div className="px-3 py-2.5">
            <div className="mx-auto h-9 w-16 animate-pulse rounded bg-[var(--surface-hover)]" />
            <div className="mx-auto mt-2 h-2.5 w-14 animate-pulse rounded bg-[var(--surface-hover)]" />
          </div>
        </div>
        <div className="h-1 w-full animate-pulse rounded-full bg-[var(--surface-hover)]" />
        <div className="mt-3.5 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
          <div className="h-3 w-32 animate-pulse rounded bg-[var(--surface-hover)]" />
          <div className="h-3 w-12 animate-pulse rounded bg-[var(--surface-hover)]" />
        </div>
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
    <Link
      href={`/market/${market.id}`}
      className="card fade-up relative block h-full overflow-hidden p-5 no-underline transition duration-150 hover:-translate-y-px hover:border-yes/30"
    >
      {/* Background accent glows */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-[400px] w-[400px] bg-[radial-gradient(circle,#01d24307_0%,transparent_65%)]" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-[400px] w-[400px] bg-[radial-gradient(circle,#f0324c05_0%,transparent_65%)]" />

      {/* Header */}
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded bg-yes/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-yes">
            24-Hour Market
          </span>
          <span className="rounded bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--muted-strong)]">
            {countdown}
          </span>
        </div>
        <span className="text-[11px] text-[var(--muted)]">
          Live
        </span>
      </div>

      <div className="">

      
      {/* Question */}
      <h2 className="mb-4 text-sm font-semibold leading-[1.4] tracking-[-0.01em] text-[var(--foreground)]">
        {question}
      </h2>

      {/* Large probability display */}
      <div className="mb-3.5 grid grid-cols-[1fr_1px_1fr] gap-0 overflow-hidden rounded-lg border border-[var(--border-subtle)]">
        <div className="bg-yes/[0.04] px-3 py-6 text-center">
          <div className="mono text-[30px] font-medium leading-none tracking-[-0.03em] text-yes">
            {yp}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
            {outcomeLabels.yes} %
          </div>
        </div>
        <div className="bg-[var(--border-subtle)]" />
        <div className="bg-no/[0.03] px-3 py-6 text-center">
          <div className="mono text-[30px] font-medium leading-none tracking-[-0.03em] text-no">
            {np}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
            {outcomeLabels.no} %
          </div>
        </div>
      </div>

      <ProbBar yes={parseFloat(yp)} height={4} />
      </div>
      

      {/* Footer */}
      <div className="mt-3.5 flex items-center justify-between border-t border-white/[0.04] pt-3">
        <span className="text-[11px] text-[var(--muted)]">
          {formatVolume(volume)} volume · NAM{" "}
          {namPrice !== null ? `$${namPrice.toFixed(5)}` : "$—"}
        </span>
        <span className="text-[11px] font-semibold text-yes">
          Trade →
        </span>
      </div>
    </Link>
  );
}
