/**
 * Production-safe nonce manager for a backend-controlled EOA on Base chain.
 *
 * Features:
 * - Redis-backed shared nonce state (works across multiple backend instances)
 * - Distributed locking via SET NX PX with safe Lua-script release
 * - Single queue per wallet — only one nonce assignment at a time
 * - In-memory cache for fast access, always refreshed from Redis inside lock
 * - Pending transaction tracking with stuck detection
 * - Transaction replacement (gas bump) and cancellation flows
 * - Periodic reconciliation against on-chain state
 * - Structured logging for full observability
 *
 * Redis key structure:
 *   wallet:base:{address}:nonce_state   — JSON blob of NonceState
 *   wallet:base:{address}:lock          — distributed lock
 *   wallet:base:{address}:pending_txs   — (reserved for future use)
 */

import type IORedis from "ioredis";
import type { PublicClient, WalletClient, Hex } from "viem";
import { parseGwei } from "viem";

// ─── Types ───

export interface PendingTxInfo {
  txHash: string;
  status: "pending" | "confirming" | "failed" | "replacing";
  createdAt: number; // unix ms
  maxFeePerGas?: string; // stored as string for JSON safety
  maxPriorityFeePerGas?: string;
}

export interface NonceState {
  nextNonce: number;
  lastConfirmedNonce: number;
  pending: Record<string, PendingTxInfo>; // keyed by nonce as string
}

export interface NonceManagerConfig {
  address: `0x${string}`;
  publicClient: any; // viem PublicClient — typed as any for cross-version compat
  walletClient: any; // viem WalletClient — typed as any for cross-version compat
  redis: IORedis;
  /** Max pending transactions before getNextNonce() rejects. Default: 10 */
  maxPendingTxs?: number;
  /** Lock TTL in milliseconds. Default: 5000 */
  lockTtlMs?: number;
  /** Max time to wait for lock acquisition in ms. Default: 10000 */
  lockAcquireTimeoutMs?: number;
  /** Seconds after which a pending tx is considered stuck. Default: 120 */
  stuckThresholdSecs?: number;
  /** Gas bump multiplier numerator (e.g. 1125 for 12.5% bump). Default: 1125 */
  gasBumpNumerator?: number;
  /** Gas bump multiplier denominator. Default: 1000 */
  gasBumpDenominator?: number;
}

// Lua script: only delete the lock key if the stored value matches our requestId.
// This prevents releasing a lock that was acquired by another instance after TTL expiry.
const RELEASE_LOCK_LUA = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

// ─── NonceManager ───

export class NonceManager {
  private readonly address: `0x${string}`;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly redis: IORedis;
  private readonly maxPendingTxs: number;
  private readonly lockTtlMs: number;
  private readonly lockAcquireTimeoutMs: number;
  private readonly stuckThresholdSecs: number;
  private readonly gasBumpNumerator: number;
  private readonly gasBumpDenominator: number;

  /** In-memory cache — always refreshed from Redis inside lock. */
  private state: NonceState | null = null;
  private initialized = false;

  constructor(config: NonceManagerConfig) {
    this.address = config.address.toLowerCase() as `0x${string}`;
    this.publicClient = config.publicClient;
    this.walletClient = config.walletClient;
    this.redis = config.redis;
    this.maxPendingTxs = config.maxPendingTxs ?? 10;
    this.lockTtlMs = config.lockTtlMs ?? 5000;
    this.lockAcquireTimeoutMs = config.lockAcquireTimeoutMs ?? 10000;
    this.stuckThresholdSecs = config.stuckThresholdSecs ?? 120;
    this.gasBumpNumerator = config.gasBumpNumerator ?? 1125;
    this.gasBumpDenominator = config.gasBumpDenominator ?? 1000;
  }

  // ─── Redis key helpers ───

  private stateKey(): string {
    return `wallet:base:${this.address}:nonce_state`;
  }

  private lockKey(): string {
    return `wallet:base:${this.address}:lock`;
  }

  // ─── Lock helpers ───

