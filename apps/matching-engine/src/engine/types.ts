export type Outcome = "yes" | "no";
export type Side = "buy" | "sell";
export type OrderType = "limit" | "market";

export type EngineOrderStatus =
  | "open"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "expired"
  | "rejected";

export interface PlaceOrderInput {
  id: string;
  userId: string;
  marketId: string;
  side: Side;
  outcome: Outcome;
  price: number;
  quantity: number;
  type?: OrderType;
  createdAt?: Date;
}

export interface EngineOrder {
  id: string;
  userId: string;
  marketId: string;
  side: Side;
  outcome: Outcome;
  type: OrderType;
  price: number;
  priceTicks: number;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  status: EngineOrderStatus;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  sequence: number;
}

export interface FillEvent {
  marketId: string;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId: string;
  takerUserId: string;
  outcome: Outcome;
  price: number;
  quantity: number;
  timestamp: Date;
}

export interface PlaceOrderResult {
  order: EngineOrder;
  fills: FillEvent[];
  selfTradePrevented: boolean;
}

export interface DepthLevel {
  price: number;
  quantity: number;
}

export interface MarketDepth {
  marketId: string;
  yesBids: DepthLevel[];
  yesAsks: DepthLevel[];
  noBids: DepthLevel[];
  noAsks: DepthLevel[];
}

export interface MirroredDepth {
  marketId: string;
  yesBids: DepthLevel[];
  yesAsks: DepthLevel[];
  noBids: DepthLevel[];
  noAsks: DepthLevel[];
}
