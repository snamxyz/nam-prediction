import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { markets, users, trades, userPositions, vaultTransactions } from "../db/schema";
import { eq, desc, count, sum, gte, lt, and, sql, ne } from "drizzle-orm";
import { resolveMarketOnChain } from "../services/resolution";
import { processDailyResolution } from "../services/queue/resolution-queue";
import { verifyAdminToken } from "../middleware/admin";

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
        [totalTradesRow],
        [trades24hRow],
        [totalVolumeRow],
        [volume24hRow],
        [activeMarketsRow],
        [resolvedMarketsRow],
        [totalDepositsRow],
        [totalWithdrawalsRow],
      ] = await Promise.all([
        db.select({ c: count() }).from(users),
        db.select({ c: count() }).from(users).where(gte(users.createdAt, ago24h)),
        db.select({ c: count() }).from(users).where(gte(users.createdAt, ago7d)),
        db.select({ c: count() }).from(trades),
        db.select({ c: count() }).from(trades).where(gte(trades.timestamp, ago24h)),
        db.select({ v: sum(markets.volume) }).from(markets),
        db.select({ v: sum(trades.collateral) }).from(trades).where(gte(trades.timestamp, ago24h)),
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
          totalTrades: Number(totalTradesRow?.c ?? 0),
          trades24h: Number(trades24hRow?.c ?? 0),
          totalVolume: Number(totalVolumeRow?.v ?? 0).toFixed(2),
          volume24h: Number(volume24hRow?.v ?? 0).toFixed(2),
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
        data: page.map((r) => ({
          ...r.user,
          tradeCount: Number(r.tradeCount ?? 0),
          totalVolume: Number(r.totalVolume ?? 0).toFixed(2),
        })),
        nextCursor: page.length === limit ? page[page.length - 1]?.user.id : null,
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
            question: p.market.question,
            resolved: p.market.resolved,
            result: p.market.result,
          })),
          vaultTxs,
        },
      };
    },
    { params: t.Object({ id: t.String() }) }
  )

  // ─── GET /admin/markets?status=active|resolved ───
  .get(
    "/markets",
    async ({ headers, query, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const limit = Math.min(Number(query?.limit ?? 50), 200);
      const statusFilter = query?.status;

      const rows = await db
        .select({
          market: markets,
          tradeCount: count(trades.id),
          totalVol: sum(trades.collateral),
        })
        .from(markets)
        .leftJoin(trades, eq(trades.marketId, markets.id))
        .where(
          statusFilter === "active"
            ? eq(markets.resolved, false)
            : statusFilter === "resolved"
            ? eq(markets.resolved, true)
            : undefined
        )
        .groupBy(markets.id)
        .orderBy(desc(markets.createdAt))
        .limit(limit);

      return {
        success: true,
        data: rows.map((r) => ({
          ...r.market,
          tradeCount: Number(r.tradeCount ?? 0),
          totalVolume: Number(r.totalVol ?? 0).toFixed(2),
        })),
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        status: t.Optional(t.String()),
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
      const cursor = query?.cursor ? Number(query.cursor) : undefined;

      const rows = await db
        .select({ trade: trades, market: markets })
        .from(trades)
        .innerJoin(markets, eq(trades.marketId, markets.id))
        .orderBy(desc(trades.timestamp))
        .limit(limit);

      const page = cursor ? rows.filter((r) => r.trade.id < cursor).slice(0, limit) : rows.slice(0, limit);

      return {
        success: true,
        data: page.map((r) => ({
          ...r.trade,
          question: r.market.question,
          cadence: r.market.cadence,
        })),
        nextCursor: page.length === limit ? page[page.length - 1]?.trade.id : null,
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
    }
  );