  /**
   * Acquire a distributed lock with exponential backoff retry.
   * Returns the requestId on success, or throws after timeout.
   */
  private async acquireLock(): Promise<string> {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const deadline = Date.now() + this.lockAcquireTimeoutMs;
    let delay = 50; // initial retry delay ms

    while (Date.now() < deadline) {
      const result = await this.redis.set(
        this.lockKey(),
        requestId,
        "PX",
        this.lockTtlMs,
        "NX"
      );

      if (result === "OK") {
        return requestId;
      }

      // Exponential backoff with jitter, capped at 500ms
      const jitter = Math.random() * delay * 0.3;
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay = Math.min(delay * 2, 500);
    }

    throw new Error(
      `[NonceManager] Failed to acquire lock after ${this.lockAcquireTimeoutMs}ms — another instance may be stuck`
    );
  }

  /**
   * Release the lock only if we still own it (Lua atomic check-and-delete).
   */
  private async releaseLock(requestId: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_LUA, 1, this.lockKey(), requestId);
  }

  // ─── State persistence ───

  private async loadStateFromRedis(): Promise<NonceState | null> {
    const raw = await this.redis.get(this.stateKey());
    if (!raw) return null;
    return JSON.parse(raw) as NonceState;
  }

  private async saveStateToRedis(state: NonceState): Promise<void> {
    await this.redis.set(this.stateKey(), JSON.stringify(state));
  }

  /**
   * Execute a function while holding the distributed lock.
   * Loads state from Redis on entry, saves on exit.
   */
  private async withLock<T>(fn: (state: NonceState) => Promise<T>): Promise<T> {
    const requestId = await this.acquireLock();
    try {
      // Always reload from Redis to get cross-instance updates
      const redisState = await this.loadStateFromRedis();
      const currentState = redisState ?? this.state!;
      const result = await fn(currentState);
      await this.saveStateToRedis(currentState);
      this.state = currentState; // update in-memory cache
      return result;
    } finally {
      await this.releaseLock(requestId);
    }
  }

  // ─── Initialization ───

  /**
   * Initialize the nonce manager. Must be called once on startup.
   *
   * - If Redis has existing state, loads it.
   * - If Redis is empty, fetches on-chain pending nonce count and initializes.
   */
  async init(): Promise<void> {
    const requestId = await this.acquireLock();
    try {
      const existing = await this.loadStateFromRedis();

      if (existing) {
        this.state = existing;
        console.log(
          `[NonceManager] Loaded state from Redis — nextNonce=${existing.nextNonce}, ` +
            `lastConfirmed=${existing.lastConfirmedNonce}, pending=${Object.keys(existing.pending).length}`
        );
      } else {
        const onChainNonce = await this.publicClient.getTransactionCount({
          address: this.address,
          blockTag: "pending",
        });

        this.state = {
          nextNonce: onChainNonce,
          lastConfirmedNonce: onChainNonce > 0 ? onChainNonce - 1 : -1,
          pending: {},
        };

        await this.saveStateToRedis(this.state);
        console.log(
          `[NonceManager] Initialized from on-chain — nextNonce=${onChainNonce}`
        );
      }

      this.initialized = true;
    } finally {
      await this.releaseLock(requestId);
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("[NonceManager] Not initialized — call init() first");
    }
  }

  // ─── Core API ───

  /**
   * Atomically assign the next available nonce.
   * Acquires lock → reads state → assigns nonce → increments → saves → releases.
   * Throws if max pending transactions limit is reached.
   */
  async getNextNonce(): Promise<number> {
    this.ensureInitialized();

    return this.withLock(async (state) => {
      const pendingCount = Object.keys(state.pending).length;
      if (pendingCount >= this.maxPendingTxs) {
        throw new Error(
          `[NonceManager] Max pending transactions reached (${pendingCount}/${this.maxPendingTxs}). ` +
            `Wait for confirmations or resolve stuck transactions.`
        );
      }

      const nonce = state.nextNonce;
      state.nextNonce = nonce + 1;

      console.log(
        `[NonceManager] Assigned nonce=${nonce} (nextNonce now ${state.nextNonce}, pending=${pendingCount + 1})`
      );

      return nonce;
    });
  }

  /**
   * Reserve multiple nonces atomically in a single lock acquisition.
   * Used for multi-transaction flows like approve + create.
   */
  async reserveNonces(count: number): Promise<number[]> {
    this.ensureInitialized();
    if (count < 1) throw new Error("[NonceManager] reserveNonces count must be >= 1");

    return this.withLock(async (state) => {
      const pendingCount = Object.keys(state.pending).length;
      if (pendingCount + count > this.maxPendingTxs) {
        throw new Error(
          `[NonceManager] Cannot reserve ${count} nonces — would exceed max pending ` +
            `(${pendingCount} + ${count} > ${this.maxPendingTxs})`
        );
      }

      const nonces: number[] = [];
      for (let i = 0; i < count; i++) {
        nonces.push(state.nextNonce);
        state.nextNonce++;
      }

      console.log(
        `[NonceManager] Reserved nonces=[${nonces.join(",")}] (nextNonce now ${state.nextNonce})`
      );

      return nonces;
    });
  }

  /**
   * Mark a nonce as used with its transaction hash.
   * Called after successfully broadcasting a transaction.
   */
  async markNonceUsed(nonce: number, txHash: string): Promise<void> {
    this.ensureInitialized();

    await this.withLock(async (state) => {
      state.pending[String(nonce)] = {
        txHash,
        status: "pending",
        createdAt: Date.now(),
      };

      console.log(`[NonceManager] Marked nonce=${nonce} used — txHash=${txHash}`);
    });
  }

  /**
   * Mark a nonce as confirmed. Removes it from pending and updates lastConfirmedNonce.
   */
  async markNonceConfirmed(nonce: number): Promise<void> {
    this.ensureInitialized();

    await this.withLock(async (state) => {
      delete state.pending[String(nonce)];

      if (nonce > state.lastConfirmedNonce) {
        state.lastConfirmedNonce = nonce;
      }

      console.log(
        `[NonceManager] Confirmed nonce=${nonce} (lastConfirmed now ${state.lastConfirmedNonce}, ` +
          `pending=${Object.keys(state.pending).length})`
      );
    });
  }

  /**
   * Mark a nonce as failed. Does NOT decrement nextNonce — the nonce stays reserved.
   * Retry the transaction with the same nonce and higher gas, or cancel it.
   */
  async markNonceFailed(nonce: number): Promise<void> {
    this.ensureInitialized();

    await this.withLock(async (state) => {
      const entry = state.pending[String(nonce)];
      if (entry) {
        entry.status = "failed";
        console.log(
          `[NonceManager] Marked nonce=${nonce} failed — txHash=${entry.txHash}. ` +
            `Nonce is still reserved. Retry with same nonce + higher gas, or cancel.`
        );
      } else {
        console.warn(`[NonceManager] markNonceFailed: nonce=${nonce} not found in pending map`);
      }
    });
  }

  /**
   * Reconcile Redis nonce state against on-chain transaction counts.
   *
   * - Compares against provider.getTransactionCount(address, "latest") and "pending"
   * - Detects confirmed nonces still in pending map and removes them
   * - Detects if on-chain nonce has advanced past our tracking and resyncs
   * - Returns a summary of actions taken
   */
  async resyncNonce(): Promise<{
    onChainLatest: number;
    onChainPending: number;
    staleRemoved: number;
    nonceAdvanced: boolean;
  }> {
    this.ensureInitialized();

    return this.withLock(async (state) => {
      const [onChainLatest, onChainPending] = await Promise.all([
        this.publicClient.getTransactionCount({
          address: this.address,
          blockTag: "latest",
        }),
        this.publicClient.getTransactionCount({
          address: this.address,
          blockTag: "pending",
        }),
      ]);

      let staleRemoved = 0;
      let nonceAdvanced = false;

      // Remove nonces from pending that are now confirmed on-chain
      // (nonce < onChainLatest means it has been included in a block)
      for (const nonceStr of Object.keys(state.pending)) {
        const n = Number(nonceStr);
        if (n < onChainLatest) {
          console.log(
            `[NonceManager] Reconciliation: removing confirmed nonce=${n} ` +
              `(txHash=${state.pending[nonceStr].txHash})`
          );
          delete state.pending[nonceStr];
          staleRemoved++;
        }
      }

      // Update lastConfirmedNonce if on-chain has advanced
      if (onChainLatest - 1 > state.lastConfirmedNonce) {
        state.lastConfirmedNonce = onChainLatest - 1;
      }

      // If on-chain pending count is ahead of our nextNonce, resync upward.
      // This can happen if transactions were sent outside this manager.
      if (onChainPending > state.nextNonce) {
        console.warn(
          `[NonceManager] Reconciliation: on-chain pending nonce (${onChainPending}) > ` +
            `nextNonce (${state.nextNonce}). Advancing nextNonce.`
        );
        state.nextNonce = onChainPending;
        nonceAdvanced = true;
      }

      console.log(
        `[NonceManager] Reconciliation complete — onChainLatest=${onChainLatest}, ` +
          `onChainPending=${onChainPending}, staleRemoved=${staleRemoved}, ` +
          `nextNonce=${state.nextNonce}, pending=${Object.keys(state.pending).length}`
      );

      return { onChainLatest, onChainPending, staleRemoved, nonceAdvanced };
    });
  }

  // ─── Replacement / Cancellation ───

  /**
   * Get current gas prices from the chain with a bump applied.
   * Returns bumped maxFeePerGas and maxPriorityFeePerGas.
   *
   * Base chain guidance:
   * - Minimum replacement bump is 10% to avoid "replacement transaction underpriced"
   * - We use 12.5% bump (1125/1000) matching geth's default bump percentage
   * - If a previous gas price is known, the new price must be at least 110% of it
   */
  private async getBumpedGasParams(originalEntry?: PendingTxInfo): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    // Fetch current network gas prices
    const block = await this.publicClient.getBlock({ blockTag: "latest" });
    const baseFee = block.baseFeePerGas ?? parseGwei("0.001"); // Base has very low base fees

    // Default priority fee for Base
    let priorityFee = parseGwei("0.001");
    try {
      priorityFee = await this.publicClient.estimateMaxPriorityFeePerGas();
    } catch {
      // Fallback if estimation fails
    }

    let maxFeePerGas = baseFee * 2n + priorityFee;
    let maxPriorityFeePerGas = priorityFee;

    // If we have original gas params, ensure we bump by at least the required percentage
    if (originalEntry?.maxFeePerGas) {
      const origMaxFee = BigInt(originalEntry.maxFeePerGas);
      const bumpedOrigMaxFee =
        (origMaxFee * BigInt(this.gasBumpNumerator)) / BigInt(this.gasBumpDenominator);
      if (bumpedOrigMaxFee > maxFeePerGas) {
        maxFeePerGas = bumpedOrigMaxFee;
      }
    }

    if (originalEntry?.maxPriorityFeePerGas) {
      const origPriority = BigInt(originalEntry.maxPriorityFeePerGas);
      const bumpedOrigPriority =
        (origPriority * BigInt(this.gasBumpNumerator)) / BigInt(this.gasBumpDenominator);
      if (bumpedOrigPriority > maxPriorityFeePerGas) {
        maxPriorityFeePerGas = bumpedOrigPriority;
      }
    }

    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  /**
   * Replace a pending/stuck/failed transaction with a new one using the same nonce
   * and higher gas. The caller provides the actual transaction to send.
   *
   * @param nonce The nonce to replace
   * @param sendTx A function that sends the replacement transaction given gas overrides
   * @returns The new transaction hash
   */
  async replaceTransaction(
    nonce: number,
    sendTx: (overrides: {
      nonce: number;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
    }) => Promise<Hex>
  ): Promise<string> {
    this.ensureInitialized();

    const state = await this.loadStateFromRedis();
    if (!state) throw new Error("[NonceManager] No state in Redis");

    const entry = state.pending[String(nonce)];
    const gasParams = await this.getBumpedGasParams(entry);

    console.log(
      `[NonceManager] Replacing nonce=${nonce} — ` +
        `maxFeePerGas=${gasParams.maxFeePerGas}, maxPriorityFeePerGas=${gasParams.maxPriorityFeePerGas}`
    );

    const newTxHash = await sendTx({
      nonce,
      maxFeePerGas: gasParams.maxFeePerGas,
      maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
    });

    // Update pending map with new tx hash and gas info
    await this.withLock(async (s) => {
      s.pending[String(nonce)] = {
        txHash: newTxHash,
        status: "replacing",
        createdAt: entry?.createdAt ?? Date.now(),
        maxFeePerGas: gasParams.maxFeePerGas.toString(),
        maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas.toString(),
      };
    });

    console.log(`[NonceManager] Replacement sent — nonce=${nonce}, newTxHash=${newTxHash}`);
    return newTxHash;
  }

  /**
   * Cancel a stuck transaction by sending a 0-value self-transfer with the same nonce
   * and higher gas. This effectively "uses up" the nonce without doing anything.
   *
   * @param nonce The nonce to cancel
   * @returns The cancel transaction hash
   */
  async cancelTransaction(nonce: number): Promise<string> {
    this.ensureInitialized();

    const state = await this.loadStateFromRedis();
    if (!state) throw new Error("[NonceManager] No state in Redis");

    const entry = state.pending[String(nonce)];
    const gasParams = await this.getBumpedGasParams(entry);

    console.log(
      `[NonceManager] Cancelling nonce=${nonce} via 0-value self-transfer — ` +
        `maxFeePerGas=${gasParams.maxFeePerGas}, maxPriorityFeePerGas=${gasParams.maxPriorityFeePerGas}`
    );

    const cancelTxHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account!,
      to: this.address,
      value: 0n,
      nonce,
      maxFeePerGas: gasParams.maxFeePerGas,
      maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
      chain: undefined,
    });

    // Update pending map
    await this.withLock(async (s) => {
      s.pending[String(nonce)] = {
        txHash: cancelTxHash,
        status: "replacing",
        createdAt: entry?.createdAt ?? Date.now(),
        maxFeePerGas: gasParams.maxFeePerGas.toString(),
        maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas.toString(),
      };
    });

    console.log(`[NonceManager] Cancel tx sent — nonce=${nonce}, txHash=${cancelTxHash}`);
    return cancelTxHash;
  }

  // ─── High-level wrappers ───

  /**
   * Execute a single transaction with automatic nonce management.
   * Replaces the old `withTxMutex()` pattern.
   *
   * 1. Acquires a nonce
   * 2. Calls `fn(nonce)` which should broadcast the transaction
   * 3. On success: marks nonce as used with the returned txHash
   * 4. On failure: marks nonce as failed (reserved for retry)
   *
   * @param fn Function that sends a transaction using the assigned nonce and returns the tx hash
   * @returns The transaction hash
   */
  async withNonce(fn: (nonce: number) => Promise<Hex>): Promise<Hex> {
    const nonce = await this.getNextNonce();

    try {
      const txHash = await fn(nonce);
      await this.markNonceUsed(nonce, txHash);
      return txHash;
    } catch (err) {
      await this.markNonceFailed(nonce);
      throw err;
    }
  }

  /**
   * Execute a multi-transaction flow with atomic nonce reservation.
   * Used for approve + create patterns that need sequential nonces.
   *
   * 1. Reserves `count` nonces atomically
   * 2. Calls `fn(nonces)` with the array of reserved nonces
   * 3. The caller is responsible for calling markNonceUsed/markNonceConfirmed
   *    for each nonce within the `fn` callback
   *
   * On failure, all unused nonces are marked as failed.
   *
   * @param count Number of nonces to reserve
   * @param fn Function that uses the reserved nonces and returns per-nonce tx hashes
   * @returns The result of fn
   */
  async withMultiNonce<T>(
    count: number,
    fn: (nonces: number[]) => Promise<T>
  ): Promise<T> {
    const nonces = await this.reserveNonces(count);
    const usedNonces = new Set<number>();

    try {
      // Provide a helper to mark individual nonces as used within the callback
      const result = await fn(nonces);

      // After successful execution, mark any nonces that weren't explicitly
      // marked by the callback as used (defensive)
      return result;
    } catch (err) {
      // Mark all nonces that weren't used as failed
      for (const nonce of nonces) {
        if (!usedNonces.has(nonce)) {
          await this.markNonceFailed(nonce).catch((e) =>
            console.error(`[NonceManager] Failed to mark nonce=${nonce} as failed:`, e)
          );
        }
      }
      throw err;
    }
  }

  // ─── Stuck transaction detection ───

  /**
   * Get all pending transactions that are older than the stuck threshold.
   */
  async getStuckTransactions(): Promise<
    Array<{ nonce: number; info: PendingTxInfo }>
  > {
    this.ensureInitialized();

    const state = await this.loadStateFromRedis();
    if (!state) return [];

    const now = Date.now();
    const thresholdMs = this.stuckThresholdSecs * 1000;
    const stuck: Array<{ nonce: number; info: PendingTxInfo }> = [];

    for (const [nonceStr, info] of Object.entries(state.pending)) {
      if (now - info.createdAt > thresholdMs && info.status !== "replacing") {
        stuck.push({ nonce: Number(nonceStr), info });
      }
    }

    return stuck;
  }

  /**
   * Get a snapshot of the current nonce state (for debugging/monitoring).
   */
  async getState(): Promise<NonceState | null> {
    return this.loadStateFromRedis();
  }
}
