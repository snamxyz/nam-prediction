import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { userPositions, markets, trades, rangePositions, rangeMarkets, rangeTrades } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";

const DUST = 1e-9; // shares below this are ignored

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

      let realisedPnl = 0;
      const remainingByMarket = new Map<number, { result: number; yes: number; no: number }>();

      for (const trade of resolvedTrades) {
        const collateral = Number(trade.collateral || "0");
        const shares = Number(trade.shares || "0");
        realisedPnl += trade.isBuy ? -collateral : collateral;

        const current =
          remainingByMarket.get(trade.marketId) ?? {
            result: trade.result,
            yes: 0,
            no: 0,
          };
        const delta = trade.isBuy ? shares : -shares;
        if (trade.isYes) current.yes += delta;
        else current.no += delta;
        remainingByMarket.set(trade.marketId, current);
      }

      for (const position of remainingByMarket.values()) {
        if (position.result === 1) realisedPnl += Math.max(0, position.yes);
        if (position.result === 2) realisedPnl += Math.max(0, position.no);
      }

      return {
        data: {
          realisedPnl: realisedPnl.toFixed(6),
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
            .select({ marketId: trades.marketId, ts: trades.timestamp })
            .from(trades)
            .where(eq(trades.trader, addr))
            .orderBy(desc(trades.timestamp))
        : [];

      const latestByMarket = new Map<number, Date>();
      for (const t of latestTrades) {
        if (!latestByMarket.has(t.marketId)) {
          latestByMarket.set(t.marketId, t.ts);
        }
      }

      const rangeMarketIds = [...new Set(rangeRows.map((r) => r.market.id))];
      const latestRangeTrades = rangeMarketIds.length
        ? await db
            .select({ marketId: rangeTrades.rangeMarketId, ts: rangeTrades.timestamp })
            .from(rangeTrades)
            .where(eq(rangeTrades.trader, addr))
            .orderBy(desc(rangeTrades.timestamp))
        : [];

      const latestByRangeMarket = new Map<number, Date>();
      for (const t of latestRangeTrades) {
        if (!latestByRangeMarket.has(t.marketId)) {
          latestByRangeMarket.set(t.marketId, t.ts);
        }
      }

      const binaryMapped = rows
        .map((p) => {
          const { position: pos, market: m } = p;

          const yesBal = Number(pos.yesBalance || "0");
          const noBal = Number(pos.noBalance || "0");

          // Drop dust-only rows (no meaningful position).
          if (yesBal < DUST && noBal < DUST) return null;

          // Per-side live values using current AMM prices from the market row.
          const yesCurrentVal = yesBal * m.yesPrice;
          const noCurrentVal = noBal * m.noPrice;
          const yesCost = Number(pos.yesCostBasis || "0");
          const noCost = Number(pos.noCostBasis || "0");

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
            yesPrice: m.yesPrice,
            noPrice: m.noPrice,
            // YES leg
            yesBalance: pos.yesBalance,
            yesAvgPrice: pos.yesAvgPrice,
            yesCostBasis: pos.yesCostBasis,
            yesCurrentValue: yesCurrentVal.toFixed(6),
            yesPnl: yesPnl.toFixed(6),
            yesPnlPct: yesPnlPct.toFixed(2),
            // NO leg
            noBalance: pos.noBalance,
            noAvgPrice: pos.noAvgPrice,
            noCostBasis: pos.noCostBasis,
            noCurrentValue: noCurrentVal.toFixed(6),
            noPnl: noPnl.toFixed(6),
            noPnlPct: noPnlPct.toFixed(2),
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
          const balance = Number(pos.balance || "0");
          if (balance < DUST) return null;

          const ranges = m.ranges as { index: number; label: string }[];
          const prices = m.rangePrices as number[];
          const range = ranges.find((r) => r.index === pos.rangeIndex) ?? ranges[pos.rangeIndex];
          const currentPrice = m.resolved
            ? pos.rangeIndex === m.winningRangeIndex ? 1 : 0
            : prices[pos.rangeIndex] ?? 0;
          const currentValue = balance * currentPrice;
          const costBasis = Number(pos.costBasis || "0");
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
            rangeBalance: pos.balance,
            rangeAvgPrice: pos.avgEntryPrice,
            rangeCostBasis: pos.costBasis,
            rangeCurrentPrice: currentPrice,
            rangeCurrentValue: currentValue.toFixed(6),
            rangePnl: pnl.toFixed(6),
            rangePnlPct: pnlPct.toFixed(2),
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
