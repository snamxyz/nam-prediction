"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useHourlyHistory, useMarket, useMarketTrades } from "@/hooks/useMarkets";
import { useMarketSocket } from "@/hooks/useMarketSocket";
import { useNamPriceStream } from "@/hooks/useNamPriceStream";
import { TradePanel } from "@/components/TradePanel";
import { PriceChart } from "@/components/PriceChart";
import { NamPriceChart } from "@/components/NamPriceChart";
import { ProbBar } from "@/components/ProbBar";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/UI/drawer";
import { formatMarketQuestion, getOutcomeLabels } from "@/lib/marketDisplay";
import { formatEasternShortDate } from "@/lib/dateDisplay";
import { ArrowLeft, TrendingUp, TrendingDown, X } from "lucide-react";

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
  const { data: hourlyHistory = [] } = useHourlyHistory();
  const { prices: livePrices, stats: liveStats, resolved: liveResolved, locked: liveLocked } = useMarketSocket(market?.id);
  const [chartMode, setChartMode] = useState<"price" | "prob">("price");
  const [tab, setTab] = useState<"trades" | "about">("trades");
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false);
  const [mobileSide, setMobileSide] = useState<"YES" | "NO">("YES");
  const { price: namPrice, iconUrl: namIconUrl, history: namHistory } = useNamPriceStream();
  const countdown = useCountdown(market?.endTime);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-4 h-[200px] rounded-[10px] border border-[var(--border)] bg-[var(--surface)]" />
        <div className="h-[300px] rounded-[10px] border border-[var(--border)] bg-[var(--surface)]" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] py-20 text-center">
        <p className="text-[var(--muted)]">Market not found</p>
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
  const outcomeLabels = getOutcomeLabels(market);
  const marketQuestion = formatMarketQuestion(market);
  const priorHourlyMarkets = hourlyHistory.filter((m) => m.id !== market.id);
  const marketInfoRows = [
    [`${outcomeLabels.yes} price`, `${(currentYesPrice * 100).toFixed(1)}¢`, "text-yes"],
    [`${outcomeLabels.no} price`, `${(currentNoPrice * 100).toFixed(1)}¢`, "text-no"],
    ["Volume", `$${liveVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, "text-[var(--foreground)]"],
    ["Liquidity", `$${Number(market.liquidity).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, "text-[var(--foreground)]"],
    ["Created", new Date(market.createdAt).toLocaleString(), "text-[var(--muted)]"],
  ];
  const openMobileTrade = (side: "YES" | "NO") => {
    setMobileSide(side);
    setMobileTradeOpen(true);
  };

  return (
    <>
      {!isResolved && !isLocked && (
        <div className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[50] grid grid-cols-2 gap-2 md:hidden">
          <button type="button" onClick={() => openMobileTrade("YES")} className="flex cursor-pointer items-center justify-between rounded-xl border border-yes/30 bg-yes px-4 py-3 text-left text-white shadow-[0_8px_24px_rgba(1,210,67,0.16)]">
            <span className="text-sm font-bold">Up</span>
            <span className="font-mono text-sm font-bold">{Math.round(currentYesPrice * 100)}¢</span>
          </button>
          <button type="button" onClick={() => openMobileTrade("NO")} className="flex cursor-pointer items-center justify-between rounded-xl border border-no/30 bg-no px-4 py-3 text-left text-white shadow-[0_8px_24px_rgba(240,50,76,0.16)]">
            <span className="text-sm font-bold">Down</span>
            <span className="font-mono text-sm font-bold">{Math.round(currentNoPrice * 100)}¢</span>
          </button>
        </div>
      )}
      <div className="relative mx-auto h-full max-w-[1400px] animate-[fadeUp_0.35s_ease-out_forwards] pb-20 md:pb-0">
      <div className="grid items-start gap-4 min-[901px]:grid-cols-[1fr_350px]">
        <div className="flex flex-col gap-3.5">
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-[18px] md:px-6 md:py-[22px]">
            <div className="mb-[18px] flex flex-col items-start gap-3.5 md:mb-5 md:flex-row md:gap-4">
              <div className="flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded px-[7px] py-0.5 text-[10px] font-bold uppercase tracking-[0.09em] ${isResolved ? "bg-[var(--surface-hover)] text-[var(--muted)]" : "bg-yes/10 text-yes"}`}>
                    {market.cadence === "24h" ? "Price" : "Market"}
                  </span>
                  {!isResolved && <span className="inline-block h-1.5 w-1.5 animate-[blink_2s_ease-in-out_infinite] rounded-full bg-yes" />}
                  <span className="font-mono text-[10px] text-[var(--muted)]">{market.cadence ?? "daily"} cadence</span>
                </div>
                <h1 className="max-w-[580px] text-base font-semibold leading-[1.4] tracking-[-0.01em] text-[var(--foreground)] md:text-[17px]">{marketQuestion}</h1>
              </div>
              <div className="w-full shrink-0 md:w-auto">
                {isResolved ? (
                  <div className={`w-fit rounded-lg border px-3.5 py-1.5 ${market.result === 1 ? "border-yes bg-yes/10 text-yes" : "border-no bg-no/10 text-no"}`}>
                    <span className="font-mono text-[13px] font-bold">{market.result === 1 ? outcomeLabels.yesShort : outcomeLabels.noShort}</span>
                  </div>
                ) : (
                  <div className="flex w-full items-end justify-between gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3.5 py-2.5 md:w-auto md:justify-start md:border-0 md:bg-transparent md:p-0">
                    {[countdown.h, countdown.m, countdown.s].map((v, i) => (
                      <div key={`${v}-${i}`} className="text-center">
                        <div className="font-mono text-[22px] font-medium leading-none md:text-[28px]">{v}</div>
                        <div className="mt-[3px] text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{["HRS", "MINS", "SECS"][i]}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {!isResolved && (
              <div className="mt-3 md:mt-4">
                <div className="mb-3">
                  <div className="flex w-fit gap-[3px] rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-[3px]">
                    {[["price", "NAM Price"], ["prob", "Probabilities"]].map(([value, label]) => (
                      <button key={value} onClick={() => setChartMode(value as "price" | "prob")} className={`cursor-pointer rounded-md border-0 px-3.5 py-[5px] text-[11px] font-semibold ${chartMode === value ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-[var(--surface-hover)] text-[var(--muted)]"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {chartMode === "price" ? <NamPriceChart points={namHistory} threshold={priceToBeat} tokenIconUrl={namIconUrl} /> : <PriceChart trades={trades || []} marketCreatedAt={market.createdAt} outcomeLabel={outcomeLabels.yes} />}
              </div>
            )}

            <div className="grid gap-3.5 border-t border-[var(--border-subtle)] pt-[18px] md:flex">
              {priceToBeat != null && (
                <div className="grid grid-cols-2 gap-3 md:mr-[18px] md:flex md:gap-7">
                  <div className="min-w-0 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-2.5 md:border-0 md:bg-transparent md:p-0">
                    <div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Price to Beat</div>
                    <div className="font-mono text-lg">${priceToBeat.toFixed(5)}</div>
                  </div>
                  <div className="min-w-0 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-2.5 md:border-0 md:bg-transparent md:p-0">
                    <div className="mb-[5px] flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                      Current Price
                      {priceDelta != null && (
                        <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-px font-mono text-[9px] font-bold ${priceDelta >= 0 ? "bg-yes/10 text-yes" : "bg-no/10 text-no"}`}>
                          {priceDelta >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />} ${Math.abs(priceDelta).toFixed(5)}
                        </span>
                      )}
                    </div>
                    <div className={`font-mono text-lg ${namPrice != null && priceDelta != null && priceDelta < 0 ? "text-no" : "text-yes"}`}>
                      {namPrice == null ? "—" : `$${namPrice.toFixed(5)}`}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 md:ml-auto md:flex md:gap-5">
                <div className="min-w-0 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-2.5 md:border-0 md:bg-transparent md:p-0"><div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">{outcomeLabels.yes} %</div><div className="font-mono text-sm text-yes">{yesPct.toFixed(1)}%</div></div>
                <div className="min-w-0 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-2.5 md:border-0 md:bg-transparent md:p-0"><div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">{outcomeLabels.no} %</div><div className="font-mono text-sm text-no">{noPct.toFixed(1)}%</div></div>
                <div className="min-w-0 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-2.5 md:border-0 md:bg-transparent md:p-0"><div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">Volume</div><div className="font-mono text-sm">${liveVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
                <div className="min-w-0 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-2.5 md:border-0 md:bg-transparent md:p-0"><div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">Liquidity</div><div className="font-mono text-sm">${Number(market.liquidity).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
              </div>
            </div>
            <div className="mt-4">
              <ProbBar yes={yesPct} height={5} />
            </div>
          </div>

          {market.cadence === "24h" && priorHourlyMarkets.length > 0 && (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                Previous Days
              </div>
              <div className="flex gap-2 overflow-x-auto pb-0.5">
                {hourlyHistory.map((item) => {
                  const isCurrent = item.id === market.id;
                  const displayDate = formatEasternShortDate(item.endTime) ?? `#${item.id}`;
                  return (
                    <Link
                      key={item.id}
                      href={`/market/${item.id}`}
                      className={`shrink-0 rounded-lg border px-3 py-2 text-xs no-underline ${isCurrent ? "border-yes/40 bg-yes/10 text-yes" : "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-[var(--muted)]"}`}
                    >
                      <span className="font-mono">{displayDate}</span>
                      <span className="mt-0.5 block text-[9px] uppercase tracking-[0.06em]">
                        {item.resolved ? "Resolved" : "Active"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="mb-3 flex gap-1">
              {[["trades", "Recent Trades"], ["about", "About"]].map(([value, label]) => (
                <button key={value} onClick={() => setTab(value as "trades" | "about")} className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold ${tab === value ? "border border-[var(--border)] bg-[var(--surface-hover)] text-[var(--foreground)]" : "border border-transparent bg-transparent text-[var(--muted)]"}`}>
                  {label}
                </button>
              ))}
            </div>
            {tab === "trades" ? (
              <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-5 py-[18px]">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 border-b border-[var(--border-subtle)] pb-2.5 md:grid-cols-[110px_1fr_80px_80px_80px]">
                  {["Outcome", "Trader", "Shares", "Amount", "Time"].map((h) => <span key={h} className={`text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--muted)] ${h === "Shares" || h === "Time" ? "hidden md:inline" : ""}`}>{h}</span>)}
                </div>
                {(trades ?? []).slice(0, 8).map((trade, i, arr) => (
                  <div key={trade.id} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 py-[11px] md:grid-cols-[110px_1fr_80px_80px_80px] ${i < arr.length - 1 ? "border-b border-[var(--border-subtle)]" : ""}`}>
                    <span className={`w-fit rounded px-2 py-[3px] text-[9px] font-bold tracking-[0.04em] ${trade.isYes ? "bg-yes/10 text-yes" : "bg-no/10 text-no"}`}>{trade.isBuy ? "BUY" : "SELL"} {trade.isYes ? outcomeLabels.yesShort : outcomeLabels.noShort}</span>
                    <span className="truncate font-mono text-[11px] text-[var(--muted)]">{trade.trader.slice(0, 6)}…{trade.trader.slice(-4)}</span>
                    <span className="hidden font-mono text-[11px] md:inline">{Number(trade.shares).toFixed(1)}</span>
                    <span className="font-mono text-[11px]">${Number(trade.collateral).toFixed(2)}</span>
                    <span className="hidden text-[10px] text-[var(--muted)] md:inline">{new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
                {(trades ?? []).length === 0 && <p className="mt-3 text-xs text-[var(--muted)]">No trades yet</p>}
              </div>
            ) : (
              <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-6 py-5">
                <div className="mb-5 text-[13px] leading-[1.75]">
                  Resolves according to configured market source ({market.resolutionSource}) at market end time.
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {[["Created", new Date(market.createdAt).toLocaleString()], ["Market ID", `#${market.id}`], ["Resolution Source", market.resolutionSource], ["Cadence", market.cadence ?? "daily"]].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3.5 py-3">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">{k}</div>
                      <div className="font-mono text-xs">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="block min-[901px]:hidden">
            {(isLocked && !isResolved) ? (
              <div className="mb-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
                <p className="mb-1.5 text-base font-bold">Market Locked</p>
                <p className="text-[13px] text-[var(--muted)]">Trading is closed. Awaiting resolution…</p>
              </div>
            ) : isResolved ? (
              <div className="mb-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Market Resolved</p>
                <p className={`font-mono text-[42px] font-medium leading-none ${market.result === 1 ? "text-yes" : "text-no"}`}>{market.result === 1 ? outcomeLabels.yesShort : outcomeLabels.noShort}</p>
              </div>
            ) : null}
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">Market Info</div>
              {marketInfoRows.map(([k, v, c], i, arr) => (
                <div key={k} className={`mb-2 flex justify-between pb-2 text-xs ${i < arr.length - 1 ? "border-b border-[var(--border-subtle)]" : "border-b-0"}`}>
                  <span className="text-[var(--muted)]">{k}</span>
                  <span className={`font-mono ${c}`}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden min-[901px]:sticky min-[901px]:top-[70px] min-[901px]:block">
          {!isResolved && !isLocked ? (
            <TradePanel marketId={market.id} onChainMarketId={market.onChainId} ammAddress={market.ammAddress as `0x${string}`} yesPrice={currentYesPrice} noPrice={currentNoPrice} outcomeLabels={outcomeLabels} />
          ) : isLocked && !isResolved ? (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-7 text-center">
              <p className="mb-1.5 text-base font-bold">Market Locked</p>
              <p className="text-[13px] text-[var(--muted)]">Trading is closed. Awaiting resolution…</p>
            </div>
          ) : (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-7 text-center">
              <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Market Resolved</p>
              <p className={`mb-3.5 font-mono text-[52px] font-medium leading-none ${market.result === 1 ? "text-yes" : "text-no"}`}>{market.result === 1 ? outcomeLabels.yesShort : outcomeLabels.noShort}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Go to Portfolio to redeem your winnings</p>
            </div>
          )}

          <div className="mt-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">Market Info</div>
            {marketInfoRows.map(([k, v, c], i, arr) => (
              <div key={k} className={`mb-2 flex justify-between pb-2 text-xs ${i < arr.length - 1 ? "border-b border-[var(--border-subtle)]" : "border-b-0"}`}>
                <span className="text-[var(--muted)]">{k}</span>
                <span className={`font-mono ${c}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>


      {!isResolved && !isLocked && (
        <Drawer open={mobileTradeOpen} onOpenChange={setMobileTradeOpen}>

          <DrawerContent className="min-[901px]:hidden">
            <DrawerHeader>
              <div>
                <DrawerDescription>Trade</DrawerDescription>
                <DrawerTitle>Buy {mobileSide === "YES" ? "Up" : "Down"}</DrawerTitle>
              </div>
              <DrawerClose asChild>
                <button type="button" className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-hover)] text-[var(--foreground)]" aria-label="Close trade panel">
                  <X className="h-4 w-4" />
                </button>
              </DrawerClose>
            </DrawerHeader>
            <div className="overflow-y-auto">
              <TradePanel marketId={market.id} onChainMarketId={market.onChainId} ammAddress={market.ammAddress as `0x${string}`} yesPrice={currentYesPrice} noPrice={currentNoPrice} outcomeLabels={outcomeLabels} defaultSide={mobileSide} />
            </div>
          </DrawerContent>
        </Drawer>
      )}
      </div>
    </>
  );
}
