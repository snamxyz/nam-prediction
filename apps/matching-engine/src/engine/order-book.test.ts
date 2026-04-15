import { describe, expect, it } from "bun:test";
import { MatchingEngine } from "./order-book";

describe("MatchingEngine", () => {
  it("enforces price-time priority at the same price", () => {
    const engine = new MatchingEngine();

    engine.placeOrder({
      id: "sell-1",
      userId: "maker-a",
      marketId: "m-1",
      side: "sell",
      outcome: "yes",
      price: 0.42,
      quantity: 100,
      type: "limit",
    });

    engine.placeOrder({
      id: "sell-2",
      userId: "maker-b",
      marketId: "m-1",
      side: "sell",
      outcome: "yes",
      price: 0.42,
      quantity: 100,
      type: "limit",
    });

    const result = engine.placeOrder({
      id: "buy-1",
      userId: "taker-c",
      marketId: "m-1",
      side: "buy",
      outcome: "yes",
      price: 0.42,
      quantity: 150,
      type: "limit",
    });

    expect(result.fills).toHaveLength(2);
    expect(result.fills[0].makerOrderId).toBe("sell-1");
    expect(result.fills[0].quantity).toBe(100);
    expect(result.fills[1].makerOrderId).toBe("sell-2");
    expect(result.fills[1].quantity).toBe(50);

    const openOrders = engine.getOpenOrders("m-1");
    expect(openOrders).toHaveLength(1);
    expect(openOrders[0].id).toBe("sell-2");
    expect(openOrders[0].remainingQuantity).toBe(50);
  });

  it("supports partial fills and cancellation", () => {
    const engine = new MatchingEngine();

    engine.placeOrder({
      id: "buy-no-1",
      userId: "u1",
      marketId: "m-2",
      side: "buy",
      outcome: "no",
      price: 0.6,
      quantity: 200,
      type: "limit",
    });

    const fill = engine.placeOrder({
      id: "sell-no-1",
      userId: "u2",
      marketId: "m-2",
      side: "sell",
      outcome: "no",
      price: 0.6,
      quantity: 50,
      type: "limit",
    });

    expect(fill.fills).toHaveLength(1);
    expect(fill.fills[0].quantity).toBe(50);

    const cancelled = engine.cancelOrder("m-2", "buy-no-1", "u1");
    expect(cancelled).not.toBeNull();
    expect(cancelled?.status).toBe("cancelled");

    expect(engine.getOpenOrders("m-2")).toHaveLength(0);
  });

  it("projects mirrored liquidity for opposite outcome", () => {
    const engine = new MatchingEngine();

    engine.placeOrder({
      id: "yes-bid-1",
      userId: "u1",
      marketId: "m-3",
      side: "buy",
      outcome: "yes",
      price: 0.42,
      quantity: 100,
      type: "limit",
    });

    const mirrored = engine.getMirroredDepth("m-3", 5);
    expect(mirrored).not.toBeNull();

    const noAsks = mirrored?.noAsks ?? [];
    expect(noAsks.length).toBeGreaterThan(0);
    expect(noAsks[0].price).toBeCloseTo(0.58, 6);
    expect(noAsks[0].quantity).toBe(100);
  });

  it("prevents direct self-trading", () => {
    const engine = new MatchingEngine();

    engine.placeOrder({
      id: "self-sell",
      userId: "same-user",
      marketId: "m-4",
      side: "sell",
      outcome: "yes",
      price: 0.4,
      quantity: 100,
      type: "limit",
    });

    const result = engine.placeOrder({
      id: "self-buy",
      userId: "same-user",
      marketId: "m-4",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      quantity: 100,
      type: "limit",
    });

    expect(result.selfTradePrevented).toBeTrue();
    expect(result.order.status).toBe("rejected");
    expect(result.fills).toHaveLength(0);
    expect(engine.getOpenOrders("m-4")).toHaveLength(1);
  });
});
