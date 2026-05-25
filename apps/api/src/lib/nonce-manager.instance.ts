/**
 * Singleton NonceManager instance for the admin/operator EOA.
 *
 * Uses the PRIVATE_KEY env var to derive the address, and connects to
 * a non-batched public client plus a write-optimized walletClient.
 *
 * Call `initNonceManager()` once at server startup before any transactions.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { NonceManager } from "./nonce-manager";
import { redis } from "./redis";

const READ_RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const WRITE_RPC_URL =
  process.env.WRITE_RPC_URL ||
  READ_RPC_URL;

function createInstance(): NonceManager {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");

  const normalizedKey = privateKey.startsWith("0x")
    ? (privateKey as `0x${string}`)
    : (`0x${privateKey}` as `0x${string}`);

  const account = privateKeyToAccount(normalizedKey);

  const noncePublicClient = createPublicClient({
    chain: base,
    transport: http(READ_RPC_URL, {
      retryCount: 4,
      retryDelay: 500,
      timeout: 30_000,
    }),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(WRITE_RPC_URL, {
      retryCount: 3,
      retryDelay: 500,
      timeout: 30_000,
    }),
  });

  return new NonceManager({
    address: account.address,
    publicClient: noncePublicClient,
    walletClient,
    redis,
    maxPendingTxs: 1,
    lockTtlMs: 5_000,
    lockAcquireTimeoutMs: 10_000,
    stuckThresholdSecs: 120,
    queueTimeoutMs: 120_000,
    inflightPollIntervalMs: 4_000,
  });
}

/** Singleton instance — created lazily on first access. */
let _instance: NonceManager | null = null;
let _initPromise: Promise<void> | null = null;

export function getNonceManager(): NonceManager {
  if (!_instance) {
    _instance = createInstance();
  }
  return _instance;
}

/**
 * Initialize the nonce manager at server startup.
 * Loads state from Redis or syncs from on-chain.
 */
export async function initNonceManager(): Promise<void> {
  if (!_initPromise) {
    const nm = getNonceManager();
    _initPromise = nm.init().catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  await _initPromise;
}

/**
 * Lazily initialize the nonce manager before request-path transactions.
 * This covers dev/worker profiles where startup init may be disabled or still
 * in progress when the first trade arrives.
 */
export async function getInitializedNonceManager(): Promise<NonceManager> {
  await initNonceManager();
  return getNonceManager();
}
