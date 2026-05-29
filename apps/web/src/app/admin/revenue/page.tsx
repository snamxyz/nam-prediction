"use client";

import Link from "next/link";
import { ArrowRight, DollarSign, TrendingUp } from "lucide-react";
import { Badge } from "@/components/UI/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/UI/card";
import { Skeleton } from "@/components/UI/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/UI/table";
import { useAdminMarkets, type AdminMarket } from "@/hooks/useAdmin";
import {
  formatAdminMarketDate,
  formatAdminMarketQuestion,
  formatMoney,
  getAdminMarketFamily,
  getFamilyMeta,
  sortMarketsByDay,
} from "@/lib/adminMarketDisplay";

function asNumber(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pnlClassName(value: string | number | null | undefined) {
  const pnl = asNumber(value);
  if (pnl > 0) return "text-yes";
  if (pnl < 0) return "text-no";
  return "text-[var(--muted)]";
}

function RevenueStatCard({
  label,
  value,
  subtext,
  tone,
}: {
  label: string;
  value: string;
  subtext: string;
  tone?: "profit" | "loss";
}) {
  const valueClassName = tone === "profit" ? "text-yes" : tone === "loss" ? "text-no" : "text-[var(--foreground)]";

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
      <div className="mb-3 flex items-center gap-2 text-xs text-[var(--muted)]">
        <DollarSign className="h-4 w-4 text-yes" />
        {label}
      </div>
      <div className={`mono text-2xl font-semibold ${valueClassName}`}>{value}</div>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{subtext}</p>
    </div>
  );
}

function marketHref(market: AdminMarket) {
  const family = getAdminMarketFamily(market);
  if (!family) return null;
  return `/admin/markets/${family}/${market.id}`;
}

export default function AdminRevenuePage() {
  const { data, isLoading } = useAdminMarkets({ status: "all", limit: 500 });
  const resolvedMarkets = sortMarketsByDay(data?.markets ?? []).filter((market) => market.resolved);
  const totalVolume = resolvedMarkets.reduce((sum, market) => sum + asNumber(market.totalVolume), 0);
  const totalHousePnl = resolvedMarkets.reduce((sum, market) => sum + asNumber(market.housePnl), 0);
  const finalPnlCount = resolvedMarkets.filter((market) => market.housePnlSource === "final").length;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-yes" />
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Revenue</h1>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Track realized and estimated house P&amp;L by market. Per-trade fee amounts are enforced on-chain
          through each market contract&apos;s fee settings, but AMM fee rows are not yet indexed into the database.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <RevenueStatCard
          label="Total House P&L"
          value={formatMoney(totalHousePnl)}
          subtext="Profit or loss from resolved market liquidity provision"
          tone={totalHousePnl > 0 ? "profit" : totalHousePnl < 0 ? "loss" : undefined}
        />
        <RevenueStatCard
          label="Resolved Volume"
          value={formatMoney(totalVolume)}
          subtext="Collateral volume across resolved markets"
        />
        <RevenueStatCard
          label="Resolved Markets"
          value={String(resolvedMarkets.length)}
          subtext={`${finalPnlCount} final P&L rows, ${resolvedMarkets.length - finalPnlCount} estimated or pending`}
        />
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Market Revenue</CardTitle>
          <CardDescription>
            House P&amp;L is shown per resolved market. Fee revenue needs a future indexer event before it can be shown per trade.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>House P&amp;L</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resolvedMarkets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-xs text-[var(--muted)]">
                    No resolved markets found yet.
                  </TableCell>
                </TableRow>
              ) : (
                resolvedMarkets.map((market) => {
                  const family = getAdminMarketFamily(market);
                  const meta = family ? getFamilyMeta(family) : null;
                  const href = marketHref(market);

                  return (
                    <TableRow key={`${family ?? "unknown"}-${market.id}`}>
                      <TableCell className="max-w-[360px] whitespace-normal text-xs leading-5">
                        {formatAdminMarketQuestion(market)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{meta?.label ?? "Unknown"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-[var(--muted)]">{formatAdminMarketDate(market)}</TableCell>
                      <TableCell className="mono text-xs">{formatMoney(market.totalVolume)}</TableCell>
                      <TableCell className={`mono text-xs ${pnlClassName(market.housePnl)}`}>
                        {formatMoney(market.housePnl ?? 0)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{market.housePnlSource ?? "pending"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {href ? (
                          <Link
                            href={href}
                            className="inline-flex items-center gap-1 text-xs font-medium text-yes no-underline"
                          >
                            View <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
