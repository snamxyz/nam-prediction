"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Badge } from "@/components/UI/badge";
import { Button } from "@/components/UI/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/UI/card";
import { Skeleton } from "@/components/UI/skeleton";
import {
  useAdminMarkets,
  type AdminMarket,
  type AdminMarketFamily,
  type AdminMarketStatus,
} from "@/hooks/useAdmin";
import {
  formatAdminMarketDate,
  formatMarketType,
  formatMoney,
  formatShortAddress,
  getFamilyMeta,
  getTodayET,
  isAdminMarketFamily,
  sortMarketsByDay,
  statusText,
  formatAdminMarketQuestion,
} from "@/lib/adminMarketDisplay";

const STATUS_FILTERS: Array<{ key: AdminMarketStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "resolved", label: "Resolved" },
];

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "negative" | "positive";
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3 py-2">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
        {label}
      </div>
      <div
        className="mono text-xs"
        style={{
          color:
            tone === "negative"
              ? "var(--no)"
              : tone === "positive"
              ? "var(--yes)"
              : "var(--foreground)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatHousePnlDisplay(market: AdminMarket) {
  if (market.housePnl == null || market.housePnlSource === "pending") {
    return "—";
  }
  const formatted = formatMoney(market.housePnl);
  if (market.housePnlSource === "estimated") {
    return `${formatted} (est.)`;
  }
  return formatted;
}

function formatShares(value: string | number | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function DayMarketRow({ market, family }: { market: AdminMarket; family: AdminMarketFamily }) {
  const housePnl =
    market.housePnl != null && market.housePnlSource !== "pending"
      ? parseFloat(market.housePnl)
      : 0;
  const housePnlTone =
    market.housePnlSource === "pending"
      ? undefined
      : housePnl < 0
      ? "negative"
      : housePnl > 0
        ? "positive"
        : undefined;

  const isAwaitingDrain = market.liquidityState === "awaiting drain";
  const liquidityTone = isAwaitingDrain ? "text-amber-300" : market.resolved ? "text-[var(--muted-strong)]" : "text-yes";

  return (
    <Card className="bg-[var(--surface)] transition">
      <CardHeader className="p-5 pb-3">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[11px]">
              {formatAdminMarketDate(market)}
            </Badge>
            {market.date === getTodayET() && (
              <Badge className="bg-yes/15 text-yes hover:bg-yes/20">
                Current day
              </Badge>
            )}
            <Badge
              variant={market.resolved ? "secondary" : "default"}
              className={market.resolved ? "text-[11px]" : "bg-yes/15 text-yes hover:bg-yes/20"}
            >
              {statusText(market)}
            </Badge>
            <span className="text-[11px] text-[var(--muted)]">
              {formatMarketType(market)}
            </span>
          </div>
            <CardTitle className="text-base font-semibold leading-6 tracking-[-0.01em]">
            {formatAdminMarketQuestion(market)}
            </CardTitle>
            <CardDescription className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>Pool {formatShortAddress(market.poolAddress)}</span>
              <span>On-chain {market.onChainId ? `#${market.onChainId}` : "—"}</span>
              <span>Ends {market.endTime ? formatAdminMarketDate({ ...market, date: undefined }) : "—"}</span>
            </CardDescription>
          </div>
          <Link href={`/admin/markets/${family}/${market.id}`} className="no-underline">
            <Button variant="outline" size="sm">
              Details <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardHeader>

      <CardContent className="p-5 pt-0">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <MetricPill label="Liquidity State" value={market.liquidityState ?? "—"} tone={isAwaitingDrain ? "negative" : undefined} />
          <MetricPill label="Volume" value={formatMoney(market.totalVolume)} />
          <MetricPill label="Trades" value={`${market.tradeCount} / ${market.distinctTraderCount} users`} />
          <MetricPill label="Holders" value={String(market.holderCount ?? 0)} />
          <MetricPill label="Open Interest" value={formatShares(market.openInterestShares)} />
          <MetricPill label="At Risk" value={formatMoney(market.liquidityAtRisk)} />
          <MetricPill label="Claims" value={formatMoney(market.outstandingWinningClaims)} />
          <MetricPill label="House P&L" value={formatHousePnlDisplay(market)} tone={housePnlTone} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--muted)]">
          <span>
            {market.totalRangeShares
              ? `Range shares ${formatShares(market.totalRangeShares)}`
              : `YES ${formatShares(market.totalYesShares)} · NO ${formatShares(market.totalNoShares)}`}
          </span>
          <span className={liquidityTone}>
            Seeded {formatMoney(market.seededLiquidity ?? market.liquidity)} · Withdrawn {formatMoney(market.liquidityWithdrawn)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminMarketFamilyPage() {
  const params = useParams<{ family: string }>();
  const rawFamily = Array.isArray(params.family) ? params.family[0] : params.family;
  const isValidFamily = isAdminMarketFamily(rawFamily);
  const family: AdminMarketFamily = isValidFamily ? rawFamily : "token";
  const meta = getFamilyMeta(family)!;
  const [status, setStatus] = useState<AdminMarketStatus>("all");
  const { data, isLoading } = useAdminMarkets({ family, status, limit: 200 });
  const markets = sortMarketsByDay(data?.markets ?? []);
  const currentDayCount = markets.filter((market) => market.date === getTodayET()).length;

  if (!isValidFamily) {
    return (
      <Card className="max-w-xl  bg-card">
        <CardHeader>
        <CardTitle>
          Unknown market family
        </CardTitle>
        <CardDescription>
          Choose one of the production market families from the admin Markets hub.
        </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/admin/markets" className="no-underline">
            <Button variant="outline">Back to Markets</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="fade-up">
      <Link
        href="/admin/markets"
        className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] no-underline transition hover:text-yes"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to market families
      </Link>

      <div className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="bg-yes/10 text-yes hover:bg-yes/20">
              {meta.badge}
            </Badge>
            <Badge variant="secondary">
              {markets.length} days
            </Badge>
            {currentDayCount > 0 && (
              <Badge variant="secondary">
                Current day included
              </Badge>
            )}
          </div>
          <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.025em] text-[var(--foreground)]">
            {meta.label} Markets
          </h1>
          <p className="max-w-3xl text-[13px] leading-5 text-[var(--muted)]">
            {meta.description} Rows are newest first and include all available days for this market family.
          </p>
          {data?.snapshotAt && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              {data.snapshotSource === "redis" ? "Redis" : "DB"} snapshot from{" "}
              {new Date(data.snapshotAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {data.stale ? " · rebuilt on demand" : ""}
            </p>
          )}
          {family !== "token" && (
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--muted)]">
              Trades and unique traders are activity on that day&apos;s market, not ecosystem-wide totals.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.key}
              type="button"
              onClick={() => setStatus(filter.key)}
              variant={status === filter.key ? "secondary" : "ghost"}
              size="sm"
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <Card className=" bg-card">
          <CardContent className="px-5 py-10 text-center text-sm text-[var(--muted)]">
            No markets found for this family and filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {markets.map((market) => (
            <DayMarketRow key={`${family}-${market.id}`} market={market} family={family} />
          ))}
        </div>
      )}
    </div>
  );
}
