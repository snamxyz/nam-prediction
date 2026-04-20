"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import type { Market, Trade } from "@nam-prediction/shared";
import { fetchApi } from "@/lib/api";
import { ProbBar } from "@/components/ProbBar";
import { useNamPrice } from "@/hooks/useNamPrice";

function formatTimeRemaining(endTime: string): string {
  const now = Date.now();
  const target = new Date(endTime).getTime();
  const diff = (target - now) / 1000;
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600) / 60);
  return `${hours}h ${mins}m left`;
}

function formatVolume(vol: string): string {
  const n = Number(vol);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function MarketCard({ market }: { market: Market }) {
  const queryClient = useQueryClient();
  const { price: namPrice } = useNamPrice();
  const yesPct = Math.round(market.yesPrice * 100);
  const noPct = 100 - yesPct;

  const prefetchMarket = () => {
    const id = market.id;
    void queryClient.prefetchQuery({
      queryKey: ["market", id],
      queryFn: () => fetchApi<Market>(`/markets/${id}`),
    });
    void queryClient.prefetchQuery({
      queryKey: ["market-trades", id],
      queryFn: () => fetchApi<Trade[]>(`/markets/${id}/trades`),
    });
  };

  return (
    <Link
      href={`/market/${market.id}`}
      onMouseEnter={prefetchMarket}
      onFocus={prefetchMarket}
    >
      <div
        className="card"
        style={{
          padding: 20,
          cursor: "pointer",
          transition: "all 0.14s",
          borderRadius: 12,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#111320";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#0d0e14";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
        }}
      >
        {/* Question */}
        <p
          style={{
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.55,
            color: "#e4e5eb",
            marginBottom: 18,
          }}
        >
          {market.question}
        </p>

        {/* Split probability block */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            marginBottom: 14,
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              flex: 1,
              textAlign: "center",
              padding: "10px 0",
              background: "#01d24309",
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 26, fontWeight: 500, color: "#01d243" }}
            >
              {yesPct}
            </span>
            <span
              style={{
                fontSize: 10,
                color: "#4c4e68",
                display: "block",
                marginTop: 1,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              YES %
            </span>
          </div>
          <div
            style={{
              width: 1,
              height: 48,
              background: "rgba(255,255,255,0.04)",
            }}
          />
          <div
            style={{
              flex: 1,
              textAlign: "center",
              padding: "10px 0",
              background: "#f0324c07",
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 26, fontWeight: 500, color: "#f0324c" }}
            >
              {noPct}
            </span>
            <span
              style={{
                fontSize: 10,
                color: "#4c4e68",
                display: "block",
                marginTop: 1,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              NO %
            </span>
          </div>
        </div>

        <ProbBar yes={yesPct} height={3} />

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="mono" style={{ fontSize: 11, color: "#4c4e68" }}>
              {formatVolume(market.volume)} vol
            </span>
            <span className="mono" style={{ fontSize: 11, color: "#4c4e68" }}>
              NAM {namPrice !== null ? `$${namPrice.toFixed(5)}` : "—"}
            </span>
          </div>
          {market.resolved ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: market.result === 1 ? "#01d243" : "#f0324c",
              }}
            >
              {market.result === 1 ? "YES" : "NO"} resolved
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "#4c4e68" }}>
              {formatTimeRemaining(market.endTime)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
