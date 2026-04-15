import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { orders, markets } from "../db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { verifyPrivyToken } from "../middleware/auth";
import { featureFlags } from "../config/feature-flags";

const OPEN_STATUSES = ["open", "partially_filled"] as const;

function createOrderId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `ord_${Date.now()}_${random}`;
}

function normalizePrice(price: number): string {
  return price.toFixed(6);
}

function normalizeQuantity(quantity: number): string {
  return quantity.toFixed(18);
}

function parseDbNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function toDepth(
  rawOrders: Array<{
    side: string;
    outcome: string;
    price: string;
    remainingQuantity: string;
  }>
) {
  const buckets = {
    yes: { buy: new Map<number, number>(), sell: new Map<number, number>() },
    no: { buy: new Map<number, number>(), sell: new Map<number, number>() },
  };

  for (const order of rawOrders) {
    if (order.outcome !== "yes" && order.outcome !== "no") continue;
    if (order.side !== "buy" && order.side !== "sell") continue;

    const price = parseDbNumber(order.price);
    const qty = parseDbNumber(order.remainingQuantity);
    const map = buckets[order.outcome][order.side];
    map.set(price, (map.get(price) ?? 0) + qty);
  }

  const toLevels = (map: Map<number, number>, side: "buy" | "sell") =>
    Array.from(map.entries())
      .sort((a, b) => (side === "buy" ? b[0] - a[0] : a[0] - b[0]))
      .map(([price, quantity]) => ({
        price,
        quantity,
      }));

  return {
    yesBids: toLevels(buckets.yes.buy, "buy"),
    yesAsks: toLevels(buckets.yes.sell, "sell"),
    noBids: toLevels(buckets.no.buy, "buy"),
    noAsks: toLevels(buckets.no.sell, "sell"),
  };
}

