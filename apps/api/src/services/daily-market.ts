import { createWalletClient, createPublicClient, http, encodePacked, parseUnits, toHex } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../db/client";
import { dailyMarkets, markets } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { MarketFactoryABI, ERC20ABI } from "@nam-prediction/shared";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b4CF1daEdda") as `0x${string}`;
const DEFAULT_FEE_BPS = Number(process.env.DEFAULT_FEE_BPS) || 200;
const DAILY_MARKET_LIQUIDITY = Number(process.env.DAILY_MARKET_LIQUIDITY) || 100; // USDC

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");
  const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
  return createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });
}

function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(RPC_URL),
  });
}

/**
 * Fetch current NAM/USDC price from DexScreener.
 * Returns the price in USD or null if unavailable.
 */
export async function fetchNamPrice(): Promise<number | null> {
  const pairAddress = process.env.DEXSCREENER_PAIR_ADDRESS;
  if (!pairAddress) {
    console.warn("[DailyMarket] DEXSCREENER_PAIR_ADDRESS not set");
    return null;
  }

  try {
    const url = `https://api.dexscreener.com/latest/dex/pairs/base/${pairAddress}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const pair = data.pair;
    if (!pair?.priceUsd) return null;

    return Number(pair.priceUsd);
  } catch (err) {
    console.error("[DailyMarket] Failed to fetch NAM price:", err);
    return null;
  }
}

/**
 * Get the next 00:00 UTC timestamp from now.
 */
function getNextMidnightUTC(): Date {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return tomorrow;
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Create a daily NAM price prediction market on-chain and track it in DB.
 */
export async function createDailyMarket(threshold: number): Promise<void> {
  if (!FACTORY_ADDRESS) throw new Error("MARKET_FACTORY_ADDRESS not set");

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const account = walletClient.account;

  const endTime = getNextMidnightUTC();
  const endTimeUnix = BigInt(Math.floor(endTime.getTime() / 1000));
  const dateStr = formatDate(endTime);

  // Check if a market already exists for this date
  const existing = await db
    .select()
    .from(dailyMarkets)
    .where(eq(dailyMarkets.date, dateStr))
    .limit(1);

  if (existing.length > 0) {
    console.log(`[DailyMarket] Market for ${dateStr} already exists — skipping`);
    return;
  }

  const question = `Will NAM be above $${threshold.toFixed(6)} at 00:00 UTC on ${dateStr}?`;
  const liquidityUsdc = parseUnits(String(DAILY_MARKET_LIQUIDITY), 6);

  // Resolution source = 2 (dexscreener), encode config as JSON bytes
  const resolutionConfig = JSON.stringify({ comparison: ">=", threshold });
  const resolutionData = toHex(new TextEncoder().encode(resolutionConfig));

  console.log(`[DailyMarket] Creating market: "${question}" with $${DAILY_MARKET_LIQUIDITY} USDC liquidity`);

  // Insert a "creating" record first
  await db.insert(dailyMarkets).values({
    date: dateStr,
    threshold: threshold.toString(),
    status: "creating",
  });

  try {
    // Approve USDC for the factory
    const approveHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20ABI,
      functionName: "approve",
      args: [FACTORY_ADDRESS, liquidityUsdc],
    });
    console.log(`[DailyMarket] USDC approval tx: ${approveHash}`);

    // Wait for approval
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Create market on-chain
    const createHash = await walletClient.writeContract({
      address: FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      functionName: "createMarket",
      args: [
        question,
        endTimeUnix,
        liquidityUsdc,
        BigInt(DEFAULT_FEE_BPS),
        2, // SOURCE_DEXSCREENER
        resolutionData as `0x${string}`,
      ],
    });
    console.log(`[DailyMarket] Market creation tx: ${createHash}`);

    // Wait for the tx to be mined — the indexer will pick up the MarketCreated event
    // and create the row in the markets table
    await publicClient.waitForTransactionReceipt({ hash: createHash });
    console.log(`[DailyMarket] Market created for ${dateStr} with threshold $${threshold}`);

    // The daily_markets row will be linked to the markets row after the indexer processes the event
    // For now, we update status to 'active'. The market_id will be linked later.
    await db
      .update(dailyMarkets)
      .set({ status: "active" })
      .where(eq(dailyMarkets.date, dateStr));

  } catch (err) {
    console.error(`[DailyMarket] Failed to create market for ${dateStr}:`, err);
    // Clean up the "creating" record
    await db
      .update(dailyMarkets)
      .set({ status: "creating" })
      .where(eq(dailyMarkets.date, dateStr));
    throw err;
  }
}

/**
 * Get the currently active daily market.
 */
export async function getActiveDailyMarket() {
  const result = await db
    .select()
    .from(dailyMarkets)
    .where(eq(dailyMarkets.status, "active"))
    .orderBy(desc(dailyMarkets.createdAt))
    .limit(1);

  return result[0] || null;
}

/**
 * Get the most recently resolved daily market (to find the last settlement price).
 */
export async function getLastResolvedDailyMarket() {
  const result = await db
    .select()
    .from(dailyMarkets)
    .where(eq(dailyMarkets.status, "resolved"))
    .orderBy(desc(dailyMarkets.createdAt))
    .limit(1);

  return result[0] || null;
}
