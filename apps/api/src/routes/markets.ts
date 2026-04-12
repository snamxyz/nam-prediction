import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { markets, trades, dailyMarkets } from "../db/schema";
import { eq, desc } from "drizzle-orm";

export const marketRoutes = new Elysia({ prefix: "/markets" })
  // GET /markets — List all markets
  .get("/", async () => {
    const allMarkets = await db
      .select()
      .from(markets)
      .orderBy(desc(markets.createdAt));
    return { data: allMarkets, success: true };
  })

  // GET /markets/daily/active — Get the active daily NAM market
  .get("/daily/active", async ({ set }) => {
    const daily = await db
      .select()
      .from(dailyMarkets)
      .where(eq(dailyMarkets.status, "active"))
      .orderBy(desc(dailyMarkets.createdAt))
      .limit(1);

    if (daily.length === 0) {
      return { data: null, success: true };
    }

    // If we have a linked market, fetch it
    let market = null;
    if (daily[0].marketId) {
      const m = await db
        .select()
        .from(markets)
        .where(eq(markets.id, daily[0].marketId))
        .limit(1);
      if (m.length > 0) market = m[0];
    }

    // If no linked market yet, try to find by question containing the date
    if (!market) {
      const allUnresolved = await db
        .select()
        .from(markets)
        .where(eq(markets.resolved, false))
        .orderBy(desc(markets.createdAt));

      for (const m of allUnresolved) {
        if (m.question.includes(daily[0].date) && m.resolutionSource === "dexscreener") {
          market = m;
          // Link it
          await db
            .update(dailyMarkets)
            .set({ marketId: m.id })
            .where(eq(dailyMarkets.id, daily[0].id));
          break;
        }
      }
    }

    return {
      data: {
        daily: daily[0],
        market,
      },
      success: true,
    };
  })

  // GET /markets/:id — Single market detail
  .get(
    "/:id",
    async ({ params, set }) => {
      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.id, Number(params.id)))
        .limit(1);

      if (market.length === 0) {
        set.status = 404;
        return { data: null, success: false, error: "Market not found" };
      }
      return { data: market[0], success: true };
    },
    { params: t.Object({ id: t.String() }) }
  )

  // GET /markets/:id/trades — Trade history for a market
  .get(
    "/:id/trades",
    async ({ params }) => {
      const marketTrades = await db
        .select()
        .from(trades)
        .where(eq(trades.marketId, Number(params.id)))
        .orderBy(desc(trades.timestamp));
      return { data: marketTrades, success: true };
    },
    { params: t.Object({ id: t.String() }) }
  );
