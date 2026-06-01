import { CPMMABI, ERC20ABI } from "@nam-prediction/shared";
import { and, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { createPublicClient, formatUnits, http } from "viem";
import { base } from "viem/chains";
import { db } from "../db/client";
import {
  marketFeeEvents,
  markets,
  orderFills,
  rangeMarkets,
  rangePositions,
  rangeTrades,
  trades,
  userPositions,
  users,
  vaultTransactions,
} from "../db/schema";
import { cacheKeys, acquireLock, releaseLock, redis } from "../lib/redis";
import { formatMarketQuestion } from "../lib/market-display";
import {
  computeHousePnl,
  formatHousePnl,
  sumBinaryTraderRealisedPnl,
  sumRangeTraderRealisedPnl,
} from "../lib/pnl";

export type AdminMarketStatus = "active" | "resolved" | "all";
export type AdminMarketFamily = "token" | "participants" | "receipts";
export type SnapshotSource = "redis" | "db";

const ACTIVE_SNAPSHOT_TTL_SECONDS = 120;
const HISTORICAL_SNAPSHOT_TTL_SECONDS = 600;
const USER_SNAPSHOT_TTL_SECONDS = 120;
const HEALTH_TTL_SECONDS = 900;
const MAX_MARKET_SNAPSHOT_LIMIT = 200;
const DUST = 1e-9;
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const adminSnapshotPublicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL, {
    retryCount: 2,
    retryDelay: 500,
    timeout: 10_000,
  }),
});

export interface SnapshotMetadata {
  snapshotAt: string;
  snapshotSource: SnapshotSource;
  stale?: boolean;
}

export interface AdminOverviewSnapshot extends SnapshotMetadata {
  totalUsers: number;
  users24h: number;
  users7d: number;
  totalTrades: number;
  trades24h: number;
  totalVolume: string;
  volume24h: string;
  activeMarkets: number;
  resolvedMarkets: number;
  totalDeposits: string;
  totalWithdrawals: string;
  tvl: string;
  activeLiquidity: string;
  startingLiquidity: string;
  endingLiquidity: string;
  currentLiquidity: string;
  currentLiquiditySource: "chain" | "mixed" | "db";
  currentLiquidityFailedPools: number;
  liquidityWithdrawn: string;
  reservedClaims: string;
  outstandingWinningClaims: string;
  liquidityAtRisk: string;
  housePnl: string;
  housePnlFinalCount: number;
  housePnlEstimatedCount: number;
  totalFees: string;
  totalRedemptions: string;
}

export interface AdminMarketSnapshot extends SnapshotMetadata {
  id: number;
  onChainId: number;
  question: string;
  resolutionSource?: string;
  cadence: string;
  category?: string;
  marketType?: string;
  date?: string;
  status?: string;
  resolved: boolean;
  result: number;
  tradeCount: number;
  distinctTraderCount: number;
  totalVolume: string;
  liquidity?: string;
  liquidityWithdrawn?: string;
  reservedClaims?: string;
  outstandingWinningClaims?: string;
  housePnl?: string | null;
  housePnlSource?: "final" | "estimated" | "pending";
  liquidityState?: string;
  seededLiquidity?: string;
  poolAddress?: string | null;
  endTime?: Date | string;
  createdAt: Date | string;
  holderCount: number;
  openInterestShares: string;
  largestHolderShares: string;
  holderConcentrationPct: string;
  liquidityAtRisk: string;
  totalYesShares?: string;
  totalNoShares?: string;
  totalRangeShares?: string;
}

export interface AdminMarketsSnapshotResponse extends SnapshotMetadata {
  markets: AdminMarketSnapshot[];
}

export interface AdminUserHoldingsSnapshot extends SnapshotMetadata {
  wallet: string;
  vault: {
    totalDeposits: string;
    totalWithdrawals: string;
    totalRedemptions: string;
    netDeposits: string;
    transactionCount: number;
    recentTransactions: Array<{
      id: number;
      type: string;
      amount: string;
      txHash: string;
      timestamp: Date | string;
    }>;
  };
  binary: Array<{
    marketId: number;
    question: string;
    resolved: boolean;
    result: number;
    yesBalance: string;
    noBalance: string;
    yesCostBasis: string;
    noCostBasis: string;
  }>;
  range: Array<{
    marketId: number;
    question: string;
    marketType: string;
    rangeIndex: number;
    balance: string;
    costBasis: string;
    avgEntryPrice: number;
    resolved: boolean;
    winningRangeIndex: number | null;
  }>;
}

type HoldingSummary = {
  holderCount: number;
  openInterestShares: number;
  largestHolderShares: number;
  holderConcentrationPct: number;
};

export type BinaryPositionSummary = HoldingSummary & {
  totalYesShares: number;
  totalNoShares: number;
};

export type RangePositionSummary = HoldingSummary & {
  totalRangeShares: number;
};

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function money(value: unknown): string {
  return asNumber(value).toFixed(2);
}

function shares(value: unknown): string {
  return asNumber(value).toFixed(6);
}

