import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { rangeMarkets, rangePositions, rangeTrades } from "../db/schema";
import { eq, desc, and } from "drizzle-orm";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  decodeEventLog,
  verifyTypedData,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  RangeMarketFactoryABI,
  RangeCPMMABI,
  RangeLMSRABI,
  VaultABI,
  ERC20ABI,
  TRADING_DOMAIN,
  RANGE_TRADE_INTENT_TYPES,
  RANGE_TRADE_INTENT_PRIMARY_TYPE,
} from "@nam-prediction/shared";

// Unified pool ABI: RangeLMSRABI is a superset of RangeCPMMABI for identical functions.
const RangePoolABI = RangeLMSRABI;
import { publishEvent, getCache, setCache, cacheKeys } from "../lib/redis";
import { getNonceManager } from "../lib/nonce-manager.instance";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = (process.env.RANGE_FACTORY_ADDRESS || process.env.MARKET_FACTORY_ADDRESS) as `0x${string}`;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS as `0x${string}` | undefined;

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);
  return createWalletClient({ account, chain: base, transport: http(RPC_URL) });
}

function getPublicClient() {
  return createPublicClient({ chain: base, transport: http(RPC_URL) });
}

// Fetch on-chain prices from RangeCPMM and return as float array (each 0–1)
async function fetchOnChainPrices(cpmmAddress: string): Promise<number[]> {
  try {
    const client = getPublicClient();
    const rawPrices = await client.readContract({
      address: cpmmAddress as `0x${string}`,
      abi: RangePoolABI,
      functionName: "getPrices",
    });
    return (rawPrices as bigint[]).map((p) => Number(p) / 1e18);
  } catch {
    return [];
  }
}

const SHARES_DECIMALS = 18n;
const SHARES_UNIT = 10n ** SHARES_DECIMALS;

/**
 * Convert a raw shares bigint (18 decimals) to a NUMERIC-safe decimal string.
 * e.g. 70000000000000000n → "0.070000000000000000"
 * NUMERIC(30,18) allows max 12 digits before the decimal point; this always
 * produces at most a few integer digits for realistic share amounts.
 */
function bigintToDecimalShares(raw: bigint): string {
  const intPart = raw / SHARES_UNIT;
  const fracPart = raw % SHARES_UNIT;
  return `${intPart}.${fracPart.toString().padStart(18, "0")}`;
}

/**
 * Parse a decimal shares string back to raw bigint (18 decimals).
 * Handles both legacy float strings ("0.07") and full-precision strings ("0.070000000000000000").
 * Returns 0n on parse failure.
 */
function decimalSharesToBigint(str: string): bigint {
  try {
    const [intStr = "0", fracStr = ""] = str.split(".");
    const fracPadded = fracStr.padEnd(18, "0").slice(0, 18);
    return BigInt(intStr) * SHARES_UNIT + BigInt(fracPadded);
  } catch {
    return BigInt(0);
  }
}

/**
 * Reads the on-chain range token balance for a given holder address.
 * Used to cap sell amounts and avoid ERC20InsufficientBalance reverts.
 */
async function getRangeTokenBalance(
  cpmmAddress: `0x${string}`,
  rangeIndex: number,
  holderAddress: `0x${string}`
): Promise<bigint> {
  try {
    const client = getPublicClient();
    const tokenAddr = await client.readContract({
      address: cpmmAddress,
      abi: RangePoolABI,
      functionName: "getRangeToken",
      args: [BigInt(rangeIndex)],
    }) as `0x${string}`;
    const balance = await client.readContract({
      address: tokenAddr,
      abi: ERC20ABI,
      functionName: "balanceOf",
      args: [holderAddress],
    }) as bigint;
    return balance;
  } catch {
    return BigInt(0);
  }
}

/**
 * Reads the user's vault escrow address. Returns null if vault not configured or no escrow.
 */
async function getUserEscrow(userAddress: `0x${string}`): Promise<`0x${string}` | null> {
  if (!VAULT_ADDRESS) return null;
  try {
    const client = getPublicClient();
    const escrow = await client.readContract({
      address: VAULT_ADDRESS,
      abi: VaultABI,
      functionName: "escrowOf",
      args: [userAddress],
    }) as `0x${string}`;
    return escrow === "0x0000000000000000000000000000000000000000" ? null : escrow;
  } catch {
    return null;
  }
}

