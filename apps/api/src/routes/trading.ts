import { Elysia, t } from "elysia";
import {
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  recoverTypedDataAddress,
  decodeEventLog,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../db/client";
import { markets, rangeMarkets, rangeTrades, trades, vaultTransactions } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import {
  CPMMABI,
  VaultABI,
  OutcomeTokenABI,
  TRADING_DOMAIN,
  TRADE_INTENT_TYPES,
  TRADE_INTENT_PRIMARY_TYPE,
} from "@nam-prediction/shared";
import { verifyPrivyToken, privyClient } from "../middleware/auth";
import { getCache, cacheKeys, redis } from "../lib/redis";
import { getNonceManager } from "../lib/nonce-manager.instance";
import {
  processTradeFill,
  watchTradesForPool,
  publicClient,
} from "../services/indexer";
import { reconcilePositionsForWallet } from "../services/position-reconciler";

// Writes can optionally be broadcast through a separate endpoint (e.g. the
// free public RPC, since writes are cheap and infrequent) while reads go
// through the paid provider configured for the indexer. Falls back to the
// read RPC when unset.
const WRITE_RPC_URL =
  process.env.WRITE_RPC_URL ||
  process.env.RPC_URL ||
  "https://mainnet.base.org";
const VAULT_ADDRESS = process.env.VAULT_ADDRESS as `0x${string}`;

// Read both pool reserves in a single multicall to stay under RPC rate limits.
async function readReserves(ammAddress: `0x${string}`): Promise<[bigint, bigint]> {
  const results = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: ammAddress, abi: CPMMABI, functionName: "yesReserve" },
      { address: ammAddress, abi: CPMMABI, functionName: "noReserve" },
    ],
  });
  return [results[0] as bigint, results[1] as bigint];
}

/// Fetch the pool's live fee configuration so estimates stay in sync with on-chain
/// state (e.g. an admin tweaking protocolFeeBps mid-flight).
async function readPoolFees(ammAddress: `0x${string}`): Promise<{
  lpFeeBps: bigint;
  protocolFeeBps: bigint;
}> {
  const results = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: ammAddress, abi: CPMMABI, functionName: "feeBps" },
      { address: ammAddress, abi: CPMMABI, functionName: "protocolFeeBps" },
    ],
  });
  return {
    lpFeeBps: results[0] as bigint,
    protocolFeeBps: results[1] as bigint,
  };
}

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");
  const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
  return createWalletClient({
    account,
    chain: base,
    transport: http(WRITE_RPC_URL, {
      retryCount: 3,
      retryDelay: 500,
      timeout: 30_000,
    }),
  });
}

// ─── AMM math helpers for estimates ───

// Mirrors CPMM.buyYes/buyNo: protocol fee is skimmed first off the gross input,
// the LP fee is then withheld from the AMM math, and the remainder drives the
// constant-product swap.
function estimateBuy(
  usdcIn: bigint,
  lpFeeBps: bigint,
  protocolFeeBps: bigint,
  yesReserve: bigint,
  noReserve: bigint,
  isYes: boolean
): { sharesOut: bigint; protocolFee: bigint; netIn: bigint } {
  const protocolFee = (usdcIn * protocolFeeBps) / 10000n;
  const netIn = usdcIn - protocolFee;
  const lpFee = (netIn * lpFeeBps) / 10000n;
  const usdcAfterFee = netIn - lpFee;
  const scaledIn = usdcAfterFee * 10n ** 12n;
  const k = yesReserve * noReserve;

  let sharesOut: bigint;
  if (isYes) {
    const newNoReserve = noReserve + scaledIn;
    const newYesReserve = k / newNoReserve;
    sharesOut = yesReserve - newYesReserve;
  } else {
    const newYesReserve = yesReserve + scaledIn;
    const newNoReserve = k / newYesReserve;
    sharesOut = noReserve - newNoReserve;
  }

  return { sharesOut, protocolFee, netIn };
}