function withSource<T extends SnapshotMetadata>(payload: T, source: SnapshotSource, stale?: boolean): T {
  return {
    ...payload,
    snapshotSource: source,
    stale: stale ?? payload.stale,
  };
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type LiveLiquidityPool = {
  address: string | null;
  fallback: number;
};

async function readLiveCurrentLiquidity(pools: LiveLiquidityPool[]) {
  const candidates = pools.filter((pool) => pool.address?.startsWith("0x"));
  const fallbackTotal = pools.reduce((acc, pool) => acc + Math.max(0, pool.fallback), 0);
  if (candidates.length === 0) {
    return { value: fallbackTotal, source: "db" as const, failedPools: 0 };
  }

  try {
    const results = await adminSnapshotPublicClient.multicall({
      allowFailure: true,
      contracts: candidates.map((pool) => ({
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "balanceOf",
        args: [pool.address as `0x${string}`],
      })),
    });

    let total = 0;
    let failedPools = 0;
    for (let i = 0; i < candidates.length; i++) {
      const result = results[i] as { status: "success" | "failure"; result?: bigint };
      if (result?.status === "success" && result.result !== undefined) {
        total += Number(formatUnits(result.result, 6));
      } else {
        failedPools += 1;
        total += Math.max(0, candidates[i].fallback);
      }
    }

    return {
      value: total,
      source: failedPools === 0 ? "chain" as const : "mixed" as const,
      failedPools,
    };
  } catch (err) {
    console.warn("[AdminSnapshots] Failed to read live pool liquidity:", err);
    return { value: fallbackTotal, source: "db" as const, failedPools: candidates.length };
  }
}

async function computeOverviewHousePnl() {
  const [binaryRows, rangeRows] = await Promise.all([
    db.select().from(markets).where(eq(markets.resolved, true)),
    db.select().from(rangeMarkets).where(eq(rangeMarkets.resolved, true)),
  ]);

  const binaryIds = binaryRows.map((market) => market.id);
  const rangeIds = rangeRows.map((market) => market.id);

  const [binaryTradeRows, rangeTradeRows] = await Promise.all([
    binaryIds.length
      ? db
          .select({
            trader: trades.trader,
            marketId: trades.marketId,
            isYes: trades.isYes,
            isBuy: trades.isBuy,
            shares: trades.shares,
            collateral: trades.collateral,
            result: markets.result,
          })
          .from(trades)
          .innerJoin(markets, eq(trades.marketId, markets.id))
          .where(and(inArray(trades.marketId, binaryIds), eq(markets.resolved, true)))
      : Promise.resolve([]),
    rangeIds.length
      ? db
          .select({
            trader: rangeTrades.trader,
            marketId: rangeTrades.rangeMarketId,
            rangeIndex: rangeTrades.rangeIndex,
            isBuy: rangeTrades.isBuy,
            shares: rangeTrades.shares,
            collateral: rangeTrades.collateral,
            winningRangeIndex: rangeMarkets.winningRangeIndex,
          })
          .from(rangeTrades)
          .innerJoin(rangeMarkets, eq(rangeTrades.rangeMarketId, rangeMarkets.id))
          .where(and(inArray(rangeTrades.rangeMarketId, rangeIds), eq(rangeMarkets.resolved, true)))
      : Promise.resolve([]),
  ]);

  const binaryTradesByMarket = new Map<number, typeof binaryTradeRows>();
  for (const trade of binaryTradeRows) {
    const list = binaryTradesByMarket.get(trade.marketId) ?? [];
    list.push(trade);
    binaryTradesByMarket.set(trade.marketId, list);
  }

  const rangeTradesByMarket = new Map<number, typeof rangeTradeRows>();
  for (const trade of rangeTradeRows) {
    const list = rangeTradesByMarket.get(trade.marketId) ?? [];
    list.push(trade);
    rangeTradesByMarket.set(trade.marketId, list);
  }

  let pnl = 0;
  let finalCount = 0;
  let estimatedCount = 0;

  for (const market of binaryRows) {
    const seededLiquidity = asNumber(market.seededLiquidity) || (market.cadence === "24h" ? 1 : asNumber(market.liquidity));
    const traderPnl = sumBinaryTraderRealisedPnl(binaryTradesByMarket.get(market.id) ?? []);
    const result = computeHousePnl({
      resolved: market.resolved,
      liquidityDrained: market.liquidityDrained,
      seededLiquidity,
      liquidityWithdrawn: asNumber(market.liquidityWithdrawn),
      traderRealisedPnlSum: traderPnl,
    });
    if (result.pnl !== null) pnl += result.pnl;
    if (result.source === "final") finalCount += 1;
    if (result.source === "estimated") estimatedCount += 1;
  }

  for (const market of rangeRows) {
    const traderPnl = sumRangeTraderRealisedPnl(rangeTradesByMarket.get(market.id) ?? []);
    const result = computeHousePnl({
      resolved: market.resolved,
      liquidityDrained: market.liquidityDrained,
      seededLiquidity: asNumber(market.totalLiquidity),
      liquidityWithdrawn: asNumber(market.liquidityWithdrawn),
      traderRealisedPnlSum: traderPnl,
    });
    if (result.pnl !== null) pnl += result.pnl;
    if (result.source === "final") finalCount += 1;
    if (result.source === "estimated") estimatedCount += 1;
  }

  return { pnl, finalCount, estimatedCount };
}

async function readJsonSnapshot<T extends SnapshotMetadata>(key: string): Promise<T | null> {
  return parseJson<T>(await redis.get(key));
}

async function writeJsonSnapshot(key: string, payload: SnapshotMetadata, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(payload), "EX", ttlSeconds);
}

export function computeMarketLiquidityAtRisk(input: {
  resolved: boolean;
  liquidity: number;
  reservedClaims: number;
  outstandingWinningClaims: number;
}): number {
  if (!input.resolved) return Math.max(0, input.liquidity);
  return Math.max(0, input.reservedClaims + input.outstandingWinningClaims);
}