/**
 * Reads the user's vault USDC balance directly from chain (no cache).
 * Used in pre-flight checks — always fresh to avoid acting on stale cached values.
 */
async function getUserVaultBalance(userAddress: `0x${string}`): Promise<bigint> {
  if (!VAULT_ADDRESS) return BigInt(0);
  try {
    const client = getPublicClient();
    const balance = await client.readContract({
      address: VAULT_ADDRESS,
      abi: VaultABI,
      functionName: "balanceOf",
      args: [userAddress],
    }) as bigint;
    return balance;
  } catch {
    return BigInt(0);
  }
}

/**
 * After a range trade, refresh the user's vault balance in cache and emit a live update.
 */
async function refreshAndEmitVaultBalance(userAddress: string): Promise<void> {
  if (!VAULT_ADDRESS) return;
  try {
    const client = getPublicClient();
    const balance = await client.readContract({
      address: VAULT_ADDRESS,
      abi: VaultABI,
      functionName: "balanceOf",
      args: [userAddress as `0x${string}`],
    }) as bigint;
    const usdcStr = formatUnits(balance, 6);
    await setCache(cacheKeys.userUsdcBalance(userAddress.toLowerCase()), usdcStr, 300);
    await publishEvent("user:balance", {
      wallet: userAddress.toLowerCase(),
      usdcBalance: usdcStr,
    });
  } catch {
    // Non-fatal — balance will be refreshed on next poll
  }
}

/**
 * Verify an EIP-712 range trade intent signature.
 * Returns the recovered signer address (lowercased) or throws.
 */
async function verifyRangeTradeSignature(opts: {
  signature: `0x${string}`;
  trader: `0x${string}`;
  marketId: bigint;
  cpmmAddress: `0x${string}`;
  rangeIndex: bigint;
  isBuy: boolean;
  amount: bigint;
  minOutput: bigint;
  nonce: bigint;
  deadline: bigint;
}): Promise<void> {
  const valid = await verifyTypedData({
    address: opts.trader,
    domain: { ...TRADING_DOMAIN, chainId: base.id },
    types: RANGE_TRADE_INTENT_TYPES,
    primaryType: RANGE_TRADE_INTENT_PRIMARY_TYPE,
    message: {
      trader: opts.trader,
      marketId: opts.marketId,
      cpmmAddress: opts.cpmmAddress,
      rangeIndex: opts.rangeIndex,
      isBuy: opts.isBuy,
      amount: opts.amount,
      minOutput: opts.minOutput,
      nonce: opts.nonce,
      deadline: opts.deadline,
    },
    signature: opts.signature,
  });
  if (!valid) throw new Error("Invalid signature");
  if (BigInt(Math.floor(Date.now() / 1000)) > opts.deadline) {
    throw new Error("Signature expired");
  }
}

