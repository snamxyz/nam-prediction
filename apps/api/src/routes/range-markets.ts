import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { rangeMarkets, rangePositions, rangeTrades, vaultTransactions } from "../db/schema";
import { eq, desc, and } from "drizzle-orm";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  decodeEventLog,
  encodeAbiParameters,
  verifyTypedData,
  isAddress,
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
import { publishEvent, getCache, setCache, cacheKeys, redis } from "../lib/redis";
import { getNonceManager } from "../lib/nonce-manager.instance";
import { verifyPrivyToken, privyClient } from "../middleware/auth";

// ─── Replay protection ───
//
// Each signed range-trade intent carries a nonce. We reserve the nonce in
// Redis with SETNX so a captured signature cannot be re-submitted. The TTL
// must match the intent's signature window (24h is plenty — intent deadlines
// are typically minutes).
const RANGE_NONCE_TTL_SECONDS = 60 * 60 * 24;

function rangeNonceKey(wallet: string, nonce: string) {
  return `range-trading:nonce:used:${wallet.toLowerCase()}:${nonce}`;
}

async function reserveRangeNonce(wallet: string, nonce: string): Promise<boolean> {
  const result = await redis.set(rangeNonceKey(wallet, nonce), "1", "EX", RANGE_NONCE_TTL_SECONDS, "NX");
  return result === "OK";
}

async function releaseRangeNonce(wallet: string, nonce: string) {
  await redis.del(rangeNonceKey(wallet, nonce));
}

/**
 * Resolve a trade wallet from the Privy JWT in the Authorization header.
 * If a requested wallet is supplied, it must be one of the user's linked
 * Privy wallets. This lets users sign with the wallet the UI selected while
 * still preventing body-only impersonation.
 *
 * All trade-execution endpoints MUST run this and use the returned address
 * as the authoritative trader — never trust `userAddress` from the request
 * body, since the server-controlled operator wallet would otherwise be
 * tricked into pulling funds from any victim escrow.
 */
async function resolveAuthenticatedWallet(
  authHeader: string | null | undefined,
  requestedWallet?: string | null
): Promise<`0x${string}` | null> {
  const claims = await verifyPrivyToken(authHeader);
  if (!claims) return null;
  try {
    const user = await privyClient.getUser(claims.userId);
    const wallets = new Set<string>();
    const addWallet = (account: unknown) => {
      const address = (account as { address?: unknown } | null)?.address;
      if (typeof address === "string" && isAddress(address)) {
        wallets.add(address.toLowerCase());
      }
    };

    addWallet(user.wallet);
    for (const account of user.linkedAccounts ?? []) {
      if ((account as { type?: unknown }).type === "wallet") addWallet(account);
    }

    if (wallets.size === 0) return null;
    if (requestedWallet) {
      if (!isAddress(requestedWallet)) return null;
      const requested = requestedWallet.toLowerCase();
      return wallets.has(requested) ? (requested as `0x${string}`) : null;
    }

    return [...wallets][0] as `0x${string}`;
  } catch {
    return null;
  }
}

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = (process.env.RANGE_FACTORY_ADDRESS || process.env.MARKET_FACTORY_ADDRESS) as `0x${string}`;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS as `0x${string}` | undefined;
const RANGE_LMSR_ADAPTER_ADDRESS = process.env.RANGE_LMSR_ADAPTER_ADDRESS as `0x${string}` | undefined;
const RANGE_REDEEMED_EVENT_ABI = [
  {
    type: "event",
    name: "RangeRedeemed",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "rangeIndex", type: "uint256", indexed: false },
      { name: "usdcOut", type: "uint256", indexed: false },
    ],
  },
] as const;

function encodeRangeTrade(isBuy: boolean, rangeIndex: bigint, amount: bigint, minOutput: bigint): `0x${string}` {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "isBuy", type: "bool" },
          { name: "rangeIndex", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "minOutput", type: "uint256" },
        ],
      },
    ],
    [{ isBuy, rangeIndex, amount, minOutput }]
  );
}

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
const DECIMAL_INPUT_RE = /^\d+(?:\.\d+)?$/;

function parseDecimalUnits(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!DECIMAL_INPUT_RE.test(trimmed)) return null;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return null;
  }
}

function getErrorMessage(err: unknown): string {
  return (
    (err as { shortMessage?: string; message?: string }).shortMessage ||
    (err as { message?: string }).message ||
    "Unknown error"
  );
}

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