async function getEffectiveLiquidityWithdrawn(input: {
  marketId: number;
  poolAddress?: string | null;
  resolved: boolean;
  liquidityDrained: boolean;
  liquidityWithdrawn: number;
}) {
  if (
    !input.resolved ||
    !input.liquidityDrained ||
    input.liquidityWithdrawn > DUST ||
    !input.poolAddress?.startsWith("0x")
  ) {
    return input.liquidityWithdrawn;
  }

  try {
    const withdrawnOnChain = (await adminSnapshotPublicClient.readContract({
      address: input.poolAddress as `0x${string}`,
      abi: CPMMABI,
      functionName: "liquidityWithdrawn",
    })) as bigint;
    return Number(formatUnits(withdrawnOnChain, 6));
  } catch (err) {
    console.warn(
      `[AdminSnapshots] Failed to read liquidityWithdrawn for market #${input.marketId}:`,
      err
    );
    return input.liquidityWithdrawn;
  }
}

export function summarizeBinaryPositionRows(
  rows: Array<{ marketId: number; userAddress: string; yesBalance: string; noBalance: string }>
): Map<number, BinaryPositionSummary> {
  const summaries = new Map<number, BinaryPositionSummary>();
  const largestByMarketUser = new Map<string, number>();

  for (const row of rows) {
    const yes = asNumber(row.yesBalance);
    const no = asNumber(row.noBalance);
    const total = Math.max(0, yes) + Math.max(0, no);
    const current =
      summaries.get(row.marketId) ??
      {
        holderCount: 0,
        totalYesShares: 0,
        totalNoShares: 0,
        openInterestShares: 0,
        largestHolderShares: 0,
        holderConcentrationPct: 0,
      };

    current.totalYesShares += Math.max(0, yes);
    current.totalNoShares += Math.max(0, no);
    current.openInterestShares += total;

    if (total > DUST) {
      current.holderCount += 1;
      const holderKey = `${row.marketId}:${row.userAddress.toLowerCase()}`;
      const previous = largestByMarketUser.get(holderKey) ?? 0;
      largestByMarketUser.set(holderKey, previous + total);
      current.largestHolderShares = Math.max(current.largestHolderShares, previous + total);
    }

    summaries.set(row.marketId, current);
  }

  for (const summary of summaries.values()) {
    summary.holderConcentrationPct =
      summary.openInterestShares > DUST
        ? (summary.largestHolderShares / summary.openInterestShares) * 100
        : 0;
  }

  return summaries;
}

export function summarizeRangePositionRows(
  rows: Array<{ rangeMarketId: number; userAddress: string; balance: string }>
): Map<number, RangePositionSummary> {
  const summaries = new Map<number, RangePositionSummary>();
  const largestByMarketUser = new Map<string, number>();

  for (const row of rows) {
    const balance = Math.max(0, asNumber(row.balance));
    const current =
      summaries.get(row.rangeMarketId) ??
      {
        holderCount: 0,
        totalRangeShares: 0,
        openInterestShares: 0,
        largestHolderShares: 0,
        holderConcentrationPct: 0,
      };

    current.totalRangeShares += balance;
    current.openInterestShares += balance;

    if (balance > DUST) {
      const holderKey = `${row.rangeMarketId}:${row.userAddress.toLowerCase()}`;
      const previous = largestByMarketUser.get(holderKey) ?? 0;
      if (previous <= DUST) current.holderCount += 1;
      largestByMarketUser.set(holderKey, previous + balance);
      current.largestHolderShares = Math.max(current.largestHolderShares, previous + balance);
    }

    summaries.set(row.rangeMarketId, current);
  }

  for (const summary of summaries.values()) {
    summary.holderConcentrationPct =
      summary.openInterestShares > DUST
        ? (summary.largestHolderShares / summary.openInterestShares) * 100
        : 0;
  }

  return summaries;
}

