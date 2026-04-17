import { createPublicClient, http, formatUnits, parseUnits } from "viem";
import { base } from "viem/chains";
import { db } from "../db/client";
import { markets, trades, userPositions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { MarketFactoryABI, CPMMABI, VaultABI } from "@nam-prediction/shared";
import { publishEvent, setCache, cacheKeys } from "../lib/redis";

// `RPC_URL` drives reads (indexer polling, multicalls, balance lookups).
// Writes can optionally go through a different endpoint via `WRITE_RPC_URL`
// (see trading.ts). This lets operators point reads at a paid/high-throughput
// provider while still broadcasting transactions via any URL they trust.
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}` | undefined;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS as `0x${string}` | undefined;

// Slow event polling by default. Base produces a block every ~2s, but the
// public RPC is rate-limited aggressively, so we back off unless the operator
// sets a dedicated endpoint.
const IS_PUBLIC_RPC = /mainnet\.base\.org$/.test(new URL(RPC_URL).host);
const POLLING_INTERVAL_MS = Number(
  process.env.INDEXER_POLLING_MS || (IS_PUBLIC_RPC ? 12_000 : 4_000)
);

if (IS_PUBLIC_RPC) {
  console.warn(
    "[Indexer] Using the public Base RPC (mainnet.base.org). It is heavily " +
      "rate-limited and will drop event polling and readContract calls. " +
      "Set RPC_URL in apps/api/.env to a dedicated endpoint " +
      "(Alchemy / QuickNode / Ankr / Base paid tier)."
  );
}

export const publicClient = createPublicClient({
  chain: base,
  pollingInterval: POLLING_INTERVAL_MS,
  transport: http(RPC_URL, {
    // Coalesce concurrent reads into eth_multicall-style JSON-RPC batches.
    batch: { batchSize: 64, wait: 16 },
    // Retry transient 429 / network errors with exponential backoff.
    retryCount: 4,
    retryDelay: 400,
    timeout: 20_000,
  }),
});

// Track which pools we're already watching so we don't double-subscribe
const watchedPools = new Set<string>();

// ─── Balance math (decimal-string safe) ───
//
// Positions are stored as `numeric(30, 18)` decimal strings (e.g. "0.0001234").
// `BigInt(...)` only accepts integers, so we scale through wei before adding
// or subtracting and then format back to the DB's decimal representation.

function toWei(decimalStr: string | null | undefined): bigint {
  const s = (decimalStr ?? "0").trim();
  if (!s) return 0n;
  try {
    return parseUnits(s, 18);
  } catch {
    return 0n;
  }
}

function addBigIntStrings(a: string, b: string): string {
  return formatUnits(toWei(a) + toWei(b), 18);
}

function subBigIntStrings(a: string, b: string): string {
  const r = toWei(a) - toWei(b);
  return formatUnits(r < 0n ? 0n : r, 18);
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

// ─── Core trade-fill processor (reused by event watcher + /trading routes) ───

export interface TradeFillInput {
  /// On-chain marketId (the `marketId` indexed event arg)
  onChainMarketId: bigint | number;
  trader: string;
  isYes: boolean;
  isBuy: boolean;
  shares: bigint; // 18 decimals
  collateral: bigint; // 6 decimals
  txHash: string;
}

/// Insert the trade, update the market prices + volume, publish the realtime
/// websocket events, and update the user's position.
///
/// Safe to call multiple times with the same `txHash` — it will no-op on the
/// second call, which lets the indexer and the trading route both fire
/// without double-booking anything.
export async function processTradeFill(input: TradeFillInput): Promise<void> {
  const { onChainMarketId, trader, isYes, isBuy, shares, collateral, txHash } = input;

  const market = await db
    .select()
    .from(markets)
    .where(eq(markets.onChainId, Number(onChainMarketId)))
    .limit(1);

  if (market.length === 0) {
    console.warn(`[Indexer] processTradeFill: no DB market for onChainId=${onChainMarketId}`);
    return;
  }
  const dbMarket = market[0];

  // Dedupe: if the same txHash already produced a trade row in this market, skip.
  const existingTrade = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.marketId, dbMarket.id), eq(trades.txHash, txHash)))
    .limit(1);
  if (existingTrade.length > 0) {
    return;
  }

  const traderAddr = trader.toLowerCase();
  const sharesStr = formatUnits(shares, 18);
  const collateralStr = formatUnits(collateral, 6);

  // Snapshot the AMM's post-trade YES/NO prices so the chart and the market
  // header share a single source of truth (see PriceChart).
  // One multicall instead of three round-trips keeps us under the RPC rate
  // limit when trades arrive in bursts. On any RPC failure we fall back to the
  // market row's last known prices so the trade row is never lost.
  let yesPriceNum = dbMarket.yesPrice ?? 0.5;
  let noPriceNum = dbMarket.noPrice ?? 0.5;
  let yesReserve: bigint = 0n;
  let noReserve: bigint = 0n;
  let pricesFetched = false;
  try {
    const ammAddress = dbMarket.ammAddress as `0x${string}`;
    const results = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: ammAddress, abi: CPMMABI, functionName: "getPrices" },
        { address: ammAddress, abi: CPMMABI, functionName: "yesReserve" },
        { address: ammAddress, abi: CPMMABI, functionName: "noReserve" },
      ],
    });
    const [yesPrice, noPrice] = results[0] as readonly [bigint, bigint];
    yesReserve = results[1] as bigint;
    noReserve = results[2] as bigint;
    yesPriceNum = Number(yesPrice) / 1e18;
    noPriceNum = Number(noPrice) / 1e18;
    pricesFetched = true;
  } catch (err) {
    console.error("[Indexer] Failed to fetch AMM prices, using cached:", err);
  }

  await db.insert(trades).values({
    marketId: dbMarket.id,
    trader: traderAddr,
    isYes,
    isBuy,
    shares: sharesStr,
    collateral: collateralStr,
    yesPrice: yesPriceNum,
    noPrice: noPriceNum,
    txHash,
  });

  if (pricesFetched) {
    try {
      const newVolume = Number(dbMarket.volume) + Number(collateral) / 1e6;

      // Realized fill price from this trade: USDC in per share.
      const sharesNum = Number(shares) / 1e18;
      const collateralNum = Number(collateral) / 1e6;
      const lastTradePrice = sharesNum > 0 ? collateralNum / sharesNum : 0;

      await db
        .update(markets)
        .set({
          yesPrice: yesPriceNum,
          noPrice: noPriceNum,
          volume: newVolume.toString(),
        })
        .where(eq(markets.id, dbMarket.id));

      await setCache(cacheKeys.marketYesPrice(dbMarket.id), yesPriceNum.toString());
      await setCache(cacheKeys.marketNoPrice(dbMarket.id), noPriceNum.toString());

      await publishEvent("market:price", {
        marketId: dbMarket.id,
        yesPrice: yesPriceNum,
        noPrice: noPriceNum,
        yesReserve: formatUnits(yesReserve, 18),
        noReserve: formatUnits(noReserve, 18),
        lastTradePrice,
        lastTradeSide: isYes ? "YES" : "NO",
        lastTradeIsBuy: isBuy,
        volume: newVolume,
      });
    } catch (err) {
      console.error("[Indexer] Failed to update market prices:", err);
    }
  }

  await publishEvent("trade:new", {
    marketId: dbMarket.id,
    trader: traderAddr,
    isYes,
    isBuy,
    shares: sharesStr,
    collateral: collateralStr,
    txHash,
  });

  // Update user position
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

  // Invalidate user share balance cache and notify
  if (isYes) {
    await setCache(cacheKeys.userYesBalance(traderAddr, dbMarket.id), "0");
  } else {
    await setCache(cacheKeys.userNoBalance(traderAddr, dbMarket.id), "0");
  }
  await publishEvent("user:shares", {
    wallet: traderAddr,
    marketId: dbMarket.id,
  });
}

async function handleTrade(log: any) {
  const { marketId, trader, isYes, isBuy, shares, collateral: col } = log.args;
  console.log(`[Indexer] Trade on market #${marketId} by ${trader} (tx=${log.transactionHash})`);
  await processTradeFill({
    onChainMarketId: marketId as bigint,
    trader: trader as string,
    isYes: isYes as boolean,
    isBuy: isBuy as boolean,
    shares: shares as bigint,
    collateral: col as bigint,
    txHash: log.transactionHash as string,
  });
}

