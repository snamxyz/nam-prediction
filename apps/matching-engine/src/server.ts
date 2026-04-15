import { Elysia, t } from "elysia";
import { MatchingEngine } from "./engine/order-book";

export interface MatchingEngineServerOptions {
  port?: number;
  engine?: MatchingEngine;
}

export function createMatchingEngineServer(options: MatchingEngineServerOptions = {}) {
  const engine = options.engine ?? new MatchingEngine();

  const app = new Elysia()
    .get("/health", () => ({
      success: true,
      data: {
        status: "ok",
        timestamp: new Date().toISOString(),
      },
    }))
    .post(
      "/orders",
      ({ body, set }) => {
        try {
          const result = engine.placeOrder({
            id: body.id,
            userId: body.userId,
            marketId: body.marketId,
            side: body.side,
            outcome: body.outcome,
            price: body.price,
            quantity: body.quantity,
            type: body.type,
          });

          return {
            success: true,
            data: result,
          };
        } catch (error: unknown) {
          set.status = 400;
          return {
            success: false,
            error: error instanceof Error ? error.message : "Invalid order",
          };
        }
      },
      {
        body: t.Object({
          id: t.String(),
          userId: t.String(),
          marketId: t.String(),
          side: t.Union([t.Literal("buy"), t.Literal("sell")]),
          outcome: t.Union([t.Literal("yes"), t.Literal("no")]),
          price: t.Number({ minimum: 0, maximum: 1 }),
          quantity: t.Number({ minimum: 0.000001 }),
          type: t.Optional(t.Union([t.Literal("limit"), t.Literal("market")])),
        }),
      }
    )
    .delete(
      "/orders/:marketId/:orderId",
      ({ params, query, set }) => {
        const cancelled = engine.cancelOrder(params.marketId, params.orderId, query.userId);
        if (!cancelled) {
          set.status = 404;
          return {
            success: false,
            error: "Order not found",
          };
        }

        return {
          success: true,
          data: cancelled,
        };
      },
      {
        params: t.Object({
          marketId: t.String(),
          orderId: t.String(),
        }),
        query: t.Object({
          userId: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/orderbook/:marketId",
      ({ params, query }) => {
        const depth = query.depth ? Number(query.depth) : 20;
        const snapshot = engine.getDepth(params.marketId, depth);

        return {
          success: true,
          data: snapshot ?? {
            marketId: params.marketId,
            yesBids: [],
            yesAsks: [],
            noBids: [],
            noAsks: [],
          },
        };
      },
      {
        params: t.Object({
          marketId: t.String(),
        }),
        query: t.Object({
          depth: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/orderbook/:marketId/mirrored",
      ({ params, query }) => {
        const depth = query.depth ? Number(query.depth) : 20;
        const snapshot = engine.getMirroredDepth(params.marketId, depth);

        return {
          success: true,
          data: snapshot ?? {
            marketId: params.marketId,
            yesBids: [],
            yesAsks: [],
            noBids: [],
            noAsks: [],
          },
        };
      },
      {
        params: t.Object({
          marketId: t.String(),
        }),
        query: t.Object({
          depth: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/orders/:marketId/open",
      ({ params, query }) => {
        return {
          success: true,
          data: engine.getOpenOrders(params.marketId, query.userId),
        };
      },
      {
        params: t.Object({
          marketId: t.String(),
        }),
        query: t.Object({
          userId: t.Optional(t.String()),
        }),
      }
    );

  return { app, engine };
}

if (import.meta.main) {
  const port = Number(process.env.MATCHING_ENGINE_PORT || 3010);
  const { app } = createMatchingEngineServer({ port });
  app.listen(port);

  console.log(`[matching-engine] listening on http://localhost:${port}`);
}
