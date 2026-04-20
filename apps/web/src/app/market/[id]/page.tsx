"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useMarket, useMarketTrades } from "@/hooks/useMarkets";
import { useMarketSocket } from "@/hooks/useMarketSocket";
import { TradePanel } from "@/components/TradePanel";
import { PriceChart } from "@/components/PriceChart";
import { ProbBar } from "@/components/ProbBar";

export default function MarketPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: market, isLoading } = useMarket(id);
  const { data: trades } = useMarketTrades(id);
  const {
    prices: livePrices,
    stats: liveStats,
    resolved: liveResolved,
    locked: liveLocked,
  } = useMarketSocket(market?.id);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div className="card" style={{ height: 200, marginBottom: 16 }} />
        <div className="card" style={{ height: 300 }} />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "80px 0" }}>
        <p style={{ color: "#4c4e68" }}>Market not found</p>
      </div>
    );
  }

  const currentYesPrice = livePrices?.yesPrice ?? market.yesPrice;
  const currentNoPrice = livePrices?.noPrice ?? market.noPrice;
  const yesPct = currentYesPrice * 100;
  const noPct = 100 - yesPct;
  const isResolved = liveResolved ? true : market.resolved;
  const isLocked = liveLocked || market.status === "locked";
  const liveVolume = liveStats?.volume ?? Number(market.volume);
  const endDate = new Date(market.endTime);

  return (
    <div className="fade-up" style={{ maxWidth: 1280, margin: "0 auto" }}>
      {/* Back link */}
      <Link
        href="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "#4c4e68",
          marginBottom: 16,
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#e4e5eb")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#4c4e68")}
      >
        ← Back to Markets
      </Link>

      {/* 2-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Header card */}
          <div className="card" style={{ padding: 24 }}>
            <h1
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "#e4e5eb",
                marginBottom: 20,
                lineHeight: 1.45,
                letterSpacing: "-0.01em",
              }}
            >
              {market.question}
            </h1>

            {/* Large probability numbers */}
            <div className="w-full"
              style={{
                display: "flex",
                alignItems: "center",
              }}
            >
              <div className="w-1/2 bg-accent/5 p-4 rounded-tl-md">
                <span
                  className="mono"
                  style={{ fontSize: 48, fontWeight: 500, color: "#01d243", lineHeight: 1, letterSpacing: "-0.03em" }}
                >
                  {yesPct.toFixed(1)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#4c4e68",
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    marginLeft: 6,
                  }}
                >
                  YES ¢
                </span>
              </div>
              
              <div className="w-1/2 bg-[#f0324c]/5 p-4 rounded-tr-md">
                <span
                  className="mono"
                  style={{ fontSize: 48, fontWeight: 500, color: "#f0324c", lineHeight: 1, letterSpacing: "-0.03em" }}
                >
                  {noPct.toFixed(1)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#4c4e68",
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    marginLeft: 6,
                  }}
                >
                  NO ¢
                </span>
              </div>
            </div>

            <ProbBar yes={yesPct} height={4} />

            {/* Meta row */}
            <div
              style={{
                display: "flex",
                gap: 20,
                marginTop: 16,
                paddingTop: 14,
                borderTop: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <div>
                <span style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
                  Volume
                </span>
                <div className="mono" style={{ fontSize: 13, color: "#e4e5eb", marginTop: 2 }}>
                  ${liveVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
              {liveStats?.lastTradePrice != null && liveStats.lastTradePrice > 0 && (
                <div>
                  <span style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
                    Last Trade
                  </span>
                  <div
                    className="mono"
                    style={{
                      fontSize: 13,
                      color: liveStats.lastTradeSide === "YES" ? "#01d243" : "#f0324c",
                      marginTop: 2,
                    }}
                  >
                    {liveStats.lastTradeSide} @ {(liveStats.lastTradePrice * 100).toFixed(1)}¢
                  </div>
                </div>
              )}
              <div>
                <span style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
                  {market.resolved ? "Status" : "Ends"}
                </span>
                <div className="mono" style={{ fontSize: 13, color: "#e4e5eb", marginTop: 2 }}>
                  {market.resolved ? (
                    <span style={{ color: market.result === 1 ? "#01d243" : "#f0324c", fontWeight: 600 }}>
                      {market.result === 1 ? "YES" : "NO"} Resolved
                    </span>
                  ) : (
                    `${endDate.toLocaleDateString()} ${endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Chart */}
          <PriceChart trades={trades || []} />

          {/* Recent trades */}
          <div className="card" style={{ padding: 20 }}>
            <h3
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "#4c4e68",
                marginBottom: 14,
              }}
            >
              Recent Trades
            </h3>
            {trades && trades.length > 0 ? (
              <div>
                {trades.slice(0, 8).map((trade) => (
                  <div
                    key={trade.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "9px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 4,
                          letterSpacing: "0.04em",
                          ...(trade.isBuy
                            ? { background: "rgba(1,210,67,0.10)", color: "#01d243" }
                            : { background: "rgba(240,50,76,0.10)", color: "#f0324c" }),
                        }}
                      >
                        {trade.isBuy ? "BUY" : "SELL"}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: trade.isYes ? "#01d243" : "#f0324c",
                        }}
                      >
                        {trade.isYes ? "YES" : "NO"}
                      </span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="mono" style={{ fontSize: 12, color: "#e4e5eb" }}>
                        ${Number(trade.collateral).toFixed(2)}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: "#4c4e68" }}>
                        {trade.trader.slice(0, 6)}…{trade.trader.slice(-4)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "#4c4e68" }}>No trades yet</p>
            )}
          </div>
        </div>

        {/* Right column (sticky) */}
        <div style={{ position: "sticky", top: 68 }}>
          {!isResolved && !isLocked ? (
            <TradePanel
              marketId={market.id}
              onChainMarketId={market.onChainId}
              ammAddress={market.ammAddress as `0x${string}`}
              yesPrice={currentYesPrice}
              noPrice={currentNoPrice}
            />
          ) : isLocked && !isResolved ? (
            <div className="card" style={{ padding: 28, textAlign: "center" }}>
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#e4e5eb",
                  marginBottom: 6,
                }}
              >
                Market Locked
              </p>
              <p style={{ fontSize: 13, color: "#4c4e68" }}>
                Trading is closed. Awaiting resolution…
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: 28, textAlign: "center" }}>
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#e4e5eb",
                  marginBottom: 8,
                }}
              >
                Market Resolved
              </p>
              <p
                className="mono"
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: market.result === 1 ? "#01d243" : "#f0324c",
                }}
              >
                {market.result === 1 ? "YES" : "NO"} Wins
              </p>
              <p style={{ fontSize: 12, color: "#4c4e68", marginTop: 8 }}>
                Go to Portfolio to redeem your winnings
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