async function handleMarketResolved(log: any) {
  const { marketId, result } = log.args;
  console.log(`[Indexer] MarketResolved #${marketId} → ${result === 1 ? "YES" : "NO"}`);

  await db
    .update(markets)
    .set({ resolved: true, result: Number(result), status: "resolved" })
    .where(eq(markets.onChainId, Number(marketId)));

  // Find the DB market to get the internal ID
  const market = await db
    .select()
    .from(markets)
    .where(eq(markets.onChainId, Number(marketId)))
    .limit(1);

  if (market.length > 0) {
    await publishEvent("market:resolved", {
      marketId: market[0].id,
      result: Number(result),
    });
  }
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
  // Always watch pools for existing markets, even if the factory address isn't
  // configured (e.g. a dev left MARKET_FACTORY_ADDRESS unset) — trades still
  // need to be indexed.
  try {
    const existingMarkets = await db.select().from(markets);
    for (const m of existingMarkets) {
      watchTradesForPool(m.ammAddress as `0x${string}`);
    }
    console.log(`[Indexer] Watching trades for ${existingMarkets.length} existing pool(s)`);
  } catch (err) {
    console.error("[Indexer] Failed to load existing markets for trade watching:", err);
  }

  if (FACTORY_ADDRESS) {
    console.log(`[Indexer] Watching events on factory: ${FACTORY_ADDRESS}`);

    publicClient.watchContractEvent({
      address: FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      eventName: "MarketCreated",
      onLogs: (logs) => logs.forEach(handleMarketCreated),
    });

    publicClient.watchContractEvent({
      address: FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      eventName: "MarketResolved",
      onLogs: (logs) => logs.forEach(handleMarketResolved),
    });

    publicClient.watchContractEvent({
      address: FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      eventName: "Redeemed",
      onLogs: (logs) => logs.forEach(handleRedeemed),
    });
  } else {
    console.warn("[Indexer] No MARKET_FACTORY_ADDRESS set — factory event watching disabled");
  }

  // Start watching Vault events
  startVaultWatcher();

  console.log("[Indexer] Event watchers started");
}

