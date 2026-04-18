"use client";

import { StatsBar } from "@/components/StatsBar";
import { M15MarketHero } from "@/components/M15MarketHero";
import { useState } from "react";

export default function HomePage() {
  const [mode, setMode] = useState<"m15" | "items" | "tokens">("m15");

  return (
    <div>
      {/* Featured 15-Min Market */}

      <div className="mb-8">
        <h1
          className="text-2xl font-semibold mb-2"
          style={{ color: "#e8e9ed" }}
        >
          NAM Prediction Markets
        </h1>
        <p className="text-sm" style={{ color: "#717182" }}>
          Trade on NAM ecosystem milestones. Backed by real outcomes.
        </p>
      </div>

      <StatsBar />

      <div className="h-[1px] w-full bg-white/10 mb-10"></div>
      <div className="flex space-x-2 mb-6">
        <button
          onClick={() => {
            setMode("m15");
          }}
          className={`text-xs font-bold border rounded-full ${
            mode === "m15"
              ? "border-accent text-accent bg-accent/10 "
              : "border-transparent bg-gray-800/50 text-gray-500"
          } w-32 py-2`}
        >
          15M NAM price
        </button>
        <button
          onClick={() => {
            setMode("items");
          }}
          className={`text-xs font-bold border rounded-full ${
            mode === "items"
              ? "border-accent text-accent bg-accent/10 "
              : "border-transparent bg-gray-800/50 text-gray-500"
          } w-32 py-2 `}
        >
          Items Price
        </button>
        <button
          onClick={() => {
            setMode("tokens");
          }}
          className={`text-xs font-bold border rounded-full ${
            mode === "tokens"
              ? "border-accent text-accent bg-accent/10 "
              : "border-transparent bg-gray-800/50 text-gray-500"
          } w-32 py-2`}
        >
          Tokens Claimed
        </button>
      </div>
          {mode === "m15" && <M15MarketHero />}
    </div>
  );
}
