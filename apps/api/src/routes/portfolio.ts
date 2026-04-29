import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { userPositions, markets, trades, rangePositions, rangeMarkets, rangeTrades } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";

const DUST = 1e-9; // shares below this are ignored

type BinaryExposure = {
  result: number;
  yes: number;
  no: number;
  yesCost: number;
  noCost: number;
  cashFlow: number;
};

type RangeExposure = {
  winningRangeIndex: number | null;
  rangeIndex: number;
  shares: number;
  cost: number;
  cashFlow: number;
};

function reduceSide(
  sharesBefore: number,
  costBefore: number,
  sharesSold: number
) {
  const sold = Math.min(sharesSold, sharesBefore);
  const costRemoved = sharesBefore > DUST ? costBefore * (sold / sharesBefore) : 0;
  const shares = Math.max(0, sharesBefore - sold);
  const cost = shares > DUST ? Math.max(0, costBefore - costRemoved) : 0;
  return { shares, cost };
}

function hasBinaryExposure(exposure: BinaryExposure) {
  return (
    exposure.yes > DUST ||
    exposure.no > DUST ||
    exposure.yesCost > DUST ||
    exposure.noCost > DUST
  );
}

function hasRangeExposure(exposure: RangeExposure) {
  return exposure.shares > DUST || exposure.cost > DUST;
}

function getBinarySettlementValue(exposure: BinaryExposure) {
  if (exposure.result === 1) return Math.max(0, exposure.yes);
  if (exposure.result === 2) return Math.max(0, exposure.no);
  return 0;
}

function getBinaryWin(exposure: BinaryExposure) {
  return getBinarySettlementValue(exposure) > DUST;
}

function getRangeSettlementValue(exposure: RangeExposure) {
  return exposure.rangeIndex === exposure.winningRangeIndex
    ? Math.max(0, exposure.shares)
    : 0;
}

function buildBinaryExposureMap<
  T extends {
    marketId: number;
    isYes: boolean;
    isBuy: boolean;
    shares: string;
    collateral: string;
    result: number;
  }
>(tradeRows: T[]) {
  const byMarket = new Map<number, BinaryExposure>();

  for (const trade of tradeRows) {
    const exposure =
      byMarket.get(trade.marketId) ?? {
        result: trade.result,
        yes: 0,
        no: 0,
        yesCost: 0,
        noCost: 0,
        cashFlow: 0,
      };
    const shares = Number(trade.shares || "0");
    const collateral = Number(trade.collateral || "0");
    exposure.cashFlow += trade.isBuy ? -collateral : collateral;

    if (trade.isYes) {
      if (trade.isBuy) {
        exposure.yes += shares;
        exposure.yesCost += collateral;
      } else {
        const next = reduceSide(exposure.yes, exposure.yesCost, shares);
        exposure.yes = next.shares;
        exposure.yesCost = next.cost;
      }
    } else if (trade.isBuy) {
      exposure.no += shares;
      exposure.noCost += collateral;
    } else {
      const next = reduceSide(exposure.no, exposure.noCost, shares);
      exposure.no = next.shares;
      exposure.noCost = next.cost;
    }

    byMarket.set(trade.marketId, exposure);
  }

  return byMarket;
}

function buildRangeExposureMap<
  T extends {
    marketId: number;
    rangeIndex: number;
    isBuy: boolean;
    shares: string;
    collateral: string;
    winningRangeIndex: number | null;
  }
>(tradeRows: T[]) {
  const byPosition = new Map<string, RangeExposure>();

  for (const trade of tradeRows) {
    const key = `${trade.marketId}:${trade.rangeIndex}`;
    const exposure =
      byPosition.get(key) ?? {
        winningRangeIndex: trade.winningRangeIndex,
        rangeIndex: trade.rangeIndex,
        shares: 0,
        cost: 0,
        cashFlow: 0,
      };
    const shares = Number(trade.shares || "0");
    const collateral = Number(trade.collateral || "0");
    exposure.cashFlow += trade.isBuy ? -collateral : collateral;

    if (trade.isBuy) {
      exposure.shares += shares;
      exposure.cost += collateral;
    } else {
      const next = reduceSide(exposure.shares, exposure.cost, shares);
      exposure.shares = next.shares;
      exposure.cost = next.cost;
    }

    byPosition.set(key, exposure);
  }

  return byPosition;
}