export async function buildAdminOverviewSnapshot(): Promise<AdminOverviewSnapshot> {
  const now = new Date();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    [totalUsersRow],
    [users24hRow],
    [users7dRow],
    [totalTradesBinaryRow],
    [totalTradesRangeRow],
    [trades24hBinaryRow],
    [trades24hRangeRow],
    [totalVolumeMarketsRow],
    [totalVolumeRangeTradesRow],
    [volume24hBinaryRow],
    [volume24hRangeRow],
    [activeBinaryMarketsRow],
    [activeRangeMarketsRow],
    [resolvedBinaryMarketsRow],
    [resolvedRangeMarketsRow],
    [totalDepositsRow],
    [totalWithdrawalsRow],
    [totalRedemptionsRow],
    [activeBinaryLiquidityRow],
    [activeRangeLiquidityRow],
    [binaryStartingLiquidityRow],
    [rangeStartingLiquidityRow],
    [binaryEndingLiquidityRow],
    [rangeEndingLiquidityRow],
    [binaryLiquidityWithdrawnRow],
    [rangeLiquidityWithdrawnRow],
    [binaryReservedClaimsRow],
    [rangeReservedClaimsRow],
    [binaryOutstandingClaimsRow],
    [rangeOutstandingClaimsRow],
    [ammFeesRow],
    [clobFeesRow],
    binaryLiquidityPools,
    rangeLiquidityPools,
    housePnlSummary,
  ] = await Promise.all([
    db.select({ c: count() }).from(users),
    db.select({ c: count() }).from(users).where(gte(users.createdAt, ago24h)),
    db.select({ c: count() }).from(users).where(gte(users.createdAt, ago7d)),
    db.select({ c: count() }).from(trades),
    db.select({ c: count() }).from(rangeTrades),
    db.select({ c: count() }).from(trades).where(gte(trades.timestamp, ago24h)),
    db.select({ c: count() }).from(rangeTrades).where(gte(rangeTrades.timestamp, ago24h)),
    db.select({ v: sum(markets.volume) }).from(markets),
    db.select({ v: sum(rangeTrades.collateral) }).from(rangeTrades),
    db.select({ v: sum(trades.collateral) }).from(trades).where(gte(trades.timestamp, ago24h)),
    db.select({ v: sum(rangeTrades.collateral) }).from(rangeTrades).where(gte(rangeTrades.timestamp, ago24h)),
    db.select({ c: count() }).from(markets).where(eq(markets.resolved, false)),
    db.select({ c: count() }).from(rangeMarkets).where(eq(rangeMarkets.resolved, false)),
    db.select({ c: count() }).from(markets).where(eq(markets.resolved, true)),
    db.select({ c: count() }).from(rangeMarkets).where(eq(rangeMarkets.resolved, true)),
    db.select({ s: sum(vaultTransactions.amount) }).from(vaultTransactions).where(eq(vaultTransactions.type, "deposit")),
    db.select({ s: sum(vaultTransactions.amount) }).from(vaultTransactions).where(eq(vaultTransactions.type, "withdraw")),
    db.select({ s: sum(vaultTransactions.amount) }).from(vaultTransactions).where(eq(vaultTransactions.type, "redemption")),
    db.select({ s: sum(markets.liquidity) }).from(markets).where(eq(markets.resolved, false)),
    db.select({ s: sum(rangeMarkets.totalLiquidity) }).from(rangeMarkets).where(eq(rangeMarkets.resolved, false)),
    db.select({ s: sum(markets.seededLiquidity) }).from(markets),
    db.select({ s: sum(rangeMarkets.totalLiquidity) }).from(rangeMarkets),
    db
      .select({
        s: sql<string>`sum(coalesce(${markets.endingLiquidity}, ${markets.liquidityWithdrawn} + ${markets.outstandingWinningClaims}))`,
      })
      .from(markets)
      .where(eq(markets.resolved, true)),
    db
      .select({
        s: sql<string>`sum(coalesce(${rangeMarkets.endingLiquidity}, ${rangeMarkets.liquidityWithdrawn} + ${rangeMarkets.outstandingWinningClaims}))`,
      })
      .from(rangeMarkets)
      .where(eq(rangeMarkets.resolved, true)),
    db.select({ s: sum(markets.liquidityWithdrawn) }).from(markets),
    db.select({ s: sum(rangeMarkets.liquidityWithdrawn) }).from(rangeMarkets),
    db.select({ s: sum(markets.reservedClaims) }).from(markets),
    db.select({ s: sum(rangeMarkets.reservedClaims) }).from(rangeMarkets),
    db.select({ s: sum(markets.outstandingWinningClaims) }).from(markets),
    db.select({ s: sum(rangeMarkets.outstandingWinningClaims) }).from(rangeMarkets),
    db
      .select({ s: sum(marketFeeEvents.amount) })
      .from(marketFeeEvents)
      .where(inArray(marketFeeEvents.marketFamily, ["binary", "range"])),
    db.select({ s: sql<string>`sum(${orderFills.makerFee} + ${orderFills.takerFee})` }).from(orderFills),
    db
      .select({
        address: markets.ammAddress,
        resolved: markets.resolved,
        liquidity: markets.liquidity,
        reservedClaims: markets.reservedClaims,
        outstandingWinningClaims: markets.outstandingWinningClaims,
      })
      .from(markets),
    db
      .select({
        address: rangeMarkets.rangeCpmmAddress,
        resolved: rangeMarkets.resolved,
        liquidity: rangeMarkets.totalLiquidity,
        reservedClaims: rangeMarkets.reservedClaims,
        outstandingWinningClaims: rangeMarkets.outstandingWinningClaims,
      })
      .from(rangeMarkets),
    computeOverviewHousePnl(),
  ]);

  const totalDeposits = asNumber(totalDepositsRow?.s);
  const totalWithdrawals = asNumber(totalWithdrawalsRow?.s);
  const totalRedemptions = asNumber(totalRedemptionsRow?.s);
  const activeLiquidity = asNumber(activeBinaryLiquidityRow?.s) + asNumber(activeRangeLiquidityRow?.s);
  const startingLiquidity = asNumber(binaryStartingLiquidityRow?.s) + asNumber(rangeStartingLiquidityRow?.s);
  const endingLiquidity = asNumber(binaryEndingLiquidityRow?.s) + asNumber(rangeEndingLiquidityRow?.s);
  const liquidityWithdrawn =
    asNumber(binaryLiquidityWithdrawnRow?.s) + asNumber(rangeLiquidityWithdrawnRow?.s);
  const reservedClaims = asNumber(binaryReservedClaimsRow?.s) + asNumber(rangeReservedClaimsRow?.s);
  const outstandingWinningClaims =
    asNumber(binaryOutstandingClaimsRow?.s) + asNumber(rangeOutstandingClaimsRow?.s);
  const currentLiquidity = await readLiveCurrentLiquidity([
    ...binaryLiquidityPools.map((pool) => ({
      address: pool.address,
      fallback: pool.resolved
        ? asNumber(pool.reservedClaims) + asNumber(pool.outstandingWinningClaims)
        : asNumber(pool.liquidity),
    })),
    ...rangeLiquidityPools.map((pool) => ({
      address: pool.address,
      fallback: pool.resolved
        ? asNumber(pool.reservedClaims) + asNumber(pool.outstandingWinningClaims)
        : asNumber(pool.liquidity),
    })),
  ]);
  const totalFees = asNumber(ammFeesRow?.s) + asNumber(clobFeesRow?.s);

  return {
    snapshotAt: now.toISOString(),
    snapshotSource: "db",
    totalUsers: Number(totalUsersRow?.c ?? 0),
    users24h: Number(users24hRow?.c ?? 0),
    users7d: Number(users7dRow?.c ?? 0),
    totalTrades: Number(totalTradesBinaryRow?.c ?? 0) + Number(totalTradesRangeRow?.c ?? 0),
    trades24h: Number(trades24hBinaryRow?.c ?? 0) + Number(trades24hRangeRow?.c ?? 0),
    totalVolume: money(asNumber(totalVolumeMarketsRow?.v) + asNumber(totalVolumeRangeTradesRow?.v)),
    volume24h: money(asNumber(volume24hBinaryRow?.v) + asNumber(volume24hRangeRow?.v)),
    activeMarkets: Number(activeBinaryMarketsRow?.c ?? 0) + Number(activeRangeMarketsRow?.c ?? 0),
    resolvedMarkets: Number(resolvedBinaryMarketsRow?.c ?? 0) + Number(resolvedRangeMarketsRow?.c ?? 0),
    totalDeposits: money(totalDeposits),
    totalWithdrawals: money(totalWithdrawals),
    tvl: money(totalDeposits - totalWithdrawals),
    activeLiquidity: money(activeLiquidity),
    startingLiquidity: money(startingLiquidity),
    endingLiquidity: money(endingLiquidity),
    currentLiquidity: money(currentLiquidity.value),
    currentLiquiditySource: currentLiquidity.source,
    currentLiquidityFailedPools: currentLiquidity.failedPools,
    liquidityWithdrawn: money(liquidityWithdrawn),
    reservedClaims: money(reservedClaims),
    outstandingWinningClaims: money(outstandingWinningClaims),
    liquidityAtRisk: money(activeLiquidity + reservedClaims + outstandingWinningClaims),
    housePnl: money(housePnlSummary.pnl),
    housePnlFinalCount: housePnlSummary.finalCount,
    housePnlEstimatedCount: housePnlSummary.estimatedCount,
    totalFees: money(totalFees),
    totalRedemptions: money(totalRedemptions),
  };
}

