"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import type { Market, Trade } from "@nam-prediction/shared";
import { fetchApi } from "@/lib/api";
import { ProbBar } from "@/components/ProbBar";
import { useNamPrice } from "@/hooks/useNamPrice";
import { formatMarketQuestion, getOutcomeLabels } from "@/lib/marketDisplay";

function formatTimeRemaining(endTime: string): string {
  const now = Date.now();
  const target = new Date(endTime).getTime();
  const diff = (target - now) / 1000;
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

export function MarketCard({ market }: { market: Market }) {
  const queryClient = useQueryClient();
  const { price: namPrice } = useNamPrice();
  const yesPct = Math.round(market.yesPrice * 100);
  const noPct = 100 - yesPct;
  const outcomeLabels = getOutcomeLabels(market);
  const question = formatMarketQuestion(market);

  const prefetchMarket = () => {
    const id = market.id;
    void queryClient.prefetchQuery({
      queryKey: ["market", id],
      queryFn: () => fetchApi<Market>(`/markets/${id}`),
    });
    void queryClient.prefetchQuery({
      queryKey: ["market-trades", id],
      queryFn: () => fetchApi<Trade[]>(`/markets/${id}/trades`),
    });
  };

  return (
    <Link
      href={`/market/${market.id}`}
      onMouseEnter={prefetchMarket}
      onFocus={prefetchMarket}
    >
      <div
        className="card cursor-pointer rounded-xl p-5 transition-all duration-150 hover:border-[var(--border)] hover:bg-[var(--surface-hover)]"
      >
        {/* Question */}
        <p className="mb-[18px] text-[13px] font-medium leading-[1.55] text-[var(--foreground)]">
          {question}
        </p>

        {/* Split probability block */}
        <div className="mb-3.5 flex items-center gap-0 overflow-hidden rounded-lg border border-[var(--border-subtle)]">
          <div className="flex-1 bg-yes/[0.04] py-2.5 text-center">
            <span className="mono text-[26px] font-medium text-yes">
              {yesPct}
            </span>
            <span className="mt-px block text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
              {outcomeLabels.yes} %
            </span>
          </div>
          <div className="h-12 w-px bg-[var(--border-subtle)]" />
          <div className="flex-1 bg-no/[0.03] py-2.5 text-center">
            <span className="mono text-[26px] font-medium text-no">
              {noPct}
            </span>
            <span className="mt-px block text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
              {outcomeLabels.no} %
            </span>
          </div>
        </div>

        <ProbBar yes={yesPct} height={3} />

        {/* Footer */}
        <div className="mt-3 flex justify-between border-t border-[var(--border-subtle)] pt-3">
          <div className="flex items-center gap-3">
            <span className="mono text-[11px] text-[var(--muted)]">
              {formatVolume(market.volume)} vol
            </span>
            <span className="mono text-[11px] text-[var(--muted)]">
              NAM {namPrice !== null ? `$${namPrice.toFixed(5)}` : "—"}
            </span>
          </div>
          {market.resolved ? (
            <span className={`text-[11px] font-bold ${market.result === 1 ? "text-yes" : "text-no"}`}>
              {market.result === 1 ? outcomeLabels.yesShort : outcomeLabels.noShort} resolved
            </span>
          ) : (
            <span className="text-[11px] text-[var(--muted)]">
              {formatTimeRemaining(market.endTime)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