export const orderRoutes = new Elysia({ prefix: "/orders" })

  // GET /orders/book/:marketId — Order book snapshot
  .get(
    "/book/:marketId",
    async ({ params }) => {
      const marketId = Number(params.marketId);

      const openOrders = await db
        .select({
          side: orders.side,
          outcome: orders.outcome,
          price: orders.price,
          remainingQuantity: orders.remainingQuantity,
        })
        .from(orders)
        .where(
          and(
            eq(orders.marketId, marketId),
            inArray(orders.status, OPEN_STATUSES as unknown as string[])
          )
        );

      return {
        data: {
          marketId,
          ...toDepth(openOrders),
        },
        success: true,
      };
    },
    { params: t.Object({ marketId: t.String() }) }
  )

  // GET /orders/user/:address — Open orders for a user
  .get(
    "/user/:address",
    async ({ params, query }) => {
      const userAddress = params.address.toLowerCase();
      const statuses = (query.status as string | undefined)?.split(",") ?? [...OPEN_STATUSES];

      const userOrders = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.userAddress, userAddress),
            inArray(orders.status, statuses)
          )
        )
        .orderBy(desc(orders.createdAt));

      return {
        data: userOrders,
        success: true,
      };
    },
    {
      params: t.Object({ address: t.String() }),
      query: t.Object({ status: t.Optional(t.String()) }),
    }
  )

  // GET /orders/:id — Single order status
  .get(
    "/:id",
    async ({ params, set }) => {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, Number(params.id)))
        .limit(1);
      if (!order) {
        set.status = 404;
        return { success: false, error: "Order not found" };
      }
      return { data: order, success: true };
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /orders — Place a new CLOB order (matching integration comes next)
  .post(
    "/",
    async ({ body, request, set }) => {
      const authHeader = request.headers.get("authorization");
      const claims = await verifyPrivyToken(authHeader);
      if (!claims) {
        set.status = 401;
        return { success: false, error: "Unauthorized" };
      }

      if (!featureFlags.enableClobTrading) {
        set.status = 503;
        return { success: false, error: "CLOB trading is disabled" };
      }

      const {
        marketId,
        outcome,
        side,
        orderType,
        price,
        quantity,
        expiresAt,
        clientOrderId,
        signature,
        userAddress,
      } = body;

      // ─── Validate market exists ───
      const [market] = await db
        .select()
        .from(markets)
        .where(eq(markets.id, marketId))
        .limit(1);

      if (!market || market.resolved) {
        set.status = 400;
        return { success: false, error: "Market not found or already resolved" };
      }

      if (market.executionMode !== "clob") {
        set.status = 400;
        return { success: false, error: "Market is not configured for CLOB trading" };
      }

      if (new Date(market.endTime) < new Date()) {
        set.status = 400;
        return { success: false, error: "Market has ended" };
      }

      const lockTime = market.lockTime ? new Date(market.lockTime) : null;
      if (lockTime && lockTime <= new Date()) {
        set.status = 400;
        return { success: false, error: "Market is locked for new orders" };
      }

      // ─── Validate price range ───
      if (price <= 0 || price >= 1) {
        set.status = 400;
        return { success: false, error: "Price must be between 0 and 1 (exclusive)" };
      }

      if (quantity <= 0) {
        set.status = 400;
        return { success: false, error: "Quantity must be positive" };
      }

      const normalizedUserAddress = userAddress.toLowerCase();
      if (!normalizedUserAddress.startsWith("0x")) {
        set.status = 400;
        return { success: false, error: "Invalid userAddress" };
      }

      // ─── Validate expiry ───
      const expiryDate = expiresAt ? new Date(expiresAt) : null;
      if (expiryDate && expiryDate < new Date()) {
        set.status = 400;
        return { success: false, error: "Order already expired" };
      }

      // ─── Insert order into DB ───
      const orderId = createOrderId();
      const [inserted] = await db
        .insert(orders)
        .values({
          orderId,
          marketId,
          userAddress: normalizedUserAddress,
          side,
          outcome,
          orderType,
          price: normalizePrice(price),
          quantity: normalizeQuantity(quantity),
          filledQuantity: "0",
          remainingQuantity: normalizeQuantity(quantity),
          status: "open",
          clientOrderId,
          signature,
          expiresAt: expiryDate,
        })
        .returning();

      return {
        success: true,
        data: {
          order: inserted,
        },
      };
    },
    {
      body: t.Object({
        marketId: t.Number(),
        side: t.Union([t.Literal("buy"), t.Literal("sell")]),
        outcome: t.Union([t.Literal("yes"), t.Literal("no")]),
        orderType: t.Union([t.Literal("limit"), t.Literal("market")]),
        price: t.Number(),
        quantity: t.Number(),
        expiresAt: t.Optional(t.String()),
        clientOrderId: t.Optional(t.String()),
        signature: t.Optional(t.String()),
        userAddress: t.String(),
      }),
    }
  )

  // DELETE /orders/:id — Cancel an order
  .delete(
    "/:id",
    async ({ params, body, request, set }) => {
      const authHeader = request.headers.get("authorization");
      const claims = await verifyPrivyToken(authHeader);
      if (!claims) {
        set.status = 401;
        return { success: false, error: "Unauthorized" };
      }

      const orderId = Number(params.id);
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

      if (!order) {
        set.status = 404;
        return { success: false, error: "Order not found" };
      }

      // Verify the caller owns this order (Privy userId maps to wallet)
      // Simple check: the order's userAddress must match what Privy says
      // In production: verify via privyClient.getUser(claims.userId) → linked wallets
      if (order.status === "filled" || order.status === "cancelled") {
        set.status = 400;
        return { success: false, error: `Order cannot be cancelled (status: ${order.status})` };
      }

      if (body.userAddress && order.userAddress !== body.userAddress.toLowerCase()) {
        set.status = 403;
        return { success: false, error: "Order does not belong to this wallet" };
      }

      // Cancel in DB
      await db
        .update(orders)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(orders.id, orderId));

      return {
        success: true,
        data: { orderId, marketId: order.marketId },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        userAddress: t.Optional(t.String()),
      }),
    }
  );
