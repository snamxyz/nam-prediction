import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../db/client";
import { markets } from "../db/schema";
import { eq } from "drizzle-orm";
import { MarketFactoryABI } from "@nam-prediction/shared";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;
const RESOLUTION_API_URL = process.env.RESOLUTION_API_URL || "";
const RESOLUTION_POLL_INTERVAL = Number(process.env.RESOLUTION_POLL_INTERVAL) || 60000;

// ─── Resolve a single market on-chain ───

export async function resolveMarketOnChain(
  marketId: number,
  result: number
): Promise<string> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");

  const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });

  const txHash = await walletClient.writeContract({
    address: FACTORY_ADDRESS,
    abi: MarketFactoryABI,
    functionName: "resolveMarket",
    args: [BigInt(marketId), result],
  });

  console.log(`[Resolution] Resolved market #${marketId} with result=${result}, tx=${txHash}`);
  return txHash;
}

// ─── Resolution polling service ───

async function pollResolutions() {
  if (!FACTORY_ADDRESS) return;

  try {
    // Find all unresolved markets with "api" resolution source
    const unresolvedMarkets = await db
      .select()
      .from(markets)
      .where(eq(markets.resolved, false));

    for (const market of unresolvedMarkets) {
      if (market.resolutionSource === "admin") continue; // admin markets resolved manually

      try {
        if (market.resolutionSource === "dexscreener") continue; // handled by BullMQ daily cron

        // "api" source — fetch from backend API
        if (!RESOLUTION_API_URL) continue;

        const response = await fetch(
          `${RESOLUTION_API_URL}?marketId=${market.onChainId}`
        );
        if (!response.ok) continue;

        const data = await response.json();
        // Expects { result: 1 } for YES, { result: 2 } for NO, or { result: 0 } / absent if not yet resolved
        const result = Number(data.result);

        if (result === 1 || result === 2) {
          await resolveMarketOnChain(market.onChainId, result);
          console.log(`[Resolution] Auto-resolved market #${market.onChainId} → ${result === 1 ? "YES" : "NO"}`);
        }
      } catch (err) {
        console.error(`[Resolution] Error resolving market #${market.onChainId}:`, err);
      }
    }
  } catch (err) {
    console.error("[Resolution] Poll error:", err);
  }
}

// ─── Start polling ───

export function startResolutionService() {
  if (!FACTORY_ADDRESS) {
    console.warn("[Resolution] No MARKET_FACTORY_ADDRESS set — skipping resolution polling");
    return;
  }

  console.log(`[Resolution] Polling every ${RESOLUTION_POLL_INTERVAL}ms`);
  setInterval(pollResolutions, RESOLUTION_POLL_INTERVAL);
}
