import type { Metadata } from "next";
import { Suspense } from "react";
import { RangeMarketDetail } from "@/components/RangeMarketDetail";

export const metadata: Metadata = {
  title: "Participants / Miners | NAM Prediction",
  description: "Predict the number of participants or miners for the day using a LMSR probability market.",
};

export default function ParticipantsMarketPage() {
  return (
    <main className="min-h-screen px-3 py-4 pb-20 md:px-4 md:py-6 md:pb-6">
      <Suspense fallback={<div className="card mx-auto h-[240px] max-w-[1400px]" />}>
        <RangeMarketDetail
          marketType="participants"
          title="Participants / Miners"
          description="Predict the number of participants or miners in the current Eastern-time daily window. "
        />
      </Suspense>
    </main>
  );
}
