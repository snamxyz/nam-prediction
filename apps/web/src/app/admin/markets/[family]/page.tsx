"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
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

function MetricCell({
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

function DayMarketRow({ market }: { market: AdminMarket }) {
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

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
              {formatAdminMarketDate(market)}
            </span>
            {market.date === getTodayET() && (
              <span className="rounded-md bg-yes/[0.12] px-2 py-0.5 text-[11px] font-semibold text-yes">
                Current day
              </span>
            )}
            <span
              className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{
                background: market.resolved ? "var(--surface-hover)" : "rgba(1,210,67,0.15)",
                color: market.resolved ? "var(--muted)" : "var(--yes)",
              }}
            >
              {statusText(market)}
            </span>
            <span className="text-[11px] text-[var(--muted)]">
              {formatMarketType(market)}
            </span>
          </div>
          <div className="max-w-3xl text-sm font-medium text-[var(--foreground)]">
            {formatAdminMarketQuestion(market)}
          </div>
        </div>
        <div className="text-left md:text-right">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
            Liquidity State
          </div>
          <div className="text-xs text-[var(--foreground)]">
            {market.liquidityState ?? "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-10">
        <MetricCell label="Trades" value={String(market.tradeCount)} />
        <MetricCell label="Unique Traders" value={String(market.distinctTraderCount)} />
        <MetricCell label="Volume" value={formatMoney(market.totalVolume)} />
        <MetricCell label="Seeded" value={formatMoney(market.seededLiquidity ?? market.liquidity)} />
        <MetricCell label="Liquidity" value={formatMoney(market.liquidity)} />
        <MetricCell label="Claims" value={formatMoney(market.outstandingWinningClaims)} />
        <MetricCell
          label="House P&L"
          value={formatHousePnlDisplay(market)}
          tone={housePnlTone}
        />
        <MetricCell label="Pool" value={formatShortAddress(market.poolAddress)} />
        <MetricCell label="On-chain" value={market.onChainId ? `#${market.onChainId}` : "—"} />
        <MetricCell label="Ends" value={market.endTime ? formatAdminMarketDate({ ...market, date: undefined }) : "—"} />
      </div>
    </div>
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
      <div className="glass-card max-w-xl p-6">
        <h1 className="mb-2 text-xl font-semibold text-[var(--foreground)]">
          Unknown market family
        </h1>
        <p className="mb-5 text-sm text-[var(--muted)]">
          Choose one of the production market families from the admin Markets hub.
        </p>
        <Link href="/admin/markets" className="text-sm font-semibold text-yes no-underline">
          Back to Markets
        </Link>
      </div>
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
            <span className="rounded bg-yes/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-yes">
              {meta.badge}
            </span>
            <span className="rounded bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--muted-strong)]">
              {markets.length} days
            </span>
            {currentDayCount > 0 && (
              <span className="rounded bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--muted-strong)]">
                Current day included
              </span>
            )}
          </div>
          <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.025em] text-[var(--foreground)]">
            {meta.label} Markets
          </h1>
          <p className="max-w-3xl text-[13px] leading-5 text-[var(--muted)]">
            {meta.description} Rows are newest first and include all available days for this market family.
          </p>
          {family !== "token" && (
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--muted)]">
              Trades and unique traders are activity on that day&apos;s market, not ecosystem-wide totals.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setStatus(filter.key)}
              className="rounded-full border px-3.5 py-1.5 text-xs font-medium transition"
              style={
                status === filter.key
                  ? {
                      background: "var(--surface-hover)",
                      borderColor: "var(--border)",
                      color: "var(--foreground)",
                    }
                  : {
                      background: "transparent",
                      borderColor: "transparent",
                      color: "var(--muted)",
                    }
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="glass-card h-32 animate-pulse" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <div className="glass-card px-5 py-10 text-center text-sm text-[var(--muted)]">
          No markets found for this family and filter.
        </div>
      ) : (
        <div className="space-y-3">
          {markets.map((market) => (
            <DayMarketRow key={`${family}-${market.id}`} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