function bigintToDecimalUsdc(raw: bigint): string {
  const unit = 1_000_000n;
  const intPart = raw / unit;
  const fracPart = raw % unit;
  return `${intPart}.${fracPart.toString().padStart(6, "0")}`;
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
    for (const market of rows) {
      if (!market.rangeCpmmAddress || market.resolved || market.status !== "active") continue;
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

  // GET /range-markets/:id/quote-sell?rangeIndex=&shares= — quote exact USDC for a sell
  .get("/:id/quote-sell", async ({ params, query, set }) => {
    const id = Number(params.id);
    const rangeIndex = Number(query.rangeIndex);
    const sharesParam = typeof query.shares === "string" ? query.shares : String(query.shares ?? "");
    const sharesRaw = parseDecimalUnits(sharesParam, 18);

    if (isNaN(id) || isNaN(rangeIndex) || sharesRaw == null || sharesRaw <= 0n || rangeIndex < 0) {
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
      const usdcOut = await client.readContract({
        address: market.rangeCpmmAddress as `0x${string}`,
        abi: RangePoolABI,
        functionName: "quoteSell",
        args: [BigInt(rangeIndex), sharesRaw],
      }) as bigint;

      return {
        success: true,
        data: {
          rangeIndex,
          shares: Number(sharesRaw) / 1e18,
          usdcOut: bigintToDecimalUsdc(usdcOut),
          usdcOutRaw: usdcOut.toString(),
          usdcOutFloat: Number(usdcOut) / 1e6,
        },
      };
    } catch (err: unknown) {
      console.error("[RangeMarkets] Sell quote error:", err);
      set.status = 400;
      return {
        error: `Sell quote unavailable for this deployed range market: ${getErrorMessage(err)}`,
        success: false,
      };
    }
  })

  // POST /range-markets/:id/buy — buy a range outcome
  .post(
    "/:id/buy",
    async ({ params, body, headers, set }) => {
      const id = Number(params.id);
      const { rangeIndex, usdcAmount, minOutput, signature, nonce, deadline, userAddress: requestedUserAddress } = body as {
        rangeIndex: number;
        usdcAmount: number;
        minOutput?: string;
        signature: string;
        nonce: string;
        deadline: string;
        userAddress?: string;
      };

      // ── Auth: the signed trader wallet must be linked to the Privy user ──
      // Without this, an unauthenticated caller could pass `userAddress: <victim>`
      // and have the operator drain that victim's vault escrow.
      const userAddress = await resolveAuthenticatedWallet(headers.authorization, requestedUserAddress);
      if (!userAddress) {
        set.status = 401;
        return { error: "Unauthorized", success: false };
      }

      if (isNaN(id) || rangeIndex < 0 || usdcAmount <= 0) {
        set.status = 400;
        return { error: "Invalid parameters", success: false };
      }

      // Signature, nonce, and deadline are required so that the operator wallet
      // can only execute trades the user has explicitly approved.
      if (!signature || !nonce || !deadline) {
        set.status = 400;
        return { error: "signature, nonce, and deadline are required", success: false };
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

      try {
        await verifyRangeTradeSignature({
          signature: signature as `0x${string}`,
          trader: userAddress,
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

      // Replay protection — reserve the nonce atomically. A second submission
      // with the same signature is rejected.
      const reserved = await reserveRangeNonce(userAddress, nonce);
      if (!reserved) {
        set.status = 409;
        return { error: "Nonce already used", success: false };
      }

      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();
        const nm = getNonceManager();

        // Vault pre-flight: check escrow existence and balance using fresh on-chain reads
        if (VAULT_ADDRESS) {
          const userEscrow = await getUserEscrow(userAddress as `0x${string}`);
          if (!userEscrow) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return {
              error: "No vault escrow found. Please deposit USDC to the vault to create your escrow before trading.",
              success: false,
            };
          }
          const vaultBalance = await getUserVaultBalance(userAddress as `0x${string}`);
          if (vaultBalance < usdcAmountRaw) {
            await releaseRangeNonce(userAddress, nonce);
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
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return { error: "Slippage: current quote below signed minimum", success: false };
          }
        }

        if (VAULT_ADDRESS) {
          if (!RANGE_LMSR_ADAPTER_ADDRESS) throw new Error("RANGE_LMSR_ADAPTER_ADDRESS not configured");
          const tradeData = encodeRangeTrade(true, BigInt(rangeIndex), usdcAmountRaw, minOutputRaw);
          buyHash = await nm.withNonce((n) =>
            walletClient.writeContract({
              address: VAULT_ADDRESS!,
              abi: VaultABI,
              functionName: "executeTrade",
              args: [RANGE_LMSR_ADAPTER_ADDRESS, cpmmAddress, userAddress, tradeData],
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
        // Tx never landed — release the nonce so the user can retry with the same signature.
        await releaseRangeNonce(userAddress, nonce);
        console.error("[RangeMarkets] Buy error:", err);
        set.status = 500;
        return { error: (err as Error).message ?? "Trade failed", success: false };
      }
    },
    {
      body: t.Object({
        rangeIndex: t.Number(),
        usdcAmount: t.Number(),
        userAddress: t.Optional(t.String()),
        signature: t.String(),
        minOutput: t.Optional(t.String()),
        nonce: t.String(),
        deadline: t.String(),
      }),
    }
  )

  // POST /range-markets/:id/sell — sell a range outcome
  .post(
    "/:id/sell",
    async ({ params, body, headers, set }) => {
      const id = Number(params.id);
      const { rangeIndex, shares, minOutput, signature, nonce, deadline, userAddress: requestedUserAddress } = body as {
        rangeIndex: number;
        shares: number | string;
        minOutput?: string;
        signature: string;
        nonce: string;
        deadline: string;
        userAddress?: string;
      };

      // ── Auth: the signed seller wallet must be linked to the Privy user ──
      // Same exposure as buy: an unauthenticated body-only flow lets an
      // attacker burn a victim's range tokens.
      const userAddress = await resolveAuthenticatedWallet(headers.authorization, requestedUserAddress);
      if (!userAddress) {
        set.status = 401;
        return { error: "Unauthorized", success: false };
      }

      const sharesParam = typeof shares === "string" ? shares : String(shares);
      const requestedSharesRaw = parseDecimalUnits(sharesParam, 18);

      if (isNaN(id) || rangeIndex < 0 || requestedSharesRaw == null || requestedSharesRaw <= 0n) {
        set.status = 400;
        return { error: "Invalid parameters", success: false };
      }

      if (!signature || !nonce || !deadline) {
        set.status = 400;
        return { error: "signature, nonce, and deadline are required", success: false };
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
      const minOutputRaw = minOutput ? BigInt(minOutput) : BigInt(0);

      try {
        await verifyRangeTradeSignature({
          signature: signature as `0x${string}`,
          trader: userAddress,
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

      const reserved = await reserveRangeNonce(userAddress, nonce);
      if (!reserved) {
        set.status = 409;
        return { error: "Nonce already used", success: false };
      }

      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();
        const nm = getNonceManager();

        let safeSharesRaw: bigint;
        let sellHash: `0x${string}`;

        if (VAULT_ADDRESS) {
          // Route proceeds through the user's vault escrow. Range tokens are
          // minted to the user wallet, and the pool burns from that signed seller.
          const userEscrow = await getUserEscrow(userAddress);
          if (!userEscrow) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return { error: "No vault escrow found for user", success: false };
          }

          const tokenBalance = await getRangeTokenBalance(cpmmAddress, rangeIndex, userAddress);
          if (tokenBalance === BigInt(0)) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return { error: "Wallet holds no shares for this range", success: false };
          }

          if (tokenBalance < requestedSharesRaw) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return { error: "Insufficient wallet shares for signed sell amount", success: false };
          }
          safeSharesRaw = requestedSharesRaw;

          let quotedUsdc: bigint;
          try {
            quotedUsdc = await publicClient.readContract({
              address: cpmmAddress,
              abi: RangePoolABI,
              functionName: "quoteSell",
              args: [BigInt(rangeIndex), safeSharesRaw],
            }) as bigint;
          } catch (err) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return {
              error: `Sell quote unavailable for this deployed range market: ${getErrorMessage(err)}`,
              success: false,
            };
          }
          if (minOutputRaw > 0n && quotedUsdc < minOutputRaw) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return { error: "Slippage: current quote below signed minimum", success: false };
          }

          if (!RANGE_LMSR_ADAPTER_ADDRESS) throw new Error("RANGE_LMSR_ADAPTER_ADDRESS not configured");
          const tradeData = encodeRangeTrade(false, BigInt(rangeIndex), safeSharesRaw, minOutputRaw);
          sellHash = await nm.withNonce((n) =>
            walletClient.writeContract({
              address: VAULT_ADDRESS!,
              abi: VaultABI,
              functionName: "executeTrade",
              args: [RANGE_LMSR_ADAPTER_ADDRESS, cpmmAddress, userAddress, tradeData],
              nonce: n,
            })
          );
          await publicClient.waitForTransactionReceipt({ hash: sellHash });
        } else {
          // Fallback: server wallet holds tokens, sell directly
          const serverAddress = walletClient.account.address;
          const onChainBalance = await getRangeTokenBalance(cpmmAddress, rangeIndex, serverAddress);

          if (onChainBalance === BigInt(0)) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return { error: "Server wallet holds no shares for this range", success: false };
          }

          if (onChainBalance < requestedSharesRaw) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return { error: "Insufficient shares for signed sell amount", success: false };
          }
          safeSharesRaw = requestedSharesRaw;

          let quotedUsdc: bigint;
          try {
            quotedUsdc = await publicClient.readContract({
              address: cpmmAddress,
              abi: RangePoolABI,
              functionName: "quoteSell",
              args: [BigInt(rangeIndex), safeSharesRaw],
            }) as bigint;
          } catch (err) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return {
              error: `Sell quote unavailable for this deployed range market: ${getErrorMessage(err)}`,
              success: false,
            };
          }
          if (minOutputRaw > 0n && quotedUsdc < minOutputRaw) {
            await releaseRangeNonce(userAddress, nonce);
            set.status = 400;
            return { error: "Slippage: current quote below signed minimum", success: false };
          }

          sellHash = await nm.withNonce((n) =>
            walletClient.writeContract({
              address: cpmmAddress,
              abi: RangePoolABI,
              functionName: "sell",
              args: [BigInt(rangeIndex), safeSharesRaw, minOutputRaw],
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
        await releaseRangeNonce(userAddress, nonce);
        console.error("[RangeMarkets] Sell error:", err);
        set.status = 500;
        return { error: (err as Error).message ?? "Trade failed", success: false };
      }
    },
    {
      body: t.Object({
        rangeIndex: t.Number(),
        shares: t.Union([t.Number(), t.String()]),
        userAddress: t.Optional(t.String()),
        minOutput: t.Optional(t.String()),
        signature: t.String(),
        nonce: t.String(),
        deadline: t.String(),
      }),
    }
  )

  // POST /range-markets/:id/redeem — redeem winning tokens after resolution
  //
  // SECURITY NOTE: `RangeMarketFactory.redeemRange` resolves the redeemer via
  // `msg.sender`, so calling it from the operator wallet would attempt to burn
  // the OPERATOR's range tokens (zero) and the user would never see funds. The
  // correct flow is for the user to call `redeemRange` directly from their own
  // wallet — this endpoint only persists the resulting on-chain receipt for
  // history. Until a delegated `redeemRangeFor(user)` exists on the factory,
  // we only accept already-confirmed user-broadcast tx hashes here.
  .post(
    "/:id/redeem",
    async ({ params, body, headers, set }) => {
      const userAddress = await resolveAuthenticatedWallet(headers.authorization);
      if (!userAddress) {
        set.status = 401;
        return { error: "Unauthorized", success: false };
      }

      const id = Number(params.id);
      const { txHash } = body as { txHash: string };

      if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        set.status = 400;
        return { error: "Valid txHash required (user must broadcast redemption)", success: false };
      }

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
        const publicClient = getPublicClient();
        const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
        if (!receipt || receipt.status !== "success") {
          set.status = 400;
          return { error: "Transaction not confirmed or reverted", success: false };
        }

        // Verify the redemption was actually for the authenticated user. The
        // RangeRedeemed event indexes `user`, so we can match it against the
        // JWT-derived wallet to prevent users tagging their history with
        // someone else's tx.
        let redeemedAmount = "0";
        let matched = false;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({
              abi: RANGE_REDEEMED_EVENT_ABI,
              data: log.data,
              topics: log.topics,
            }) as {
              eventName: string;
              args: { user?: `0x${string}`; usdcOut?: bigint; marketId?: bigint };
            };
            if (
              decoded.eventName === "RangeRedeemed" &&
              decoded.args.user?.toLowerCase() === userAddress &&
              decoded.args.marketId === BigInt(market.onChainMarketId!) &&
              decoded.args.usdcOut != null
            ) {
              redeemedAmount = formatUnits(decoded.args.usdcOut, 6);
              matched = true;
              break;
            }
          } catch {
            // Not the range redemption event.
          }
        }

        if (!matched) {
          set.status = 400;
          return { error: "RangeRedeemed event for this user not found in tx", success: false };
        }

        await db
          .insert(vaultTransactions)
          .values({
            userAddress,
            type: "redemption",
            amount: redeemedAmount,
            txHash,
            blockNumber: receipt.blockNumber.toString(),
          })
          .onConflictDoNothing({ target: vaultTransactions.txHash });

        return { success: true, data: { txHash, amount: redeemedAmount } };
      } catch (err: unknown) {
        console.error("[RangeMarkets] Redeem error:", err);
        set.status = 500;
        return { error: (err as Error).message ?? "Redeem failed", success: false };
      }
    },
    {
      body: t.Object({ txHash: t.String() }),
    }
  );
