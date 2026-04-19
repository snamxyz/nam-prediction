/**
 * Admin authentication middleware.
 *
 * Two-factor gate:
 *   1. A valid Privy JWT in the Authorization: Bearer header.
 *   2. The wallet resolved from that JWT must appear in the ADMIN_ADDRESSES
 *      environment variable (comma-separated).
 *
 * Usage:
 *   const claims = await verifyAdminToken(headers.authorization);
 *   if (!claims) { set.status = 403; return { error: "Forbidden" }; }
 */

import { verifyPrivyToken, privyClient } from "./auth";

const ADMIN_ADDRESSES = (process.env.ADMIN_ADDRESSES || "")
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

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
    walletAddress = user.wallet?.address?.toLowerCase() ?? null;
  } catch {
    return null;
  }

  if (!walletAddress || !ADMIN_ADDRESSES.includes(walletAddress)) {
    return null;
  }

  return { userId: claims.userId, walletAddress };
}
