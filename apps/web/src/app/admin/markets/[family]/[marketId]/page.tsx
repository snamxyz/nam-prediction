"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  useAdminMarketDetail,
  useAdminMarketHolders,
  useAdminMarketTrades,
  type AdminMarket,
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

function asNumber(value: string | number | undefined | null) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
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
  valueClassName,
}: {
  label: string;
  value: string | number;
  subtext: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </p>
      <p className={`mono text-sm ${valueClassName ?? "text-[var(--foreground)]"}`}>{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
        {subtext}
      </p>
    </div>
  );
}

type HolderDisplayRow = AdminMarketHolder & {
  rowKey: string;
  displaySide: string;
};

type MarketSideTab = {
  key: string;
  label: string;
  binarySide?: "YES" | "NO";
  rangeIndex?: number;
};

function getMarketSideTabs(
  family: AdminMarketFamily,
  market: AdminMarket,
  holders: AdminMarketHolder[],
  trades: AdminTrade[],
): MarketSideTab[] {
  if (family === "token") {
    return [
      { key: "yes", label: "YES", binarySide: "YES" },
      { key: "no", label: "NO", binarySide: "NO" },
    ];
  }

  const rangeMap = new Map<number, string>();

  for (const range of market.ranges ?? []) {
    rangeMap.set(range.index, range.label);
  }

  for (const holder of holders) {
    if (holder.rangeIndex !== undefined) {
      rangeMap.set(holder.rangeIndex, holder.rangeLabel ?? holder.side ?? `Range ${holder.rangeIndex + 1}`);
    }
  }

  for (const trade of trades) {
    if (trade.rangeIndex !== undefined) {
      rangeMap.set(trade.rangeIndex, trade.side);
    }
  }

  return [...rangeMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, label]) => ({
      key: `range-${index}`,
      label,
      rangeIndex: index,
    }));
}

function matchesSideTab(
  family: AdminMarketFamily,
  sideTab: MarketSideTab,
  item: { displaySide?: string; side?: string; rangeIndex?: number },
) {
  if (family === "token") {
    return item.displaySide === sideTab.binarySide || item.side === sideTab.binarySide;
  }
  return item.rangeIndex === sideTab.rangeIndex;
}

function expandHolderRows(holders: AdminMarketHolder[]): HolderDisplayRow[] {
  return holders.flatMap((holder) => {
    const yesShares = asNumber(holder.yesBalance);
    const noShares = asNumber(holder.noBalance);
    const hasBinaryBalances = holder.yesBalance !== undefined || holder.noBalance !== undefined;

    if (hasBinaryBalances) {
      const rows: HolderDisplayRow[] = [];

      if (yesShares > 0) {
        rows.push({
          ...holder,
          rowKey: `${holder.userAddress}-YES`,
          side: "YES",
          displaySide: "YES",
          openInterestShares: holder.yesBalance ?? "0",
          costBasis: holder.yesCostBasis ?? "0.00",
          avgEntryPrice: holder.yesAvgPrice ?? null,
        });
      }

      if (noShares > 0) {
        rows.push({
          ...holder,
          rowKey: `${holder.userAddress}-NO`,
          side: "NO",
          displaySide: "NO",
          openInterestShares: holder.noBalance ?? "0",
          costBasis: holder.noCostBasis ?? "0.00",
          avgEntryPrice: holder.noAvgPrice ?? null,
        });
      }

      return rows;
    }

    return [{
      ...holder,
      rowKey: `${holder.userAddress}-${holder.side}-${holder.rangeIndex ?? "range"}`,
      displaySide: holder.rangeLabel ?? holder.side,
    }];
  });
}

function getHolderAction(holder: HolderDisplayRow, market: AdminMarket) {
  if (!market.resolved) return "Awaiting Redemption";

  const isWinner =
    holder.rangeIndex !== undefined
      ? holder.rangeIndex === market.result - 1
      : (holder.side === "YES" && market.result === 1) || (holder.side === "NO" && market.result === 2);

  if (!isWinner) return "Lost";
  return asNumber(holder.openInterestShares) > 0 ? "Awaiting Redemption" : "Redeemed";
}

