import { resolveMarketOnChain } from "../resolution";
import { createNextM15Market } from "../m15-market";
import type { MarketRow } from "../../db/schema";

const DEXSCREENER_PAIR_ADDRESS = process.env.DEXSCREENER_PAIR_ADDRESS || "";
const BASE_CHAIN = "base";

/**
 * DexScreener resolver — resolves markets based on NAM/USDC price from DexScreener.
 * Config shape: { comparison: '>=' | '<=', threshold: number }
 */
export async function resolveDexScreener(market: MarketRow): Promise<void> {
  if (!DEXSCREENER_PAIR_ADDRESS) {
    console.warn(`[DexScreener] DEXSCREENER_PAIR_ADDRESS not set — skipping market #${market.onChainId}`);
    return;
  }

  const config = market.resolutionConfig as {
    comparison: string;
    threshold: number;
  } | null;

  if (!config?.threshold) {
    console.warn(`[DexScreener] Market #${market.onChainId}: missing resolution config`);
    return;
  }

  try {
    const url = `https://api.dexscreener.com/latest/dex/pairs/${BASE_CHAIN}/${DEXSCREENER_PAIR_ADDRESS}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[DexScreener] API error ${response.status} for market #${market.onChainId}`);
      return;
    }

    const data = await response.json();
    const pair = data.pair;

    if (!pair || !pair.priceUsd) {
      console.warn(`[DexScreener] No price data for pair ${DEXSCREENER_PAIR_ADDRESS}`);
      return;
    }

    const price = Number(pair.priceUsd);
    const threshold = config.threshold;
    const isPastEnd = new Date() >= new Date(market.endTime);

    let conditionMet = false;
    switch (config.comparison) {
      case ">=":
        conditionMet = price >= threshold;
        break;
      case "<=":
        conditionMet = price <= threshold;
        break;
      default:
        console.warn(`[DexScreener] Market #${market.onChainId}: unknown comparison "${config.comparison}"`);
        return;
    }

    if (conditionMet) {
      console.log(`[DexScreener] Market #${market.onChainId}: NAM price $${price} ${config.comparison} $${threshold} → YES`);
      await resolveMarketOnChain(market.onChainId, 1);
      await maybeCreateNextM15(market, price);
    } else if (isPastEnd) {
      console.log(`[DexScreener] Market #${market.onChainId}: past end time, price $${price} didn't meet threshold → NO`);
      await resolveMarketOnChain(market.onChainId, 2);
      await maybeCreateNextM15(market, price);
    } else {
      console.log(`[DexScreener] Market #${market.onChainId}: NAM price $${price}, threshold $${threshold} — waiting...`);
    }
  } catch (err) {
    console.error(`[DexScreener] Error fetching price for market #${market.onChainId}:`, err);
  }
}

/**
 * After resolving an m15 market, automatically create the next one.
 */
async function maybeCreateNextM15(market: MarketRow, currentPrice: number): Promise<void> {
  if (market.cadence !== "m15") return;

  try {
    console.log(`[DexScreener] Creating next m15 market with threshold $${currentPrice}`);
    await createNextM15Market(">=", currentPrice);
    console.log("[DexScreener] Next m15 market created successfully");
  } catch (err) {
    console.error("[DexScreener] Failed to create next m15 market:", err);
    // Don't throw — the resolution itself already succeeded
  }
}
