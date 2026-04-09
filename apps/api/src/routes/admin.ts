import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { markets, internalMetrics } from "../db/schema";
import { eq } from "drizzle-orm";
import { resolveMarketOnChain } from "../services/resolution";

const ADMIN_ADDRESSES = (process.env.ADMIN_ADDRESSES || "")
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

export const adminRoutes = new Elysia({ prefix: "/admin" })
  // POST /admin/resolve/:marketId — Manually trigger market resolution
  .post(
    "/resolve/:marketId",
    async ({ params, body, set }) => {
      // Simple admin check via header
      const callerAddress = (body.adminAddress || "").toLowerCase();
      if (!ADMIN_ADDRESSES.includes(callerAddress)) {
        set.status = 403;
        return { success: false, error: "Not authorized" };
      }

      const marketId = Number(params.marketId);
      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.onChainId, marketId))
        .limit(1);

      if (market.length === 0) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }

      if (market[0].resolved) {
        set.status = 400;
        return { success: false, error: "Already resolved" };
      }

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
      body: t.Object({
        adminAddress: t.String(),
        result: t.Number({ minimum: 1, maximum: 2 }),
      }),
    }
  )

  // GET /admin/metrics — List all internal metrics
  .get("/metrics", async () => {
    const allMetrics = await db.select().from(internalMetrics);
    return { data: allMetrics, success: true };
  })

  // POST /admin/metrics — Upsert an internal metric
  .post(
    "/metrics",
    async ({ body, set }) => {
      const callerAddress = (body.adminAddress || "").toLowerCase();
      if (!ADMIN_ADDRESSES.includes(callerAddress)) {
        set.status = 403;
        return { success: false, error: "Not authorized" };
      }

      const { metricName, value } = body;

      // Upsert: insert or update on conflict
      await db
        .insert(internalMetrics)
        .values({
          metricName,
          value: value.toString(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: internalMetrics.metricName,
          set: {
            value: value.toString(),
            updatedAt: new Date(),
          },
        });

      return { success: true, data: { metricName, value } };
    },
    {
      body: t.Object({
        adminAddress: t.String(),
        metricName: t.String(),
        value: t.Number(),
      }),
    }
  );
