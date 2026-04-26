import type { Metadata } from "next";
import { RangeMarketDetail } from "@/components/RangeMarketDetail";

export const metadata: Metadata = {
  title: "Total Receipts Uploaded | NAM Prediction",
  description: "Predict the total number of receipts uploaded today using a LMSR probability market.",
};

export default function ReceiptsMarketPage() {
  return (
    <main style={{ padding: "24px 16px", minHeight: "100vh" }}>
      <RangeMarketDetail
        marketType="receipts"
        title="Total Receipts Uploaded"
        description="Predict the number of receipts uploaded in the current daily window. The market uses a Logarithmic Market Scoring Rule (LMSR) — probabilities are always valid and liquidity is always available."
      />
    </main>
  );
}
