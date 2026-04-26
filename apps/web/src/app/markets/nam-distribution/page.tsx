import type { Metadata } from "next";
import { RangeMarketDetail } from "@/components/RangeMarketDetail";

export const metadata: Metadata = {
  title: "NAM Tokens Distributed | NAM Prediction",
  description: "Predict the number of NAM tokens distributed today using a LMSR probability market.",
};

export default function NamDistributionMarketPage() {
  return (
    <main style={{ padding: "24px 16px", minHeight: "100vh" }}>
      <RangeMarketDetail
        marketType="nam-distribution"
        title="NAM Tokens Distributed"
        description="Predict the number of NAM tokens distributed in the current daily window. The market uses a Logarithmic Market Scoring Rule (LMSR) — probabilities are always valid and liquidity is always available."
      />
    </main>
  );
}