export const portfolioRoutes = new Elysia({ prefix: "/portfolio" })
  // GET /portfolio/:user/summary — Aggregated user stats that should include
  // markets even after redeemed balances have been zeroed out.
  .get(
    "/:user/summary",
    async ({ params }) => {
      const addr = params.user.toLowerCase();

      const resolvedTrades = await db
        .select({
          marketId: trades.marketId,
          isYes: trades.isYes,
          isBuy: trades.isBuy,
          shares: trades.shares,
          collateral: trades.collateral,
          result: markets.result,
        })
        .from(trades)
        .innerJoin(markets, eq(trades.marketId, markets.id))
        .where(and(eq(trades.trader, addr), eq(markets.resolved, true)));

      const resolvedRangeTrades = await db
        .select({
          marketId: rangeTrades.rangeMarketId,
          rangeIndex: rangeTrades.rangeIndex,
          isBuy: rangeTrades.isBuy,
          shares: rangeTrades.shares,
          collateral: rangeTrades.collateral,
          winningRangeIndex: rangeMarkets.winningRangeIndex,
        })
        .from(rangeTrades)
        .innerJoin(rangeMarkets, eq(rangeTrades.rangeMarketId, rangeMarkets.id))
        .where(and(eq(rangeTrades.trader, addr), eq(rangeMarkets.resolved, true)));

      let realisedPnl = 0;
      let resolvedCost = 0;
      let resolvedValue = 0;
      let wins = 0;
      let resolvedCount = 0;

      for (const position of buildBinaryExposureMap(resolvedTrades).values()) {
        if (!hasBinaryExposure(position)) continue;
        const settlementValue = getBinarySettlementValue(position);
        realisedPnl += position.cashFlow + settlementValue;
        resolvedCost += position.yesCost + position.noCost;
        resolvedValue += settlementValue;
        resolvedCount += 1;
        if (getBinaryWin(position)) wins += 1;
      }

      for (const position of buildRangeExposureMap(resolvedRangeTrades).values()) {
        if (!hasRangeExposure(position)) continue;
        const settlementValue = getRangeSettlementValue(position);
        realisedPnl += position.cashFlow + settlementValue;
        resolvedCost += position.cost;
        resolvedValue += settlementValue;
        resolvedCount += 1;
        if (settlementValue > DUST) wins += 1;
      }

      const winRate = resolvedCount > 0 ? (wins / resolvedCount) * 100 : 0;

      return {
        data: {
          realisedPnl: realisedPnl.toFixed(6),
          winRate: winRate.toFixed(2),
          wins,
          resolvedCount,
          resolvedCost: resolvedCost.toFixed(6),
          resolvedValue: resolvedValue.toFixed(6),
        },
        success: true,
      };
    },
    { params: t.Object({ user: t.String() }) }
  )

  // GET /portfolio/:user — User positions across all markets with per-side PnL
  .get(
    "/:user",
    async ({ params }) => {
      const addr = params.user.toLowerCase();

      const rows = await db
        .select({
          position: userPositions,
          market: markets,
        })
        .from(userPositions)
        .innerJoin(markets, eq(userPositions.marketId, markets.id))
        .where(eq(userPositions.userAddress, addr));

      const rangeRows = await db
        .select({
          position: rangePositions,
          market: rangeMarkets,
        })
        .from(rangePositions)
        .innerJoin(rangeMarkets, eq(rangePositions.rangeMarketId, rangeMarkets.id))
        .where(eq(rangePositions.userAddress, addr));

      // Fetch latest trade timestamp per market so we can sort by recency.
      // We do this lazily only for markets in the result set.
      const marketIds = [...new Set(rows.map((r) => r.market.id))];
      const latestTrades = marketIds.length
        ? await db
            .select({
              marketId: trades.marketId,
              isYes: trades.isYes,
              isBuy: trades.isBuy,
              shares: trades.shares,
              collateral: trades.collateral,
              result: markets.result,
              ts: trades.timestamp,
            })
            .from(trades)
            .innerJoin(markets, eq(trades.marketId, markets.id))
            .where(eq(trades.trader, addr))
            .orderBy(desc(trades.timestamp))
        : [];

      const latestByMarket = new Map<number, Date>();
      for (const t of latestTrades) {
        if (!latestByMarket.has(t.marketId)) {
          latestByMarket.set(t.marketId, t.ts);
        }
      }
      const binaryExposureByMarket = buildBinaryExposureMap(latestTrades);

      const rangeMarketIds = [...new Set(rangeRows.map((r) => r.market.id))];
      const latestRangeTrades = rangeMarketIds.length
        ? await db
            .select({
              marketId: rangeTrades.rangeMarketId,
              rangeIndex: rangeTrades.rangeIndex,
              isBuy: rangeTrades.isBuy,
              shares: rangeTrades.shares,
              collateral: rangeTrades.collateral,
              winningRangeIndex: rangeMarkets.winningRangeIndex,
              ts: rangeTrades.timestamp,
            })
            .from(rangeTrades)
            .innerJoin(rangeMarkets, eq(rangeTrades.rangeMarketId, rangeMarkets.id))
            .where(eq(rangeTrades.trader, addr))
            .orderBy(desc(rangeTrades.timestamp))
        : [];

      const latestByRangeMarket = new Map<number, Date>();
      for (const t of latestRangeTrades) {
        if (!latestByRangeMarket.has(t.marketId)) {
          latestByRangeMarket.set(t.marketId, t.ts);
        }
      }
      const rangeExposureByPosition = buildRangeExposureMap(latestRangeTrades);

      const binaryMapped = rows
        .map((p) => {
          const { position: pos, market: m } = p;

          const historical = binaryExposureByMarket.get(pos.marketId);
          const yesBal = m.resolved && historical ? historical.yes : Number(pos.yesBalance || "0");
          const noBal = m.resolved && historical ? historical.no : Number(pos.noBalance || "0");
          const yesCost = m.resolved && historical ? historical.yesCost : Number(pos.yesCostBasis || "0");
          const noCost = m.resolved && historical ? historical.noCost : Number(pos.noCostBasis || "0");

          // Drop dust-only rows (no meaningful position).
          if (yesBal < DUST && noBal < DUST && yesCost < DUST && noCost < DUST) return null;

          // Resolved markets settle at $1 for the winner and $0 for the loser.
          const yesCurrentPrice = m.resolved ? (m.result === 1 ? 1 : 0) : m.yesPrice;
          const noCurrentPrice = m.resolved ? (m.result === 2 ? 1 : 0) : m.noPrice;
          const yesCurrentVal = yesBal * yesCurrentPrice;
          const noCurrentVal = noBal * noCurrentPrice;

          // PnL = current value − cost basis (unrealised P&L).
          const yesPnl = yesBal >= DUST ? yesCurrentVal - yesCost : 0;
          const noPnl = noBal >= DUST ? noCurrentVal - noCost : 0;
          const yesPnlPct =
            yesBal >= DUST && yesCost > 0
              ? (yesPnl / yesCost) * 100
              : 0;
          const noPnlPct =
            noBal >= DUST && noCost > 0
              ? (noPnl / noCost) * 100
              : 0;

          return {
            positionType: "binary" as const,
            // identity
            id: pos.id,
            marketId: pos.marketId,
            onChainId: m.onChainId,
            question: m.question,
            resolved: m.resolved,
            result: m.result,
            // market prices
            yesPrice: yesCurrentPrice,
            noPrice: noCurrentPrice,
            // YES leg
            yesBalance: yesBal.toFixed(18),
            yesAvgPrice: yesBal > DUST ? yesCost / yesBal : 0,
            yesCostBasis: yesCost.toFixed(6),
            yesCurrentValue: yesCurrentVal.toFixed(6),
            yesPnl: yesPnl.toFixed(6),
            yesPnlPct: yesPnlPct.toFixed(2),
            // NO leg
            noBalance: noBal.toFixed(18),
            noAvgPrice: noBal > DUST ? noCost / noBal : 0,
            noCostBasis: noCost.toFixed(6),
            noCurrentValue: noCurrentVal.toFixed(6),
            noPnl: noPnl.toFixed(6),
            noPnlPct: noPnlPct.toFixed(2),
            totalCost: (yesCost + noCost).toFixed(6),
            resolvedValue: (yesCurrentVal + noCurrentVal).toFixed(6),
            redeemed:
              m.resolved &&
              ((m.result === 1 && Number(pos.yesBalance || "0") < DUST && yesBal >= DUST) ||
                (m.result === 2 && Number(pos.noBalance || "0") < DUST && noBal >= DUST)),
            // legacy fields kept for backward compat
            avgEntryPrice: pos.avgEntryPrice,
            pnl: (yesPnl + noPnl).toFixed(6),
            lastReconciledAt: pos.lastReconciledAt,
            sortTs: latestByMarket.get(pos.marketId)?.getTime() ?? 0,
          };
        })
        .filter((position) => position !== null);

      const rangeMapped = rangeRows
        .map((p) => {
          const { position: pos, market: m } = p;
          const historical = rangeExposureByPosition.get(`${pos.rangeMarketId}:${pos.rangeIndex}`);
          const balance = m.resolved && historical ? historical.shares : Number(pos.balance || "0");
          const costBasis = m.resolved && historical ? historical.cost : Number(pos.costBasis || "0");
          if (balance < DUST && costBasis < DUST) return null;

          const ranges = m.ranges as { index: number; label: string }[];
          const prices = m.rangePrices as number[];
          const range = ranges.find((r) => r.index === pos.rangeIndex) ?? ranges[pos.rangeIndex];
          const currentPrice = m.resolved
            ? pos.rangeIndex === m.winningRangeIndex ? 1 : 0
            : prices[pos.rangeIndex] ?? 0;
          const currentValue = balance * currentPrice;
          const pnl = currentValue - costBasis;
          const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

          return {
            positionType: "range" as const,
            id: pos.id,
            marketId: pos.rangeMarketId,
            onChainId: m.onChainMarketId,
            marketType: m.marketType,
            question: m.question,
            resolved: m.resolved,
            status: m.status,
            winningRangeIndex: m.winningRangeIndex,
            ranges,
            rangePrices: prices,
            rangeIndex: pos.rangeIndex,
            rangeLabel: range?.label ?? `Range ${pos.rangeIndex}`,
            rangeBalance: balance.toFixed(18),
            rangeAvgPrice: balance > DUST ? costBasis / balance : 0,
            rangeCostBasis: costBasis.toFixed(6),
            rangeCurrentPrice: currentPrice,
            rangeCurrentValue: currentValue.toFixed(6),
            rangePnl: pnl.toFixed(6),
            rangePnlPct: pnlPct.toFixed(2),
            totalCost: costBasis.toFixed(6),
            resolvedValue: currentValue.toFixed(6),
            pnl: pnl.toFixed(6),
            sortTs: latestByRangeMarket.get(pos.rangeMarketId)?.getTime() ?? 0,
          };
        })
        .filter((position) => position !== null);

      const mapped = [...binaryMapped, ...rangeMapped];

      // Sort: unresolved markets first, then by most recent user trade descending.
      mapped.sort((a, b) => {
        if (a!.resolved !== b!.resolved) return a!.resolved ? 1 : -1;
        return (b!.sortTs ?? 0) - (a!.sortTs ?? 0);
      });

      return {
        data: mapped.map(({ sortTs, ...position }) => position),
        success: true,
      };
    },
    { params: t.Object({ user: t.String() }) }
  );
