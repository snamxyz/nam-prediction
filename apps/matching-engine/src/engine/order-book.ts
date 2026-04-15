import type {
  DepthLevel,
  EngineOrder,
  FillEvent,
  MarketDepth,
  MirroredDepth,
  Outcome,
  PlaceOrderInput,
  PlaceOrderResult,
  Side,
} from "./types";

const PRICE_SCALE = 1_000_000;
const MIN_PRICE_TICKS = 1;
const MAX_PRICE_TICKS = PRICE_SCALE - 1;
const QUANTITY_SCALE = 1_000_000;

interface DepthLevelTicks {
  priceTicks: number;
  quantity: number;
}

function clampPriceTicks(priceTicks: number): number {
  if (priceTicks < MIN_PRICE_TICKS) return MIN_PRICE_TICKS;
  if (priceTicks > MAX_PRICE_TICKS) return MAX_PRICE_TICKS;
  return priceTicks;
}

function toPriceTicks(price: number): number {
  if (!Number.isFinite(price)) {
    throw new Error("price must be a finite number");
  }

  return clampPriceTicks(Math.round(price * PRICE_SCALE));
}

function fromPriceTicks(priceTicks: number): number {
  return priceTicks / PRICE_SCALE;
}

function normalizeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) {
    throw new Error("quantity must be a finite number");
  }

  return Math.round(quantity * QUANTITY_SCALE) / QUANTITY_SCALE;
}

function mirrorPriceTicks(priceTicks: number): number {
  return clampPriceTicks(PRICE_SCALE - priceTicks);
}

class SideBook {
  private readonly levels = new Map<number, EngineOrder[]>();
  private readonly prices: number[] = [];

  constructor(private readonly side: Side) {}

  add(order: EngineOrder): void {
    const level = this.levels.get(order.priceTicks);
    if (level) {
      level.push(order);
      return;
    }

    this.levels.set(order.priceTicks, [order]);
    this.prices.push(order.priceTicks);
    this.prices.sort((a, b) => (this.side === "buy" ? b - a : a - b));
  }

  bestOrder(): EngineOrder | null {
    while (this.prices.length > 0) {
      const bestPrice = this.prices[0];
      const level = this.levels.get(bestPrice);

      if (!level || level.length === 0) {
        this.levels.delete(bestPrice);
        this.prices.shift();
        continue;
      }

      return level[0];
    }

    return null;
  }

  remove(orderId: string, priceHint?: number): EngineOrder | null {
    if (typeof priceHint === "number") {
      const removed = this.removeFromLevel(orderId, priceHint);
      if (removed) return removed;
    }

    for (const price of this.prices) {
      const removed = this.removeFromLevel(orderId, price);
      if (removed) return removed;
    }

    return null;
  }

  depth(maxLevels: number): DepthLevel[] {
    return this.depthWithTicks(maxLevels).map((level) => ({
      price: fromPriceTicks(level.priceTicks),
      quantity: level.quantity,
    }));
  }

  depthWithTicks(maxLevels: number): DepthLevelTicks[] {
    const levels: DepthLevelTicks[] = [];

    for (const price of this.prices) {
      if (levels.length >= maxLevels) break;

      const queue = this.levels.get(price);
      if (!queue || queue.length === 0) continue;

      const quantity = normalizeQuantity(
        queue.reduce((sum, order) => sum + order.remainingQuantity, 0)
      );

      if (quantity <= 0) continue;

      levels.push({
        priceTicks: price,
        quantity,
      });
    }

    return levels;
  }

  private removeFromLevel(orderId: string, priceTicks: number): EngineOrder | null {
    const queue = this.levels.get(priceTicks);
    if (!queue || queue.length === 0) return null;

    const index = queue.findIndex((order) => order.id === orderId);
    if (index === -1) return null;

    const [removed] = queue.splice(index, 1);

    if (queue.length === 0) {
      this.levels.delete(priceTicks);
      const priceIndex = this.prices.indexOf(priceTicks);
      if (priceIndex !== -1) {
        this.prices.splice(priceIndex, 1);
      }
    }

    return removed;
  }
}

class MarketOrderBook {
  private readonly yesBids = new SideBook("buy");
  private readonly yesAsks = new SideBook("sell");
  private readonly noBids = new SideBook("buy");
  private readonly noAsks = new SideBook("sell");
  private readonly orderLookup = new Map<string, EngineOrder>();
  private sequence = 0;

  constructor(private readonly marketId: string) {}

