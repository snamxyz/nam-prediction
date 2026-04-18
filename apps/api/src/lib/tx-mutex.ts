/**
 * In-memory async mutex that serialises all admin-wallet transactions.
 *
 * Alchemy (and most RPC providers) enforce a small in-flight transaction limit
 * per account.  Because market creation, resolution, and vault trading all
 * share the same PRIVATE_KEY signer, we must ensure only one `writeContract`
 * call is pending at a time.
 *
 * Usage:
 *   const hash = await withTxMutex(() => walletClient.writeContract({ ... }));
 */

let _lock: Promise<void> = Promise.resolve();

/**
 * Run `fn` while holding the global transaction lock.
 * Callers are serialised in FIFO order.
 */
export async function withTxMutex<T>(fn: () => Promise<T>): Promise<T> {
  // Capture the current tail of the queue so we wait for it.
  const prev = _lock;

  let release!: () => void;
  // Extend the queue with our own turn.
  _lock = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await prev; // wait for all prior tasks
    return await fn();
  } finally {
    release(); // let the next waiter proceed
  }
}
