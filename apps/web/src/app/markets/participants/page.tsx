import type { Metadata } from "next";
import { Suspense } from "react";
import { RangeMarketDetail } from "@/components/RangeMarketDetail";

export const metadata: Metadata = {
  title: "Participants / Miners | NAM Prediction",
  description: "Predict the number of participants or miners for the day using a LMSR probability market.",
};

export default function ParticipantsMarketPage() {
  return (
    <main className="min-h-screen px-4 py-6">
      <Suspense fallback={<div className="card mx-auto h-[240px] max-w-[1200px]" />}>
        <RangeMarketDetail
          marketType="participants"
          title="Participants / Miners"
          description="Predict the number of participants or miners in the current Eastern-time daily window. Settlement source is configurable until the final production data source is selected."
        />
      </Suspense>
    </main>
  );
}
