/**
 * 1-hour market lifecycle service.
 *
 * Provides `createNextHourlyMarket()` which creates a new 1-hour NAM market
 * on-chain and inserts the corresponding DB row. Called automatically after
 * the previous hourly market resolves, and on server startup when no active hourly
 * market exists.
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

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const DEFAULT_FEE_BPS = Number(process.env.DEFAULT_FEE_BPS) || 200;
const HOURLY_LIQUIDITY = Number(process.env.HOURLY_MARKET_LIQUIDITY || process.env.DAILY_MARKET_LIQUIDITY || 1);
const DURATION_MINUTES = Number(process.env.HOURLY_MARKET_DURATION_MINUTES || 60);
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
 * Check whether there is already an unresolved hourly market in the DB.
 */
export async function hasActiveHourlyMarket(): Promise<boolean> {
  const active = await db
    .select({ id: markets.id })
    .from(markets)
    .where(
      and(
        eq(markets.cadence, "1h"),
        eq(markets.resolved, false),
      )
    )
    .limit(1);

  return active.length > 0;
}

/**
 * Create the next 1-hour NAM market on-chain and insert it into the DB.
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
    console.log("[Hourly] Active hourly market already exists — skipping creation");
    throw new Error("Active hourly market already exists");
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
  const endTime = new Date(now.getTime() + DURATION_MINUTES * 60 * 1000);
  const lockTime = new Date(endTime.getTime() - LOCK_WINDOW_SECONDS * 1000);
  const endTimeUnix = BigInt(Math.floor(endTime.getTime() / 1000));
  const lockTimeUnix = BigInt(Math.floor(lockTime.getTime() / 1000));

  const question = `Will NAM be ${comparison} $${threshold.toFixed(6)} at ${formatEndLabel(endTime)}?`;

  const resolutionConfig = {
    comparison,
    threshold,
    cadence: "1h",
    lockTime: lockTime.toISOString(),
    lockTimeUnix: Number(lockTimeUnix),
    pairAddress: process.env.DEXSCREENER_PAIR_ADDRESS || null,
  };
  const resolutionData = toHex(
    new TextEncoder().encode(JSON.stringify(resolutionConfig)),
  );

  const liquidityUsdc = parseUnits(String(HOURLY_LIQUIDITY), 6);
  const approvalAmount = (1n << 256n) - 1n;

  console.log(`[Hourly] Creating next market — threshold: $${threshold.toFixed(6)} (${comparison})`);
  console.log(`[Hourly] Window: now=${now.toISOString()} lock=${lockTime.toISOString()} end=${endTime.toISOString()}`);

  // Approve + Create as two sequential transactions, each going through the
  // serialized nonce manager queue. Only one in-flight tx at a time is allowed
  // because Alchemy treats this EOA as a delegated account.
  const nm = getNonceManager();

  // Step 1: USDC Approval — withNonce handles nonce assignment + active_tx tracking
  const approveHash = await nm.withNonce((nonce) =>
    walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20ABI,
      functionName: "approve",
      args: [FACTORY_ADDRESS, approvalAmount],
      nonce,
    })
  );
  console.log(`[Hourly] Approve tx: ${approveHash}`);
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
  console.log(`[Hourly] Create tx: ${createHash}`);
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
      cadence: "1h",
      status: "open",
      lockTime,
      endTime,
      resolved: false,
      result: 0,
      yesPrice: 0.5,
      noPrice: 0.5,
      volume: "0",
      liquidity: HOURLY_LIQUIDITY.toString(),
      resolutionSource: "dexscreener",
      resolutionConfig,
    })
    .onConflictDoNothing();

  // Ensure hourly-specific fields are set (in case indexer inserted the row first)
  await db
    .update(markets)
    .set({
      cadence: "1h",
      status: "open",
      lockTime,
      endTime,
      resolutionSource: "dexscreener",
      resolutionConfig,
    })
    .where(eq(markets.onChainId, onChainId));

  console.log(`[Hourly] Market created successfully. onChainId=${onChainId}`);
  console.log(`[Hourly] Question: ${question}`);
  console.log(`[Hourly] Pool: ${liquidityPool}`);

  return { onChainId };
}
