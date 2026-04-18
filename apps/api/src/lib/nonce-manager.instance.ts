/**
 * Singleton NonceManager instance for the admin/operator EOA.
 *
 * Uses the PRIVATE_KEY env var to derive the address, and connects to
 * the shared publicClient (from indexer) and a write-optimized walletClient.
 *
 * Call `initNonceManager()` once at server startup before any transactions.
 */

import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { NonceManager } from "./nonce-manager";
import { redis } from "./redis";
import { publicClient } from "../services/indexer";

const WRITE_RPC_URL =
  process.env.WRITE_RPC_URL ||
  process.env.RPC_URL ||
  "https://mainnet.base.org";

function createInstance(): NonceManager {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");

  const normalizedKey = privateKey.startsWith("0x")
    ? (privateKey as `0x${string}`)
    : (`0x${privateKey}` as `0x${string}`);

  const account = privateKeyToAccount(normalizedKey);

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
    publicClient,
    walletClient,
    redis,
    maxPendingTxs: 1,
    lockTtlMs: 5_000,
    lockAcquireTimeoutMs: 10_000,
    stuckThresholdSecs: 120,
    queueTimeoutMs: 120_000,
    inflightPollIntervalMs: 2_000,
  });
}

/** Singleton instance — created lazily on first access. */
let _instance: NonceManager | null = null;

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
  const nm = getNonceManager();
  await nm.init();
}