export async function getAdminOverviewSnapshot(): Promise<AdminOverviewSnapshot> {
  const key = cacheKeys.adminOverview();
  const cached = await readJsonSnapshot<AdminOverviewSnapshot>(key);
  if (cached) return withSource(cached, "redis");

  const rebuilt = await buildAdminOverviewSnapshot();
  await writeJsonSnapshot(key, rebuilt, ACTIVE_SNAPSHOT_TTL_SECONDS);
  return withSource(rebuilt, "db", true);
}

export async function buildAdminMarketsSnapshot(input: {
  status?: AdminMarketStatus;
  family?: AdminMarketFamily;
  limit?: number;
}): Promise<AdminMarketsSnapshotResponse> {
  const statusFilter = input.status === "active" || input.status === "resolved" ? input.status : undefined;
  const family = input.family;
  const limit = Math.min(input.limit ?? MAX_MARKET_SNAPSHOT_LIMIT, MAX_MARKET_SNAPSHOT_LIMIT);
  const shouldFetchBinary = !family || family === "token";
  const shouldFetchRange = !family || family === "participants" || family === "receipts";
  const binaryFilters = [
    statusFilter === "active" ? eq(markets.resolved, false) : statusFilter === "resolved" ? eq(markets.resolved, true) : undefined,
    family === "token" ? eq(markets.cadence, "24h") : undefined,
  ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
  const rangeFilters = [
    statusFilter === "active" ? eq(rangeMarkets.resolved, false) : statusFilter === "resolved" ? eq(rangeMarkets.resolved, true) : undefined,
    family === "participants" || family === "receipts" ? eq(rangeMarkets.marketType, family) : undefined,
  ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));

  const rows = shouldFetchBinary
    ? await db
        .select({
          market: markets,
          tradeCount: count(trades.id),
          distinctTraderCount: sql<number>`count(distinct ${trades.trader})`,
          totalVol: sum(trades.collateral),
        })
        .from(markets)
        .leftJoin(trades, eq(trades.marketId, markets.id))
        .where(binaryFilters.length > 0 ? and(...binaryFilters) : undefined)
        .groupBy(markets.id)
        .orderBy(desc(family === "token" ? markets.endTime : markets.createdAt))
        .limit(limit)
    : [];

  const rangeRows = shouldFetchRange
    ? await db
        .select({
          market: rangeMarkets,
          tradeCount: count(rangeTrades.id),
          distinctTraderCount: sql<number>`count(distinct ${rangeTrades.trader})`,
          totalVol: sum(rangeTrades.collateral),
        })
        .from(rangeMarkets)
        .leftJoin(rangeTrades, eq(rangeTrades.rangeMarketId, rangeMarkets.id))
        .where(rangeFilters.length > 0 ? and(...rangeFilters) : undefined)
        .groupBy(rangeMarkets.id)
        .orderBy(desc(family ? rangeMarkets.date : rangeMarkets.createdAt))
        .limit(limit)
    : [];

  const binaryIds = rows.map((r) => r.market.id);
  const rangeIds = rangeRows.map((r) => r.market.id);
  const resolvedBinaryIds = rows.filter((r) => r.market.resolved).map((r) => r.market.id);
  const resolvedRangeIds = rangeRows.filter((r) => r.market.resolved).map((r) => r.market.id);

  const [binaryPositionRows, rangePositionRows] = await Promise.all([
    binaryIds.length
      ? db
          .select({
            marketId: userPositions.marketId,
            userAddress: userPositions.userAddress,
            yesBalance: userPositions.yesBalance,
            noBalance: userPositions.noBalance,
          })
          .from(userPositions)
          .where(inArray(userPositions.marketId, binaryIds))
      : Promise.resolve([]),
    rangeIds.length
      ? db
          .select({
            rangeMarketId: rangePositions.rangeMarketId,
            userAddress: rangePositions.userAddress,
            balance: rangePositions.balance,
          })
          .from(rangePositions)
          .where(inArray(rangePositions.rangeMarketId, rangeIds))
      : Promise.resolve([]),
  ]);

  const binaryHoldings = summarizeBinaryPositionRows(binaryPositionRows);
  const rangeHoldings = summarizeRangePositionRows(rangePositionRows);

  const binaryTraderPnlByMarket = new Map<number, number>();
  if (resolvedBinaryIds.length > 0) {
    const resolvedBinaryTrades = await db
      .select({
        trader: trades.trader,
        marketId: trades.marketId,
        isYes: trades.isYes,
        isBuy: trades.isBuy,
        shares: trades.shares,
        collateral: trades.collateral,
        result: markets.result,
      })
      .from(trades)
      .innerJoin(markets, eq(trades.marketId, markets.id))
      .where(and(inArray(trades.marketId, resolvedBinaryIds), eq(markets.resolved, true)));

    for (const marketId of resolvedBinaryIds) {
      binaryTraderPnlByMarket.set(
        marketId,
        sumBinaryTraderRealisedPnl(resolvedBinaryTrades.filter((t) => t.marketId === marketId))
      );
    }
  }

  const binaryMarkets = await Promise.all(rows.map(async (r) => {
    const liquidity = asNumber(r.market.liquidity);
    const seededLiquidity = asNumber(r.market.seededLiquidity) || (r.market.cadence === "24h" ? 1 : liquidity);
    const liquidityWithdrawn = await getEffectiveLiquidityWithdrawn({
      marketId: r.market.id,
      poolAddress: r.market.ammAddress,
      resolved: r.market.resolved,
      liquidityDrained: r.market.liquidityDrained,
      liquidityWithdrawn: asNumber(r.market.liquidityWithdrawn),
    });
    const reservedClaims = asNumber(r.market.reservedClaims);
    const outstandingWinningClaims = asNumber(r.market.outstandingWinningClaims);
    const traderPnl = binaryTraderPnlByMarket.get(r.market.id) ?? 0;
    const holding = binaryHoldings.get(r.market.id);
    const { pnl: housePnlValue, source: housePnlSource } = computeHousePnl({
      resolved: r.market.resolved,
      liquidityDrained: r.market.liquidityDrained,
      seededLiquidity,
      liquidityWithdrawn,
      traderRealisedPnlSum: traderPnl,
    });

    return {
      ...r.market,
      snapshotAt: new Date().toISOString(),
      snapshotSource: "db" as const,
      question: formatMarketQuestion(r.market),
      category: r.market.cadence === "24h" ? "24h" : "binary",
      marketType: r.market.cadence === "24h" ? "24h" : "binary",
      tradeCount: Number(r.tradeCount ?? 0),
      distinctTraderCount: Number(r.distinctTraderCount ?? 0),
      totalVolume: money(r.totalVol),
      liquidity: money(liquidity),
      seededLiquidity: money(seededLiquidity),
      poolAddress: r.market.ammAddress,
      endTime: r.market.endTime,
      liquidityWithdrawn: money(liquidityWithdrawn),
      reservedClaims: money(reservedClaims),
      outstandingWinningClaims: money(outstandingWinningClaims),
      housePnl: formatHousePnl(housePnlValue),
      housePnlSource,
      liquidityState: r.market.resolved ? (r.market.liquidityDrained ? "drained" : "awaiting drain") : "active",
      holderCount: holding?.holderCount ?? 0,
      openInterestShares: shares(holding?.openInterestShares),
      largestHolderShares: shares(holding?.largestHolderShares),
      holderConcentrationPct: (holding?.holderConcentrationPct ?? 0).toFixed(1),
      totalYesShares: shares(holding?.totalYesShares),
      totalNoShares: shares(holding?.totalNoShares),
      liquidityAtRisk: money(
        computeMarketLiquidityAtRisk({
          resolved: r.market.resolved,
          liquidity,
          reservedClaims,
          outstandingWinningClaims,
        })
      ),
    };
  }));

  const rangeTraderPnlByMarket = new Map<number, number>();
  if (resolvedRangeIds.length > 0) {
    const resolvedRangeTrades = await db
      .select({
        trader: rangeTrades.trader,
        marketId: rangeTrades.rangeMarketId,
        rangeIndex: rangeTrades.rangeIndex,
        isBuy: rangeTrades.isBuy,
        shares: rangeTrades.shares,
        collateral: rangeTrades.collateral,
        winningRangeIndex: rangeMarkets.winningRangeIndex,
      })
      .from(rangeTrades)
      .innerJoin(rangeMarkets, eq(rangeTrades.rangeMarketId, rangeMarkets.id))
      .where(and(inArray(rangeTrades.rangeMarketId, resolvedRangeIds), eq(rangeMarkets.resolved, true)));

    for (const marketId of resolvedRangeIds) {
      rangeTraderPnlByMarket.set(
        marketId,
        sumRangeTraderRealisedPnl(resolvedRangeTrades.filter((t) => t.marketId === marketId))
      );
    }
  }

  const rangeAdminMarkets = await Promise.all(rangeRows.map(async (r) => {
    const seededLiquidity = asNumber(r.market.totalLiquidity);
    const liquidityWithdrawn = await getEffectiveLiquidityWithdrawn({
      marketId: r.market.id,
      poolAddress: r.market.rangeCpmmAddress,
      resolved: r.market.resolved,
      liquidityDrained: r.market.liquidityDrained,
      liquidityWithdrawn: asNumber(r.market.liquidityWithdrawn),
    });
    const reservedClaims = asNumber(r.market.reservedClaims);
    const outstandingWinningClaims = asNumber(r.market.outstandingWinningClaims);
    const traderPnl = rangeTraderPnlByMarket.get(r.market.id) ?? 0;
    const holding = rangeHoldings.get(r.market.id);
    const { pnl: housePnlValue, source: housePnlSource } = computeHousePnl({
      resolved: r.market.resolved,
      liquidityDrained: r.market.liquidityDrained,
      seededLiquidity,
      liquidityWithdrawn,
      traderRealisedPnlSum: traderPnl,
    });

    return {
      id: r.market.id,
      onChainId: r.market.onChainMarketId ?? 0,
      question: r.market.question,
      cadence: "daily",
      category: "range",
      marketType: r.market.marketType,
      date: r.market.date,
      status: r.market.status,
      resolved: r.market.resolved,
      result: r.market.winningRangeIndex == null ? 0 : r.market.winningRangeIndex + 1,
      tradeCount: Number(r.tradeCount ?? 0),
      distinctTraderCount: Number(r.distinctTraderCount ?? 0),
      totalVolume: money(r.totalVol),
      createdAt: r.market.createdAt,
      snapshotAt: new Date().toISOString(),
      snapshotSource: "db" as const,
      liquidity: money(seededLiquidity),
      seededLiquidity: money(seededLiquidity),
      poolAddress: r.market.rangeCpmmAddress,
      endTime: r.market.endTime,
      liquidityWithdrawn: money(liquidityWithdrawn),
      reservedClaims: money(reservedClaims),
      outstandingWinningClaims: money(outstandingWinningClaims),
      housePnl: formatHousePnl(housePnlValue),
      housePnlSource,
      liquidityState: r.market.resolved ? (r.market.liquidityDrained ? "drained" : "awaiting drain") : "active LMSR",
      holderCount: holding?.holderCount ?? 0,
      openInterestShares: shares(holding?.openInterestShares),
      largestHolderShares: shares(holding?.largestHolderShares),
      holderConcentrationPct: (holding?.holderConcentrationPct ?? 0).toFixed(1),
      totalRangeShares: shares(holding?.totalRangeShares),
      liquidityAtRisk: money(
        computeMarketLiquidityAtRisk({
          resolved: r.market.resolved,
          liquidity: seededLiquidity,
          reservedClaims,
          outstandingWinningClaims,
        })
      ),
    };
  }));

  const snapshotAt = new Date().toISOString();
  const allMarkets = [...binaryMarkets, ...rangeAdminMarkets]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((market) => ({ ...market, snapshotAt }));

  return {
    snapshotAt,
    snapshotSource: "db",
    markets: allMarkets,
  };
}

