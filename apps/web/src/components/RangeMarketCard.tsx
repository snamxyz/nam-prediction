"use client";

import Link from "next/link";
import type { RangeMarket, RangeOutcome } from "@nam-prediction/shared";
import { getRangeMarketAccent, getRangeMarketLabel } from "@/lib/rangeMarketDisplay";

const RANGE_COLORS = [
  "#6c7aff",
  "#01d243",
  "#f0a832",
  "#f0324c",
  "#a78bfa",
  "#38bdf8",
];

const RANGE_TEXT_CLASSES = [
  "text-[#6c7aff]",
  "text-[#01d243]",
  "text-[#f0a832]",
  "text-[#f0324c]",
  "text-[#a78bfa]",
  "text-[#38bdf8]",
];

const RANGE_BG_CLASSES = [
  "bg-[#6c7aff]/15",
  "bg-[#01d243]/15",
  "bg-[#f0a832]/15",
  "bg-[#f0324c]/15",
  "bg-[#a78bfa]/15",
  "bg-[#38bdf8]/15",
];

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface RangeMarketCardProps {
  market: RangeMarket;
  href: string;
}

export function RangeMarketCard({ market, href }: RangeMarketCardProps) {
  const ranges = market.ranges as RangeOutcome[];
  const prices = market.rangePrices as number[];
  const total = prices.reduce((a, b) => a + b, 0) || 1;

  const accent = getRangeMarketAccent(market.marketType);
  const typeLabel = getRangeMarketLabel(market.marketType);

  return (
    <Link href={href} className="block h-full no-underline">
      <div
        className={`card h-full cursor-pointer px-[22px] py-5 transition duration-150 hover:-translate-y-px ${accent.hover}`}
      >
        {/* Header */}
        <div className="mb-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${accent.bg} ${accent.text}`}>
              {typeLabel}
            </span>
            {market.resolved ? (
              <span className="rounded bg-yes/[0.08] px-2 py-0.5 text-[10px] font-bold text-yes">
                RESOLVED
              </span>
            ) : (
              <span className="rounded bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--muted-strong)]">
                {timeUntil(market.endTime)}
              </span>
            )}
          </div>
          <span className="text-[11px] text-[var(--muted)]">{market.date}</span>
        </div>

        {/* Question */}
        <p className="mb-4 text-sm font-semibold leading-[1.4] text-[var(--foreground)]">
          {market.question}
        </p>

        {/* Range probability bars */}
        <div className="flex flex-col gap-2">
          {ranges.map((range, i) => {
            const rawPrice = prices[i] ?? 0;
            const displayPrice = total > 0 ? rawPrice / total : 1 / ranges.length;
            const pct = (displayPrice * 100).toFixed(1);
            const color = RANGE_COLORS[i % RANGE_COLORS.length];
            const colorClass = RANGE_TEXT_CLASSES[i % RANGE_TEXT_CLASSES.length];
            const bgClass = RANGE_BG_CLASSES[i % RANGE_BG_CLASSES.length];
            const isWinner =
              market.resolved && market.winningRangeIndex === i;
            const barPct = Math.min(100, parseFloat(pct));

            return (
              <div key={range.index}>
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <svg className="h-2 w-2 shrink-0" viewBox="0 0 8 8" aria-hidden="true">
                      <circle cx="4" cy="4" r="4" fill={color} />
                    </svg>
                    <span
                      className={`text-xs ${
                        isWinner ? `${colorClass} font-bold` : "font-normal text-[var(--muted-strong)]"
                      }`}
                    >
                      {range.label}
                    </span>
                    {isWinner && (
                      <span className={`rounded-[3px] px-[5px] py-px text-[9px] font-bold ${bgClass} ${colorClass}`}>
                        WIN
                      </span>
                    )}
                  </div>
                  <span
                    className={`mono text-xs font-semibold ${
                      isWinner ? colorClass : "text-[var(--foreground)]"
                    }`}
                  >
                    {pct}¢
                  </span>
                </div>
                <svg
                  className="block h-[3px] w-full overflow-hidden rounded-full bg-[var(--surface-hover)]"
                  viewBox="0 0 100 1"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <rect
                    width={barPct}
                    height="1"
                    fill={color}
                    opacity={market.resolved && !isWinner ? 0.3 : 1}
                  />
                </svg>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-3.5 flex items-center justify-between border-t border-white/[0.04] pt-3">
          <span className="text-[11px] text-[var(--muted)]">
            {ranges.length} outcomes · LMSR
          </span>
          <span className={`text-[11px] font-semibold ${accent.text}`}>
            Trade →
          </span>
        </div>
      </div>
    </Link>
  );
}
