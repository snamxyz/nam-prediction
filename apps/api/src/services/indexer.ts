import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { db } from "../db/client";
import { markets, trades, userPositions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { MarketFactoryABI, CPMMABI } from "@nam-prediction/shared";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

// Track which pools we're already watching so we don't double-subscribe
const watchedPools = new Set<string>();

// ─── BigInt-safe balance helpers ───

function addBigIntStrings(a: string, b: string): string {
  return (BigInt(a || "0") + BigInt(b || "0")).toString();
}

function subBigIntStrings(a: string, b: string): string {
  const result = BigInt(a || "0") - BigInt(b || "0");
  return result < 0n ? "0" : result.toString();
}

// ─── Event handlers ───

async function handleMarketCreated(log: any) {
  const { marketId, yesToken, noToken, liquidityPool, question, endTime, resolutionSource, resolutionData } = log.args;
  console.log(`[Indexer] MarketCreated #${marketId}: "${question}" (source=${resolutionSource})`);

  // Map on-chain resolution source ID to string
  const sourceMap: Record<number, string> = {
    0: "admin",
    1: "api",
    2: "dexscreener",
  };
  const sourceStr = sourceMap[Number(resolutionSource)] || "admin";

  // Decode resolutionData as JSON config (if present)
  let resolutionConfig = null;
  if (resolutionData && resolutionData !== "0x") {
    try {
      const decoded = Buffer.from(resolutionData.slice(2), "hex").toString("utf-8");
      resolutionConfig = JSON.parse(decoded);
    } catch {
      // resolutionData may be raw bytes — store as-is
      resolutionConfig = { raw: resolutionData };
    }
  }

  await db
    .insert(markets)
    .values({
      onChainId: Number(marketId),
      question: question,
      yesToken: yesToken,
      noToken: noToken,
      ammAddress: liquidityPool,
      endTime: new Date(Number(endTime) * 1000),
      resolved: false,
      result: 0,
      yesPrice: 0.5,
      noPrice: 0.5,
      volume: "0",
      liquidity: "0",
      resolutionSource: sourceStr,
      resolutionConfig: resolutionConfig,
    })
    .onConflictDoNothing();

  // Start watching Trade events on this pool
  watchTradesForPool(liquidityPool as `0x${string}`);
}

async function handleTrade(log: any) {
  const { marketId, trader, isYes, isBuy, shares, collateral: col } = log.args;
  console.log(`[Indexer] Trade on market #${marketId} by ${trader}`);

  // Find the DB market
  const market = await db
    .select()
    .from(markets)
    .where(eq(markets.onChainId, Number(marketId)))
    .limit(1);

  if (market.length === 0) return;
  const dbMarket = market[0];

  // Insert trade
  await db.insert(trades).values({
    marketId: dbMarket.id,
    trader: trader.toLowerCase(),
    isYes: isYes,
    isBuy: isBuy,
    shares: shares.toString(),
    collateral: col.toString(),
    txHash: log.transactionHash,
  });

  // Update market prices from AMM
  try {
    const [yesPrice, noPrice] = await publicClient.readContract({
      address: dbMarket.ammAddress as `0x${string}`,
      abi: CPMMABI,
      functionName: "getPrices",
    }) as [bigint, bigint];

    const yesPriceNum = Number(yesPrice) / 1e18;
    const noPriceNum = Number(noPrice) / 1e18;

    await db
      .update(markets)
      .set({
        yesPrice: yesPriceNum,
        noPrice: noPriceNum,
        volume: (Number(dbMarket.volume) + Number(col) / 1e6).toString(),
      })
      .where(eq(markets.id, dbMarket.id));
  } catch (err) {
    console.error("[Indexer] Failed to update prices:", err);
  }

  // Update user position
  const traderAddr = trader.toLowerCase();
  const existing = await db
    .select()
    .from(userPositions)
    .where(
      and(
        eq(userPositions.marketId, dbMarket.id),
        eq(userPositions.userAddress, traderAddr)
      )
    )
    .limit(1);

  const sharesStr = shares.toString();
  if (existing.length === 0) {
    await db.insert(userPositions).values({
      marketId: dbMarket.id,
      userAddress: traderAddr,
      yesBalance: isYes && isBuy ? sharesStr : "0",
      noBalance: !isYes && isBuy ? sharesStr : "0",
      avgEntryPrice: 0,
      pnl: "0",
    });
  } else {
    const pos = existing[0];

    let newYes = pos.yesBalance;
    let newNo = pos.noBalance;
    if (isYes) {
      newYes = isBuy
        ? addBigIntStrings(pos.yesBalance, sharesStr)
        : subBigIntStrings(pos.yesBalance, sharesStr);
    } else {
      newNo = isBuy
        ? addBigIntStrings(pos.noBalance, sharesStr)
        : subBigIntStrings(pos.noBalance, sharesStr);
    }

    await db
      .update(userPositions)
      .set({ yesBalance: newYes, noBalance: newNo })
      .where(eq(userPositions.id, pos.id));
  }
}

async function handleMarketResolved(log: any) {
  const { marketId, result } = log.args;
  console.log(`[Indexer] MarketResolved #${marketId} → ${result === 1 ? "YES" : "NO"}`);

  await db
    .update(markets)
    .set({ resolved: true, result: Number(result) })
    .where(eq(markets.onChainId, Number(marketId)));
}

async function handleRedeemed(log: any) {
  const { marketId, user, amount } = log.args;
  console.log(`[Indexer] Redeemed on market #${marketId} by ${user}: ${amount}`);

  // Find the DB market
  const market = await db
    .select()
    .from(markets)
    .where(eq(markets.onChainId, Number(marketId)))
    .limit(1);

  if (market.length === 0) return;
  const dbMarket = market[0];
  const userAddr = (user as string).toLowerCase();

  // Zero out the winning side balance for this user
  const updates: Record<string, string> =
    dbMarket.result === 1 ? { yesBalance: "0" } : { noBalance: "0" };

  await db
    .update(userPositions)
    .set(updates)
    .where(
      and(
        eq(userPositions.marketId, dbMarket.id),
        eq(userPositions.userAddress, userAddr)
      )
    );
}

// ─── Start watching events ───

export async function startIndexer() {
  if (!FACTORY_ADDRESS) {
    console.warn("[Indexer] No MARKET_FACTORY_ADDRESS set — skipping event indexing");
    return;
  }

  console.log(`[Indexer] Watching events on factory: ${FACTORY_ADDRESS}`);

  // Watch MarketCreated
  publicClient.watchContractEvent({
    address: FACTORY_ADDRESS,
    abi: MarketFactoryABI,
    eventName: "MarketCreated",
    onLogs: (logs) => logs.forEach(handleMarketCreated),
  });

  // Watch MarketResolved
  publicClient.watchContractEvent({
    address: FACTORY_ADDRESS,
    abi: MarketFactoryABI,
    eventName: "MarketResolved",
    onLogs: (logs) => logs.forEach(handleMarketResolved),
  });

  // Watch Redeemed
  publicClient.watchContractEvent({
    address: FACTORY_ADDRESS,
    abi: MarketFactoryABI,
    eventName: "Redeemed",
    onLogs: (logs) => logs.forEach(handleRedeemed),
  });

  // Start watching Trade events for all existing markets in DB
  try {
    const existingMarkets = await db.select().from(markets);
    for (const m of existingMarkets) {
      watchTradesForPool(m.ammAddress as `0x${string}`);
    }
    console.log(`[Indexer] Watching trades for ${existingMarkets.length} existing pool(s)`);
  } catch (err) {
    console.error("[Indexer] Failed to load existing markets for trade watching:", err);
  }

  console.log("[Indexer] Event watchers started");
}

/// Watch Trade events for a specific CPMM pool (idempotent — safe to call multiple times)
export function watchTradesForPool(ammAddress: `0x${string}`) {
  const key = ammAddress.toLowerCase();
  if (watchedPools.has(key)) return;
  watchedPools.add(key);

  console.log(`[Indexer] Watching trades on pool: ${ammAddress}`);
  publicClient.watchContractEvent({
    address: ammAddress,
    abi: CPMMABI,
    eventName: "Trade",
    onLogs: (logs) => logs.forEach(handleTrade),
  });
}
