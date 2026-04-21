"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMarket, useMarketTrades } from "@/hooks/useMarkets";
import { useMarketSocket } from "@/hooks/useMarketSocket";
import { TradePanel } from "@/components/TradePanel";
import { PriceChart } from "@/components/PriceChart";
import { NamPriceChart } from "@/components/NamPriceChart";
import { ProbBar } from "@/components/ProbBar";
import { fetchApi } from "@/lib/api";

type NamPricePoint = { ts: string; priceUsd: string };
type NamPriceResponse = { priceUsd: string; tokenAddress: string | null; history: NamPricePoint[] };

function useCountdown(iso?: string) {
  const [value, setValue] = useState({ h: "00", m: "00", s: "00", ended: false });
  useEffect(() => {
    if (!iso) return;
    const tick = () => {
      const d = (new Date(iso).getTime() - Date.now()) / 1000;
      if (d <= 0) return setValue({ h: "00", m: "00", s: "00", ended: true });
      const h = Math.floor((d % 86400) / 3600);
      const m = Math.floor((d % 3600) / 60);
      const s = Math.floor(d % 60);
      setValue({ h: String(h).padStart(2, "0"), m: String(m).padStart(2, "0"), s: String(s).padStart(2, "0"), ended: false });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return value;
}

export default function MarketPage() {
  const params = useParams();
  const id = params.id as string;
  const { data: market, isLoading } = useMarket(id);
  const { data: trades } = useMarketTrades(id);
  const { prices: livePrices, stats: liveStats, resolved: liveResolved, locked: liveLocked } = useMarketSocket(market?.id);
  const [chartMode, setChartMode] = useState<"price" | "prob">("price");
  const [tab, setTab] = useState<"trades" | "about">("trades");
  const [namPrice, setNamPrice] = useState<number | null>(null);
  const [namHistory, setNamHistory] = useState<NamPricePoint[]>([]);
  const countdown = useCountdown(market?.endTime);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const data = await fetchApi<NamPriceResponse>("/markets/nam-price");
        if (!alive) return;
        const price = Number(data.priceUsd);
        if (Number.isFinite(price)) setNamPrice(price);
        setNamHistory(data.history ?? []);
      } catch {
        // no-op on transient polling failure
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

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
  const resolutionConfig = market.resolutionConfig && typeof market.resolutionConfig === "object" ? (market.resolutionConfig as { threshold?: number }) : null;
  const threshold = typeof resolutionConfig?.threshold === "number" ? resolutionConfig.threshold : null;
  const priceToBeat = threshold ?? null;
  const priceDelta = namPrice == null || priceToBeat == null ? null : namPrice - priceToBeat;

  return (
    <div className="fade-up" style={{ maxWidth: 1400, margin: "0 auto" }}>
      <Link
        href="/"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4c4e68", marginBottom: 16, transition: "color 0.12s" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#e4e5eb")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#4c4e68")}
      >
        ← Back to Markets
      </Link>

      <div className="market-grid" style={{ display: "grid", gridTemplateColumns: "1fr 350px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: "22px 24px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", padding: "2px 7px", borderRadius: 4, background: isResolved ? "rgba(255,255,255,0.06)" : "rgba(1,210,67,0.12)", color: isResolved ? "#4c4e68" : "#01d243" }}>
                    {market.cadence === "24h" ? "Price" : "Market"}
                  </span>
                  {!isResolved && <span className="live-dot" />}
                  <span className="mono" style={{ fontSize: 10, color: "#4c4e68" }}>{market.cadence ?? "daily"} cadence</span>
                </div>
                <h1 style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, letterSpacing: "-0.01em", maxWidth: 580 }}>{market.question}</h1>
              </div>
              <div style={{ flexShrink: 0 }}>
                {isResolved ? (
                  <div style={{ padding: "6px 14px", borderRadius: 8, background: market.result === 1 ? "rgba(1,210,67,0.12)" : "rgba(240,50,76,0.12)", border: `1px solid ${market.result === 1 ? "#01d243" : "#f0324c"}` }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: market.result === 1 ? "#01d243" : "#f0324c" }}>{market.result === 1 ? "YES" : "NO"}</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                    {[countdown.h, countdown.m, countdown.s].map((v, i) => (
                      <div key={`${v}-${i}`} style={{ textAlign: "center" }}>
                        <div className="mono" style={{ fontSize: 28, fontWeight: 500, lineHeight: 1 }}>{v}</div>
                        <div style={{ fontSize: 8, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, marginTop: 3 }}>{["HRS", "MINS", "SECS"][i]}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 18 }}>
              {priceToBeat != null && (
                <div style={{ display: "flex", gap: 28, marginRight: 18 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 5 }}>Price to Beat</div>
                    <div className="mono" style={{ fontSize: 18 }}>${priceToBeat.toFixed(5)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 5, display: "flex", gap: 6, alignItems: "center" }}>
                      Current Price
                      {priceDelta != null && (
                        <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: priceDelta >= 0 ? "#01d243" : "#f0324c", background: priceDelta >= 0 ? "rgba(1,210,67,0.12)" : "rgba(240,50,76,0.12)", padding: "1px 5px", borderRadius: 4 }}>
                          {priceDelta >= 0 ? "▲" : "▼"} ${Math.abs(priceDelta).toFixed(5)}
                        </span>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: 18, color: namPrice != null && priceDelta != null && priceDelta < 0 ? "#f0324c" : "#01d243" }}>
                      {namPrice == null ? "—" : `$${namPrice.toFixed(5)}`}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 20 }}>
                <div><div style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 5 }}>YES chance</div><div className="mono" style={{ color: "#01d243", fontSize: 14 }}>{yesPct.toFixed(1)}%</div></div>
                <div><div style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 5 }}>NO chance</div><div className="mono" style={{ color: "#f0324c", fontSize: 14 }}>{noPct.toFixed(1)}%</div></div>
                <div><div style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 5 }}>Volume</div><div className="mono" style={{ fontSize: 14 }}>${liveVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
                <div><div style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 5 }}>Liquidity</div><div className="mono" style={{ fontSize: 14 }}>${Number(market.liquidity).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <ProbBar yes={yesPct} height={5} />
            </div>
          </div>

          {!isResolved && (
            <div className="card" style={{ padding: "16px 20px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 8, background: "#111320", border: "1px solid rgba(255,255,255,0.07)" }}>
                  {[["price", "NAM Price"], ["prob", "Probabilities"]].map(([value, label]) => (
                    <button key={value} onClick={() => setChartMode(value as "price" | "prob")} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, background: chartMode === value ? "#e4e5eb" : "#111320", color: chartMode === value ? "#07080c" : "#4c4e68" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {chartMode === "price" ? <NamPriceChart points={namHistory} threshold={priceToBeat} /> : <PriceChart trades={trades || []} />}
            </div>
          )}

          <div>
            <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
              {[["trades", "Recent Trades"], ["about", "About"]].map(([value, label]) => (
                <button key={value} onClick={() => setTab(value as "trades" | "about")} style={{ padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: tab === value ? "#111320" : "transparent", color: tab === value ? "#e4e5eb" : "#4c4e68", border: `1px solid ${tab === value ? "rgba(255,255,255,0.07)" : "transparent"}` }}>
                  {label}
                </button>
              ))}
            </div>
            {tab === "trades" ? (
              <div className="card" style={{ padding: "18px 20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 80px 80px 80px", gap: 10, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {["Outcome", "Trader", "Shares", "Amount", "Time"].map((h) => <span key={h} style={{ fontSize: 9, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>{h}</span>)}
                </div>
                {(trades ?? []).slice(0, 8).map((trade, i, arr) => (
                  <div key={trade.id} style={{ display: "grid", gridTemplateColumns: "110px 1fr 80px 80px 80px", gap: 10, padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 4, width: "fit-content", letterSpacing: "0.04em", background: trade.isYes ? "rgba(1,210,67,0.12)" : "rgba(240,50,76,0.12)", color: trade.isYes ? "#01d243" : "#f0324c" }}>{trade.isBuy ? "BUY" : "SELL"} {trade.isYes ? "YES" : "NO"}</span>
                    <span className="mono" style={{ fontSize: 11, color: "#4c4e68" }}>{trade.trader.slice(0, 6)}…{trade.trader.slice(-4)}</span>
                    <span className="mono" style={{ fontSize: 11 }}>{Number(trade.shares).toFixed(1)}</span>
                    <span className="mono" style={{ fontSize: 11 }}>${Number(trade.collateral).toFixed(2)}</span>
                    <span style={{ fontSize: 10, color: "#4c4e68" }}>{new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
                {(trades ?? []).length === 0 && <p style={{ fontSize: 12, color: "#4c4e68", marginTop: 12 }}>No trades yet</p>}
              </div>
            ) : (
              <div className="card" style={{ padding: "20px 24px" }}>
                <div style={{ fontSize: 13, lineHeight: 1.75, marginBottom: 20 }}>
                  Resolves according to configured market source ({market.resolutionSource}) at market end time.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[["Created", new Date(market.createdAt).toLocaleString()], ["Market ID", `#${market.id}`], ["Resolution Source", market.resolutionSource], ["Cadence", market.cadence ?? "daily"]].map(([k, v]) => (
                    <div key={k} style={{ padding: "12px 14px", borderRadius: 8, background: "#111320", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ fontSize: 10, color: "#4c4e68", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 4 }}>{k}</div>
                      <div className="mono" style={{ fontSize: 12 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="market-right" style={{ position: "sticky", top: 70 }}>
          {!isResolved && !isLocked ? (
            <TradePanel marketId={market.id} onChainMarketId={market.onChainId} ammAddress={market.ammAddress as `0x${string}`} yesPrice={currentYesPrice} noPrice={currentNoPrice} />
          ) : isLocked && !isResolved ? (
            <div className="card" style={{ padding: 28, textAlign: "center" }}>
              <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Market Locked</p>
              <p style={{ fontSize: 13, color: "#4c4e68" }}>Trading is closed. Awaiting resolution…</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 28, textAlign: "center" }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#4c4e68", marginBottom: 16 }}>Market Resolved</p>
              <p className="mono" style={{ fontSize: 52, fontWeight: 500, color: market.result === 1 ? "#01d243" : "#f0324c", lineHeight: 1, marginBottom: 14 }}>{market.result === 1 ? "YES" : "NO"}</p>
              <p style={{ fontSize: 12, color: "#4c4e68", marginTop: 8 }}>Go to Portfolio to redeem your winnings</p>
            </div>
          )}

          <div className="card" style={{ padding: "14px 16px", marginTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: "#4c4e68", marginBottom: 12 }}>Market Info</div>
            {[
              ["Yes price", `${(currentYesPrice * 100).toFixed(1)}¢`, "#01d243"],
              ["No price", `${(currentNoPrice * 100).toFixed(1)}¢`, "#f0324c"],
              ["Volume", `$${liveVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, "#e4e5eb"],
              ["Liquidity", `$${Number(market.liquidity).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, "#e4e5eb"],
              ["Created", new Date(market.createdAt).toLocaleString(), "#4c4e68"],
            ].map(([k, v, c], i, arr) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8, paddingBottom: 8, borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <span style={{ color: "#4c4e68" }}>{k}</span>
                <span className="mono" style={{ color: c }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        .live-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #01d243;
          animation: blink 2s ease-in-out infinite;
        }
        @keyframes blink {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.25;
          }
        }
        @media (max-width: 900px) {
          .market-grid {
            grid-template-columns: 1fr !important;
          }
          .market-right {
            position: static !important;
          }
        }
      `}</style>
    </div>
  );
}
