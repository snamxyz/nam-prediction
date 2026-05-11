import type { Metadata } from "next";
import { Suspense } from "react";
import { RangeMarketDetail } from "@/components/RangeMarketDetail";

export const metadata: Metadata = {
  title: "Total Receipts Uploaded | NAM Prediction",
  description: "Predict the total number of receipts uploaded today using a LMSR probability market.",
};

export default function ReceiptsMarketPage() {
  return (
    <main className="min-h-screen px-4 py-6">
      <Suspense fallback={<div className="card mx-auto h-[240px] max-w-[1200px]" />}>
        <RangeMarketDetail
          marketType="receipts"
          title="Total Receipts Uploaded"
          description="Predict the number of receipts uploaded in the current daily window. The market uses a Logarithmic Market Scoring Rule (LMSR) — probabilities are always valid and liquidity is always available."
        />
      </Suspense>
    </main>
  );
}