export async function getAdminMarketsSnapshot(input: {
  status?: AdminMarketStatus;
  family?: AdminMarketFamily;
  limit?: number;
}): Promise<AdminMarketsSnapshotResponse> {
  const status = input.status ?? "all";
  const family = input.family ?? "all";
  const key = cacheKeys.adminMarkets(family, status);
  const cached = await readJsonSnapshot<AdminMarketsSnapshotResponse>(key);
  if (cached) {
    return {
      ...withSource(cached, "redis"),
      markets: cached.markets.slice(0, input.limit ?? MAX_MARKET_SNAPSHOT_LIMIT).map((market) => withSource(market, "redis")),
    };
  }

  const rebuilt = await buildAdminMarketsSnapshot({
    ...input,
    limit: MAX_MARKET_SNAPSHOT_LIMIT,
  });
  await writeJsonSnapshot(
    key,
    rebuilt,
    status === "resolved" ? HISTORICAL_SNAPSHOT_TTL_SECONDS : ACTIVE_SNAPSHOT_TTL_SECONDS
  );
  return {
    ...withSource(rebuilt, "db", true),
    markets: rebuilt.markets.slice(0, input.limit ?? MAX_MARKET_SNAPSHOT_LIMIT).map((market) => withSource(market, "db", true)),
  };
}