// Mirrors CPMM.sellYes/sellNo: AMM math first, then LP fee retained in the pool,
// then the protocol fee is routed to the fee wallet. User receives what's left.
function estimateSell(
  sharesIn: bigint,
  lpFeeBps: bigint,
  protocolFeeBps: bigint,
  yesReserve: bigint,
  noReserve: bigint,
  isYes: boolean
): { usdcOut: bigint; grossOut: bigint; protocolFee: bigint } {
  const k = yesReserve * noReserve;

  let scaledOut: bigint;
  if (isYes) {
    const newYesReserve = yesReserve + sharesIn;
    const newNoReserve = k / newYesReserve;
    scaledOut = noReserve - newNoReserve;
  } else {
    const newNoReserve = noReserve + sharesIn;
    const newYesReserve = k / newNoReserve;
    scaledOut = yesReserve - newYesReserve;
  }

  const grossOut = scaledOut / 10n ** 12n;
  const lpFee = (grossOut * lpFeeBps) / 10000n;
  const afterLpFee = grossOut - lpFee;
  const protocolFee = (afterLpFee * protocolFeeBps) / 10000n;
  const usdcOut = afterLpFee - protocolFee;

  return { usdcOut, grossOut, protocolFee };
}

// ─── Signed intent helpers ───

const NONCE_TTL_SECONDS = 60 * 60 * 24; // 24h replay window

function nonceKey(wallet: string, nonce: string) {
  return `trading:nonce:used:${wallet.toLowerCase()}:${nonce}`;
}

/// Reserve a nonce atomically — returns true if we were the first to use it.
async function reserveNonce(wallet: string, nonce: string): Promise<boolean> {
  const result = await redis.set(nonceKey(wallet, nonce), "1", "EX", NONCE_TTL_SECONDS, "NX");
  return result === "OK";
}

/// Release a nonce after a failed trade so the user can retry with the same signature.
async function releaseNonce(wallet: string, nonce: string) {
  await redis.del(nonceKey(wallet, nonce));
}

/// Verify an EIP-712 signed trade intent and return the authoritative trader wallet.
/// Throws a user-friendly Error on any validation failure.
async function verifyTradeIntent(params: {
  signature: Hex;
  trader: `0x${string}`;
  marketId: bigint;
  ammAddress: `0x${string}`;
  isYes: boolean;
  isBuy: boolean;
  amount: bigint;
  minOutput: bigint;
  nonce: bigint;
  deadline: bigint;
  expectedTrader: `0x${string}`;
}): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (params.deadline <= now) {
    throw new Error("Intent expired");
  }

  const recovered = await recoverTypedDataAddress({
    domain: TRADING_DOMAIN,
    types: TRADE_INTENT_TYPES,
    primaryType: TRADE_INTENT_PRIMARY_TYPE,
    message: {
      trader: params.trader,
      marketId: params.marketId,
      ammAddress: params.ammAddress,
      isYes: params.isYes,
      isBuy: params.isBuy,
      amount: params.amount,
      minOutput: params.minOutput,
      nonce: params.nonce,
      deadline: params.deadline,
    },
    signature: params.signature,
  });

  if (recovered.toLowerCase() !== params.expectedTrader.toLowerCase()) {
    throw new Error("Signature does not match authenticated wallet");
  }
  if (params.trader.toLowerCase() !== params.expectedTrader.toLowerCase()) {
    throw new Error("Intent trader does not match authenticated wallet");
  }
}

