"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAdminMarkets, type AdminMarket } from "@/hooks/useAdmin";
import { useLatestHourlyMarket } from "@/hooks/useMarkets";
import { formatMarketQuestion } from "@/lib/marketDisplay";
import { useNamPrice } from "@/hooks/useNamPrice";
import {
  ADMIN_MARKET_FAMILIES,
  findCurrentMarket,
  formatAdminMarketDate,
  formatCompactMoney,
  getFamilyMeta,
  formatAdminMarketQuestion,
} from "@/lib/adminMarketDisplay";

function SkeletonLine({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[var(--surface-hover)] ${className}`} />;
}

function CardShell({
  href,
  badge,
  children,
}: {
  href: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="card group relative block h-full min-h-[260px] overflow-hidden p-5 no-underline transition duration-150 hover:-translate-y-px hover:border-yes/30"
    >
      <div className="pointer-events-none absolute -left-20 -top-20 h-[400px] w-[400px] bg-[radial-gradient(circle,#01d24307_0%,transparent_65%)]" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-[400px] w-[400px] bg-[radial-gradient(circle,#f0324c05_0%,transparent_65%)]" />
      <div className="relative">
        <div className="mb-3.5 flex items-center justify-between">
          <span className="rounded bg-yes/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-yes">
            {badge}
          </span>
          <span className="text-[11px] font-semibold text-yes">
            View days <ArrowRight className="ml-1 inline h-3 w-3 transition group-hover:translate-x-0.5" />
          </span>
        </div>
        {children}
      </div>
    </Link>
  );
}

function MarketStats({
  market,
  volumeLabel = "Volume",
}: {
  market: AdminMarket | null | undefined;
  volumeLabel?: string;
}) {
  return (
    <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[var(--border-subtle)]">
      {[
        ["Trades", market ? String(market.tradeCount) : "—"],
        ["Unique Traders", market ? String(market.distinctTraderCount) : "—"],
        [volumeLabel, market ? formatCompactMoney(market.totalVolume) : "—"],
      ].map(([label, value]) => (
        <div key={label} className="border-r border-[var(--border-subtle)] px-3 py-4 last:border-r-0">
          <div className="mono text-lg font-medium leading-none tracking-[-0.03em] text-[var(--foreground)]">
            {value}
          </div>
          <div className="mt-2 text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

function RangeFamilyCard({
  market,
  isLoading,
  family,
}: {
  market: AdminMarket | null;
  isLoading: boolean;
  family: "participants" | "receipts";
}) {
  const meta = getFamilyMeta(family)!;

  if (isLoading) {
    return (
      <div className="card h-full min-h-[260px] p-5">
        <SkeletonLine className="mb-4 h-4 w-24" />
        <SkeletonLine className="mb-2 h-4 w-2/3" />
        <SkeletonLine className="mb-5 h-3 w-full" />
        <SkeletonLine className="h-24 w-full" />
      </div>
    );
  }

  return (
    <CardShell href={meta.path} badge={meta.badge}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold leading-[1.4] tracking-[-0.01em] text-[var(--foreground)]">
          {meta.label}
        </h2>
        <span className="text-[11px] text-[var(--muted)]">
          {market ? formatAdminMarketDate(market) : "No current day"}
        </span>
      </div>
      <p className="mb-4 min-h-10 text-xs leading-5 text-[var(--muted)]">
        {market ? formatAdminMarketQuestion(market) : "No active market row exists for today yet."}
      </p>
      <MarketStats market={market} />
      <div className="mt-3.5 border-t border-white/[0.04] pt-3 text-[11px] text-[var(--muted)]">
        Trading activity on today&apos;s market, not ecosystem totals.
      </div>
    </CardShell>
  );
}

export default function AdminMarketsPage() {
  const { data: tokenData, isLoading: isTokenLoading } = useAdminMarkets({
    family: "token",
    limit: 200,
  });
  const { data: participantsData, isLoading: isParticipantsLoading } = useAdminMarkets({
    family: "participants",
    limit: 200,
  });
  const { data: receiptsData, isLoading: isReceiptsLoading } = useAdminMarkets({
    family: "receipts",
    limit: 200,
  });
  const { data: hourlyMarket, isLoading: isHourlyLoading } = useLatestHourlyMarket();
  const { price: namPrice } = useNamPrice();

  const tokenMarkets = tokenData?.markets ?? [];
  const tokenMarket =
    tokenMarkets.find((market) => market.id === hourlyMarket?.id) ??
    findCurrentMarket(tokenMarkets, "token");
  const participantsMarket = findCurrentMarket(participantsData?.markets ?? [], "participants");
  const receiptsMarket = findCurrentMarket(receiptsData?.markets ?? [], "receipts");
  const tokenMeta = ADMIN_MARKET_FAMILIES[0];
  const yesPrice = hourlyMarket ? (hourlyMarket.yesPrice * 100).toFixed(1) : null;
  const noPrice = hourlyMarket ? (hourlyMarket.noPrice * 100).toFixed(1) : null;

  return (
    <div className="fade-up">
      <div className="mb-7">
        <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.025em] text-[var(--foreground)]">
          Markets
        </h1>
        <p className="max-w-3xl text-[13px] leading-5 text-[var(--muted)]">
          Monitor the three production market families first, then drill into each day&apos;s liquidity, volume, and settlement state.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {isTokenLoading || isHourlyLoading ? (
          <div className="card h-full min-h-[260px] p-5">
            <SkeletonLine className="mb-4 h-4 w-28" />
            <SkeletonLine className="mb-2 h-4 w-2/3" />
            <SkeletonLine className="mb-5 h-3 w-full" />
            <SkeletonLine className="h-24 w-full" />
          </div>
        ) : (
          <CardShell href={tokenMeta.path} badge={tokenMeta.badge}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold leading-[1.4] tracking-[-0.01em] text-[var(--foreground)]">
                {tokenMeta.label}
              </h2>
              <span className="text-[11px] text-[var(--muted)]">
                NAM {namPrice !== null ? `$${namPrice.toFixed(5)}` : "$—"}
              </span>
            </div>
            <p className="mb-4 min-h-10 text-xs leading-5 text-[var(--muted)]">
              {tokenMarket
                ? formatAdminMarketQuestion(tokenMarket)
                : hourlyMarket
                ? formatMarketQuestion(hourlyMarket)
                : "No token price market is active yet."}
            </p>
            <div className="mb-3.5 grid grid-cols-[1fr_1px_1fr] overflow-hidden rounded-lg border border-[var(--border-subtle)]">
              <div className="bg-yes/[0.04] px-3 py-4 text-center">
                <div className="mono text-2xl font-medium leading-none tracking-[-0.03em] text-yes">
                  {yesPrice ?? "—"}
                </div>
                <div className="mt-2 text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
                  YES %
                </div>
              </div>
              <div className="bg-[var(--border-subtle)]" />
              <div className="bg-no/[0.03] px-3 py-4 text-center">
                <div className="mono text-2xl font-medium leading-none tracking-[-0.03em] text-no">
                  {noPrice ?? "—"}
                </div>
                <div className="mt-2 text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
                  NO %
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/[0.04] pt-3 text-[11px] text-[var(--muted)]">
              <span>
                {tokenMarket ? `${formatCompactMoney(tokenMarket.totalVolume)} volume` : "No volume yet"} · {tokenMarket?.tradeCount ?? 0} trades
              </span>
              <span>{tokenMarket?.distinctTraderCount ?? 0} unique traders</span>
            </div>
          </CardShell>
        )}

        <RangeFamilyCard
          family="participants"
          isLoading={isParticipantsLoading}
          market={participantsMarket}
        />
        <RangeFamilyCard
          family="receipts"
          isLoading={isReceiptsLoading}
          market={receiptsMarket}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          ["Token days", tokenMarkets.length],
          ["Participant days", participantsData?.markets.length ?? 0],
          ["Receipt days", receiptsData?.markets.length ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
              {label}
            </div>
            <div className="mono mt-1 text-sm text-[var(--foreground)]">
              {value}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-5 max-w-3xl text-xs leading-5 text-[var(--muted)]">
        Participant and receipt cards use trading-derived activity for the current market day: trades and unique wallet traders.
        They are not ecosystem-wide participant or receipt upload totals.
      </p>

      <div className="mt-5 text-xs text-[var(--muted)]">
        Daily operational totals such as liquidity state, claims, pool, and on-chain id live inside each family drill-down.
      </div>

    </div>
  );
}