function pnlClassName(value: string | undefined) {
  const pnl = asNumber(value);
  if (pnl > 0) return "text-yes";
  if (pnl < 0) return "text-no";
  return "text-[var(--muted)]";
}

function HoldersTable({
  holders,
  rows: providedRows,
  isLoading,
  market,
  hideSideColumn = false,
}: {
  holders?: AdminMarketHolder[];
  rows?: HolderDisplayRow[];
  isLoading: boolean;
  market: AdminMarket;
  hideSideColumn?: boolean;
}) {
  const rows = providedRows ?? expandHolderRows(holders ?? []);

  return (
    <Card className=" bg-card">
      <CardHeader>
        <CardTitle className="text-base">Holders</CardTitle>
        <CardDescription>
          Positions indexed for this market. Action tracks Lost, Redeemed, or Awaiting Redemption.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-0">
        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-10 w-full" />)}
          </div>
        ) : (
          <Table className="min-w-[920px]">
            <TableHeader>
              <TableRow>
                <TableHead>Holder</TableHead>
                {!hideSideColumn && <TableHead>Side</TableHead>}
                <TableHead>Shares</TableHead>
                <TableHead>Cost Basis</TableHead>
                <TableHead>Avg Entry</TableHead>
                <TableHead>P&amp;L</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="text-right">Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={hideSideColumn ? 7 : 8} className="py-8 text-center text-xs text-[var(--muted)]">
                    No holders found.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((holder) => (
                  <TableRow key={holder.rowKey}>
                    <TableCell className="font-medium">
                      {holder.displayName || holder.loginMethod || holder.shortAddress || shortAddress(holder.userAddress)}
                    </TableCell>
                    {!hideSideColumn && (
                      <TableCell>
                        <Badge variant="secondary">{holder.displaySide}</Badge>
                      </TableCell>
                    )}
                    <TableCell className="mono text-xs">{formatShares(holder.openInterestShares)}</TableCell>
                    <TableCell className="mono text-xs">{formatMoney(holder.costBasis)}</TableCell>
                    <TableCell className="mono text-xs">
                      {typeof holder.avgEntryPrice === "number" ? `${(holder.avgEntryPrice * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className={`mono text-xs ${pnlClassName(holder.pnl)}`}>
                      {formatMoney(holder.pnl)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getHolderAction(holder, market)}</Badge>
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

function TradesTable({
  trades,
  isLoading,
  hideSideColumn = false,
}: {
  trades: AdminTrade[];
  isLoading: boolean;
  hideSideColumn?: boolean;
}) {
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
                {!hideSideColumn && <TableHead>Side</TableHead>}
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
                  <TableCell colSpan={hideSideColumn ? 6 : 7} className="py-8 text-center text-xs text-[var(--muted)]">
                    No trades found.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => (
                  <TableRow key={`${trade.source ?? "binary"}-${trade.id}`}>
                    <TableCell className="mono text-xs">{shortAddress(trade.traderAddress)}</TableCell>
                    {!hideSideColumn && (
                      <TableCell>
                        <Badge variant="secondary">{trade.side}</Badge>
                      </TableCell>
                    )}
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

function SideFilterTabs({
  sideTabs,
  children,
}: {
  sideTabs: MarketSideTab[];
  children: (sideTab: MarketSideTab) => ReactNode;
}) {
  if (sideTabs.length === 0) {
    return (
      <Card className="bg-card">
        <CardContent className="py-8 text-center text-xs text-[var(--muted)]">
          No outcome sides available for this market.
        </CardContent>
      </Card>
    );
  }

  if (sideTabs.length === 1) {
    return <>{children(sideTabs[0])}</>;
  }

  return (
    <Tabs defaultValue={sideTabs[0].key} className="flex flex-col gap-3">
      <TabsList className="h-auto flex-wrap bg-[var(--surface-hover)]">
        {sideTabs.map((sideTab) => (
          <TabsTrigger
            key={sideTab.key}
            value={sideTab.key}
            className="text-xs aria-selected:border-yes/30 aria-selected:bg-yes/15 aria-selected:text-yes"
          >
            {sideTab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {sideTabs.map((sideTab) => (
        <TabsContent key={sideTab.key} value={sideTab.key}>
          {children(sideTab)}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default function AdminMarketDetailPage() {
  const params = useParams<{ family: string; marketId: string }>();
  const rawFamily = Array.isArray(params.family) ? params.family[0] : params.family;
  const family: AdminMarketFamily | undefined = isAdminMarketFamily(rawFamily) ? rawFamily : undefined;
  const marketId = Array.isArray(params.marketId) ? params.marketId[0] : params.marketId;
  const meta = family ? getFamilyMeta(family) : undefined;

  const { data: detail, isLoading: isMarketLoading } = useAdminMarketDetail(family, marketId);
  const market = detail?.market;
  const resolvedQueryOptions = market?.resolved
    ? { staleTime: Infinity, refetchInterval: false as const }
    : undefined;
  const { data: holdersData, isLoading: isHoldersLoading } = useAdminMarketHolders(family, marketId, resolvedQueryOptions);
  const { data: tradesData, isLoading: isTradesLoading } = useAdminMarketTrades(family, marketId, resolvedQueryOptions);
  const holders = holdersData?.holders ?? [];
  const trades = tradesData?.trades ?? [];
  const sideTabs = market ? getMarketSideTabs(family ?? "token", market, holders, trades) : [];
  const expandedHolders = expandHolderRows(holders);

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
        <CardContent className="grid gap-3 md:grid-cols-4 xl:grid-cols-5">
          <StatCard label="Trades" value={market.tradeCount} subtext="Executed orders" />
          <StatCard label="Unique Traders" value={market.distinctTraderCount} subtext="Distinct wallets that traded" />
          <StatCard label="Volume" value={formatMoney(market.totalVolume)} subtext="Total collateral volume" />
          <StatCard label="Holders" value={market.holderCount ?? 0} subtext="Wallets with currently open holdings" />
          <StatCard
            label="House P&L"
            value={formatMoney(market.housePnl ?? 0)}
            subtext={`${market.housePnlSource ?? "pending"} house result from liquidity provision`}
            valueClassName={pnlClassName(market.housePnl ?? "0")}
          />
          <StatCard
            label="Open Interest"
            value={formatShares(market.openInterestShares)}
            subtext="Unresolved shares outstanding, including losing-side shares until settlement"
          />
          <StatCard
            label="Liquidity"
            value={formatMoney(market.liquidity)}
            subtext="Current USDC in the AMM pool supporting this market"
          />
          <StatCard
            label="At Risk"
            value={formatMoney(market.liquidityAtRisk)}
            subtext="Max payout owed to current winning-side holders at $1 per share"
          />
          <StatCard
            label="Withdrawn"
            value={formatMoney(market.liquidityWithdrawn)}
            subtext="USDC drained from pool after resolution by admin actions"
          />
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
          <SideFilterTabs sideTabs={sideTabs}>
            {(sideTab) => (
              <HoldersTable
                rows={expandedHolders.filter((holder) => matchesSideTab(family!, sideTab, holder))}
                isLoading={isHoldersLoading}
                market={market}
                hideSideColumn
              />
            )}
          </SideFilterTabs>
        </TabsContent>
        <TabsContent value="trades">
          <SideFilterTabs sideTabs={sideTabs}>
            {(sideTab) => (
              <TradesTable
                trades={trades.filter((trade) => matchesSideTab(family!, sideTab, trade))}
                isLoading={isTradesLoading}
                hideSideColumn
              />
            )}
          </SideFilterTabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
