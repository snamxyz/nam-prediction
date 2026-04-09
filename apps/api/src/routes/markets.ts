import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { markets, trades } from "../db/schema";
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
