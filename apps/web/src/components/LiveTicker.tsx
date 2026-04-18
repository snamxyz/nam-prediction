"use client";

import { useRef, useEffect, useMemo } from "react";
import { Zap } from "lucide-react";
import { useRecentTrades, type RecentTrade } from "@/hooks/useRecentTrades";

const AVATAR_COLORS = ["#7c3aed","#2563eb","#db2777","#d97706","#0891b2","#059669","#dc2626","#4f46e5","#b45309","#0e7490","#be185d","#065f46"];

function hashColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = ((h << 5) - h + addr.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function initials(addr: string): string {
  return addr.slice(0, 2).toUpperCase();
}

function timeAgo(ts: string): string {
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatTrade(t: RecentTrade) {
  const side = t.isYes ? "YES" as const : "NO" as const;
  const amount = Math.round(Number(t.collateral));
  const price = Math.round((t.isYes ? t.yesPrice : t.noPrice) * 100);
  return {
    id: t.id,
    user: truncateAddress(t.trader),
    initials: initials(t.trader),
    avatarColor: hashColor(t.trader),
    market: t.marketQuestion,
    side,
    amount,
    price,
    timeAgo: timeAgo(t.timestamp),
  };
}

export function LiveTicker() {
  const { data: trades } = useRecentTrades(50);
  const trackRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);

  const formatted = useMemo(() => {
    if (!trades || trades.length === 0) return [];
    return trades.map(formatTrade);
  }, [trades]);

  // Double the list for seamless looping
  const doubled = useMemo(() => [...formatted, ...formatted], [formatted]);

  useEffect(() => {
    let prev = 0;
    function tick(now: number) {
      const dt = prev ? Math.min(now - prev, 50) : 16;
      prev = now;
      if (!pausedRef.current && trackRef.current) {
        const half = trackRef.current.scrollWidth / 2;
        if (half > 0) {
          posRef.current -= 0.55 * (dt / 16);
          if (posRef.current <= -half) posRef.current += half;
          trackRef.current.style.transform = `translateX(${posRef.current}px)`;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (formatted.length === 0) return null;

  return (
    <div className="sticky z-40 w-full overflow-hidden"
      style={{ top: 65, height: 40, background: "rgba(9,10,14,0.88)", backdropFilter: "blur(18px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}>
      <div className="flex items-stretch h-full">
        {/* LIVE badge */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 z-20"
          style={{ background: "rgba(9,10,14,0.97)", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
          <span className="relative flex h-2 w-2">
            <span className="anim-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "#01d243", opacity: 0.75 }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#01d243" }} />
          </span>
          <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#01d243" }} />
          <span className="text-[10px] font-semibold tracking-[0.15em] uppercase" style={{ color: "#01d243" }}>Live</span>
        </div>

        {/* Scroll viewport */}
        <div className="flex-1 overflow-hidden relative">
          <div ref={trackRef} className="flex items-center h-full" style={{ willChange: "transform" }}>
            {doubled.map((t, i) => (
              <div key={`${t.id}-${i}`} className="flex items-center gap-2 px-5 h-full flex-shrink-0 whitespace-nowrap"
                style={{ borderRight: "1px solid rgba(255,255,255,0.04)" }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: t.avatarColor, fontSize: "8px", fontWeight: 700, color: "#fff" }}>
                  {t.initials}
                </div>
                <span className="text-[11px]" style={{ color: "rgba(113,113,130,0.8)" }}>{t.user}</span>
                <span className="text-[11px]" style={{ color: "rgba(232,233,237,0.35)" }}>bought</span>
                <span className="text-[10px] px-1.5 py-[2px] rounded font-bold"
                  style={t.side === "YES"
                    ? { background: "rgba(1,210,67,0.12)", color: "#01d243" }
                    : { background: "rgba(255,71,87,0.12)", color: "#ff4757" }}>
                  {t.side}
                </span>
                <span className="text-[11px]" style={{ color: "rgba(232,233,237,0.85)" }}>${t.amount}</span>
                <span className="text-[11px]" style={{ color: "rgba(232,233,237,0.35)" }}>on</span>
                <span className="text-[11px]" style={{ color: "rgba(232,233,237,0.70)" }}>{t.market}</span>
                <span className="text-[11px]" style={{ color: t.side === "YES" ? "rgba(1,210,67,0.55)" : "rgba(255,71,87,0.55)" }}>@{t.price}¢</span>
                <span className="text-[11px]" style={{ color: "rgba(232,233,237,0.20)" }}>·</span>
                <span className="text-[10px]" style={{ color: "rgba(113,113,130,0.40)" }}>{t.timeAgo}</span>
              </div>
            ))}
          </div>
          <div className="absolute inset-y-0 left-0 w-8 pointer-events-none z-10" style={{ background: "linear-gradient(to right, rgba(9,10,14,0.97), transparent)" }} />
          <div className="absolute inset-y-0 right-0 w-16 pointer-events-none z-10" style={{ background: "linear-gradient(to left, rgba(9,10,14,0.97), transparent)" }} />
        </div>
      </div>
    </div>
  );
}
