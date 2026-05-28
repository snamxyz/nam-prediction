"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  useAdminMarketDetail,
  useAdminMarketHolders,
  useAdminMarketTrades,
  type AdminMarketFamily,
  type AdminMarketHolder,
  type AdminTrade,
} from "@/hooks/useAdmin";
import {
  formatAdminMarketDate,
  formatAdminMarketQuestion,
  formatMarketType,
  formatMoney,
  getFamilyMeta,
  isAdminMarketFamily,
  statusText,
} from "@/lib/adminMarketDisplay";
import { Badge } from "@/components/UI/badge";
import { Button } from "@/components/UI/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/UI/card";
import { Skeleton } from "@/components/UI/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/UI/table";

function shortAddress(address: string | null | undefined) {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatShares(value: string | number | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function timeAgo(ts: string) {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StatCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string | number;
  subtext: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mono text-sm text-[var(--foreground)]">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
        {subtext}
      </p>
    </div>
  );
}

function HoldersTable({ holders, isLoading }: { holders: AdminMarketHolder[]; isLoading: boolean }) {
  return (
    <Card className=" bg-card">
      <CardHeader>
        <CardTitle className="text-base">Holders</CardTitle>
        <CardDescription>Open positions indexed for this market.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-0">
        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-10 w-full" />)}
          </div>
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Holder</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Shares</TableHead>
                <TableHead>Cost Basis</TableHead>
                <TableHead>Avg Entry</TableHead>
                <TableHead className="text-right">Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-xs text-[var(--muted)]">
                    No holders found.
                  </TableCell>
                </TableRow>
              ) : (
                holders.map((holder) => (
                  <TableRow key={`${holder.userAddress}-${holder.side}-${holder.rangeIndex ?? "binary"}`}>
                    <TableCell className="font-medium">
                      {holder.displayName || holder.loginMethod || holder.shortAddress || shortAddress(holder.userAddress)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{holder.rangeLabel ?? holder.side}</Badge>
                    </TableCell>
                    <TableCell className="mono text-xs">{formatShares(holder.openInterestShares)}</TableCell>
                    <TableCell className="mono text-xs">{formatMoney(holder.costBasis)}</TableCell>
                    <TableCell className="mono text-xs">
                      {typeof holder.avgEntryPrice === "number" ? `${(holder.avgEntryPrice * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`https://basescan.org/address/${holder.userAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-xs text-[var(--muted)] no-underline hover:text-[var(--foreground)]"
                      >
                        {shortAddress(holder.userAddress)}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TradesTable({ trades, isLoading }: { trades: AdminTrade[]; isLoading: boolean }) {
  return (
    <Card className=" bg-card">
      <CardHeader>
        <CardTitle className="text-base">Trades</CardTitle>
        <CardDescription>Most recent trades scoped to this market.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-0">
        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-10 w-full" />)}
          </div>
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Trader</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Shares</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-xs text-[var(--muted)]">
                    No trades found.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => (
                  <TableRow key={`${trade.source ?? "binary"}-${trade.id}`}>
                    <TableCell className="mono text-xs">{shortAddress(trade.traderAddress)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{trade.side}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={trade.isBuy ? "bg-yes/15 text-yes hover:bg-yes/20" : "bg-no/15 text-no hover:bg-no/20"}>
                        {trade.isBuy ? "BUY" : "SELL"}
                      </Badge>
                    </TableCell>
                    <TableCell className="mono text-xs">{formatMoney(trade.collateral)}</TableCell>
                    <TableCell className="mono text-xs">{formatShares(trade.shares)}</TableCell>
                    <TableCell className="text-xs text-[var(--muted)]">{timeAgo(trade.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`https://basescan.org/tx/${trade.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex text-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminMarketDetailPage() {
  const params = useParams<{ family: string; marketId: string }>();
  const rawFamily = Array.isArray(params.family) ? params.family[0] : params.family;
  const family: AdminMarketFamily | undefined = isAdminMarketFamily(rawFamily) ? rawFamily : undefined;
  const marketId = Array.isArray(params.marketId) ? params.marketId[0] : params.marketId;
  const meta = family ? getFamilyMeta(family) : undefined;

  const { data: detail, isLoading: isMarketLoading } = useAdminMarketDetail(family, marketId);
  const { data: holdersData, isLoading: isHoldersLoading } = useAdminMarketHolders(family, marketId);
  const { data: tradesData, isLoading: isTradesLoading } = useAdminMarketTrades(family, marketId);
  const market = detail?.market;

  if (!family || !meta) {
    return (
      <Card className="max-w-xl  bg-card">
        <CardHeader>
          <CardTitle>Unknown market family</CardTitle>
          <CardDescription>Choose one of the production market families.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/admin/markets" className="no-underline">
            <Button variant="outline">Back to Markets</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (isMarketLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (!market) {
    return (
      <Card className="max-w-xl  bg-card">
        <CardHeader>
          <CardTitle>Market not found</CardTitle>
          <CardDescription>This market was not found for the selected family.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/admin/markets/${family}`} className="no-underline">
            <Button variant="outline">Back to {meta.label}</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href={`/admin/markets/${family}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] no-underline transition hover:text-yes"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {meta.label} markets
      </Link>

      <Card className=" bg-[var(--surface)]">
        <CardHeader>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="bg-yes/10 text-yes hover:bg-yes/20">{meta.badge}</Badge>
            <Badge variant="secondary">{formatAdminMarketDate(market)}</Badge>
            <Badge variant={market.resolved ? "secondary" : "default"}>
              {statusText(market)}
            </Badge>
            <Badge variant="outline">{formatMarketType(market)}</Badge>
          </div>
          <CardTitle className="max-w-4xl text-xl leading-7">
            {formatAdminMarketQuestion(market)}
          </CardTitle>
          <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Liquidity state: {market.liquidityState ?? "—"}</span>
            <span>Pool {shortAddress(market.poolAddress)}</span>
            <span>On-chain {market.onChainId ? `#${market.onChainId}` : "—"}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <StatCard label="Trades" value={market.tradeCount} subtext="Executed orders" />
          <StatCard label="Unique Traders" value={market.distinctTraderCount} subtext="Distinct wallets that traded" />
          <StatCard label="Volume" value={formatMoney(market.totalVolume)} subtext="Total collateral volume" />
          <StatCard label="Holders" value={market.holderCount ?? 0} subtext="Wallets with currently open holdings" />
          <StatCard label="Open Interest" value={formatShares(market.openInterestShares)} subtext="Outstanding unresolved shares" />
          <StatCard label="Liquidity" value={formatMoney(market.liquidity)} subtext="Current pool liquidity tracked" />
          <StatCard label="At Risk" value={formatMoney(market.liquidityAtRisk)} subtext="Liquidity reserved for potential payouts" />
          <StatCard label="Withdrawn" value={formatMoney(market.liquidityWithdrawn)} subtext="Liquidity drained after resolution actions" />
        </CardContent>
      </Card>
      <p className="-mt-2 text-[10px] text-[var(--muted)]">
        Legend: all metric cards above are scoped to this individual market.
      </p>

      <Tabs defaultValue="holders" className="flex flex-col gap-4">
        <TabsList className="bg-[var(--surface-hover)]">
          <TabsTrigger
            value="holders"
            className="text-xs aria-selected:border-yes/30 aria-selected:bg-yes/15 aria-selected:text-yes"
          >
            Holders
          </TabsTrigger>
          <TabsTrigger
            value="trades"
            className="text-xs aria-selected:border-yes/30 aria-selected:bg-yes/15 aria-selected:text-yes"
          >
            Trades
          </TabsTrigger>
        </TabsList>
        <TabsContent value="holders">
          <HoldersTable holders={holdersData?.holders ?? []} isLoading={isHoldersLoading} />
        </TabsContent>
        <TabsContent value="trades">
          <TradesTable trades={tradesData?.trades ?? []} isLoading={isTradesLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
