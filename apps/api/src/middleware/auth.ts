import { PrivyClient } from "@privy-io/server-auth";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || "";

export const privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

/**
 * Verify a Privy auth token from the Authorization header.
 * Returns the verified claims or null if invalid.
 */
export async function verifyPrivyToken(authHeader: string | undefined | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const claims = await privyClient.verifyAuthToken(token);
    return claims;
  } catch {
    return null;
  }
}
