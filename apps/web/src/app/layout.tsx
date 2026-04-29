import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "NAM Prediction Market",
  description: "Decentralized prediction market on Base",
};

const themeScript = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem("nam-theme");
    const systemTheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : systemTheme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Mono:ital,wght@0,400;0,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <div
            className="min-h-screen"
            style={{
              background: "var(--background)",
              color: "var(--foreground)",
            }}
          >
            <Navbar />
            <main className="max-w-[1280px] mx-auto px-6 relative py-10">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
