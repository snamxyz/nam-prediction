import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Navbar } from "@/components/Navbar";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { LiveTicker } from "@/components/LiveTicker";
import Background from "@/components/UI/Background";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NAM Prediction Market",
  description: "Decentralized prediction market on Base",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen" style={{ background: "#0a0b0f", color: "#e8e9ed" }}>
          
            <Background/>
            <Navbar />
            <LiveTicker />
            <main className="max-w-[1400px] mx-auto px-6 py-8 relative" style={{ zIndex: 10 }}>
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
