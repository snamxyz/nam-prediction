import { createWalletClient, createPublicClient, decodeEventLog, http, parseUnits, toHex } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../db/client";
import { dailyMarkets, markets } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { MarketFactoryABI, ERC20ABI } from "@nam-prediction/shared";
import { getNonceManager } from "../lib/nonce-manager.instance";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const DEFAULT_FEE_BPS = Number(process.env.DEFAULT_FEE_BPS) || 200;
const DAILY_MARKET_LIQUIDITY = Number(process.env.DAILY_MARKET_LIQUIDITY) || 100; // USDC

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");
  const normalizedPrivateKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(normalizedPrivateKey as `0x${string}`);
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

export type NamPriceData = {
  price: number;
  iconUrl: string | null;
};

/**
 * Fetch current NAM/USDC price from DexScreener, with token icon URL.
 * Returns null if the price is unavailable.
 */
export async function fetchNamPriceEnriched(): Promise<NamPriceData | null> {
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

    return {
      price: Number(pair.priceUsd),
      iconUrl: (pair.info?.imageUrl as string | undefined) ?? null,
    };
  } catch (err) {
    console.error("[DailyMarket] Failed to fetch NAM price:", err);
    return null;
  }
}

/**
 * Fetch current NAM/USDC price from DexScreener.
 * Returns the price in USD or null if unavailable.
 */
export async function fetchNamPrice(): Promise<number | null> {
  const result = await fetchNamPriceEnriched();
  return result?.price ?? null;
}

/**
 * Get the next 00:00 Eastern timestamp from now.
 */
function getNextMidnightET(): Date {
  const now = new Date();
  const todayET = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [y, m, d] = todayET.split("-").map(Number);
  const nextDayUTC = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = nextDayUTC.getUTCFullYear();
  const nm = String(nextDayUTC.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(nextDayUTC.getUTCDate()).padStart(2, "0");
  let candidate = new Date(`${ny}-${nm}-${nd}T05:00:00Z`);
  const etHour =
    Number(
      candidate
        .toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
        .split(":")[0]
    ) % 24;
  if (etHour !== 0) {
    candidate = new Date(candidate.getTime() - etHour * 60 * 60 * 1000);
  }
  return candidate;
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Format a date as e.g. "April 25".
 */
function formatMarketDate(date: Date): string {
  const marketDay = new Date(date.getTime() - 1);
  return marketDay.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * Create a daily NAM price prediction market on-chain and track it in DB.
 */
export async function createDailyMarket(threshold: number): Promise<void> {
  if (!FACTORY_ADDRESS) throw new Error("MARKET_FACTORY_ADDRESS not set");

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const account = walletClient.account;

  const endTime = getNextMidnightET();
  const endTimeUnix = BigInt(Math.floor(endTime.getTime() / 1000));
  const dateStr = formatDate(endTime);

  // Check if a market already exists for this date
  const existing = await db
    .select()
    .from(dailyMarkets)
    .where(eq(dailyMarkets.date, dateStr))
    .limit(1);

  if (existing.length > 0 && !["failed", "cancelled"].includes(existing[0].status)) {
    console.log(`[DailyMarket] Market for ${dateStr} already exists — skipping`);
    return;
  }
  if (existing.length > 0) {
    console.warn(`[DailyMarket] Retrying ${dateStr} after previous ${existing[0].status} state`);
    await db.delete(dailyMarkets).where(eq(dailyMarkets.id, existing[0].id));
  }

  const question = `NAM Up or Down on ${formatMarketDate(endTime)}?`;
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
    // Approve + Create as two sequential transactions, each going through the
    // serialized nonce manager queue. Only one in-flight tx at a time is allowed
    // because Alchemy treats this EOA as a delegated account.
    const nm = getNonceManager();

    // Step 1: USDC Approval
    const approveHash = await nm.withNonce((nonce) =>
      walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [FACTORY_ADDRESS, liquidityUsdc],
        nonce,
      })
    );
    console.log(`[DailyMarket] USDC approval tx: ${approveHash}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Step 2: Market Creation — the queue's waitForNoInFlight() will verify
    // the approve tx is confirmed on-chain before assigning the next nonce.
    const createHash = await nm.withNonce((nonce) =>
      walletClient.writeContract({
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
        nonce,
      })
    );
    console.log(`[DailyMarket] Market creation tx: ${createHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    if (receipt.status !== "success") {
      throw new Error(`Market creation tx reverted (status=${receipt.status})`);
    }
    console.log(`[DailyMarket] Market created for ${dateStr} with threshold $${threshold}`);

    let createdOnChainId: number | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: MarketFactoryABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "MarketCreated") {
          createdOnChainId = Number(decoded.args.marketId);
          break;
        }
      } catch {
        // Ignore unrelated logs emitted by token approvals/transfers.
      }
    }

    // Give the indexer a few seconds to process the MarketCreated event
    await new Promise((r) => setTimeout(r, 5000));

    // Try to link the daily_markets row to the newly indexed market
    let linkedMarketId: number | null = null;
    if (createdOnChainId != null) {
      const created = await db
        .select()
        .from(markets)
        .where(eq(markets.onChainId, createdOnChainId))
        .limit(1);
      linkedMarketId = created[0]?.id ?? null;
    }

    if (linkedMarketId == null) {
      const recentMarkets = await db
        .select()
        .from(markets)
        .where(eq(markets.resolved, false))
        .orderBy(desc(markets.createdAt));

      for (const m of recentMarkets) {
        if (m.question.includes(formatMarketDate(endTime)) && m.resolutionSource === "dexscreener") {
          linkedMarketId = m.id;
          break;
        }
      }
    }

    await db
      .update(dailyMarkets)
      .set({ status: "active", marketId: linkedMarketId })
      .where(eq(dailyMarkets.date, dateStr));

    if (linkedMarketId) {
      await db
        .update(markets)
        .set({
          liquidity: DAILY_MARKET_LIQUIDITY.toString(),
          seededLiquidity: DAILY_MARKET_LIQUIDITY.toString(),
        })
        .where(eq(markets.id, linkedMarketId));
      console.log(`[DailyMarket] Linked daily market to markets.id=${linkedMarketId}`);
    } else {
      console.warn(`[DailyMarket] Could not link market yet — fallback will resolve later`);
    }

  } catch (err) {
    console.error(`[DailyMarket] Failed to create market for ${dateStr}:`, err);
    await db
      .update(dailyMarkets)
      .set({ status: "failed" })
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