export async function buildAdminUserHoldingsSnapshot(wallet: string): Promise<AdminUserHoldingsSnapshot> {
  const walletLower = wallet.toLowerCase();
  const [binaryRows, rangeRows, vaultRows] = await Promise.all([
    db
      .select({ position: userPositions, market: markets })
      .from(userPositions)
      .innerJoin(markets, eq(userPositions.marketId, markets.id))
      .where(eq(userPositions.userAddress, walletLower))
      .orderBy(desc(markets.createdAt)),
    db
      .select({ position: rangePositions, market: rangeMarkets })
      .from(rangePositions)
      .innerJoin(rangeMarkets, eq(rangePositions.rangeMarketId, rangeMarkets.id))
      .where(eq(rangePositions.userAddress, walletLower))
      .orderBy(desc(rangeMarkets.createdAt)),
    db
      .select()
      .from(vaultTransactions)
      .where(eq(vaultTransactions.userAddress, walletLower))
      .orderBy(desc(vaultTransactions.timestamp)),
  ]);

  const totalDeposits = vaultRows
    .filter((tx) => tx.type === "deposit")
    .reduce((acc, tx) => acc + asNumber(tx.amount), 0);
  const totalWithdrawals = vaultRows
    .filter((tx) => tx.type === "withdraw")
    .reduce((acc, tx) => acc + asNumber(tx.amount), 0);
  const totalRedemptions = vaultRows
    .filter((tx) => tx.type === "redemption")
    .reduce((acc, tx) => acc + asNumber(tx.amount), 0);

  return {
    wallet: walletLower,
    snapshotAt: new Date().toISOString(),
    snapshotSource: "db",
    vault: {
      totalDeposits: money(totalDeposits),
      totalWithdrawals: money(totalWithdrawals),
      totalRedemptions: money(totalRedemptions),
      netDeposits: money(totalDeposits - totalWithdrawals),
      transactionCount: vaultRows.length,
      recentTransactions: vaultRows.slice(0, 20).map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        txHash: tx.txHash,
        timestamp: tx.timestamp,
      })),
    },
    binary: binaryRows.map(({ position, market }) => ({
      marketId: market.id,
      question: formatMarketQuestion(market),
      resolved: market.resolved,
      result: market.result,
      yesBalance: position.yesBalance,
      noBalance: position.noBalance,
      yesCostBasis: position.yesCostBasis,
      noCostBasis: position.noCostBasis,
    })),
    range: rangeRows.map(({ position, market }) => ({
      marketId: market.id,
      question: market.question,
      marketType: market.marketType,
      rangeIndex: position.rangeIndex,
      balance: position.balance,
      costBasis: position.costBasis,
      avgEntryPrice: position.avgEntryPrice,
      resolved: market.resolved,
      winningRangeIndex: market.winningRangeIndex,
    })),
  };
}