  placeOrder(input: PlaceOrderInput): PlaceOrderResult {
    if (this.orderLookup.has(input.id)) {
      throw new Error(`order ${input.id} already exists`);
    }

    const quantity = normalizeQuantity(input.quantity);
    if (quantity <= 0) {
      throw new Error("quantity must be positive");
    }

    const orderType = input.type ?? "limit";
    const priceTicks =
      orderType === "market"
        ? input.side === "buy"
          ? MAX_PRICE_TICKS
          : MIN_PRICE_TICKS
        : toPriceTicks(input.price);

    const now = input.createdAt ?? new Date();

    const incoming: EngineOrder = {
      id: input.id,
      userId: input.userId,
      marketId: input.marketId,
      side: input.side,
      outcome: input.outcome,
      type: orderType,
      price: fromPriceTicks(priceTicks),
      priceTicks,
      quantity,
      filledQuantity: 0,
      remainingQuantity: quantity,
      status: "open",
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      sequence: ++this.sequence,
    };

    const fills: FillEvent[] = [];
    let selfTradePrevented = false;
    const opposingBook = this.getSideBook(
      incoming.outcome,
      incoming.side === "buy" ? "sell" : "buy"
    );

    while (incoming.remainingQuantity > 0) {
      const resting = opposingBook.bestOrder();
      if (!resting) break;

      if (!this.canCross(incoming, resting.priceTicks)) break;

      if (resting.userId === incoming.userId) {
        selfTradePrevented = true;
        break;
      }

      const fillQuantity = normalizeQuantity(
        Math.min(incoming.remainingQuantity, resting.remainingQuantity)
      );
      if (fillQuantity <= 0) {
        opposingBook.remove(resting.id, resting.priceTicks);
        this.orderLookup.delete(resting.id);
        continue;
      }

      const fillTimestamp = new Date();
      const fillPrice = fromPriceTicks(resting.priceTicks);

      incoming.filledQuantity = normalizeQuantity(incoming.filledQuantity + fillQuantity);
      incoming.remainingQuantity = normalizeQuantity(incoming.remainingQuantity - fillQuantity);
      incoming.updatedAt = fillTimestamp;
      incoming.status = incoming.remainingQuantity > 0 ? "partially_filled" : "filled";

      resting.filledQuantity = normalizeQuantity(resting.filledQuantity + fillQuantity);
      resting.remainingQuantity = normalizeQuantity(resting.remainingQuantity - fillQuantity);
      resting.updatedAt = fillTimestamp;
      resting.status = resting.remainingQuantity > 0 ? "partially_filled" : "filled";

      fills.push({
        marketId: this.marketId,
        makerOrderId: resting.id,
        takerOrderId: incoming.id,
        makerUserId: resting.userId,
        takerUserId: incoming.userId,
        outcome: incoming.outcome,
        price: fillPrice,
        quantity: fillQuantity,
        timestamp: fillTimestamp,
      });

      if (resting.remainingQuantity <= 0) {
        opposingBook.remove(resting.id, resting.priceTicks);
        this.orderLookup.delete(resting.id);
      } else {
        this.orderLookup.set(resting.id, resting);
      }
    }

    if (selfTradePrevented && incoming.filledQuantity === 0) {
      incoming.status = "rejected";
      return {
        order: incoming,
        fills,
        selfTradePrevented,
      };
    }

    if (incoming.remainingQuantity > 0) {
      if (incoming.type === "limit") {
        const restingSide = this.getSideBook(incoming.outcome, incoming.side);
        restingSide.add(incoming);
        this.orderLookup.set(incoming.id, incoming);
        incoming.status = incoming.filledQuantity > 0 ? "partially_filled" : "open";
      } else {
        incoming.status = incoming.filledQuantity > 0 ? "partially_filled" : "rejected";
      }
    }

    return {
      order: incoming,
      fills,
      selfTradePrevented,
    };
  }

  cancelOrder(orderId: string, userId?: string): EngineOrder | null {
    const existing = this.orderLookup.get(orderId);
    if (!existing) return null;
    if (userId && existing.userId !== userId) return null;

    const sideBook = this.getSideBook(existing.outcome, existing.side);
    const removed = sideBook.remove(orderId, existing.priceTicks);
    if (!removed) return null;

    removed.status = "cancelled";
    removed.cancelledAt = new Date();
    removed.updatedAt = removed.cancelledAt;

    this.orderLookup.delete(orderId);
    return removed;
  }

