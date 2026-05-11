import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { markets, trades, userPositions, dailyMarkets } from "../db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { createPublicClient, http, decodeEventLog, formatUnits, parseUnits } from "viem";
import { base } from "viem/chains";
import { CPMMABI } from "@nam-prediction/shared";
import { featureFlags } from "../config/feature-flags";
import { getNamSnapshot } from "../services/nam-price-poller";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const rpcClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

// Positions are stored as numeric(30,18) decimal strings. Scale to wei
// before doing BigInt arithmetic, then format back to decimal.
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

function formatMarketDate(date: Date): string {
  const marketDay = new Date(date.getTime() - 1);
  return marketDay.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export const marketRoutes = new Elysia({ prefix: "/markets" })
  // GET /markets — List all markets
  .get("/", async () => {
    const allMarkets = await db
      .select()
      .from(markets)
      .orderBy(desc(markets.createdAt));
    return { data: allMarkets, success: true };
  })

  // GET /markets/daily/active — Get the active daily NAM market
  .get("/daily/active", async ({ set }) => {
    const daily = await db
      .select()
      .from(dailyMarkets)
      .where(eq(dailyMarkets.status, "active"))
      .orderBy(desc(dailyMarkets.createdAt))
      .limit(1);

    if (daily.length === 0) {
      return { data: null, success: true };
    }

    // If we have a linked market, fetch it
    let market = null;
    if (daily[0].marketId) {
      const m = await db
        .select()
        .from(markets)
        .where(eq(markets.id, daily[0].marketId))
        .limit(1);
      if (m.length > 0) market = m[0];
    }

    // If no linked market yet, try to find by question containing the date
    if (!market) {
      const allUnresolved = await db
        .select()
        .from(markets)
        .where(eq(markets.resolved, false))
        .orderBy(desc(markets.createdAt));

      const dailyDisplayDate = formatMarketDate(new Date(`${daily[0].date}T00:00:00.000Z`));
      for (const m of allUnresolved) {
        const marketDate = m.endTime.toISOString().split("T")[0];
        if (
          m.resolutionSource === "dexscreener" &&
          (marketDate === daily[0].date || m.question.includes(dailyDisplayDate))
        ) {
          market = m;
          // Link it
          await db
            .update(dailyMarkets)
            .set({ marketId: m.id })
            .where(eq(dailyMarkets.id, daily[0].id));
          break;
        }
      }
    }

    return {
      data: {
        daily: daily[0],
        market,
      },
      success: true,
    };
  })

  // GET /markets/nam-price — Live NAM/USDC price from DexScreener (served from poller cache)
  .get("/nam-price", ({ set }) => {
    const snap = getNamSnapshot();
    if (!snap) {
      set.status = 503;
      return { success: false, error: "NAM price not yet available" };
    }
    return {
      success: true,
      data: {
        priceUsd: snap.priceUsd,
        tokenAddress: process.env.NAM_TOKEN_ADDRESS ?? null,
        tokenIconUrl: snap.tokenIconUrl,
        lastUpdatedAt: snap.lastUpdatedAt,
        history: snap.history,
      },
    };
  })

  // GET /markets/features — Runtime rollout flags for clients and ops
  .get("/features", async () => {
    return {
      success: true,
      data: {
        enableAmmTrading: featureFlags.enableAmmTrading,
        enableClobTrading: featureFlags.enableClobTrading,
        defaultMarketExecutionMode: featureFlags.defaultMarketExecutionMode,
      },
    };
  })

  // GET /markets/24h/latest — Get the latest 24h market
  .get("/24h/latest", async () => {
    const result = await db
      .select()
      .from(markets)
      .where(eq(markets.cadence, "24h"))
      .orderBy(desc(markets.createdAt))
      .limit(1);

    return { data: result.length > 0 ? result[0] : null, success: true };
  })

  // GET /markets/24h/history — Last 7 days of 24h markets
  .get("/24h/history", async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.cadence, "24h"),
          gte(markets.createdAt, sevenDaysAgo)
        )
      )
      .orderBy(desc(markets.createdAt));

    return { data: result, success: true };
  })

  // GET /markets/recent-trades — Latest trades across all markets
  .get("/recent-trades", async ({ query }) => {
    const limit = Math.min(Number(query?.limit) || 50, 100);
    const recentTrades = await db
      .select({
        id: trades.id,
        marketId: trades.marketId,
        trader: trades.trader,
        isYes: trades.isYes,
        isBuy: trades.isBuy,
        shares: trades.shares,
        collateral: trades.collateral,
        yesPrice: trades.yesPrice,
        noPrice: trades.noPrice,
        txHash: trades.txHash,
        timestamp: trades.timestamp,
        marketQuestion: markets.question,
      })
      .from(trades)
      .innerJoin(markets, eq(trades.marketId, markets.id))
      .orderBy(desc(trades.timestamp))
      .limit(limit);
    return { data: recentTrades, success: true };
  }, {
    query: t.Optional(t.Object({ limit: t.Optional(t.String()) })),
  })

  // GET /markets/:id — Single market detail
  .get(
    "/:id",
    async ({ params, set }) => {
      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.id, Number(params.id)))
        .limit(1);

      if (market.length === 0) {
        set.status = 404;
        return { data: null, success: false, error: "Market not found" };
      }
      return { data: market[0], success: true };
    },
    { params: t.Object({ id: t.String() }) }
  )

  // GET /markets/:id/trades — Trade history for a market
  .get(
    "/:id/trades",
    async ({ params }) => {
      const marketTrades = await db
        .select()
        .from(trades)
        .where(eq(trades.marketId, Number(params.id)))
        .orderBy(desc(trades.timestamp));
      return { data: marketTrades, success: true };
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /markets/:id/record-trade — Record a trade from a tx hash (fallback for indexer)
  .post(
    "/:id/record-trade",
    async ({ params, body, set }) => {
      console.log(`[record-trade] Received request to record trade for marketId=${params.id} with txHash=${body.txHash}`);
      if (!featureFlags.enableAmmTrading) {
        set.status = 503;
        return {
          success: false,
          error: "AMM trading is disabled",
        };
      }

      const { txHash } = body;
      const marketId = Number(params.id);

      // Check if already recorded
      const existing = await db
        .select()
        .from(trades)
        .where(eq(trades.txHash, txHash))
        .limit(1);
      if (existing.length > 0) {
        return { success: true, data: existing[0], message: "Already recorded" };
      }

      // Find the market
      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.id, marketId))
        .limit(1);
      if (market.length === 0) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }
      const dbMarket = market[0];

      if (dbMarket.executionMode === "clob") {
        set.status = 400;
        return {
          success: false,
          error: "record-trade currently supports AMM markets only",
        };
      }

      // Fetch the tx receipt from chain
      let receipt;
      try {
        receipt = await rpcClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      } catch (err) {
        set.status = 400;
        return { success: false, error: "Could not fetch tx receipt" };
      }

      // Decode Trade event logs
      let tradeEvent = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: CPMMABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "Trade") {
            tradeEvent = decoded.args as {
              marketId: bigint;
              trader: `0x${string}`;
              isYes: boolean;
              isBuy: boolean;
              shares: bigint;
              collateral: bigint;
            };
            break;
          }
        } catch {
          // Not a Trade event from this ABI, skip
        }
      }

      if (!tradeEvent) {
        set.status = 400;
        return { success: false, error: "No Trade event found in tx" };
      }

      // Fetch AMM prices pinned to the trade's block so the snapshot matches
      // the Trade event we just decoded (reading "latest" would race with any
      // concurrent trade and flip the price in the wrong direction).
      // Retry once, then fall back to "latest", then to the market row's
      // cached prices so the trade still gets recorded.
      let yesPriceNum = dbMarket.yesPrice ?? 0.5;
      let noPriceNum = dbMarket.noPrice ?? 0.5;
      let pricesFetched = false;
      const readPricesAt = async (bn?: bigint) =>
        (await rpcClient.readContract({
          address: dbMarket.ammAddress as `0x${string}`,
          abi: CPMMABI,
          functionName: "getPrices",
          ...(bn !== undefined ? { blockNumber: bn } : {}),
        })) as [bigint, bigint];
      try {
        const [yesPrice, noPrice] = await readPricesAt(receipt.blockNumber);
        yesPriceNum = Number(yesPrice) / 1e18;
        noPriceNum = Number(noPrice) / 1e18;
        pricesFetched = true;
      } catch (err) {
        console.warn(
          `[record-trade] Block-pinned price read failed (block=${receipt.blockNumber}), retrying:`,
          (err as Error)?.message || err
        );
        try {
          await new Promise((r) => setTimeout(r, 250));
          const [yesPrice, noPrice] = await readPricesAt(receipt.blockNumber);
          yesPriceNum = Number(yesPrice) / 1e18;
          noPriceNum = Number(noPrice) / 1e18;
          pricesFetched = true;
        } catch (err2) {
          console.warn(
            "[record-trade] Retry failed, falling back to latest block:",
            (err2 as Error)?.message || err2
          );
          try {
            const [yesPrice, noPrice] = await readPricesAt(undefined);
            yesPriceNum = Number(yesPrice) / 1e18;
            noPriceNum = Number(noPrice) / 1e18;
            pricesFetched = true;
          } catch (err3) {
            console.error(
              "[record-trade] Failed to fetch AMM prices, using cached:",
              err3
            );
          }
        }
      }

      // Insert trade (convert from raw BigInt to human-readable decimals)
      const [inserted] = await db
        .insert(trades)
        .values({
          marketId: dbMarket.id,
          trader: tradeEvent.trader.toLowerCase(),
          isYes: tradeEvent.isYes,
          isBuy: tradeEvent.isBuy,
          shares: formatUnits(tradeEvent.shares, 18),
          collateral: formatUnits(tradeEvent.collateral, 6),
          yesPrice: yesPriceNum,
          noPrice: noPriceNum,
          txHash,
        })
        .onConflictDoNothing()
        .returning();

      if (pricesFetched) {
        try {
          await db
            .update(markets)
            .set({
              yesPrice: yesPriceNum,
              noPrice: noPriceNum,
              volume: (
                Number(dbMarket.volume) +
                Number(tradeEvent.collateral) / 1e6
              ).toString(),
            })
            .where(eq(markets.id, dbMarket.id));
        } catch (err) {
          console.error("[record-trade] Failed to update market prices:", err);
        }
      }

      // Update user position
      const traderAddr = tradeEvent.trader.toLowerCase();
      const existingPos = await db
        .select()
        .from(userPositions)
        .where(
          and(
            eq(userPositions.marketId, dbMarket.id),
            eq(userPositions.userAddress, traderAddr)
          )
        )
        .limit(1);

      const sharesStr = formatUnits(tradeEvent.shares, 18);
      if (existingPos.length === 0) {
        await db.insert(userPositions).values({
          marketId: dbMarket.id,
          userAddress: traderAddr,
          yesBalance: tradeEvent.isYes && tradeEvent.isBuy ? sharesStr : "0",
          noBalance: !tradeEvent.isYes && tradeEvent.isBuy ? sharesStr : "0",
          avgEntryPrice: 0,
          pnl: "0",
        });
      } else {
        const pos = existingPos[0];
        let newYes = pos.yesBalance;
        let newNo = pos.noBalance;
        if (tradeEvent.isYes) {
          newYes = tradeEvent.isBuy
            ? addBigIntStrings(pos.yesBalance, sharesStr)
            : subBigIntStrings(pos.yesBalance, sharesStr);
        } else {
          newNo = tradeEvent.isBuy
            ? addBigIntStrings(pos.noBalance, sharesStr)
            : subBigIntStrings(pos.noBalance, sharesStr);
        }
        await db
          .update(userPositions)
          .set({ yesBalance: newYes, noBalance: newNo })
          .where(eq(userPositions.id, pos.id));
      }

      return { success: true, data: inserted };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ txHash: t.String() }),
    }
  );
