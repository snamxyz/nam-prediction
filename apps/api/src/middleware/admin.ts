/**
 * Admin authentication middleware.
 *
 * Two-factor gate:
 *   1. A valid Privy JWT in the Authorization: Bearer header.
 *   2. The wallet resolved from that JWT must appear in the built-in admin
 *      allow-list or ADMIN_ADDRESSES environment variable (comma-separated).
 *
 * Usage:
 *   const claims = await verifyAdminToken(headers.authorization);
 *   if (!claims) { set.status = 403; return { error: "Forbidden" }; }
 */

import { verifyPrivyToken, privyClient } from "./auth";

const DEFAULT_ADMIN_ADDRESSES = [
  "0xfeb6ca810ca03f02139a6eac52fe1fcb5410cb28",
  "0x706709a08f95387f3afa207dc030320ca0ea2d91",
  "0xdd9f8b4994ece2ef1f15a42b6c346e0ed0428fa6",
  "0x1ce256752fba067675f09291d12a1f069f34f5e8",
].map((address) => address.toLowerCase());

const ENV_ADMIN_ADDRESSES = (process.env.ADMIN_ADDRESSES || "")
  .split(",")
  .map((address) => address.trim().toLowerCase())
  .filter(Boolean);

const ADMIN_ADDRESSES = new Set([...DEFAULT_ADMIN_ADDRESSES, ...ENV_ADMIN_ADDRESSES]);

function getWalletAddress(user: Awaited<ReturnType<typeof privyClient.getUser>>): string | null {
  const wallet =
    user.wallet ||
    user.linkedAccounts?.find((account: any) => account.type === "wallet");

  return wallet && "address" in wallet ? String(wallet.address).toLowerCase() : null;
}

export interface AdminClaims {
  userId: string;
  walletAddress: string;
}

/**
 * Verify the bearer token and check that the linked wallet is in the admin
 * allow-list. Returns `null` on any failure so callers return 403 cleanly.
 */
export async function verifyAdminToken(
  authorization: string | null | undefined
): Promise<AdminClaims | null> {
  if (!authorization) return null;

  const claims = await verifyPrivyToken(authorization);
  if (!claims) return null;

  let walletAddress: string | null = null;
  try {
    const user = await privyClient.getUser(claims.userId);
    walletAddress = getWalletAddress(user);
  } catch {
    return null;
  }

  if (!walletAddress || !ADMIN_ADDRESSES.has(walletAddress)) {
    return null;
  }

  return { userId: claims.userId, walletAddress };
}
