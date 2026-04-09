import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../db/client";
import { markets } from "../db/schema";
import { eq, and, lte } from "drizzle-orm";
import { MarketFactoryABI } from "@nam-prediction/shared";
import { resolveInternal } from "./resolvers/internal";
import { resolveDexScreener } from "./resolvers/dexscreener";
import { resolveUma } from "./resolvers/uma";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;
const RESOLUTION_POLL_INTERVAL = Number(process.env.RESOLUTION_POLL_INTERVAL) || 60000;

// ─── Resolve a single market on-chain (used by internal + dexscreener resolvers) ───

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
    // Find all unresolved markets
    const unresolvedMarkets = await db
      .select()
      .from(markets)
      .where(eq(markets.resolved, false));

    for (const market of unresolvedMarkets) {
      try {
        switch (market.resolutionSource) {
          case "internal":
            await resolveInternal(market);
            break;
          case "dexscreener":
            await resolveDexScreener(market);
            break;
          case "uma":
            await resolveUma(market);
            break;
          case "admin":
            // Admin markets are resolved manually via /admin/resolve endpoint
            break;
          default:
            console.warn(`[Resolution] Market #${market.onChainId}: unknown source "${market.resolutionSource}"`);
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
