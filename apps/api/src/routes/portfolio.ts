import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { userPositions, markets } from "../db/schema";
import { eq } from "drizzle-orm";

export const portfolioRoutes = new Elysia({ prefix: "/portfolio" })
  // GET /portfolio/:user — User positions across all markets
  .get(
    "/:user",
    async ({ params }) => {
      const positions = await db
        .select({
          position: userPositions,
          market: markets,
        })
        .from(userPositions)
        .innerJoin(markets, eq(userPositions.marketId, markets.id))
        .where(eq(userPositions.userAddress, params.user.toLowerCase()));

      return {
        data: positions.map((p) => ({
          ...p.position,
          question: p.market.question,
          resolved: p.market.resolved,
          result: p.market.result,
          yesPrice: p.market.yesPrice,
          noPrice: p.market.noPrice,
        })),
        success: true,
      };
    },
    { params: t.Object({ user: t.String() }) }
  );
