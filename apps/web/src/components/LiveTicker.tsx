"use client";

import { useRef, useEffect, useState } from "react";
import { Zap } from "lucide-react";

const T_AVATARS = ["#7c3aed","#2563eb","#db2777","#d97706","#0891b2","#059669","#dc2626","#4f46e5","#b45309","#0e7490","#7c3aed","#be185d"];
const T_USERS = [
  {u:"0x4f2a…8c1e",i:"4F"},{u:"alex.eth",i:"AE"},{u:"0x9b3d…2f4a",i:"9B"},
  {u:"trader_99",i:"T9"},{u:"moon_whale",i:"MW"},{u:"0x1c8f…5e2b",i:"1C"},
  {u:"defi_king",i:"DK"},{u:"0x7a4e…9d3c",i:"7A"},{u:"satoshi99",i:"S9"},
  {u:"0xf3b1…4a8d",i:"F3"},{u:"ape_trader",i:"AT"},{u:"0x2e9c…7b3f",i:"2E"},
  {u:"vitalik.eth",i:"VE"},{u:"0x8d5a…c3f1",i:"8D"},{u:"alpha_call",i:"AC"},{u:"0x3c7b…1e9a",i:"3C"},
];
const T_MARKETS = ["BTC $100K 2026","GPT-5 in 2026","SpaceX Mars <2030","S&P 500 above 7000","Quantum PC by 2028","AI replaces 30% devs","Fed rate cut Q2","ETH flips BTC","Gold above $4K","US recession 2026","Apple hits $4T","Nuclear fusion by 2027"];
const T_AMOUNTS = [25,50,75,100,125,150,200,250,300,500,750,1000,1200,1500,2000];
const T_YES = [55,58,61,64,67,70,72,74,76,80,84,88];
const T_NO = [44,41,38,35,32,29,26,24,20,18,14];
const T_TIMES = ["just now","3s ago","8s ago","14s ago","21s ago","30s ago","42s ago","55s ago","1m ago","2m ago","3m ago","5m ago","7m ago","10m ago","15m ago","20m ago"];

const TRADES = Array.from({ length: 24 }, (_, i) => {
  const u = T_USERS[i % T_USERS.length];
  const side = ([1,1,0,1,0,1,1,0,1,1,0,1,1,0,1,1][i % 16] ? "YES" : "NO") as "YES"|"NO";
  return {
    id: `t${i}`,
    user: u.u,
    initials: u.i,
    avatarColor: T_AVATARS[i % T_AVATARS.length],
    market: T_MARKETS[i % T_MARKETS.length],
    side,
    amount: T_AMOUNTS[i % T_AMOUNTS.length],
    price: side === "YES" ? T_YES[i % T_YES.length] : T_NO[i % T_NO.length],
    timeAgo: T_TIMES[i % T_TIMES.length],
  };
});
const DOUBLED_TRADES = [...TRADES, ...TRADES];

export function LiveTicker() {
  const trackRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const [newCount, setNewCount] = useState(0);

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

  useEffect(() => {
    const id = setInterval(() => setNewCount(n => n + 1), 3800);
    return () => clearInterval(id);
  }, []);

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
          {newCount > 0 && (
            <span key={newCount} className="anim-pop text-[9px] px-1.5 py-[2px] rounded-full"
              style={{ background: "rgba(1,210,67,0.15)", color: "#01d243" }}>+{newCount}</span>
          )}
        </div>

        {/* Scroll viewport */}
        <div className="flex-1 overflow-hidden relative">
          <div ref={trackRef} className="flex items-center h-full" style={{ willChange: "transform" }}>
            {DOUBLED_TRADES.map((t, i) => (
              <div key={t.id + i} className="flex items-center gap-2 px-5 h-full flex-shrink-0 whitespace-nowrap"
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
