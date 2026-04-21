"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLatestHourlyMarket } from "@/hooks/useMarkets";
import { ProbBar } from "@/components/ProbBar";
import { useNamPrice } from "@/hooks/useNamPrice";

function useCountdown(targetDate: string | null | undefined) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!targetDate) return;
    const update = () => {
      const now = Date.now();
      const target = new Date(targetDate).getTime();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft("Resolving...");
        return;
      }
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${h}h ${m}m`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

function formatVolume(vol: number) {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export function HourlyMarketHero() {
  const { data: market, isLoading } = useLatestHourlyMarket();
  const countdown = useCountdown(market?.endTime);
  const { price: namPrice } = useNamPrice();

  if (isLoading) {
    return (
      <div style={{ marginBottom: 24 }}>
        <div className="card" style={{ padding: 28, height: 320 }} />
      </div>
    );
  }

  if (!market) return null;

  const yp = (market.yesPrice * 100).toFixed(1);
  const np = (market.noPrice * 100).toFixed(1);
  const volume = Number(market.volume);

  return (
    <div
      className="card fade-up"
      style={{ padding: 28, marginBottom: 24, position: "relative", overflow: "hidden" }}
    >
      {/* Background accent glows */}
      <div
        style={{
          position: "absolute",
          top: -80,
          left: -80,
          width: 400,
          height: 400,
          background: "radial-gradient(circle, #01d24307 0%, transparent 65%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -80,
          right: -80,
          width: 400,
          height: 400,
          background: "radial-gradient(circle, #f0324c05 0%, transparent 65%)",
          pointerEvents: "none",
        }}
      />

      {/* Top row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#4c4e68",
            }}
          >
            24-Hour Market
          </span>
        </div>
        <span className="mono" style={{ fontSize: 11, color: "#4c4e68" }}>
          {countdown} remaining
        </span>
      </div>

      {/* Question */}
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "#e4e5eb",
          marginBottom: 28,
          lineHeight: 1.4,
          maxWidth: 700,
          letterSpacing: "-0.01em",
        }}
      >
        {market.question}
      </h2>

      {/* Large probability display */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr",
          marginBottom: 22,
          gap: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: "18px 24px" }}>
          <div
            className="mono"
            style={{
              fontSize: 60,
              fontWeight: 500,
              color: "#01d243",
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          >
            {yp}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#4c4e68",
              marginTop: 6,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            YES %
          </div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.07)", margin: "12px 0" }} />
        <div style={{ textAlign: "center", padding: "18px 24px" }}>
          <div
            className="mono"
            style={{
              fontSize: 60,
              fontWeight: 500,
              color: "#f0324c",
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          >
            {np}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#4c4e68",
              marginTop: 6,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            NO %
          </div>
        </div>
      </div>

      <ProbBar yes={parseFloat(yp)} height={4} />

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 20,
        }}
      >
        <div className="flex gap-5">
          <div>
            <div
              style={{
                fontSize: 10,
                color: "#4c4e68",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                fontWeight: 700,
                marginBottom: 3,
              }}
            >
              Volume
            </div>
            <div className="mono" style={{ fontSize: 13, color: "#e4e5eb" }}>
              {formatVolume(volume)}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                color: "#4c4e68",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                fontWeight: 700,
                marginBottom: 3,
              }}
            >
              NAM Price
            </div>
            <div className="mono" style={{ fontSize: 13, color: "#e4e5eb" }}>
              {namPrice !== null ? `$${namPrice.toFixed(5)}` : "$—"}
            </div>
          </div>
        </div>
        <Link
          href={`/market/${market.id}`}
          style={{
            padding: "10px 22px",
            borderRadius: 8,
            background: "#01d243",
            color: "#000",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
        >
          Trade Now →
        </Link>
      </div>
    </div>
  );
}
