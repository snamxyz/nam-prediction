import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { userPositions, markets, trades } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";

const DUST = 1e-9; // shares below this are ignored

export const portfolioRoutes = new Elysia({ prefix: "/portfolio" })
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

      const mapped = rows
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
          };
        })
        .filter(Boolean);

      // Sort: unresolved markets first, then by most recent user trade descending.
      mapped.sort((a, b) => {
        if (a!.resolved !== b!.resolved) return a!.resolved ? 1 : -1;
        const aTs = latestByMarket.get(a!.marketId)?.getTime() ?? 0;
        const bTs = latestByMarket.get(b!.marketId)?.getTime() ?? 0;
        return bTs - aTs;
      });

      return { data: mapped, success: true };
    },
    { params: t.Object({ user: t.String() }) }
  );
