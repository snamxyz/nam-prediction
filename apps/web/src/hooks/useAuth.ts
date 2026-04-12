"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface AuthUser {
  id: number;
  privyUserId: string;
  walletAddress: string | null;
  displayName: string | null;
  loginMethod: string | null;
}

export function useAuth() {
  const { login: privyLogin, logout: privyLogout, authenticated, user, getAccessToken } = usePrivy();
  const { address } = useAccount();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Sync with backend after Privy login
  useEffect(() => {
    if (authenticated && user && !authUser) {
      syncUser();
    }
    if (!authenticated) {
      setAuthUser(null);
    }
  }, [authenticated, user]);

  const syncUser = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setAuthUser(json.data);
        }
      }
    } catch (err) {
      console.error("[useAuth] Failed to sync user:", err);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, isLoading]);

  const login = useCallback(() => {
    privyLogin();
  }, [privyLogin]);

  const logout = useCallback(async () => {
    await privyLogout();
    setAuthUser(null);
  }, [privyLogout]);

  const displayName =
    authUser?.displayName ||
    (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null) ||
    (authUser?.walletAddress
      ? `${authUser.walletAddress.slice(0, 6)}…${authUser.walletAddress.slice(-4)}`
      : null) ||
    "Connected";

  return {
    user: authUser,
    isAuthenticated: authenticated,
    isLoading,
    login,
    logout,
    displayName,
    walletAddress: address || authUser?.walletAddress,
  };
}