  getDepth(depth = 20): MarketDepth {
    return {
      marketId: this.marketId,
      yesBids: this.yesBids.depth(depth),
      yesAsks: this.yesAsks.depth(depth),
      noBids: this.noBids.depth(depth),
      noAsks: this.noAsks.depth(depth),
    };
  }

  getMirroredDepth(depth = 20): MirroredDepth {
    const sourceDepth = Math.max(depth * 2, depth + 5);

    const yesBids = this.yesBids.depthWithTicks(sourceDepth);
    const yesAsks = this.yesAsks.depthWithTicks(sourceDepth);
    const noBids = this.noBids.depthWithTicks(sourceDepth);
    const noAsks = this.noAsks.depthWithTicks(sourceDepth);

    return {
      marketId: this.marketId,
      yesBids: this.combineDepth(yesBids, this.mirrorDepth(noAsks), "buy", depth),
      yesAsks: this.combineDepth(yesAsks, this.mirrorDepth(noBids), "sell", depth),
      noBids: this.combineDepth(noBids, this.mirrorDepth(yesAsks), "buy", depth),
      noAsks: this.combineDepth(noAsks, this.mirrorDepth(yesBids), "sell", depth),
    };
  }

  getOpenOrders(userId?: string): EngineOrder[] {
    const orders = Array.from(this.orderLookup.values())
      .filter((order) => order.status === "open" || order.status === "partially_filled")
      .filter((order) => !userId || order.userId === userId)
      .sort((a, b) => a.sequence - b.sequence);

    return orders;
  }

  private canCross(incoming: EngineOrder, restingPriceTicks: number): boolean {
    if (incoming.type === "market") return true;

    if (incoming.side === "buy") {
      return incoming.priceTicks >= restingPriceTicks;
    }

    return incoming.priceTicks <= restingPriceTicks;
  }

  private getSideBook(outcome: Outcome, side: Side): SideBook {
    if (outcome === "yes") {
      return side === "buy" ? this.yesBids : this.yesAsks;
    }

    return side === "buy" ? this.noBids : this.noAsks;
  }

  private mirrorDepth(depth: DepthLevelTicks[]): DepthLevelTicks[] {
    return depth.map((level) => ({
      priceTicks: mirrorPriceTicks(level.priceTicks),
      quantity: level.quantity,
    }));
  }

  private combineDepth(
    direct: DepthLevelTicks[],
    mirrored: DepthLevelTicks[],
    side: Side,
    maxLevels: number
  ): DepthLevel[] {
    const aggregate = new Map<number, number>();

    for (const level of [...direct, ...mirrored]) {
      const current = aggregate.get(level.priceTicks) ?? 0;
      aggregate.set(level.priceTicks, normalizeQuantity(current + level.quantity));
    }

    return Array.from(aggregate.entries())
      .sort((a, b) => (side === "buy" ? b[0] - a[0] : a[0] - b[0]))
      .slice(0, maxLevels)
      .map(([priceTicks, quantity]) => ({
        price: fromPriceTicks(priceTicks),
        quantity,
      }));
  }
}

export class MatchingEngine {
  private readonly markets = new Map<string, MarketOrderBook>();

  placeOrder(input: PlaceOrderInput): PlaceOrderResult {
    return this.getOrCreateMarketBook(input.marketId).placeOrder(input);
  }

  cancelOrder(marketId: string, orderId: string, userId?: string): EngineOrder | null {
    const market = this.markets.get(marketId);
    if (!market) return null;

    return market.cancelOrder(orderId, userId);
  }

  getDepth(marketId: string, depth = 20): MarketDepth | null {
    const market = this.markets.get(marketId);
    if (!market) return null;

    return market.getDepth(depth);
  }

  getMirroredDepth(marketId: string, depth = 20): MirroredDepth | null {
    const market = this.markets.get(marketId);
    if (!market) return null;

    return market.getMirroredDepth(depth);
  }

  getOpenOrders(marketId: string, userId?: string): EngineOrder[] {
    const market = this.markets.get(marketId);
    if (!market) return [];

    return market.getOpenOrders(userId);
  }

  removeMarket(marketId: string): boolean {
    return this.markets.delete(marketId);
  }

  private getOrCreateMarketBook(marketId: string): MarketOrderBook {
    const existing = this.markets.get(marketId);
    if (existing) return existing;

    const created = new MarketOrderBook(marketId);
    this.markets.set(marketId, created);
    return created;
  }
}