export const rangeMarketRoutes = new Elysia({ prefix: "/range-markets" })

  // GET /range-markets — list all range markets
  .get("/", async ({ query }) => {
    const { type, status } = query as { type?: string; status?: string };

    let q = db.select().from(rangeMarkets).orderBy(desc(rangeMarkets.createdAt)).$dynamic();

    if (type) {
      q = q.where(eq(rangeMarkets.marketType, type));
    }
    if (status) {
      q = q.where(eq(rangeMarkets.status, status));
    }

    const rows = await q;
    return { data: rows, success: true };
  })

  // GET /range-markets/active — all currently active markets
  .get("/active", async () => {
    const rows = await db
      .select()
      .from(rangeMarkets)
      .where(eq(rangeMarkets.status, "active"))
      .orderBy(desc(rangeMarkets.createdAt));

    for (const market of rows) {
      if (!market.rangeCpmmAddress || market.resolved) continue;
      const prices = await fetchOnChainPrices(market.rangeCpmmAddress);
      const ranges = market.ranges as unknown[];
      if (prices.length !== ranges.length) continue;

      market.rangePrices = prices as unknown as typeof market.rangePrices;
      await db
        .update(rangeMarkets)
        .set({ rangePrices: prices })
        .where(eq(rangeMarkets.id, market.id));
    }

    return { data: rows, success: true };
  })

  // GET /range-markets/:id — single market with latest prices
  .get("/:id", async ({ params, set }) => {
    const id = Number(params.id);
    if (isNaN(id)) {
      set.status = 400;
      return { error: "Invalid id", success: false };
    }

    const rows = await db.select().from(rangeMarkets).where(eq(rangeMarkets.id, id)).limit(1);
    if (rows.length === 0) {
      set.status = 404;
      return { error: "Range market not found", success: false };
    }

    const market = rows[0];

    // Refresh prices from on-chain if CPMM address is known
    if (market.rangeCpmmAddress && !market.resolved) {
      const prices = await fetchOnChainPrices(market.rangeCpmmAddress);
      if (prices.length === (market.ranges as unknown[]).length) {
        await db
          .update(rangeMarkets)
          .set({ rangePrices: prices })
          .where(eq(rangeMarkets.id, id));
        market.rangePrices = prices as unknown as typeof market.rangePrices;
      }
    }

    return { data: market, success: true };
  })

  // GET /range-markets/:id/positions/:userAddress — user positions for a market
  .get("/:id/positions/:userAddress", async ({ params, set }) => {
    const id = Number(params.id);
    const userAddress = params.userAddress.toLowerCase();
    if (isNaN(id)) {
      set.status = 400;
      return { error: "Invalid id", success: false };
    }

    const positions = await db
      .select()
      .from(rangePositions)
      .where(
        and(
          eq(rangePositions.rangeMarketId, id),
          eq(rangePositions.userAddress, userAddress)
        )
      )
      .orderBy(rangePositions.rangeIndex);

    return { data: positions, success: true };
  })

  // GET /range-markets/:id/trades — trade history
  .get("/:id/trades", async ({ params, set }) => {
    const id = Number(params.id);
    if (isNaN(id)) {
      set.status = 400;
      return { error: "Invalid id", success: false };
    }

    const trades = await db
      .select()
      .from(rangeTrades)
      .where(eq(rangeTrades.rangeMarketId, id))
      .orderBy(desc(rangeTrades.timestamp))
      .limit(100);

    return { data: trades, success: true };
  })

  // GET /range-markets/:id/quote?rangeIndex=&usdcAmount= — quote exact tokens for a buy
  .get("/:id/quote", async ({ params, query, set }) => {
    const id = Number(params.id);
    const rangeIndex = Number(query.rangeIndex);
    const usdcAmount = Number(query.usdcAmount);

    if (isNaN(id) || isNaN(rangeIndex) || isNaN(usdcAmount) || usdcAmount <= 0 || rangeIndex < 0) {
      set.status = 400;
      return { error: "Invalid parameters", success: false };
    }

    const rows = await db.select().from(rangeMarkets).where(eq(rangeMarkets.id, id)).limit(1);
    if (rows.length === 0) {
      set.status = 404;
      return { error: "Range market not found", success: false };
    }
    const market = rows[0];

    if (!market.rangeCpmmAddress) {
      set.status = 400;
      return { error: "Market not yet deployed on-chain", success: false };
    }

    try {
      const client = getPublicClient();
      const usdcAmountRaw = parseUnits(String(usdcAmount), 6);
      const sharesOut = await client.readContract({
        address: market.rangeCpmmAddress as `0x${string}`,
        abi: RangePoolABI,
        functionName: "quoteBuy",
        args: [BigInt(rangeIndex), usdcAmountRaw],
      }) as bigint;

      const sharesOutStr = bigintToDecimalShares(sharesOut);
      return {
        success: true,
        data: {
          rangeIndex,
          usdcAmount,
          sharesOut: sharesOutStr,
          sharesOutFloat: Number(sharesOut) / 1e18,
        },
      };
    } catch (err: unknown) {
      console.error("[RangeMarkets] Quote error:", err);
      set.status = 500;
      return { error: (err as Error).message ?? "Quote failed", success: false };
    }
  })

  // POST /range-markets/:id/buy — buy a range outcome
  .post(
    "/:id/buy",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const { rangeIndex, usdcAmount, userAddress, minOutput, signature, nonce, deadline } = body as {
        rangeIndex: number;
        usdcAmount: number;
        userAddress: string;
        minOutput?: string;
        signature: string;
        nonce: string;
        deadline: string;
      };

      if (isNaN(id) || rangeIndex < 0 || usdcAmount <= 0 || !userAddress) {
        set.status = 400;
        return { error: "Invalid parameters", success: false };
      }

      const rows = await db.select().from(rangeMarkets).where(eq(rangeMarkets.id, id)).limit(1);
      if (rows.length === 0) {
        set.status = 404;
        return { error: "Range market not found", success: false };
      }
      const market = rows[0];

      if (market.resolved || market.status !== "active") {
        set.status = 400;
        return { error: "Market is not active", success: false };
      }
      if (!market.rangeCpmmAddress) {
        set.status = 400;
        return { error: "Market not yet deployed on-chain", success: false };
      }

      const ranges = market.ranges as { index: number; label: string }[];
      if (rangeIndex >= ranges.length) {
        set.status = 400;
        return { error: "Range index out of bounds", success: false };
      }

      const usdcAmountRaw = parseUnits(String(usdcAmount), 6);
      const cpmmAddress = market.rangeCpmmAddress as `0x${string}`;
      const minOutputRaw = minOutput ? BigInt(minOutput) : BigInt(0);

      if (signature && nonce && deadline) {
        try {
          await verifyRangeTradeSignature({
            signature: signature as `0x${string}`,
            trader: userAddress as `0x${string}`,
            marketId: BigInt(market.onChainMarketId ?? market.id),
            cpmmAddress,
            rangeIndex: BigInt(rangeIndex),
            isBuy: true,
            amount: usdcAmountRaw,
            minOutput: minOutputRaw,
            nonce: BigInt(nonce),
            deadline: BigInt(deadline),
          });
        } catch (err: unknown) {
          set.status = 401;
          return { error: (err as Error).message ?? "Invalid signature", success: false };
        }
      }

      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();
        const nm = getNonceManager();

        // Vault pre-flight: check escrow existence and balance using fresh on-chain reads
        if (VAULT_ADDRESS) {
          const userEscrow = await getUserEscrow(userAddress as `0x${string}`);
          if (!userEscrow) {
            set.status = 400;
            return {
              error: "No vault escrow found. Please deposit USDC to the vault to create your escrow before trading.",
              success: false,
            };
          }
          const vaultBalance = await getUserVaultBalance(userAddress as `0x${string}`);
          if (vaultBalance < usdcAmountRaw) {
            set.status = 400;
            return { error: "Insufficient vault balance", success: false };
          }
        }

        let buyHash: `0x${string}`;
        let sharesOutRaw = BigInt(0);

        if (minOutputRaw > 0n) {
          const quotedShares = await publicClient.readContract({
            address: cpmmAddress,
            abi: RangePoolABI,
            functionName: "quoteBuy",
            args: [BigInt(rangeIndex), usdcAmountRaw],
          }) as bigint;
          if (quotedShares < minOutputRaw) {
            set.status = 400;
            return { error: "Slippage: current quote below signed minimum", success: false };
          }
        }

        if (VAULT_ADDRESS) {
          // Route through user's vault escrow: Vault.executeRangeBuy deducts from user's escrow
          buyHash = await nm.withNonce((n) =>
            walletClient.writeContract({
              address: VAULT_ADDRESS!,
              abi: VaultABI,
              functionName: "executeRangeBuy",
              args: [cpmmAddress, BigInt(rangeIndex), usdcAmountRaw, userAddress as `0x${string}`],
              nonce: n,
            })
          );
          const receipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });

          for (const log of receipt.logs) {
            try {
              const decoded = decodeEventLog({ abi: RangePoolABI, data: log.data, topics: log.topics });
              if (decoded.eventName === "RangeTrade") {
                sharesOutRaw = (decoded.args as { shares: bigint }).shares;
                break;
              }
            } catch { /* ignore unrelated logs */ }
          }
        } else {
          // Fallback: server wallet executes directly (no vault configured)
          const approveHash = await nm.withNonce((n) =>
            walletClient.writeContract({
              address: USDC_ADDRESS,
              abi: ERC20ABI,
              functionName: "approve",
              args: [cpmmAddress, usdcAmountRaw],
              nonce: n,
            })
          );
          await publicClient.waitForTransactionReceipt({ hash: approveHash });

          buyHash = await nm.withNonce((n) =>
            walletClient.writeContract({
              address: cpmmAddress,
              abi: RangePoolABI,
              functionName: "buy",
              args: [BigInt(rangeIndex), usdcAmountRaw, minOutputRaw],
              nonce: n,
            })
          );
          const receipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });

          for (const log of receipt.logs) {
            try {
              const decoded = decodeEventLog({ abi: RangePoolABI, data: log.data, topics: log.topics });
              if (decoded.eventName === "RangeTrade") {
                sharesOutRaw = (decoded.args as { shares: bigint }).shares;
                break;
              }
            } catch { /* ignore unrelated logs */ }
          }
        }

        if (minOutputRaw > 0n && sharesOutRaw < minOutputRaw) {
          throw new Error("Slippage exceeded: filled output below signed minimum");
        }

        const newPrices = await fetchOnChainPrices(cpmmAddress);

        // Fire WebSocket price update FIRST — before any DB writes.
        // This ensures the UI always sees price changes even if DB writes fail.
        if (newPrices.length > 0) {
          await db.update(rangeMarkets)
            .set({ rangePrices: newPrices })
            .where(eq(rangeMarkets.id, id));
          await publishEvent("market:price", {
            marketId: id,
            rangePrices: newPrices,
            ranges: market.ranges,
            type: "range",
          });
          console.log("[RangeMarkets] Buy price update published", {
            marketId: id,
            rangeIndex,
            txHash: buyHash,
            rangePrices: newPrices,
          });
        }

        // Emit updated vault balance so the UI balance widget refreshes immediately
        await refreshAndEmitVaultBalance(userAddress.toLowerCase());

        // Secondary DB writes — wrapped so failures don't break the response
        const sharesStr = bigintToDecimalShares(sharesOutRaw);
        const sharesFloat = Number(sharesOutRaw) / 1e18;
        // Use the market probability at time of purchase as the avg entry price.
        // (usdcAmount / sharesFloat gives ~$1/token regardless of range due to LMSR share scaling.)
        const actualCostPerToken = newPrices[rangeIndex] ?? 0;


        try {
          await db.insert(rangeTrades).values({
            rangeMarketId: id,
            trader: userAddress.toLowerCase(),
            rangeIndex,
            isBuy: true,
            shares: sharesStr,
            collateral: usdcAmount.toFixed(6),
            pricesSnapshot: newPrices,
            txHash: buyHash,
          }).onConflictDoNothing();
        } catch (dbErr) {
          console.error("[RangeMarkets] Buy: trade insert failed (non-fatal):", dbErr);
        }

        try {
          const existingPos = await db
            .select()
            .from(rangePositions)
            .where(
              and(
                eq(rangePositions.rangeMarketId, id),
                eq(rangePositions.userAddress, userAddress.toLowerCase()),
                eq(rangePositions.rangeIndex, rangeIndex)
              )
            )
            .limit(1);

          if (existingPos.length === 0) {
            await db.insert(rangePositions).values({
              rangeMarketId: id,
              userAddress: userAddress.toLowerCase(),
              rangeIndex,
              balance: sharesStr,
              avgEntryPrice: actualCostPerToken,
              costBasis: usdcAmount.toFixed(6),
              pnl: "0",
            });
          } else {
            const prev = existingPos[0];
            const prevRaw = decimalSharesToBigint(prev.balance);
            const newBalanceRaw = prevRaw + sharesOutRaw;
            const newBalanceStr = bigintToDecimalShares(newBalanceRaw);
            const newCostBasis = (parseFloat(prev.costBasis) + usdcAmount).toFixed(6);
            const totalSharesFloat = Number(newBalanceRaw) / 1e18;
            const prevShares = Number(prevRaw) / 1e18;
            // Weighted average by token count (probability at purchase weighted by shares bought)
            const newAvgPrice = totalSharesFloat > 0
              ? (Number(prev.avgEntryPrice) * prevShares + actualCostPerToken * sharesFloat) / totalSharesFloat
              : actualCostPerToken;
            await db.update(rangePositions)
              .set({
                balance: newBalanceStr,
                costBasis: newCostBasis,
                avgEntryPrice: newAvgPrice,
              })
              .where(eq(rangePositions.id, prev.id));
          }
        } catch (dbErr) {
          console.error("[RangeMarkets] Buy: position upsert failed (non-fatal):", dbErr);
        }

        return {
          success: true,
          data: {
            txHash: buyHash,
            sharesOut: sharesStr,
            sharesOutFloat: sharesFloat,
            rangePrices: newPrices,
          },
        };
      } catch (err: unknown) {
        console.error("[RangeMarkets] Buy error:", err);
        set.status = 500;
        return { error: (err as Error).message ?? "Trade failed", success: false };
      }
    },
    {
      body: t.Object({
        rangeIndex: t.Number(),
        usdcAmount: t.Number(),
        userAddress: t.String(),
        signature: t.Optional(t.String()),
        minOutput: t.Optional(t.String()),
        nonce: t.Optional(t.String()),
        deadline: t.Optional(t.String()),
      }),
    }
  )

  // POST /range-markets/:id/sell — sell a range outcome
  .post(
    "/:id/sell",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const { rangeIndex, shares, userAddress, minOutput, signature, nonce, deadline } = body as {
        rangeIndex: number;
        shares: number;
        userAddress: string;
        minOutput?: string;
        signature?: string;
        nonce?: string;
        deadline?: string;
      };

      if (isNaN(id) || rangeIndex < 0 || shares <= 0 || !userAddress) {
        set.status = 400;
        return { error: "Invalid parameters", success: false };
      }

      const rows = await db.select().from(rangeMarkets).where(eq(rangeMarkets.id, id)).limit(1);
      if (rows.length === 0) {
        set.status = 404;
        return { error: "Range market not found", success: false };
      }
      const market = rows[0];

      if (market.resolved || market.status !== "active") {
        set.status = 400;
        return { error: "Market is not active", success: false };
      }
      if (!market.rangeCpmmAddress) {
        set.status = 400;
        return { error: "Market not yet deployed on-chain", success: false };
      }

      const cpmmAddress = market.rangeCpmmAddress as `0x${string}`;
      // parseUnits from user input (float string) — may be slightly over actual balance
      const requestedSharesRaw = parseUnits(String(shares), 18);
      const minOutputRaw = minOutput ? BigInt(minOutput) : BigInt(0);

      // Verify EIP-712 signature when provided
      if (signature && nonce && deadline) {
        try {
          await verifyRangeTradeSignature({
            signature: signature as `0x${string}`,
            trader: userAddress as `0x${string}`,
            marketId: BigInt(market.onChainMarketId ?? market.id),
            cpmmAddress,
            rangeIndex: BigInt(rangeIndex),
            isBuy: false,
            amount: requestedSharesRaw,
            minOutput: minOutputRaw,
            nonce: BigInt(nonce),
            deadline: BigInt(deadline),
          });
        } catch (err: unknown) {
          set.status = 401;
          return { error: (err as Error).message ?? "Invalid signature", success: false };
        }
      }

      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();
        const nm = getNonceManager();

        let safeSharesRaw: bigint;
        let sellHash: `0x${string}`;

        if (VAULT_ADDRESS) {
          // Route through user's vault escrow: tokens are in the escrow, sell from there
          const userEscrow = await getUserEscrow(userAddress as `0x${string}`);
          if (!userEscrow) {
            set.status = 400;
            return { error: "No vault escrow found for user", success: false };
          }

          const escrowBalance = await getRangeTokenBalance(cpmmAddress, rangeIndex, userEscrow);
          if (escrowBalance === BigInt(0)) {
            set.status = 400;
            return { error: "Escrow holds no shares for this range", success: false };
          }

          safeSharesRaw = escrowBalance < requestedSharesRaw ? escrowBalance : requestedSharesRaw;

          sellHash = await nm.withNonce((n) =>
            walletClient.writeContract({
              address: VAULT_ADDRESS!,
              abi: VaultABI,
              functionName: "executeRangeSell",
              args: [cpmmAddress, BigInt(rangeIndex), safeSharesRaw, userAddress as `0x${string}`],
              nonce: n,
            })
          );
          await publicClient.waitForTransactionReceipt({ hash: sellHash });
        } else {
          // Fallback: server wallet holds tokens, sell directly
          const serverAddress = walletClient.account.address;
          const onChainBalance = await getRangeTokenBalance(cpmmAddress, rangeIndex, serverAddress);

          if (onChainBalance === BigInt(0)) {
            set.status = 400;
            return { error: "Server wallet holds no shares for this range", success: false };
          }

          safeSharesRaw = onChainBalance < requestedSharesRaw ? onChainBalance : requestedSharesRaw;

          sellHash = await nm.withNonce((n) =>
            walletClient.writeContract({
              address: cpmmAddress,
              abi: RangePoolABI,
              functionName: "sell",
              args: [BigInt(rangeIndex), safeSharesRaw],
              nonce: n,
            })
          );
          await publicClient.waitForTransactionReceipt({ hash: sellHash });
        }

        const newPrices = await fetchOnChainPrices(cpmmAddress);

        // Fire WebSocket price update FIRST — before any DB writes.
        if (newPrices.length > 0) {
          await db.update(rangeMarkets)
            .set({ rangePrices: newPrices })
            .where(eq(rangeMarkets.id, id));
          await publishEvent("market:price", {
            marketId: id,
            rangePrices: newPrices,
            ranges: market.ranges,
            type: "range",
          });
          console.log("[RangeMarkets] Sell price update published", {
            marketId: id,
            rangeIndex,
            txHash: sellHash,
            rangePrices: newPrices,
          });
        }

        // Emit updated vault balance so the UI balance widget refreshes immediately
        await refreshAndEmitVaultBalance(userAddress.toLowerCase());

        const actualSharesSoldStr = bigintToDecimalShares(safeSharesRaw);

        try {
          await db.insert(rangeTrades).values({
            rangeMarketId: id,
            trader: userAddress.toLowerCase(),
            rangeIndex,
            isBuy: false,
            shares: actualSharesSoldStr,
            collateral: "0.000000",
            pricesSnapshot: newPrices,
            txHash: sellHash,
          }).onConflictDoNothing();
        } catch (dbErr) {
          console.error("[RangeMarkets] Sell: trade insert failed (non-fatal):", dbErr);
        }

        // Update position balance using bigint arithmetic to preserve precision
        try {
          const existingPos = await db
            .select()
            .from(rangePositions)
            .where(
              and(
                eq(rangePositions.rangeMarketId, id),
                eq(rangePositions.userAddress, userAddress.toLowerCase()),
                eq(rangePositions.rangeIndex, rangeIndex)
              )
            )
            .limit(1);

          if (existingPos.length > 0) {
            const prev = existingPos[0];
            const prevRaw = decimalSharesToBigint(prev.balance);
            const newBalanceRaw = prevRaw > safeSharesRaw ? prevRaw - safeSharesRaw : BigInt(0);
            await db.update(rangePositions)
              .set({ balance: bigintToDecimalShares(newBalanceRaw) })
              .where(eq(rangePositions.id, prev.id));
          }
        } catch (dbErr) {
          console.error("[RangeMarkets] Sell: position update failed (non-fatal):", dbErr);
        }

        return {
          success: true,
          data: { txHash: sellHash, sharesSold: actualSharesSoldStr, rangePrices: newPrices },
        };
      } catch (err: unknown) {
        console.error("[RangeMarkets] Sell error:", err);
        set.status = 500;
        return { error: (err as Error).message ?? "Trade failed", success: false };
      }
    },
    {
      body: t.Object({
        rangeIndex: t.Number(),
        shares: t.Number(),
        userAddress: t.String(),
        minOutput: t.Optional(t.String()),
        signature: t.Optional(t.String()),
        nonce: t.Optional(t.String()),
        deadline: t.Optional(t.String()),
      }),
    }
  )

  // POST /range-markets/:id/redeem — redeem winning tokens after resolution
  .post(
    "/:id/redeem",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const { userAddress } = body as { userAddress: string };

      const rows = await db.select().from(rangeMarkets).where(eq(rangeMarkets.id, id)).limit(1);
      if (rows.length === 0) {
        set.status = 404;
        return { error: "Range market not found", success: false };
      }
      const market = rows[0];

      if (!market.resolved) {
        set.status = 400;
        return { error: "Market not yet resolved", success: false };
      }
      if (market.winningRangeIndex == null) {
        set.status = 400;
        return { error: "Winning range not set", success: false };
      }

      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();
        const nm = getNonceManager();

        const redeemHash = await nm.withNonce((nonce) =>
          walletClient.writeContract({
            address: FACTORY_ADDRESS,
            abi: RangeMarketFactoryABI,
            functionName: "redeemRange",
            args: [BigInt(market.onChainMarketId!), BigInt(market.winningRangeIndex!)],
            nonce,
          })
        );
        await publicClient.waitForTransactionReceipt({ hash: redeemHash });

        return { success: true, data: { txHash: redeemHash } };
      } catch (err: unknown) {
        console.error("[RangeMarkets] Redeem error:", err);
        set.status = 500;
        return { error: (err as Error).message ?? "Redeem failed", success: false };
      }
    },
    {
      body: t.Object({ userAddress: t.String() }),
    }
  );
