/**
 * Seed script — creates the first daily NAM market.
 *
 * Usage:
 *   bun --cwd apps/api run market:seed:daily
 *   bun --cwd apps/api run market:seed:daily 0.05
 *
 * This fetches the current NAM price from DexScreener and creates a daily
 * Required env for live seeding:
 *   PRIVATE_KEY, MARKET_FACTORY_ADDRESS, RPC_URL, DEXSCREENER_PAIR_ADDRESS
 *   DAILY_MARKET_LIQUIDITY controls initial USDC depth.
 *
 * This fetches the current NAM price from DexScreener and creates a daily
 * market with that price as the threshold. If no price can be fetched,
 * you must provide a threshold as a CLI argument:
 *
 *   bun run apps/api/src/scripts/seed-market.ts 0.05
 */
import { fetchNamPrice, createDailyMarket } from "../services/daily-market";

async function main() {
  console.log("[Seed] Starting daily market seed...");

  let threshold: number;

  // Check for CLI argument
  const cliThreshold = process.argv[2];
  if (cliThreshold) {
    threshold = parseFloat(cliThreshold);
    if (isNaN(threshold) || threshold <= 0) {
      console.error("[Seed] Invalid threshold:", cliThreshold);
      process.exit(1);
    }
    console.log(`[Seed] Using CLI-provided threshold: $${threshold}`);
  } else {
    // Try fetching from DexScreener
    console.log("[Seed] Fetching current NAM price from DexScreener...");
    const price = await fetchNamPrice();
    if (price === null) {
      console.error("[Seed] Could not fetch NAM price. Please provide a threshold as CLI argument:");
      console.error("  bun run apps/api/src/scripts/seed-market.ts <price>");
      process.exit(1);
    }
    threshold = price;
    console.log(`[Seed] Current NAM price: $${price}`);
  }

  try {
    await createDailyMarket(threshold);
    console.log("[Seed] Daily market created successfully!");
  } catch (err) {
    console.error("[Seed] Failed to create daily market:", err);
    process.exit(1);
  }

  process.exit(0);
}

main();