export async function getAdminUserHoldingsSnapshot(wallet: string): Promise<AdminUserHoldingsSnapshot> {
  const key = cacheKeys.adminUser(wallet);
  const cached = await readJsonSnapshot<AdminUserHoldingsSnapshot>(key);
  if (cached) return withSource(cached, "redis");

  const rebuilt = await buildAdminUserHoldingsSnapshot(wallet);
  await writeJsonSnapshot(key, rebuilt, USER_SNAPSHOT_TTL_SECONDS);
  return withSource(rebuilt, "db", true);
}

export async function refreshAdminSnapshots(reason = "scheduled"): Promise<void> {
  const lockKey = cacheKeys.adminSnapshotLock();
  const locked = await acquireLock(lockKey, 90);
  if (!locked) return;

  const startedAt = Date.now();
  try {
    const statuses: AdminMarketStatus[] = ["all", "active", "resolved"];
    const families: Array<AdminMarketFamily | undefined> = [undefined, "token", "participants", "receipts"];
    const overview = await buildAdminOverviewSnapshot();
    const marketSnapshots: Array<{ key: string; payload: AdminMarketsSnapshotResponse; ttl: number }> = [];

    for (const status of statuses) {
      for (const family of families) {
        const payload = await buildAdminMarketsSnapshot({
          status,
          family,
          limit: MAX_MARKET_SNAPSHOT_LIMIT,
        });
        marketSnapshots.push({
          key: cacheKeys.adminMarkets(family ?? "all", status),
          payload,
          ttl: status === "resolved" ? HISTORICAL_SNAPSHOT_TTL_SECONDS : ACTIVE_SNAPSHOT_TTL_SECONDS,
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const pipe = redis.pipeline();
    pipe.set(cacheKeys.adminOverview(), JSON.stringify(overview), "EX", ACTIVE_SNAPSHOT_TTL_SECONDS);
    for (const snapshot of marketSnapshots) {
      pipe.set(snapshot.key, JSON.stringify(snapshot.payload), "EX", snapshot.ttl);
    }
    pipe.hset(cacheKeys.adminSnapshotHealth(), {
      lastSuccessAt: finishedAt,
      lastReason: reason,
      refreshMs: String(Date.now() - startedAt),
      marketSnapshotCount: String(marketSnapshots.length),
      lastError: "",
    });
    pipe.expire(cacheKeys.adminSnapshotHealth(), HEALTH_TTL_SECONDS);
    await pipe.exec();
  } catch (err) {
    await redis.hset(cacheKeys.adminSnapshotHealth(), {
      lastErrorAt: new Date().toISOString(),
      lastReason: reason,
      lastError: err instanceof Error ? err.message : String(err),
    });
    await redis.expire(cacheKeys.adminSnapshotHealth(), HEALTH_TTL_SECONDS);
    throw err;
  } finally {
    await releaseLock(lockKey);
  }
}

let queuedRefresh: ReturnType<typeof setTimeout> | null = null;

export function queueAdminSnapshotRefresh(reason: string): void {
  if (queuedRefresh) return;
  queuedRefresh = setTimeout(() => {
    queuedRefresh = null;
    refreshAdminSnapshots(reason).catch((err) => {
      console.error("[AdminSnapshots] Queued refresh failed:", err);
    });
  }, 1_000);
}
