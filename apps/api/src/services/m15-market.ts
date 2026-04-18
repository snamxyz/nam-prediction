/**
 * 15-minute market lifecycle service.
 *
 * Provides `createNextM15Market()` which creates a new 15-minute NAM market
 * on-chain and inserts the corresponding DB row. Called automatically after
 * the previous m15 market resolves, and on server startup when no active m15
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
const M15_LIQUIDITY = Number(process.env.M15_MARKET_LIQUIDITY || process.env.DAILY_MARKET_LIQUIDITY || 1);
const DURATION_MINUTES = Number(process.env.M15_MARKET_DURATION_MINUTES || 15);
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
 * Check whether there is already an unresolved m15 market in the DB.
 */
export async function hasActiveM15Market(): Promise<boolean> {
  const active = await db
    .select({ id: markets.id })
    .from(markets)
    .where(
      and(
        eq(markets.cadence, "m15"),
        eq(markets.resolved, false),
      )
    )
    .limit(1);

  return active.length > 0;
}

/**
 * Create the next 15-minute NAM market on-chain and insert it into the DB.
 *
 * @param comparison  ">=" or "<=" (default ">=")
 * @param threshold   Explicit price threshold. If omitted, fetches live NAM price.
 */
export async function createNextM15Market(
  comparison: ">=" | "<=" = ">=",
  threshold?: number,
): Promise<{ onChainId: number }> {
  if (!FACTORY_ADDRESS) throw new Error("MARKET_FACTORY_ADDRESS not set");

  // If there's already an active m15 market, skip to prevent duplicates
  if (await hasActiveM15Market()) {
    console.log("[M15] Active m15 market already exists — skipping creation");
    throw new Error("Active m15 market already exists");
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
    cadence: "m15",
    lockTime: lockTime.toISOString(),
    lockTimeUnix: Number(lockTimeUnix),
    pairAddress: process.env.DEXSCREENER_PAIR_ADDRESS || null,
  };
  const resolutionData = toHex(
    new TextEncoder().encode(JSON.stringify(resolutionConfig)),
  );

  const liquidityUsdc = parseUnits(String(M15_LIQUIDITY), 6);
  const approvalAmount = (1n << 256n) - 1n;

  console.log(`[M15] Creating next market — threshold: $${threshold.toFixed(6)} (${comparison})`);
  console.log(`[M15] Window: now=${now.toISOString()} lock=${lockTime.toISOString()} end=${endTime.toISOString()}`);

  // Approve + Create with sequential nonces, serialised by the nonce manager
  // to prevent nonce collisions across multiple backend instances.
  const nm = getNonceManager();
  const receipt = await nm.withMultiNonce(2, async ([approveNonce, createNonce]) => {
    const approveHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20ABI,
      functionName: "approve",
      args: [FACTORY_ADDRESS, approvalAmount],
      nonce: approveNonce,
    });
    console.log(`[M15] Approve tx: ${approveHash}`);
    await nm.markNonceUsed(approveNonce, approveHash);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    await nm.markNonceConfirmed(approveNonce);

    const createHash = await walletClient.writeContract({
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
      nonce: createNonce,
    });
    console.log(`[M15] Create tx: ${createHash}`);
    await nm.markNonceUsed(createNonce, createHash);

    const txReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    await nm.markNonceConfirmed(createNonce);
    return txReceipt;
  });

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
      cadence: "m15",
      status: "open",
      lockTime,
      endTime,
      resolved: false,
      result: 0,
      yesPrice: 0.5,
      noPrice: 0.5,
      volume: "0",
      liquidity: M15_LIQUIDITY.toString(),
      resolutionSource: "dexscreener",
      resolutionConfig,
    })
    .onConflictDoNothing();

  // Ensure m15-specific fields are set (in case indexer inserted the row first)
  await db
    .update(markets)
    .set({
      cadence: "m15",
      status: "open",
      lockTime,
      endTime,
      resolutionSource: "dexscreener",
      resolutionConfig,
    })
    .where(eq(markets.onChainId, onChainId));

  console.log(`[M15] Market created successfully. onChainId=${onChainId}`);
  console.log(`[M15] Question: ${question}`);
  console.log(`[M15] Pool: ${liquidityPool}`);

  return { onChainId };
}
