"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useSetActiveWallet } from "@privy-io/wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useEffect, useState, type ReactNode } from "react";
import { base } from "viem/chains";
import { useAccount } from "wagmi";
import { Toaster } from "sonner";
import { NavigationProgress } from "@/components/NavigationProgress";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 45_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider>
      <ThemedProviders queryClient={queryClient}>{children}</ThemedProviders>
    </ThemeProvider>
  );
}

function ThemedProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient: QueryClient;
}) {
  const { theme } = useTheme();

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        defaultChain: base,
        supportedChains: [base],
        appearance: {
          theme,
          accentColor: "#01d243",
        },
        embeddedWallets: {
          createOnLogin: "all-users",
        },
        loginMethods: ["email", "wallet", "google", "twitter"],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <WalletActivator />
          <NavigationProgress />
          {children}
          <Toaster
            theme={theme}
            position="bottom-right"
            richColors
            closeButton
          />
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

function WalletActivator() {
  const { authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();

  useEffect(() => {
    if (!authenticated || !user) return;

    const embeddedWallet = wallets.find(
      (wallet) => wallet.walletClientType === "privy",
    );
    if (!embeddedWallet) return;

    const hasSocialOrEmailLogin = user.linkedAccounts?.some((account) =>
      ["email", "phone", "google_oauth", "twitter_oauth"].includes(
        account.type,
      ),
    );
    if (!hasSocialOrEmailLogin) return;

    if (address?.toLowerCase() === embeddedWallet.address.toLowerCase()) return;

    setActiveWallet(embeddedWallet).catch((error) => {
      console.error("[WalletActivator] Failed to activate embedded wallet:", error);
    });
  }, [address, authenticated, setActiveWallet, user, wallets]);

  return null;
}
