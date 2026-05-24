import { formatUnits } from "viem";
import { publishEvent } from "../lib/redis";

export type LivePriceStatus = "provisional" | "confirmed" | "corrected" | "reverted";

export interface BinaryLivePricePayload {
  marketId: number;
  yesPrice: number;
  noPrice: number;
  yesReserve?: string;
  noReserve?: string;
  lastTradePrice?: number;
  lastTradeSide?: "YES" | "NO";
  lastTradeIsBuy?: boolean;
  volume?: number;
  liquidity?: number;
  pricesStale?: boolean;
  status: LivePriceStatus;
  provisional?: boolean;
  nonce?: string;
  txHash?: string;
  publishedAt: string;
}

export async function publishBinaryLivePrice(payload: Omit<BinaryLivePricePayload, "publishedAt">) {
  await publishEvent("market:price", {
    ...payload,
    publishedAt: new Date().toISOString(),
  });
}

export function formatReserve(value: bigint | undefined): string | undefined {
  return value === undefined ? undefined : formatUnits(value, 18);
}