// ─── Vault event handlers ───

// Read the authoritative on-chain balance from the user's escrow and refresh cache.
async function refreshVaultBalance(user: `0x${string}`) {
  if (!VAULT_ADDRESS) return null;
  try {
    const balance = await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: VaultABI,
      functionName: "balanceOf",
      args: [user],
    }) as bigint;
    const formatted = formatUnits(balance, 6);
    await setCache(cacheKeys.userUsdcBalance(user.toLowerCase()), formatted);
    return formatted;
  } catch {
    return null;
  }
}

async function handleVaultDeposit(log: any) {
  const { user, amount } = log.args;
  const wallet = (user as string).toLowerCase();
  const usdcAmount = formatUnits(amount, 6);
  console.log(`[Indexer] Vault Deposit: ${wallet} deposited ${usdcAmount} USDC`);

  const balance = await refreshVaultBalance(user as `0x${string}`);

  await publishEvent("user:balance", {
    wallet,
    type: "deposit",
    amount: usdcAmount,
    usdcBalance: balance,
  });
}

async function handleVaultWithdraw(log: any) {
  const { user, amount } = log.args;
  const wallet = (user as string).toLowerCase();
  const usdcAmount = formatUnits(amount, 6);
  console.log(`[Indexer] Vault Withdraw: ${wallet} withdrew ${usdcAmount} USDC`);

  const balance = await refreshVaultBalance(user as `0x${string}`);

  await publishEvent("user:balance", {
    wallet,
    type: "withdraw",
    amount: usdcAmount,
    usdcBalance: balance,
  });
}

async function handleVaultBalanceUpdated(log: any) {
  const { user, newBalance } = log.args;
  const wallet = (user as string).toLowerCase();
  const balance = formatUnits(newBalance, 6);

  await setCache(cacheKeys.userUsdcBalance(wallet), balance);
  await publishEvent("user:balance", {
    wallet,
    usdcBalance: balance,
  });
}

async function handleEscrowCreated(log: any) {
  const { user, escrow } = log.args;
  const wallet = (user as string).toLowerCase();
  console.log(`[Indexer] EscrowCreated: ${wallet} -> ${escrow}`);

  await setCache(cacheKeys.userEscrow(wallet), (escrow as string).toLowerCase());

  await publishEvent("user:escrow", {
    wallet,
    escrow: (escrow as string).toLowerCase(),
  });
}

function startVaultWatcher() {
  if (!VAULT_ADDRESS) {
    console.log("[Indexer] No VAULT_ADDRESS set — skipping vault event watching");
    return;
  }

  console.log(`[Indexer] Watching Vault events on: ${VAULT_ADDRESS}`);

  publicClient.watchContractEvent({
    address: VAULT_ADDRESS,
    abi: VaultABI,
    eventName: "Deposit",
    onLogs: (logs) => logs.forEach(handleVaultDeposit),
  });

  publicClient.watchContractEvent({
    address: VAULT_ADDRESS,
    abi: VaultABI,
    eventName: "Withdraw",
    onLogs: (logs) => logs.forEach(handleVaultWithdraw),
  });

  publicClient.watchContractEvent({
    address: VAULT_ADDRESS,
    abi: VaultABI,
    eventName: "BalanceUpdated",
    onLogs: (logs) => logs.forEach(handleVaultBalanceUpdated),
  });

  publicClient.watchContractEvent({
    address: VAULT_ADDRESS,
    abi: VaultABI,
    eventName: "EscrowCreated",
    onLogs: (logs) => logs.forEach(handleEscrowCreated),
  });
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
