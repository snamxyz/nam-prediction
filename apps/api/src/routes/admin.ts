import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { markets, users, trades, userPositions, vaultTransactions, rangeMarkets, rangeTrades, rangePositions } from "../db/schema";
import { and, count, desc, eq, lte, sql, sum } from "drizzle-orm";
import { resolveMarketOnChain } from "../services/resolution";
import { processDailyResolution } from "../services/queue/resolution-queue";
import { processHourlyTick } from "../services/queue/hourly-queue";
import { createNextHourlyMarket } from "../services/hourly-market";
import { verifyAdminToken } from "../middleware/admin";
import { formatMarketQuestion } from "../lib/market-display";
import {
  getAdminMarketsSnapshot,
  getAdminOverviewSnapshot,
  getAdminUserHoldingsSnapshot,
  refreshAdminSnapshots,
  type AdminMarketFamily,
  type AdminMarketStatus,
} from "../services/admin-snapshots";

// ─── Helper: 403 shorthand ───
function forbidden() {
  return { success: false as const, error: "Forbidden" };
}

const MARKET_FAMILIES = new Set(["token", "participants", "receipts"]);
const DUST = 1e-9;

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function compactAddress(address: string | null | undefined) {
  if (!address) return null;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function rangeLabel(ranges: unknown, index: number): string {
  if (!Array.isArray(ranges)) return `Range ${index + 1}`;
  const range = ranges[index] as { label?: unknown } | undefined;
  return typeof range?.label === "string" ? range.label : `Range ${index + 1}`;
}

async function findAdminMarket(family: AdminMarketFamily, marketId: number) {
  const snapshot = await getAdminMarketsSnapshot({ family, status: "all", limit: 200 });
  return snapshot.markets.find((market) => market.id === marketId) ?? null;
}

async function assertMarketExists(family: AdminMarketFamily, marketId: number) {
  if (family === "token") {
    const [market] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.cadence, "24h")))
      .limit(1);
    return Boolean(market);
  }

  const [market] = await db
    .select({ id: rangeMarkets.id })
    .from(rangeMarkets)
    .where(and(eq(rangeMarkets.id, marketId), eq(rangeMarkets.marketType, family)))
    .limit(1);
  return Boolean(market);
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

      return {
        success: true,
        data: await getAdminOverviewSnapshot(),
      };
    }
  )

  // ─── POST /admin/snapshots/refresh — Manual Redis snapshot rebuild ───
  .post(
    "/snapshots/refresh",
    async ({ headers, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      try {
        await refreshAdminSnapshots("manual");
        return { success: true, data: await getAdminOverviewSnapshot() };
      } catch (err: any) {
        set.status = 500;
        return { success: false, error: err.message ?? "Snapshot refresh failed" };
      }
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

  // ─── GET /admin/users/:id/holdings ───
  .get(
    "/users/:id/holdings",
    async ({ headers, params, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const userId = Number(params.id);
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (user.length === 0) { set.status = 404; return { success: false, error: "User not found" }; }

      const wallet = user[0].walletAddress?.toLowerCase();
      if (!wallet) {
        return {
          success: true,
          data: {
            wallet: "",
            snapshotAt: new Date().toISOString(),
            snapshotSource: "db" as const,
            vault: {
              totalDeposits: "0.00",
              totalWithdrawals: "0.00",
              totalRedemptions: "0.00",
              netDeposits: "0.00",
              transactionCount: 0,
              recentTransactions: [],
            },
            binary: [],
            range: [],
          },
        };
      }

      return {
        success: true,
        data: await getAdminUserHoldingsSnapshot(wallet),
      };
    },
    { params: t.Object({ id: t.String() }) }
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
      const validStatuses = new Set(["active", "resolved", "all"]);

      if (family && !validFamilies.has(family)) {
        set.status = 400;
        return { success: false, error: "Invalid market family" };
      }

      if (statusFilter && !validStatuses.has(statusFilter)) {
        set.status = 400;
        return { success: false, error: "Invalid market status" };
      }

      return {
        success: true,
        data: await getAdminMarketsSnapshot({
          status: (statusFilter as AdminMarketStatus | undefined) ?? "all",
          family: family as AdminMarketFamily | undefined,
          limit,
        }),
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

  // ─── GET /admin/markets/:family/:marketId ───
  .get(
    "/markets/:family/:marketId",
    async ({ headers, params, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const family = params.family as AdminMarketFamily;
      const marketId = Number(params.marketId);
      if (!MARKET_FAMILIES.has(family) || !Number.isFinite(marketId)) {
        set.status = 400;
        return { success: false, error: "Invalid market" };
      }

      const market = await findAdminMarket(family, marketId);
      if (!market) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }

      if (family === "token") {
        return { success: true, data: { market } };
      }

      const [rangeMarket] = await db
        .select({ ranges: rangeMarkets.ranges })
        .from(rangeMarkets)
        .where(and(eq(rangeMarkets.id, marketId), eq(rangeMarkets.marketType, family)))
        .limit(1);

      const ranges = Array.isArray(rangeMarket?.ranges)
        ? rangeMarket.ranges.map((range, index) => {
            const item = range as { index?: unknown; label?: unknown };
            return {
              index: typeof item.index === "number" ? item.index : index,
              label: typeof item.label === "string" ? item.label : `Range ${index + 1}`,
            };
          })
        : [];

      return { success: true, data: { market: { ...market, ranges } } };
    },
    {
      params: t.Object({
        family: t.String(),
        marketId: t.String(),
      }),
    }
  )

  // ─── GET /admin/markets/:family/:marketId/holders ───
  .get(
    "/markets/:family/:marketId/holders",
    async ({ headers, params, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const family = params.family as AdminMarketFamily;
      const marketId = Number(params.marketId);
      if (!MARKET_FAMILIES.has(family) || !Number.isFinite(marketId)) {
        set.status = 400;
        return { success: false, error: "Invalid market" };
      }

      const exists = await assertMarketExists(family, marketId);
      if (!exists) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }

      if (family === "token") {
        const rows = await db
          .select({
            position: userPositions,
            displayName: users.displayName,
            loginMethod: users.loginMethod,
          })
          .from(userPositions)
          .leftJoin(users, eq(sql`lower(${users.walletAddress})`, userPositions.userAddress))
          .where(eq(userPositions.marketId, marketId));

        const holders = rows
          .map((row) => {
            const yesBalance = asNumber(row.position.yesBalance);
            const noBalance = asNumber(row.position.noBalance);
            const openInterestShares = Math.max(0, yesBalance) + Math.max(0, noBalance);
            const side =
              yesBalance > DUST && noBalance > DUST
                ? "BOTH"
                : yesBalance >= noBalance
                  ? "YES"
                  : "NO";

            return {
              userAddress: row.position.userAddress,
              shortAddress: compactAddress(row.position.userAddress),
              displayName: row.displayName,
              loginMethod: row.loginMethod,
              side,
              yesBalance: row.position.yesBalance,
              noBalance: row.position.noBalance,
              openInterestShares: openInterestShares.toFixed(6),
              costBasis: (asNumber(row.position.yesCostBasis) + asNumber(row.position.noCostBasis)).toFixed(2),
              yesCostBasis: asNumber(row.position.yesCostBasis).toFixed(2),
              noCostBasis: asNumber(row.position.noCostBasis).toFixed(2),
              yesAvgPrice: row.position.yesAvgPrice,
              noAvgPrice: row.position.noAvgPrice,
              pnl: asNumber(row.position.pnl).toFixed(2),
              avgEntryPrice:
                side === "NO"
                  ? row.position.noAvgPrice
                  : side === "YES"
                    ? row.position.yesAvgPrice
                    : null,
            };
          })
          .filter((holder) => asNumber(holder.openInterestShares) > DUST)
          .sort((a, b) => asNumber(b.openInterestShares) - asNumber(a.openInterestShares));

        return { success: true, data: { holders } };
      }

      const [market] = await db
        .select({ ranges: rangeMarkets.ranges })
        .from(rangeMarkets)
        .where(and(eq(rangeMarkets.id, marketId), eq(rangeMarkets.marketType, family)))
        .limit(1);

      const rows = await db
        .select({
          position: rangePositions,
          displayName: users.displayName,
          loginMethod: users.loginMethod,
        })
        .from(rangePositions)
        .leftJoin(users, eq(sql`lower(${users.walletAddress})`, rangePositions.userAddress))
        .where(eq(rangePositions.rangeMarketId, marketId));

      const holders = rows
        .map((row) => {
          const balance = Math.max(0, asNumber(row.position.balance));
          return {
            userAddress: row.position.userAddress,
            shortAddress: compactAddress(row.position.userAddress),
            displayName: row.displayName,
            loginMethod: row.loginMethod,
            side: rangeLabel(market?.ranges, row.position.rangeIndex),
            rangeIndex: row.position.rangeIndex,
            rangeLabel: rangeLabel(market?.ranges, row.position.rangeIndex),
            balance: row.position.balance,
            openInterestShares: balance.toFixed(6),
            costBasis: asNumber(row.position.costBasis).toFixed(2),
            pnl: asNumber(row.position.pnl).toFixed(2),
            avgEntryPrice: row.position.avgEntryPrice,
          };
        })
        .filter((holder) => asNumber(holder.openInterestShares) > DUST)
        .sort((a, b) => asNumber(b.openInterestShares) - asNumber(a.openInterestShares));

      return { success: true, data: { holders } };
    },
    {
      params: t.Object({
        family: t.String(),
        marketId: t.String(),
      }),
    }
  )

  // ─── GET /admin/markets/:family/:marketId/trades ───
  .get(
    "/markets/:family/:marketId/trades",
    async ({ headers, params, query, set }) => {
      const claims = await verifyAdminToken(headers.authorization);
      if (!claims) { set.status = 403; return forbidden(); }

      const family = params.family as AdminMarketFamily;
      const marketId = Number(params.marketId);
      const limit = Math.min(Number(query?.limit ?? 100), 500);
      if (!MARKET_FAMILIES.has(family) || !Number.isFinite(marketId)) {
        set.status = 400;
        return { success: false, error: "Invalid market" };
      }

      if (family === "token") {
        const [market] = await db
          .select()
          .from(markets)
          .where(and(eq(markets.id, marketId), eq(markets.cadence, "24h")))
          .limit(1);
        if (!market) {
          set.status = 404;
          return { success: false, error: "Market not found" };
        }

        const rows = await db
          .select()
          .from(trades)
          .where(eq(trades.marketId, marketId))
          .orderBy(desc(trades.timestamp))
          .limit(limit);

        return {
          success: true,
          data: {
            trades: rows.map((trade) => ({
              ...trade,
              traderAddress: trade.trader,
              side: trade.isYes ? "YES" : "NO",
              createdAt: trade.timestamp,
              question: formatMarketQuestion(market),
              cadence: market.cadence,
              source: "binary" as const,
            })),
          },
        };
      }

      const [market] = await db
        .select()
        .from(rangeMarkets)
        .where(and(eq(rangeMarkets.id, marketId), eq(rangeMarkets.marketType, family)))
        .limit(1);
      if (!market) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }

      const rows = await db
        .select()
        .from(rangeTrades)
        .where(eq(rangeTrades.rangeMarketId, marketId))
        .orderBy(desc(rangeTrades.timestamp))
        .limit(limit);

      return {
        success: true,
        data: {
          trades: rows.map((trade) => ({
            ...trade,
            marketId: trade.rangeMarketId,
            traderAddress: trade.trader,
            side: rangeLabel(market.ranges, trade.rangeIndex),
            rangeIndex: trade.rangeIndex,
            createdAt: trade.timestamp,
            question: market.question,
            cadence: "range",
            source: "range" as const,
          })),
        },
      };
    },
    {
      params: t.Object({
        family: t.String(),
        marketId: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
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

