/**
 * 24-hour market lifecycle service.
 *
 * Provides `createNextHourlyMarket()` which creates a new 24-hour NAM market
 * on-chain and inserts the corresponding DB row. The market resolves at
 * 00:00 Eastern Time the following day. Called automatically after the previous
 * 24h market resolves, and on server startup when no active 24h market exists.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseUnits,
  toHex,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { eq, and } from "drizzle-orm";
import { MarketFactoryABI, ERC20ABI } from "@nam-prediction/shared";
import { db } from "../db/client";
import { markets } from "../db/schema";
import { fetchNamPrice } from "./daily-market";
import { getNonceManager } from "../lib/nonce-manager.instance";
import { formatEasternMarketDay } from "../lib/market-display";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const DEFAULT_FEE_BPS = Number(process.env.DEFAULT_FEE_BPS) || 200;
const HOURLY_LIQUIDITY = Number(process.env.HOURLY_MARKET_LIQUIDITY || process.env.DAILY_MARKET_LIQUIDITY || 1);
const LOCK_WINDOW_SECONDS = Number(process.env.MARKET_LOCK_WINDOW_SECONDS || 10);

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");

  const normalizedPrivateKey = privateKey.startsWith("0x")
    ? privateKey
    : `0x${privateKey}`;

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

function formatEndLabel(endTime: Date): string {
  return endTime.toISOString().replace(".000Z", "Z");
}

/**
 * Returns the next 00:00 Eastern Time as a UTC Date, DST-aware.
 * Handles both EST (UTC-5) and EDT (UTC-4) without external libraries.
 */
function getNextMidnightET(): Date {
  const now = new Date();
  const todayET = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [y, m, d] = todayET.split("-").map(Number);
  const nextDayUTC = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = nextDayUTC.getUTCFullYear();
  const nm = String(nextDayUTC.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(nextDayUTC.getUTCDate()).padStart(2, "0");
  const tomorrowStr = `${ny}-${nm}-${nd}`;
  // Start at T05:00:00Z = midnight EST. During EDT (UTC-4) this is 01:00 ET.
  let candidate = new Date(`${tomorrowStr}T05:00:00Z`);
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

function formatETDate(midnightET: Date): string {
  return midnightET.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Check whether there is already an unresolved hourly market in the DB.
 */
export async function hasActiveHourlyMarket(): Promise<boolean> {
  const active = await db
    .select({ id: markets.id })
    .from(markets)
    .where(
      and(
        eq(markets.cadence, "24h"),
        eq(markets.resolved, false),
      )
    )
    .limit(1);

  return active.length > 0;
}

/**
 * Create the next 24-hour NAM market on-chain and insert it into the DB.
 *
 * @param comparison  ">=" or "<=" (default ">=")
 * @param threshold   Explicit price threshold. If omitted, fetches live NAM price.
 */
export async function createNextHourlyMarket(
  comparison: ">=" | "<=" = ">=",
  threshold?: number,
): Promise<{ onChainId: number }> {
  if (!FACTORY_ADDRESS) throw new Error("MARKET_FACTORY_ADDRESS not set");

  // If there's already an active hourly market, skip to prevent duplicates
  if (await hasActiveHourlyMarket()) {
    console.log("[24h] Active 24h market already exists — skipping creation");
    throw new Error("Active 24h market already exists");
  }

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const sender = walletClient.account.address;

  if (threshold === undefined) {
    const livePrice = await fetchNamPrice();
    if (livePrice === null) {
      throw new Error("Could not fetch NAM price from DexScreener");
    }
    threshold = livePrice;
  }

  const now = new Date();
  const endTime = getNextMidnightET();
  const etDate = formatETDate(endTime);
  const lockTime = new Date(endTime.getTime() - LOCK_WINDOW_SECONDS * 1000);
  const endTimeUnix = BigInt(Math.floor(endTime.getTime() / 1000));
  const lockTimeUnix = BigInt(Math.floor(lockTime.getTime() / 1000));

  const marketDay = formatEasternMarketDay(endTime);
  const question = marketDay
    ? `NAM Up or Down on ${marketDay}?`
    : `NAM Up or Down on ${etDate}?`;

  const resolutionConfig = {
    comparison,
    threshold,
    cadence: "24h",
    lockTime: lockTime.toISOString(),
    lockTimeUnix: Number(lockTimeUnix),
    pairAddress: process.env.DEXSCREENER_PAIR_ADDRESS || null,
  };
  const resolutionData = toHex(
    new TextEncoder().encode(JSON.stringify(resolutionConfig)),
  );

  const liquidityUsdc = parseUnits(String(HOURLY_LIQUIDITY), 6);

  console.log(`[24h] Creating next market — threshold: $${threshold.toFixed(6)} (${comparison})`);
  console.log(`[24h] Window: now=${now.toISOString()} lock=${lockTime.toISOString()} end=${endTime.toISOString()}`);

  // Approve + Create as two sequential transactions, each going through the
  // serialized nonce manager queue. Only one in-flight tx at a time is allowed
  // because Alchemy treats this EOA as a delegated account.
  const nm = getNonceManager();

  // Step 1: USDC Approval — bounded to this market's seed liquidity.
  const approveHash = await nm.withNonce((nonce) =>
    walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20ABI,
      functionName: "approve",
      args: [FACTORY_ADDRESS, liquidityUsdc],
      nonce,
    })
  );
  console.log(`[24h] Approve tx: ${approveHash}`);
  // Wait for on-chain confirmation before sending the next tx
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
        2, // dexscreener
        resolutionData,
      ],
      nonce,
    })
  );
  console.log(`[24h] Create tx: ${createHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

  let onChainId: number | null = null;
  let yesToken = "";
  let noToken = "";
  let liquidityPool = "";

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: MarketFactoryABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "MarketCreated") {
        onChainId = Number(decoded.args.marketId);
        yesToken = decoded.args.yesToken as string;
        noToken = decoded.args.noToken as string;
        liquidityPool = decoded.args.liquidityPool as string;
        break;
      }
    } catch {
      // Ignore unrelated logs.
    }
  }

  if (onChainId === null) {
    throw new Error("MarketCreated event not found in transaction receipt");
  }

  // Insert into DB (the indexer may also insert — onConflictDoNothing handles races)
  await db
    .insert(markets)
    .values({
      onChainId,
      question,
      yesToken,
      noToken,
      ammAddress: liquidityPool,
      executionMode: "amm",
      cadence: "24h",
      status: "open",
      lockTime,
      endTime,
      resolved: false,
      result: 0,
      yesPrice: 0.5,
      noPrice: 0.5,
      volume: "0",
      liquidity: HOURLY_LIQUIDITY.toString(),
      seededLiquidity: HOURLY_LIQUIDITY.toString(),
      resolutionSource: "dexscreener",
      resolutionConfig,
    })
    .onConflictDoNothing();

  // Ensure 24h-specific fields are set (in case indexer inserted the row first)
  await db
    .update(markets)
    .set({
      cadence: "24h",
      status: "open",
      lockTime,
      endTime,
      liquidity: HOURLY_LIQUIDITY.toString(),
      seededLiquidity: HOURLY_LIQUIDITY.toString(),
      resolutionSource: "dexscreener",
      resolutionConfig,
    })
    .where(eq(markets.onChainId, onChainId));

  console.log(`[24h] Market created successfully. onChainId=${onChainId}`);
  console.log(`[24h] Question: ${question}`);
  console.log(`[24h] Pool: ${liquidityPool}`);

  return { onChainId };
}
