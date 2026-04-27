"use client";

import { useMemo } from "react";
import { Zap } from "lucide-react";
import { useRecentTrades, type RecentTrade } from "@/hooks/useRecentTrades";

const AVATAR_CLASSES = [
  "bg-[#7c3aed]",
  "bg-[#2563eb]",
  "bg-[#db2777]",
  "bg-[#d97706]",
  "bg-[#0891b2]",
  "bg-[#059669]",
  "bg-[#dc2626]",
  "bg-[#4f46e5]",
  "bg-[#b45309]",
  "bg-[#0e7490]",
  "bg-[#be185d]",
  "bg-[#065f46]",
];

function hashColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = ((h << 5) - h + addr.charCodeAt(i)) | 0;
  return AVATAR_CLASSES[Math.abs(h) % AVATAR_CLASSES.length];
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
    avatarClass: hashColor(t.trader),
    market: t.marketQuestion,
    side,
    amount,
    price,
    timeAgo: timeAgo(t.timestamp),
  };
}

export function LiveTicker() {
  const { data: trades } = useRecentTrades(50);

  const formatted = useMemo(() => {
    if (!trades || trades.length === 0) return [];
    return trades.map(formatTrade);
  }, [trades]);

  // Double the list for seamless looping
  const doubled = useMemo(() => [...formatted, ...formatted], [formatted]);

  if (formatted.length === 0) return null;

  return (
    <div className="group sticky top-[65px] z-40 h-10 w-full overflow-hidden border-b border-white/[0.05] bg-[#090a0e]/90 backdrop-blur-[18px]">
      <div className="flex items-stretch h-full">
        {/* LIVE badge */}
        <div className="z-20 flex flex-shrink-0 items-center gap-2 border-r border-white/[0.05] bg-[#090a0e] px-4">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yes opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-yes" />
          </span>
          <Zap className="w-3.5 h-3.5 flex-shrink-0 text-yes" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-yes">Live</span>
        </div>

        {/* Scroll viewport */}
        <div className="flex-1 overflow-hidden relative">
          <div className="flex h-full animate-[tickerScroll_45s_linear_infinite] items-center will-change-transform group-hover:[animation-play-state:paused]">
            {doubled.map((t, i) => (
              <div key={`${t.id}-${i}`} className="flex h-full flex-shrink-0 items-center gap-2 whitespace-nowrap border-r border-white/[0.04] px-5">
                <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ${t.avatarClass}`}>
                  {t.initials}
                </div>
                <span className="text-[11px] text-[#717182]/80">{t.user}</span>
                <span className="text-[11px] text-[#e8e9ed]/35">bought</span>
                <span
                  className={`rounded px-1.5 py-[2px] text-[10px] font-bold ${
                    t.side === "YES"
                      ? "bg-yes/[0.12] text-yes"
                      : "bg-[#ff4757]/[0.12] text-[#ff4757]"
                  }`}
                >
                  {t.side}
                </span>
                <span className="text-[11px] text-[#e8e9ed]/85">${t.amount}</span>
                <span className="text-[11px] text-[#e8e9ed]/35">on</span>
                <span className="text-[11px] text-[#e8e9ed]/70">{t.market}</span>
                <span className={`text-[11px] ${t.side === "YES" ? "text-yes/55" : "text-[#ff4757]/55"}`}>@{t.price}¢</span>
                <span className="text-[11px] text-[#e8e9ed]/20">·</span>
                <span className="text-[10px] text-[#717182]/40">{t.timeAgo}</span>
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[#090a0e] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#090a0e] to-transparent" />
        </div>
      </div>
    </div>
  );
}
