"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "@privy-io/wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useState, type ReactNode } from "react";
import { base } from "viem/chains";
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
          createOnLogin: "users-without-wallets",
        },
        loginMethods: ["email", "wallet", "google", "twitter"],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
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
