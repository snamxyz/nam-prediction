import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { markets, users, trades, userPositions, vaultTransactions, rangeMarkets, rangeTrades } from "../db/schema";
import { eq, desc, count, sum, gte, lt, and, sql, ne, lte, inArray } from "drizzle-orm";
import {
  computeHousePnl,
  formatHousePnl,
  sumBinaryTraderRealisedPnl,
  sumRangeTraderRealisedPnl,
} from "../lib/pnl";
import { resolveMarketOnChain } from "../services/resolution";
import { processDailyResolution } from "../services/queue/resolution-queue";
import { processHourlyTick } from "../services/queue/hourly-queue";
import { createNextHourlyMarket } from "../services/hourly-market";
import { verifyAdminToken } from "../middleware/admin";
import { formatMarketQuestion } from "../lib/market-display";

// ─── Helper: 403 shorthand ───
function forbidden() {
  return { success: false as const, error: "Forbidden" };
}

export const adminRoutes = new Elysia({ prefix: "/admin" })

  // ─── POST /admin/resolve/:marketId — Manual market resolution ───
  .post(
    "/resolve/:marketId",
    async ({ params, body, headers, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const marketId = Number(params.marketId);
      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.onChainId, marketId))
        .limit(1);

      if (market.length === 0) { set.status = 404; return { success: false, error: "Market not found" }; }
      if (market[0].resolved) { set.status = 400; return { success: false, error: "Already resolved" }; }

      try {
        const txHash = await resolveMarketOnChain(marketId, body.result);
        return { success: true, data: { txHash } };
      } catch (err: any) {
        set.status = 500;
        return { success: false, error: err.message };
      }
    },
    {
      params: t.Object({ marketId: t.String() }),
      body: t.Object({ result: t.Number({ minimum: 1, maximum: 2 }) }),
    }
  )

  // ─── POST /admin/trigger-resolution — Manual daily resolution cycle ───
  .post(
    "/trigger-resolution",
    async ({ headers, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      try {
        await processDailyResolution();
        return { success: true, data: { message: "Daily resolution triggered" } };
      } catch (err: any) {
        set.status = 500;
        return { success: false, error: err.message };
      }
    }
  )

  // ─── GET /admin/analytics/overview ───
  .get(
    "/analytics/overview",
    async ({ headers, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

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
        [activeMarketsRow],
        [resolvedMarketsRow],
        [totalDepositsRow],
        [totalWithdrawalsRow],
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
        db
          .select({ v: sum(rangeTrades.collateral) })
          .from(rangeTrades)
          .where(gte(rangeTrades.timestamp, ago24h)),
        db.select({ c: count() }).from(markets).where(eq(markets.resolved, false)),
        db.select({ c: count() }).from(markets).where(eq(markets.resolved, true)),
        db.select({ s: sum(vaultTransactions.amount) }).from(vaultTransactions).where(eq(vaultTransactions.type, "deposit")),
        db.select({ s: sum(vaultTransactions.amount) }).from(vaultTransactions).where(eq(vaultTransactions.type, "withdraw")),
      ]);

      const totalDeposits = Number(totalDepositsRow?.s ?? 0);
      const totalWithdrawals = Number(totalWithdrawalsRow?.s ?? 0);

      return {
        success: true,
        data: {
          totalUsers: Number(totalUsersRow?.c ?? 0),
          users24h: Number(users24hRow?.c ?? 0),
          users7d: Number(users7dRow?.c ?? 0),
          totalTrades:
            Number(totalTradesBinaryRow?.c ?? 0) + Number(totalTradesRangeRow?.c ?? 0),
          trades24h: Number(trades24hBinaryRow?.c ?? 0) + Number(trades24hRangeRow?.c ?? 0),
          totalVolume: (
            Number(totalVolumeMarketsRow?.v ?? 0) + Number(totalVolumeRangeTradesRow?.v ?? 0)
          ).toFixed(2),
          volume24h: (
            Number(volume24hBinaryRow?.v ?? 0) + Number(volume24hRangeRow?.v ?? 0)
          ).toFixed(2),
          activeMarkets: Number(activeMarketsRow?.c ?? 0),
          resolvedMarkets: Number(resolvedMarketsRow?.c ?? 0),
          totalDeposits: totalDeposits.toFixed(2),
          totalWithdrawals: totalWithdrawals.toFixed(2),
          tvl: (totalDeposits - totalWithdrawals).toFixed(2),
        },
      };
    }
  )

  // ─── GET /admin/users?limit=50&cursor=<id>&sort=volume|joined ───
  .get(
    "/users",
    async ({ headers, query, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const limit = Math.min(Number(query?.limit ?? 50), 200);
      const cursor = query?.cursor ? Number(query.cursor) : undefined;

      const rows = await db
        .select({
          user: users,
          tradeCount: count(trades.id),
          totalVolume: sum(trades.collateral),
        })
        .from(users)
        .leftJoin(trades, eq(trades.trader, sql`lower(${users.walletAddress})`))
        .groupBy(users.id)
        .orderBy(desc(users.createdAt))
        .limit(limit + (cursor ? 1 : 0));

      const page = cursor ? rows.filter((r) => r.user.id < cursor).slice(0, limit) : rows.slice(0, limit);

      return {
        success: true,
        data: {
          users: page.map((r) => ({
            ...r.user,
            tradeCount: Number(r.tradeCount ?? 0),
            totalVolume: Number(r.totalVolume ?? 0).toFixed(2),
          })),
          nextCursor: page.length === limit ? page[page.length - 1]?.user.id : null,
        },
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        sort: t.Optional(t.String()),
      }),
    }
  )

  // ─── GET /admin/users/:id ───
  .get(
    "/users/:id",
    async ({ headers, params, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const userId = Number(params.id);
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (user.length === 0) { set.status = 404; return { success: false, error: "User not found" }; }

      const u = user[0];
      const walletLower = u.walletAddress?.toLowerCase();

      const [recentTrades, positions, vaultTxs] = await Promise.all([
        walletLower
          ? db.select().from(trades).where(eq(trades.trader, walletLower)).orderBy(desc(trades.timestamp)).limit(20)
          : Promise.resolve([]),
        walletLower
          ? db.select({ position: userPositions, market: markets })
              .from(userPositions)
              .innerJoin(markets, eq(userPositions.marketId, markets.id))
              .where(eq(userPositions.userAddress, walletLower))
          : Promise.resolve([]),
        walletLower
          ? db.select().from(vaultTransactions).where(eq(vaultTransactions.userAddress, walletLower)).orderBy(desc(vaultTransactions.timestamp)).limit(20)
          : Promise.resolve([]),
      ]);

      return {
        success: true,
        data: {
          user: u,
          recentTrades,
          positions: positions.map((p) => ({
            ...p.position,
            question: formatMarketQuestion(p.market),
            resolved: p.market.resolved,
            result: p.market.result,
          })),
          vaultTxs,
        },
      };
    },
    { params: t.Object({ id: t.String() }) }
  )

  // ─── GET /admin/markets?status=active|resolved&family=token|participants|receipts ───
  .get(
    "/markets",
    async ({ headers, query, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const limit = Math.min(Number(query?.limit ?? 50), 200);
      const statusFilter = query?.status;
      const family = query?.family;
      const validFamilies = new Set(["token", "participants", "receipts"]);

      if (family && !validFamilies.has(family)) {
        set.status = 400;
        return { success: false, error: "Invalid market family" };
      }

      const shouldFetchBinary = !family || family === "token";
      const shouldFetchRange = !family || family === "participants" || family === "receipts";
      const binaryFilters = [
        statusFilter === "active"
          ? eq(markets.resolved, false)
          : statusFilter === "resolved"
          ? eq(markets.resolved, true)
          : undefined,
        family === "token" ? eq(markets.cadence, "24h") : undefined,
      ].filter(Boolean);
      const rangeFilters = [
        statusFilter === "active"
          ? eq(rangeMarkets.resolved, false)
          : statusFilter === "resolved"
          ? eq(rangeMarkets.resolved, true)
          : undefined,
        family === "participants" || family === "receipts"
          ? eq(rangeMarkets.marketType, family)
          : undefined,
      ].filter(Boolean);

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

      const resolvedBinaryIds = rows
        .filter((r) => r.market.resolved)
        .map((r) => r.market.id);

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
          .where(
            and(
              inArray(trades.marketId, resolvedBinaryIds),
              eq(markets.resolved, true)
            )
          );

        for (const marketId of resolvedBinaryIds) {
          const marketTrades = resolvedBinaryTrades.filter((t) => t.marketId === marketId);
          binaryTraderPnlByMarket.set(
            marketId,
            sumBinaryTraderRealisedPnl(marketTrades)
          );
        }
      }

      const binaryMarkets = rows.map((r) => {
        const liquidity = Number(r.market.liquidity ?? 0);
        const seededLiquidity =
          Number(r.market.seededLiquidity ?? 0) ||
          (r.market.cadence === "24h" ? 1 : liquidity);
        const liquidityWithdrawn = Number(r.market.liquidityWithdrawn ?? 0);
        const reservedClaims = Number(r.market.reservedClaims ?? 0);
        const outstandingWinningClaims = Number(r.market.outstandingWinningClaims ?? 0);
        const traderPnl = binaryTraderPnlByMarket.get(r.market.id) ?? 0;
        const { pnl: housePnlValue, source: housePnlSource } = computeHousePnl({
          resolved: r.market.resolved,
          liquidityDrained: r.market.liquidityDrained,
          seededLiquidity,
          liquidityWithdrawn,
          traderRealisedPnlSum: traderPnl,
        });
        return {
          ...r.market,
          question: formatMarketQuestion(r.market),
          category: r.market.cadence === "24h" ? "24h" : "binary",
          marketType: r.market.cadence === "24h" ? "24h" : "binary",
          tradeCount: Number(r.tradeCount ?? 0),
          distinctTraderCount: Number(r.distinctTraderCount ?? 0),
          totalVolume: Number(r.totalVol ?? 0).toFixed(2),
          liquidity: liquidity.toFixed(2),
          seededLiquidity: seededLiquidity.toFixed(2),
          poolAddress: r.market.ammAddress,
          endTime: r.market.endTime,
          liquidityWithdrawn: liquidityWithdrawn.toFixed(2),
          reservedClaims: reservedClaims.toFixed(2),
          outstandingWinningClaims: outstandingWinningClaims.toFixed(2),
          housePnl: formatHousePnl(housePnlValue),
          housePnlSource,
          liquidityState: r.market.resolved
            ? r.market.liquidityDrained
              ? "drained"
              : "awaiting drain"
            : "active",
        };
      });

      const resolvedRangeIds = rangeRows
        .filter((r) => r.market.resolved)
        .map((r) => r.market.id);

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
          .where(
            and(
              inArray(rangeTrades.rangeMarketId, resolvedRangeIds),
              eq(rangeMarkets.resolved, true)
            )
          );

        for (const marketId of resolvedRangeIds) {
          const marketTrades = resolvedRangeTrades.filter((t) => t.marketId === marketId);
          rangeTraderPnlByMarket.set(
            marketId,
            sumRangeTraderRealisedPnl(marketTrades)
          );
        }
      }

      const rangeAdminMarkets = rangeRows.map((r) => {
        const seededLiquidity = Number(r.market.totalLiquidity ?? 0);
        const liquidityWithdrawn = Number(r.market.liquidityWithdrawn ?? 0);
        const reservedClaims = Number(r.market.reservedClaims ?? 0);
        const outstandingWinningClaims = Number(r.market.outstandingWinningClaims ?? 0);
        const traderPnl = rangeTraderPnlByMarket.get(r.market.id) ?? 0;
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
          totalVolume: Number(r.totalVol ?? 0).toFixed(2),
          createdAt: r.market.createdAt,
          liquidity: seededLiquidity.toFixed(2),
          seededLiquidity: seededLiquidity.toFixed(2),
          poolAddress: r.market.rangeCpmmAddress,
          endTime: r.market.endTime,
          liquidityWithdrawn: liquidityWithdrawn.toFixed(2),
          reservedClaims: reservedClaims.toFixed(2),
          outstandingWinningClaims: outstandingWinningClaims.toFixed(2),
          housePnl: formatHousePnl(housePnlValue),
          housePnlSource,
          liquidityState: r.market.resolved
            ? r.market.liquidityDrained
              ? "drained"
              : "awaiting drain"
            : "active LMSR",
        };
      });

      const allMarkets = [...binaryMarkets, ...rangeAdminMarkets]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return {
        success: true,
        data: { markets: allMarkets },
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        status: t.Optional(t.String()),
        family: t.Optional(t.String()),
      }),
    }
  )

  // ─── GET /admin/trades?limit=100 ───
  .get(
    "/trades",
    async ({ headers, query, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const limit = Math.min(Number(query?.limit ?? 100), 500);

      const [binaryRows, rangeRows] = await Promise.all([
        db
          .select({ trade: trades, market: markets })
          .from(trades)
          .innerJoin(markets, eq(trades.marketId, markets.id))
          .orderBy(desc(trades.timestamp))
          .limit(limit),
        db
          .select({ trade: rangeTrades, market: rangeMarkets })
          .from(rangeTrades)
          .innerJoin(rangeMarkets, eq(rangeTrades.rangeMarketId, rangeMarkets.id))
          .orderBy(desc(rangeTrades.timestamp))
          .limit(limit),
      ]);

      type Merged = {
        sortTs: number;
        source: "binary" | "range";
        id: number;
        payload: Record<string, unknown>;
      };

      const merged: Merged[] = [
        ...binaryRows.map((r) => ({
          sortTs: new Date(r.trade.timestamp).getTime(),
          source: "binary" as const,
          id: r.trade.id,
          payload: {
            ...r.trade,
            traderAddress: r.trade.trader,
            side: r.trade.isYes ? "YES" : "NO",
            createdAt: r.trade.timestamp,
            question: formatMarketQuestion(r.market),
            cadence: r.market.cadence,
            source: "binary" as const,
          },
        })),
        ...rangeRows.map((r) => ({
          sortTs: new Date(r.trade.timestamp).getTime(),
          source: "range" as const,
          id: r.trade.id,
          payload: {
            ...r.trade,
            marketId: r.trade.rangeMarketId,
            traderAddress: r.trade.trader,
            side: `R${r.trade.rangeIndex + 1}`,
            createdAt: r.trade.timestamp,
            question: r.market.question,
            cadence: "range",
            source: "range" as const,
          },
        })),
      ]
        .sort((a, b) => b.sortTs - a.sortTs)
        .slice(0, limit);

      return {
        success: true,
        data: {
          trades: merged.map((m) => m.payload),
          nextCursor: null,
        },
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
    }
  )

  // ─── POST /admin/24h/tick — Manually trigger one hourly lifecycle tick ───
  .post(
    "/24h/tick",
    async ({ headers, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      try {
        await processHourlyTick();
        return { success: true, data: { message: "Hourly tick processed" } };
      } catch (err: any) {
        set.status = 500;
        return { success: false, error: err.message };
      }
    }
  )

  // ─── POST /admin/24h/create — Manually create the next 24h market ───
  // Body: { force?: boolean, comparison?: ">=" | "<=", threshold?: number }
  // force=true marks any unresolved 24h markets past their endTime as cancelled
  // in the DB so the active-market guard is cleared before creating the new one.
  .post(
    "/24h/create",
    async ({ headers, body, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      try {
        if (body.force) {
          const now = new Date();
          const stuck = await db
            .select({ id: markets.id, onChainId: markets.onChainId })
            .from(markets)
            .where(
              and(
                eq(markets.cadence, "24h"),
                eq(markets.resolved, false),
                lte(markets.endTime, now),
              )
            );

          if (stuck.length > 0) {
            await db
              .update(markets)
              .set({ resolved: true, status: "resolved", resolvedAt: now })
              .where(
                and(
                  eq(markets.cadence, "24h"),
                  eq(markets.resolved, false),
                  lte(markets.endTime, now),
                )
              );
            console.log(
              `[Admin] Force-resolved ${stuck.length} stuck 24h market(s): ${stuck.map((m) => m.onChainId).join(", ")}`
            );
          }
        }

        const comparison = body.comparison ?? ">=";
        const { onChainId } = await createNextHourlyMarket(
          comparison as ">=" | "<=",
          body.threshold ?? undefined,
        );

        return {
          success: true,
          data: { onChainId, message: `24h market created on-chain (id=${onChainId})` },
        };
      } catch (err: any) {
        set.status = 500;
        return { success: false, error: err.message };
      }
    },
    {
      body: t.Object({
        force: t.Optional(t.Boolean()),
        comparison: t.Optional(t.Union([t.Literal(">="), t.Literal("<=")])),
        threshold: t.Optional(t.Number()),
      }),
    }
  );