/// Wait for the tx to confirm and extract the Trade event args. Throws if the
/// tx reverted so the caller can release the nonce and return a real error.
async function waitForTradeEvent(
  txHash: `0x${string}`,
  ammAddress: `0x${string}`
): Promise<{
  shares: bigint;
  collateral: bigint;
  marketId: bigint;
  blockNumber: bigint;
} | null> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted on-chain (tx=${txHash})`);
  }
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ammAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: CPMMABI,
        data: log.data,
        topics: log.topics,
      }) as { eventName: string; args: any };
      if (decoded.eventName === "Trade") {
        return {
          shares: decoded.args.shares as bigint,
          collateral: decoded.args.collateral as bigint,
          marketId: decoded.args.marketId as bigint,
          blockNumber: receipt.blockNumber,
        };
      }
    } catch {
      // Not a Trade event — skip
    }
  }
  return null;
}

export const tradingRoutes = new Elysia({ prefix: "/trading" })

  // ─── Estimate buy shares ───
  .get(
    "/estimate-buy",
    async ({ query, set }) => {
      const { marketId, side, usdcAmount } = query;

      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.id, Number(marketId)))
        .limit(1);

      if (market.length === 0) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }

      const m = market[0];
      const ammAddress = m.ammAddress as `0x${string}`;

      const [[yesReserve, noReserve], { lpFeeBps, protocolFeeBps }] = await Promise.all([
        readReserves(ammAddress),
        readPoolFees(ammAddress),
      ]);

      const usdcIn = parseUnits(usdcAmount, 6);
      const isYes = side.toLowerCase() === "yes";

      const { sharesOut, protocolFee, netIn } = estimateBuy(
        usdcIn,
        lpFeeBps,
        protocolFeeBps,
        yesReserve,
        noReserve,
        isYes
      );
      // Avg price is USDC spent per share (gross input includes protocol fee).
      const avgPrice = sharesOut > 0n ? Number(usdcIn) / (Number(sharesOut) / 1e18) : 0;

      return {
        success: true,
        data: {
          sharesOut: formatUnits(sharesOut, 18),
          sharesOutRaw: sharesOut.toString(),
          avgPrice: avgPrice.toFixed(6),
          potentialPayout: formatUnits(sharesOut, 18), // 1 share = 1 USDC if wins
          tradeAmount: formatUnits(usdcIn, 6),
          protocolFee: formatUnits(protocolFee, 6),
          protocolFeeRaw: protocolFee.toString(),
          netAmount: formatUnits(netIn, 6),
          netAmountRaw: netIn.toString(),
          lpFeeBps: lpFeeBps.toString(),
          protocolFeeBps: protocolFeeBps.toString(),
        },
      };
    },
    {
      query: t.Object({
        marketId: t.String(),
        side: t.String(),
        usdcAmount: t.String(),
      }),
    }
  )

  // ─── Estimate sell USDC out ───
  .get(
    "/estimate-sell",
    async ({ query, set }) => {
      const { marketId, side, sharesAmount } = query;

      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.id, Number(marketId)))
        .limit(1);

      if (market.length === 0) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }

      const m = market[0];
      const ammAddress = m.ammAddress as `0x${string}`;

      const [[yesReserve, noReserve], { lpFeeBps, protocolFeeBps }] = await Promise.all([
        readReserves(ammAddress),
        readPoolFees(ammAddress),
      ]);

      const sharesIn = parseUnits(sharesAmount, 18);
      const isYes = side.toLowerCase() === "yes";

      const { usdcOut, grossOut, protocolFee } = estimateSell(
        sharesIn,
        lpFeeBps,
        protocolFeeBps,
        yesReserve,
        noReserve,
        isYes
      );
      // Avg price is net USDC received per share sold.
      const avgPrice = Number(sharesIn) > 0 ? (Number(usdcOut) * 1e18) / Number(sharesIn) : 0;

      return {
        success: true,
        data: {
          usdcOut: formatUnits(usdcOut, 6),
          usdcOutRaw: usdcOut.toString(),
          avgPrice: avgPrice.toFixed(6),
          grossAmount: formatUnits(grossOut, 6),
          grossAmountRaw: grossOut.toString(),
          protocolFee: formatUnits(protocolFee, 6),
          protocolFeeRaw: protocolFee.toString(),
          netAmount: formatUnits(usdcOut, 6),
          netAmountRaw: usdcOut.toString(),
          lpFeeBps: lpFeeBps.toString(),
          protocolFeeBps: protocolFeeBps.toString(),
        },
      };
    },
    {
      query: t.Object({
        marketId: t.String(),
        side: t.String(),
        sharesAmount: t.String(),
      }),
    }
  )

  // ─── Get user balances ───
  .get(
    "/balance/:wallet",
    async ({ params, set }) => {
      const wallet = params.wallet.toLowerCase();

      // Get USDC balance from cache or chain (reads the user's personal escrow)
      let usdcBalance = await getCache(cacheKeys.userUsdcBalance(wallet));
      if (!usdcBalance && VAULT_ADDRESS) {
        try {
          const balance = await publicClient.readContract({
            address: VAULT_ADDRESS,
            abi: VaultABI,
            functionName: "balanceOf",
            args: [wallet as `0x${string}`],
          }) as bigint;
          usdcBalance = formatUnits(balance, 6);
        } catch {
          usdcBalance = "0";
        }
      }

      return {
        success: true,
        data: {
          wallet,
          usdcBalance: usdcBalance || "0",
        },
      };
    }
  )

  // ─── Get user escrow address (debug / UX) ───
  .get(
    "/escrow/:wallet",
    async ({ params, set }) => {
      const wallet = params.wallet.toLowerCase() as `0x${string}`;

      if (!VAULT_ADDRESS) {
        set.status = 500;
        return { success: false, error: "Vault not configured" };
      }

      try {
        const [deployed, predicted] = await Promise.all([
          publicClient.readContract({
            address: VAULT_ADDRESS,
            abi: VaultABI,
            functionName: "escrowOf",
            args: [wallet],
          }) as Promise<`0x${string}`>,
          publicClient.readContract({
            address: VAULT_ADDRESS,
            abi: VaultABI,
            functionName: "predictEscrow",
            args: [wallet],
          }) as Promise<`0x${string}`>,
        ]);

        const zero = "0x0000000000000000000000000000000000000000";
        return {
          success: true,
          data: {
            wallet,
            escrow: deployed,
            predictedEscrow: predicted,
            deployed: deployed.toLowerCase() !== zero,
          },
        };
      } catch (err: any) {
        set.status = 500;
        return { success: false, error: err.message || "Failed to read escrow" };
      }
    }
  )

  // ─── Issue a fresh one-time nonce for a trade intent ───
  //
  // Stateless + unique: `(epochMs << 16) | random16`. Uniqueness is enforced
  // when the nonce is actually consumed by /buy or /sell via Redis SETNX.
  .get(
    "/nonce/:wallet",
    async ({ params }) => {
      const wallet = params.wallet.toLowerCase();
      const ms = BigInt(Date.now());
      const rand = BigInt(Math.floor(Math.random() * 0x10000));
      const nonce = (ms << 16n) | rand;

      return {
        success: true,
        data: {
          wallet,
          nonce: nonce.toString(),
          // Convenience for clients — suggested default deadline (5 min).
          suggestedDeadline: (Math.floor(Date.now() / 1000) + 300).toString(),
        },
      };
    }
  )

  // ─── Buy (EIP-712 signed intent) ───
  .post(
    "/buy",
    async ({ body, headers, set }) => {
      const claims = await verifyPrivyToken(headers.authorization);
      if (!claims) {
        set.status = 401;
        return { success: false, error: "Unauthorized" };
      }

      const user = await privyClient.getUser(claims.userId);
      const walletAddress = user.wallet?.address as `0x${string}` | undefined;
      if (!walletAddress) {
        set.status = 400;
        return { success: false, error: "No wallet linked" };
      }

      const { marketId, side, amount, minOutput, nonce, deadline, signature } = body;
      const isYes = side === "YES";

      // Validate market
      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.id, marketId))
        .limit(1);

      if (market.length === 0) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }
      const m = market[0];
      if (m.resolved) {
        set.status = 400;
        return { success: false, error: "Market already resolved" };
      }
      if (m.status === "locked" || m.status === "resolving") {
        set.status = 400;
        return { success: false, error: "Market is locked" };
      }
      if (new Date() >= new Date(m.endTime)) {
        set.status = 400;
        return { success: false, error: "Market has ended" };
      }

      const ammAddress = m.ammAddress as `0x${string}`;
      const usdcParsed = BigInt(amount);
      const minOutputParsed = BigInt(minOutput);
      const nonceParsed = BigInt(nonce);
      const deadlineParsed = BigInt(deadline);

      if (usdcParsed <= 0n) {
        set.status = 400;
        return { success: false, error: "Invalid amount" };
      }

      // Verify EIP-712 signature
      try {
        await verifyTradeIntent({
          signature: signature as Hex,
          trader: walletAddress,
          marketId: BigInt(m.onChainId),
          ammAddress,
          isYes,
          isBuy: true,
          amount: usdcParsed,
          minOutput: minOutputParsed,
          nonce: nonceParsed,
          deadline: deadlineParsed,
          expectedTrader: walletAddress,
        });
      } catch (err: any) {
        set.status = 401;
        return { success: false, error: err.message || "Invalid signature" };
      }

      // Replay protection — reserve the nonce atomically
      const reserved = await reserveNonce(walletAddress, nonce);
      if (!reserved) {
        set.status = 409;
        return { success: false, error: "Nonce already used" };
      }

      // Best-effort slippage check before dispatching the tx.
      try {
        if (!VAULT_ADDRESS) throw new Error("Vault not configured");

        // One multicall: vault balance + both reserves + both fee tiers.
        const preflight = await publicClient.multicall({
          allowFailure: false,
          contracts: [
            { address: VAULT_ADDRESS, abi: VaultABI, functionName: "balanceOf", args: [walletAddress] },
            { address: ammAddress, abi: CPMMABI, functionName: "yesReserve" },
            { address: ammAddress, abi: CPMMABI, functionName: "noReserve" },
            { address: ammAddress, abi: CPMMABI, functionName: "feeBps" },
            { address: ammAddress, abi: CPMMABI, functionName: "protocolFeeBps" },
          ],
        });
        const vaultBalance = preflight[0] as bigint;
        const yesReserve = preflight[1] as bigint;
        const noReserve = preflight[2] as bigint;
        const lpFeeBps = preflight[3] as bigint;
        const protocolFeeBps = preflight[4] as bigint;
        if (vaultBalance < usdcParsed) {
          throw new Error("Insufficient deposited balance");
        }

        const { sharesOut: expectedShares } = estimateBuy(
          usdcParsed,
          lpFeeBps,
          protocolFeeBps,
          yesReserve,
          noReserve,
          isYes
        );
        if (expectedShares < minOutputParsed) {
          throw new Error("Slippage too high: expected output below minimum");
        }

        // Make sure the indexer is watching this pool, in case the market was
        // added after startup and no factory event ever fired.
        watchTradesForPool(ammAddress);

        const walletClient = getWalletClient();
        const fnName = isYes ? "executeBuyYes" : "executeBuyNo";
        const txHash = await getNonceManager().withNonce((nonce) =>
          walletClient.writeContract({
            address: VAULT_ADDRESS,
            abi: VaultABI,
            functionName: fnName,
            args: [ammAddress, usdcParsed, walletAddress],
            nonce,
          })
        );

        console.log(`[Trading] Buy ${side} on market #${marketId} for ${walletAddress}: tx=${txHash}`);

        // Wait for confirmation + parse the Trade event. Throws on revert.
        const filled = await waitForTradeEvent(txHash, ammAddress);
        if (!filled) {
          throw new Error("Trade event missing from receipt");
        }
        if (filled.shares < minOutputParsed) {
          throw new Error("Slippage exceeded: filled output below minimum");
        }

        // Eagerly update DB + publish realtime events so the UI sees the trade
        // immediately, without waiting for the log-polling indexer.
        await processTradeFill({
          onChainMarketId: filled.marketId,
          trader: walletAddress,
          isYes,
          isBuy: true,
          shares: filled.shares,
          collateral: filled.collateral,
          txHash,
          blockNumber: filled.blockNumber,
        });

        console.log(
          `[Trading] Buy filled: ${formatUnits(filled.shares, 18)} ${side} for ${formatUnits(filled.collateral, 6)} USDC`
        );

        return {
          success: true,
          data: {
            txHash,
            filledShares: formatUnits(filled.shares, 18),
            filledCollateral: formatUnits(filled.collateral, 6),
          },
        };
      } catch (err: any) {
        // Tx failed — release the nonce so the user can retry with the same signature.
        await releaseNonce(walletAddress, nonce);
        console.error("[Trading] Buy failed:", err);
        set.status = 500;
        return { success: false, error: err.shortMessage || err.message || "Trade execution failed" };
      }
    },
    {
      body: t.Object({
        marketId: t.Number(),
        side: t.Union([t.Literal("YES"), t.Literal("NO")]),
        amount: t.String(),
        minOutput: t.String(),
        nonce: t.String(),
        deadline: t.String(),
        signature: t.String(),
      }),
    }
  )

  // ─── Sell (EIP-712 signed intent) ───
  .post(
    "/sell",
    async ({ body, headers, set }) => {
      const claims = await verifyPrivyToken(headers.authorization);
      if (!claims) {
        set.status = 401;
        return { success: false, error: "Unauthorized" };
      }

      const user = await privyClient.getUser(claims.userId);
      const walletAddress = user.wallet?.address as `0x${string}` | undefined;
      if (!walletAddress) {
        set.status = 400;
        return { success: false, error: "No wallet linked" };
      }

      const { marketId, side, amount, minOutput, nonce, deadline, signature } = body;
      const isYes = side === "YES";

      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.id, marketId))
        .limit(1);

      if (market.length === 0) {
        set.status = 404;
        return { success: false, error: "Market not found" };
      }
      const m = market[0];
      if (m.resolved) {
        set.status = 400;
        return { success: false, error: "Market already resolved" };
      }
      if (m.status === "locked" || m.status === "resolving") {
        set.status = 400;
        return { success: false, error: "Market is locked" };
      }

      const ammAddress = m.ammAddress as `0x${string}`;
      const sharesParsed = BigInt(amount);
      const minOutputParsed = BigInt(minOutput);
      const nonceParsed = BigInt(nonce);
      const deadlineParsed = BigInt(deadline);

      if (sharesParsed <= 0n) {
        set.status = 400;
        return { success: false, error: "Invalid amount" };
      }

      try {
        await verifyTradeIntent({
          signature: signature as Hex,
          trader: walletAddress,
          marketId: BigInt(m.onChainId),
          ammAddress,
          isYes,
          isBuy: false,
          amount: sharesParsed,
          minOutput: minOutputParsed,
          nonce: nonceParsed,
          deadline: deadlineParsed,
          expectedTrader: walletAddress,
        });
      } catch (err: any) {
        set.status = 401;
        return { success: false, error: err.message || "Invalid signature" };
      }

      const reserved = await reserveNonce(walletAddress, nonce);
      if (!reserved) {
        set.status = 409;
        return { success: false, error: "Nonce already used" };
      }

      try {
        // Verify user owns enough shares on-chain + fetch reserves in one multicall.
        const tokenAddress = (isYes ? m.yesToken : m.noToken) as `0x${string}`;
        const preflight = await publicClient.multicall({
          allowFailure: false,
          contracts: [
            { address: tokenAddress, abi: OutcomeTokenABI, functionName: "balanceOf", args: [walletAddress] },
            { address: ammAddress, abi: CPMMABI, functionName: "yesReserve" },
            { address: ammAddress, abi: CPMMABI, functionName: "noReserve" },
            { address: ammAddress, abi: CPMMABI, functionName: "feeBps" },
            { address: ammAddress, abi: CPMMABI, functionName: "protocolFeeBps" },
          ],
        });
        const tokenBalance = preflight[0] as bigint;
        const yesReserve = preflight[1] as bigint;
        const noReserve = preflight[2] as bigint;
        const lpFeeBps = preflight[3] as bigint;
        const protocolFeeBps = preflight[4] as bigint;
        if (tokenBalance < sharesParsed) {
          throw new Error("Insufficient share balance");
        }

        const { usdcOut: expectedUsdc } = estimateSell(
          sharesParsed,
          lpFeeBps,
          protocolFeeBps,
          yesReserve,
          noReserve,
          isYes
        );
        if (expectedUsdc < minOutputParsed) {
          throw new Error("Slippage too high: expected output below minimum");
        }

        watchTradesForPool(ammAddress);

        const walletClient = getWalletClient();
        const fnName = isYes ? "executeSellYes" : "executeSellNo";
        const txHash = await getNonceManager().withNonce((nonce) =>
          walletClient.writeContract({
            address: VAULT_ADDRESS,
            abi: VaultABI,
            functionName: fnName,
            args: [ammAddress, sharesParsed, walletAddress],
            nonce,
          })
        );

        console.log(`[Trading] Sell ${side} on market #${marketId} for ${walletAddress}: tx=${txHash}`);

        const filled = await waitForTradeEvent(txHash, ammAddress);
        if (!filled) {
          throw new Error("Trade event missing from receipt");
        }
        if (filled.collateral < minOutputParsed) {
          throw new Error("Slippage exceeded: filled output below minimum");
        }

        await processTradeFill({
          onChainMarketId: filled.marketId,
          trader: walletAddress,
          isYes,
          isBuy: false,
          shares: filled.shares,
          collateral: filled.collateral,
          txHash,
          blockNumber: filled.blockNumber,
        });

        console.log(
          `[Trading] Sell filled: ${formatUnits(filled.shares, 18)} ${side} for ${formatUnits(filled.collateral, 6)} USDC`
        );

        return {
          success: true,
          data: {
            txHash,
            filledShares: formatUnits(filled.shares, 18),
            filledCollateral: formatUnits(filled.collateral, 6),
          },
        };
      } catch (err: any) {
        await releaseNonce(walletAddress, nonce);
        console.error("[Trading] Sell failed:", err);
        set.status = 500;
        return { success: false, error: err.shortMessage || err.message || "Trade execution failed" };
      }
    },
    {
      body: t.Object({
        marketId: t.Number(),
        side: t.Union([t.Literal("YES"), t.Literal("NO")]),
        amount: t.String(),
        minOutput: t.String(),
        nonce: t.String(),
        deadline: t.String(),
        signature: t.String(),
      }),
    }
  )

  // ─── On-demand position reconcile ───
  //
  // Called by the frontend usePortfolio hook on mount + every 15 s so that
  // any DB ↔ chain drift is healed before the user sees stale balances.
  // Returns the number of positions checked and how many were healed.
  .post(
    "/reconcile/:wallet",
    async ({ params, headers, set }) => {
      const claims = await verifyPrivyToken(headers.authorization);
      if (!claims) {
        set.status = 401;
        return { success: false, error: "Unauthorized" };
      }

      const wallet = params.wallet.toLowerCase();
      try {
        const result = await reconcilePositionsForWallet(wallet);
        return { success: true, data: result };
      } catch (err: any) {
        set.status = 500;
        return { success: false, error: err.message || "Reconcile failed" };
      }
    }
  )

  // ─── Vault and trading transaction history ───
  //
  // Returns a combined ledger for a wallet, ordered newest first.
  .get(
    "/transactions/:wallet",
    async ({ params, query }) => {
      const wallet = params.wallet.toLowerCase();
      const limit = Math.min(Number(query?.limit ?? 50), 200);
      const cursor = query?.cursor;

      const vaultRows = await db
        .select()
        .from(vaultTransactions)
        .where(eq(vaultTransactions.userAddress, wallet))
        .orderBy(desc(vaultTransactions.timestamp))
        .limit(200);

      const binaryRows = await db
        .select({
          id: trades.id,
          marketId: trades.marketId,
          question: markets.question,
          isYes: trades.isYes,
          isBuy: trades.isBuy,
          amount: trades.collateral,
          shares: trades.shares,
          txHash: trades.txHash,
          timestamp: trades.timestamp,
        })
        .from(trades)
        .innerJoin(markets, eq(trades.marketId, markets.id))
        .where(eq(trades.trader, wallet))
        .orderBy(desc(trades.timestamp))
        .limit(200);

      const rangeRows = await db
        .select({
          id: rangeTrades.id,
          marketId: rangeTrades.rangeMarketId,
          question: rangeMarkets.question,
          rangeIndex: rangeTrades.rangeIndex,
          isBuy: rangeTrades.isBuy,
          amount: rangeTrades.collateral,
          shares: rangeTrades.shares,
          txHash: rangeTrades.txHash,
          timestamp: rangeTrades.timestamp,
        })
        .from(rangeTrades)
        .innerJoin(rangeMarkets, eq(rangeTrades.rangeMarketId, rangeMarkets.id))
        .where(eq(rangeTrades.trader, wallet))
        .orderBy(desc(rangeTrades.timestamp))
        .limit(200);

      const ledger = [
        ...vaultRows.map((row) => ({
          id: `vault-${row.id}`,
          userAddress: row.userAddress,
          type: row.type,
          amount: row.amount,
          txHash: row.txHash,
          blockNumber: row.blockNumber,
          timestamp: row.timestamp,
          source: "vault" as const,
        })),
        ...binaryRows.map((row) => ({
          id: `binary-${row.id}`,
          userAddress: wallet,
          type: row.isBuy ? "buy" : "sell",
          amount: row.amount,
          shares: row.shares,
          txHash: row.txHash,
          blockNumber: null,
          timestamp: row.timestamp,
          source: "binary" as const,
          marketId: row.marketId,
          question: row.question,
          side: row.isYes ? "YES" : "NO",
        })),
        ...rangeRows.map((row) => ({
          id: `range-${row.id}`,
          userAddress: wallet,
          type: row.isBuy ? "buy" : "sell",
          amount: row.amount,
          shares: row.shares,
          txHash: row.txHash,
          blockNumber: null,
          timestamp: row.timestamp,
          source: "range" as const,
          marketId: row.marketId,
          question: row.question,
          side: `Range ${row.rangeIndex}`,
        })),
      ].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      const start = cursor
        ? Math.max(0, ledger.findIndex((row) => row.id === cursor) + 1)
        : 0;
      const page = ledger.slice(start, start + limit);

      return {
        success: true,
        data: page,
        nextCursor: page.length === limit ? page[page.length - 1]?.id : null,
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
    }
  );
