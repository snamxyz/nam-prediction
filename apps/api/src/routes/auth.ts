import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { verifyPrivyToken, privyClient } from "../middleware/auth";

export const authRoutes = new Elysia({ prefix: "/auth" })

  // POST /auth/login — Verify Privy token, upsert user, return user record
  .post("/login", async ({ headers, set }) => {
    const claims = await verifyPrivyToken(headers.authorization);
    if (!claims) {
      set.status = 401;
      return { success: false, error: "Invalid or missing auth token" };
    }

    const privyUserId = claims.userId;

    // Fetch full user from Privy to get linked accounts
    let walletAddress: string | null = null;
    let displayName: string | null = null;
    let loginMethod: string | null = null;

    try {
      const privyUser = await privyClient.getUser(privyUserId);

      // Extract wallet address (embedded or linked)
      const wallet =
        privyUser.wallet ||
        privyUser.linkedAccounts?.find((a: any) => a.type === "wallet");
      if (wallet && "address" in wallet) {
        walletAddress = wallet.address as string;
      }

      // Determine login method and display name from linked accounts
      const linked = privyUser.linkedAccounts || [];
      for (const account of linked) {
        if (account.type === "twitter_oauth") {
          loginMethod = loginMethod || "twitter";
          displayName = displayName || (account as any).username || (account as any).name;
        } else if (account.type === "google_oauth") {
          loginMethod = loginMethod || "google";
          displayName = displayName || (account as any).email || (account as any).name;
        } else if (account.type === "email") {
          loginMethod = loginMethod || "email";
          displayName = displayName || (account as any).address;
        } else if (account.type === "wallet") {
          loginMethod = loginMethod || "wallet";
        }
      }
    } catch (err) {
      console.error("[Auth] Failed to fetch Privy user:", err);
    }

    // Upsert user in DB
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.privyUserId, privyUserId))
      .limit(1);

    let user;
    if (existing.length > 0) {
      // Update existing user
      const updated = await db
        .update(users)
        .set({
          walletAddress: walletAddress || existing[0].walletAddress,
          displayName: displayName || existing[0].displayName,
          loginMethod: loginMethod || existing[0].loginMethod,
          updatedAt: new Date(),
        })
        .where(eq(users.privyUserId, privyUserId))
        .returning();
      user = updated[0];
    } else {
      // Create new user
      const inserted = await db
        .insert(users)
        .values({
          privyUserId,
          walletAddress,
          displayName,
          loginMethod,
        })
        .returning();
      user = inserted[0];
    }

    return {
      success: true,
      data: {
        id: user.id,
        privyUserId: user.privyUserId,
        walletAddress: user.walletAddress,
        displayName: user.displayName,
        loginMethod: user.loginMethod,
      },
    };
  })

  // GET /auth/me — Return current user from token
  .get("/me", async ({ headers, set }) => {
    const claims = await verifyPrivyToken(headers.authorization);
    if (!claims) {
      set.status = 401;
      return { success: false, error: "Invalid or missing auth token" };
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.privyUserId, claims.userId))
      .limit(1);

    if (user.length === 0) {
      set.status = 404;
      return { success: false, error: "User not found. Please login first." };
    }

    return {
      success: true,
      data: {
        id: user[0].id,
        privyUserId: user[0].privyUserId,
        walletAddress: user[0].walletAddress,
        displayName: user[0].displayName,
        loginMethod: user[0].loginMethod,
      },
    };
  });
