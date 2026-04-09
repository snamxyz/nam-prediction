import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../db/client";
import { markets } from "../db/schema";
import { eq, and, lte, isNull } from "drizzle-orm";
import { MarketFactoryABI } from "@nam-prediction/shared";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;
const ORACLE_ENDPOINT = process.env.ORACLE_ENDPOINT || "";
const ORACLE_POLL_INTERVAL = Number(process.env.ORACLE_POLL_INTERVAL) || 60000;

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

  console.log(`[Oracle] Resolved market #${marketId} with result=${result}, tx=${txHash}`);
  return txHash;
}

// ─── Oracle polling service ───

async function pollOracle() {
  if (!ORACLE_ENDPOINT || !FACTORY_ADDRESS) return;

  try {
    // Find unresolved markets past their end time
    const unresolvedMarkets = await db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.resolved, false),
          lte(markets.endTime, new Date())
        )
      );

    for (const market of unresolvedMarkets) {
      try {
        // Fetch oracle data for this market
        const response = await fetch(
          `${ORACLE_ENDPOINT}?marketId=${market.onChainId}`
        );
        if (!response.ok) continue;

        const oracleData = await response.json();

        // The user said: "The endpoint will return a value from which
        // resolution direction will be calculated on this server's end"
        // Compute resolution from oracle value.
        // Users should customize this logic based on their oracle response format.
        const result = computeResolution(market, oracleData);

        if (result === 1 || result === 2) {
          await resolveMarketOnChain(market.onChainId, result);
          console.log(`[Oracle] Auto-resolved market #${market.onChainId} → ${result === 1 ? "YES" : "NO"}`);
        }
      } catch (err) {
        console.error(`[Oracle] Error resolving market #${market.onChainId}:`, err);
      }
    }
  } catch (err) {
    console.error("[Oracle] Poll error:", err);
  }
}

/// Customize this function based on your oracle endpoint response format.
/// Returns 1 for YES, 2 for NO, or 0 if unable to determine.
function computeResolution(market: any, oracleData: any): number {
  // Example: if the oracle returns { value: number, threshold: number }
  // and the question is "Will X exceed Y?", resolve YES if value >= threshold
  if (typeof oracleData.result === "number") {
    if (oracleData.result === 1) return 1; // YES
    if (oracleData.result === 2) return 2; // NO
  }

  // Fallback: if oracle returns a raw value + the market has threshold logic
  if (typeof oracleData.value === "number" && typeof oracleData.threshold === "number") {
    return oracleData.value >= oracleData.threshold ? 1 : 2;
  }

  return 0; // Unable to determine
}

// ─── Start polling ───

export function startOracleService() {
  if (!ORACLE_ENDPOINT) {
    console.warn("[Oracle] No ORACLE_ENDPOINT set — skipping oracle polling");
    return;
  }

  console.log(`[Oracle] Polling every ${ORACLE_POLL_INTERVAL}ms from ${ORACLE_ENDPOINT}`);
  setInterval(pollOracle, ORACLE_POLL_INTERVAL);
}
