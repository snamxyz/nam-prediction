"use client";

import Link from "next/link";
import type { RangeMarket, RangeOutcome } from "@nam-prediction/shared";

const RANGE_COLORS = [
  "#6c7aff",
  "#01d243",
  "#f0a832",
  "#f0324c",
  "#a78bfa",
  "#38bdf8",
];

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface RangeMarketCardProps {
  market: RangeMarket;
  href: string;
}

export function RangeMarketCard({ market, href }: RangeMarketCardProps) {
  const ranges = market.ranges as RangeOutcome[];
  const prices = market.rangePrices as number[];
  const total = prices.reduce((a, b) => a + b, 0) || 1;

  const typeColor = market.marketType === "receipts" ? "#6c7aff" : "#f0a832";
  const typeLabel =
    market.marketType === "receipts" ? "Receipts" : "NAM Distribution";

  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div
        className="card"
        style={{
          padding: "20px 22px",
          cursor: "pointer",
          transition: "border-color 0.15s, transform 0.1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = typeColor + "55";
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "";
          (e.currentTarget as HTMLDivElement).style.transform = "";
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: typeColor,
                background: typeColor + "18",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              {typeLabel}
            </span>
            {market.resolved ? (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#01d243",
                  background: "rgba(1,210,67,0.08)",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}
              >
                RESOLVED
              </span>
            ) : (
              <span
                style={{
                  fontSize: 10,
                  color: "#8081a0",
                  background: "rgba(255,255,255,0.04)",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}
              >
                {timeUntil(market.endTime)}
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: "#4c4e68" }}>{market.date}</span>
        </div>

        {/* Question */}
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#e4e5eb",
            marginBottom: 16,
            lineHeight: 1.4,
          }}
        >
          {market.question}
        </p>

        {/* Range probability bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ranges.map((range, i) => {
            const rawPrice = prices[i] ?? 0;
            const displayPrice = total > 0 ? rawPrice / total : 1 / ranges.length;
            const pct = (displayPrice * 100).toFixed(1);
            const color = RANGE_COLORS[i % RANGE_COLORS.length];
            const isWinner =
              market.resolved && market.winningRangeIndex === i;

            return (
              <div key={range.index}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        color: isWinner ? color : "#8081a0",
                        fontWeight: isWinner ? 700 : 400,
                      }}
                    >
                      {range.label}
                    </span>
                    {isWinner && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color,
                          background: color + "20",
                          padding: "1px 5px",
                          borderRadius: 3,
                        }}
                      >
                        WIN
                      </span>
                    )}
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isWinner ? color : "#e4e5eb",
                    }}
                  >
                    {pct}¢
                  </span>
                </div>
                <div
                  style={{
                    height: 3,
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.05)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, parseFloat(pct))}%`,
                      background: color,
                      borderRadius: 3,
                      transition: "width 0.4s ease",
                      opacity: market.resolved && !isWinner ? 0.3 : 1,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "#4c4e68" }}>
            {ranges.length} outcomes · LMSR
          </span>
          <span
            style={{
              fontSize: 11,
              color: typeColor,
              fontWeight: 600,
            }}
          >
            Trade →
          </span>
        </div>
      </div>
    </Link>
  );
}
