"use client";

import { useState, useEffect, useRef } from "react";
import {
  TrendingUp, TrendingDown, Search, Wallet, User, Zap,
  DollarSign, Flame, Users, Clock, BarChart3, Award, ArrowLeft,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// KEYFRAME ANIMATIONS (injected once via <style> tag)
// ─────────────────────────────────────────────────────────────────────────────
function GlobalStyles() {
  return (
    <style>{`
      @keyframes pulseSlow {
        0%,100% { opacity:1; transform:scale(1); }
        50%      { opacity:0.5; transform:scale(1.1); }
      }
      @keyframes driftOrb {
        0%,100% { transform:translate(0,0) scale(1); }
        33%     { transform:translate(30px,-20px) scale(1.05); }
        66%     { transform:translate(-20px,15px) scale(0.97); }
      }
      @keyframes fadeInPop {
        from { opacity:0; transform:scale(0.85); }
        to   { opacity:1; transform:scale(1); }
      }
      @keyframes livePing {
        75%,100% { transform:scale(2); opacity:0; }
      }
      .anim-pulse  { animation: pulseSlow ease-in-out infinite; }
      .anim-drift  { animation: driftOrb  ease-in-out infinite; }
      .anim-pop    { animation: fadeInPop 0.3s ease-out forwards; }
      .anim-ping   { animation: livePing  1s cubic-bezier(0,0,0.2,1) infinite; }
    `}</style>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────
const G70: React.CSSProperties = {
  background: "rgba(19,20,26,0.70)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  borderTop: "0.5px solid rgba(255,255,255,0.05)",
  borderLeft: "0.5px solid rgba(255,255,255,0.05)",
  borderRight: "none",
  borderBottom: "none",
  borderRadius: "1rem",
};
const G65: React.CSSProperties = {
  background: "rgba(31,32,40,0.65)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  borderTop: "0.5px solid rgba(255,255,255,0.05)",
  borderLeft: "0.5px solid rgba(255,255,255,0.05)",
  borderRight: "none",
  borderBottom: "none",
  borderRadius: "0.75rem",
};
const INNER_BORDER: React.CSSProperties = {
  borderTop: "0.5px solid rgba(255,255,255,0.05)",
  borderLeft: "0.5px solid rgba(255,255,255,0.05)",
  borderRight: "none",
  borderBottom: "none",
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface PredictionRow {
  id: string;
  label: string;
  probability: number;
  change24h?: number;
  volume: string;
}
interface DateGroup {
  label: string;
  fullLabel: string;
  endDate: string;
  totalVolume: string;
  rows: PredictionRow[];
}
interface NAMMarket {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  totalVolume: string;
  totalTraders: string;
  dates: DateGroup[];
}
interface TradeSelection {
  marketId: string;
  marketTitle: string;
  dateLabel: string;
  rowLabel: string;
  side: "YES" | "NO";
  yesPrice: number;
  noPrice: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA — LIVE TICKER
// ─────────────────────────────────────────────────────────────────────────────
const T_AVATARS = ["#7c3aed","#2563eb","#db2777","#d97706","#0891b2","#059669","#dc2626","#4f46e5","#b45309","#0e7490","#7c3aed","#be185d"];
const T_USERS   = [
  {u:"0x4f2a…8c1e",i:"4F"},{u:"alex.eth",i:"AE"},{u:"0x9b3d…2f4a",i:"9B"},
  {u:"trader_99",i:"T9"},{u:"moon_whale",i:"MW"},{u:"0x1c8f…5e2b",i:"1C"},
  {u:"defi_king",i:"DK"},{u:"0x7a4e…9d3c",i:"7A"},{u:"satoshi99",i:"S9"},
  {u:"0xf3b1…4a8d",i:"F3"},{u:"ape_trader",i:"AT"},{u:"0x2e9c…7b3f",i:"2E"},
  {u:"vitalik.eth",i:"VE"},{u:"0x8d5a…c3f1",i:"8D"},{u:"alpha_call",i:"AC"},{u:"0x3c7b…1e9a",i:"3C"},
];
const T_MARKETS = ["BTC $100K 2026","GPT-5 in 2026","SpaceX Mars <2030","S&P 500 above 7000","Quantum PC by 2028","AI replaces 30% devs","Fed rate cut Q2","ETH flips BTC","Gold above $4K","US recession 2026","Apple hits $4T","Nuclear fusion by 2027"];
const T_AMOUNTS = [25,50,75,100,125,150,200,250,300,500,750,1000,1200,1500,2000];
const T_YES     = [55,58,61,64,67,70,72,74,76,80,84,88];
const T_NO      = [44,41,38,35,32,29,26,24,20,18,14];
const T_TIMES   = ["just now","3s ago","8s ago","14s ago","21s ago","30s ago","42s ago","55s ago","1m ago","2m ago","3m ago","5m ago","7m ago","10m ago","15m ago","20m ago"];

const TRADES = Array.from({ length: 24 }, (_, i) => {
  const u    = T_USERS[i % T_USERS.length];
  const side = ([1,1,0,1,0,1,1,0,1,1,0,1,1,0,1,1][i % 16] ? "YES" : "NO") as "YES"|"NO";
  return {
    id:          `t${i}`,
    user:        u.u,
    initials:    u.i,
    avatarColor: T_AVATARS[i % T_AVATARS.length],
    market:      T_MARKETS[i % T_MARKETS.length],
    side,
    amount:      T_AMOUNTS[i % T_AMOUNTS.length],
    price:       side === "YES" ? T_YES[i % T_YES.length] : T_NO[i % T_NO.length],
    timeAgo:     T_TIMES[i % T_TIMES.length],
  };
});
const DOUBLED_TRADES = [...TRADES, ...TRADES];

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA — PREDICTION MARKETS
// ─────────────────────────────────────────────────────────────────────────────
const MARKETS: NAMMarket[] = [
  {
    id: "receipts", title: "Receipts uploaded by:", subtitle: "Cumulative receipt uploads on the NAM platform",
    icon: "🧾", totalVolume: "$284,721", totalTraders: "1,842",
    dates: [
      { label:"Apr 9",  fullLabel:"April 9, 2026",  endDate:"Apr 9, 2026",  totalVolume:"$52,340",
        rows:[{id:"r9-1",label:"300 receipts", probability:70,change24h:+5, volume:"$36,638"},
              {id:"r9-2",label:"400 receipts", probability:10,change24h:-2, volume:"$5,234"},
              {id:"r9-3",label:"500 receipts", probability: 5,change24h:-1, volume:"$2,617"},
              {id:"r9-4",label:"200 receipts", probability: 8,change24h:-3, volume:"$4,187"},
              {id:"r9-5",label:"600+ receipts",probability: 7,change24h:+1, volume:"$3,664"}]},
      { label:"Apr 10", fullLabel:"April 10, 2026", endDate:"Apr 10, 2026", totalVolume:"$61,882",
        rows:[{id:"r10-1",label:"350 receipts",probability:45,change24h:+12,volume:"$27,847"},
              {id:"r10-2",label:"250 receipts",probability:25,change24h:-4, volume:"$15,471"},
              {id:"r10-3",label:"450 receipts",probability:20,change24h:+8, volume:"$12,376"},
              {id:"r10-4",label:"550 receipts",probability:10,change24h:-2, volume:"$6,188"}]},
      { label:"Apr 11", fullLabel:"April 11, 2026", endDate:"Apr 11, 2026", totalVolume:"$48,200",
        rows:[{id:"r11-1",label:"400 receipts",probability:55,change24h:+7, volume:"$26,510"},
              {id:"r11-2",label:"300 receipts",probability:20,change24h:-5, volume:"$9,640"},
              {id:"r11-3",label:"500 receipts",probability:15,change24h:+3, volume:"$7,230"},
              {id:"r11-4",label:"600 receipts",probability:10,change24h:-2, volume:"$4,820"}]},
      { label:"Apr 12", fullLabel:"April 12, 2026", endDate:"Apr 12, 2026", totalVolume:"$59,100",
        rows:[{id:"r12-1",label:"500 receipts",probability:40,change24h:+15,volume:"$23,640"},
              {id:"r12-2",label:"400 receipts",probability:30,change24h:-6, volume:"$17,730"},
              {id:"r12-3",label:"300 receipts",probability:15,change24h:-4, volume:"$8,865"},
              {id:"r12-4",label:"600 receipts",probability:15,change24h:+3, volume:"$8,865"}]},
      { label:"Apr 13", fullLabel:"April 13, 2026", endDate:"Apr 13, 2026", totalVolume:"$63,199",
        rows:[{id:"r13-1",label:"350 receipts",probability:60,change24h:+10,volume:"$37,919"},
              {id:"r13-2",label:"450 receipts",probability:20,change24h:+5, volume:"$12,640"},
              {id:"r13-3",label:"250 receipts",probability:12,change24h:-8, volume:"$7,584"},
              {id:"r13-4",label:"550 receipts",probability: 8,change24h:-2, volume:"$5,056"}]},
    ],
  },
  {
    id: "tokens", title: "Number of NAM tokens distributed by:", subtitle: "Cumulative NAM token distribution milestones",
    icon: "🪙", totalVolume: "$193,450", totalTraders: "1,241",
    dates: [
      { label:"Apr 9",  fullLabel:"April 9, 2026",  endDate:"Apr 9, 2026",  totalVolume:"$38,690",
        rows:[{id:"t9-1",label:"1M tokens",  probability:40,change24h:+8, volume:"$15,476"},
              {id:"t9-2",label:"5M tokens",  probability:30,change24h:-3, volume:"$11,607"},
              {id:"t9-3",label:"500K tokens",probability:15,change24h:-5, volume:"$5,804"},
              {id:"t9-4",label:"10M tokens", probability:10,change24h:+2, volume:"$3,869"},
              {id:"t9-5",label:"50M tokens", probability: 5,change24h:+1, volume:"$1,934"}]},
      { label:"Apr 10", fullLabel:"April 10, 2026", endDate:"Apr 10, 2026", totalVolume:"$44,120",
        rows:[{id:"t10-1",label:"1M tokens",  probability:45,change24h:+5, volume:"$19,854"},
              {id:"t10-2",label:"5M tokens",  probability:30,change24h:+3, volume:"$13,236"},
              {id:"t10-3",label:"10M tokens", probability:15,change24h:+7, volume:"$6,618"},
              {id:"t10-4",label:"500K tokens",probability:10,change24h:-5, volume:"$4,412"}]},
      { label:"Apr 11", fullLabel:"April 11, 2026", endDate:"Apr 11, 2026", totalVolume:"$37,280",
        rows:[{id:"t11-1",label:"1M tokens",  probability:50,change24h:+5, volume:"$18,640"},
              {id:"t11-2",label:"5M tokens",  probability:25,change24h:-3, volume:"$9,320"},
              {id:"t11-3",label:"10M tokens", probability:15,change24h:+8, volume:"$5,592"},
              {id:"t11-4",label:"500K tokens",probability:10,change24h:-5, volume:"$3,728"}]},
      { label:"Apr 12", fullLabel:"April 12, 2026", endDate:"Apr 12, 2026", totalVolume:"$35,870",
        rows:[{id:"t12-1",label:"1M tokens",  probability:35,change24h:-5, volume:"$12,555"},
              {id:"t12-2",label:"5M tokens",  probability:35,change24h:+10,volume:"$12,555"},
              {id:"t12-3",label:"10M tokens", probability:20,change24h:+5, volume:"$7,174"},
              {id:"t12-4",label:"500K tokens",probability:10,change24h:-8, volume:"$3,587"}]},
      { label:"Apr 13", fullLabel:"April 13, 2026", endDate:"Apr 13, 2026", totalVolume:"$37,490",
        rows:[{id:"t13-1",label:"1M tokens",  probability:45,change24h:+10,volume:"$16,871"},
              {id:"t13-2",label:"5M tokens",  probability:30,change24h:-5, volume:"$11,247"},
              {id:"t13-3",label:"10M tokens", probability:15,change24h:+5, volume:"$5,624"},
              {id:"t13-4",label:"500K tokens",probability:10,change24h:-2, volume:"$3,749"}]},
    ],
  },
  {
    id: "price", title: "Price of NAM token by:", subtitle: "NAM/USD price predictions at market close",
    icon: "💹", totalVolume: "$521,830", totalTraders: "3,104",
    dates: [
      { label:"Apr 9",  fullLabel:"April 9, 2026",  endDate:"Apr 9, 2026",  totalVolume:"$104,366",
        rows:[{id:"p9-1",label:"$0.25", probability:40,change24h:+5, volume:"$41,746"},
              {id:"p9-2",label:"$0.10", probability:25,change24h:-3, volume:"$26,092"},
              {id:"p9-3",label:"$0.50", probability:20,change24h:+8, volume:"$20,873"},
              {id:"p9-4",label:"$0.05", probability: 5,change24h:-2, volume:"$5,218"},
              {id:"p9-5",label:"$1.00+",probability:10,change24h:+2, volume:"$10,437"}]},
      { label:"Apr 10", fullLabel:"April 10, 2026", endDate:"Apr 10, 2026", totalVolume:"$118,240",
        rows:[{id:"p10-1",label:"$0.25", probability:45,change24h:+5, volume:"$53,208"},
              {id:"p10-2",label:"$0.50", probability:25,change24h:+12,volume:"$29,560"},
              {id:"p10-3",label:"$0.10", probability:20,change24h:-8, volume:"$23,648"},
              {id:"p10-4",label:"$1.00+",probability:10,change24h:+5, volume:"$11,824"}]},
      { label:"Apr 11", fullLabel:"April 11, 2026", endDate:"Apr 11, 2026", totalVolume:"$97,150",
        rows:[{id:"p11-1",label:"$0.25", probability:50,change24h:+5, volume:"$48,575"},
              {id:"p11-2",label:"$0.50", probability:20,change24h:+8, volume:"$19,430"},
              {id:"p11-3",label:"$0.10", probability:20,change24h:-5, volume:"$19,430"},
              {id:"p11-4",label:"$1.00+",probability:10,change24h:+3, volume:"$9,715"}]},
      { label:"Apr 12", fullLabel:"April 12, 2026", endDate:"Apr 12, 2026", totalVolume:"$112,080",
        rows:[{id:"p12-1",label:"$0.25", probability:40,change24h:-5, volume:"$44,832"},
              {id:"p12-2",label:"$0.50", probability:35,change24h:+20,volume:"$39,228"},
              {id:"p12-3",label:"$1.00+",probability:15,change24h:+10,volume:"$16,812"},
              {id:"p12-4",label:"$0.10", probability:10,change24h:-8, volume:"$11,208"}]},
      { label:"Apr 13", fullLabel:"April 13, 2026", endDate:"Apr 13, 2026", totalVolume:"$89,994",
        rows:[{id:"p13-1",label:"$0.50", probability:45,change24h:+10,volume:"$40,497"},
              {id:"p13-2",label:"$0.25", probability:30,change24h:-5, volume:"$26,998"},
              {id:"p13-3",label:"$1.00+",probability:15,change24h:+8, volume:"$13,499"},
              {id:"p13-4",label:"$0.10", probability:10,change24h:-3, volume:"$9,000"}]},
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATED BACKGROUND
// ───────────────────────────────────────────────────────────────────��─────────
function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" style={{ background: "#0a0b0f" }}>
      {/* Pulsing corner orbs */}
      <div className="anim-pulse absolute rounded-full" style={{ top:-300,left:-300,width:800,height:800,background:"rgba(1,210,67,0.06)",filter:"blur(150px)",animationDuration:"10s",animationDelay:"0s" }} />
      <div className="anim-pulse absolute rounded-full" style={{ bottom:-400,right:-400,width:1000,height:1000,background:"rgba(1,210,67,0.08)",filter:"blur(180px)",animationDuration:"12s",animationDelay:"3s" }} />
      <div className="anim-pulse absolute rounded-full" style={{ top:"10%",right:-200,width:600,height:600,background:"rgba(1,210,67,0.05)",filter:"blur(120px)",animationDuration:"14s",animationDelay:"6s" }} />
      {/* Drifting mid orbs */}
      <div className="anim-drift absolute rounded-full" style={{ top:"35%",left:"15%",width:500,height:500,background:"rgba(1,210,67,0.04)",filter:"blur(130px)",animationDuration:"18s",animationDelay:"0s" }} />
      <div className="anim-drift absolute rounded-full" style={{ top:"55%",right:"20%",width:400,height:400,background:"rgba(1,210,67,0.05)",filter:"blur(100px)",animationDuration:"22s",animationDelay:"7s" }} />
      <div className="anim-pulse absolute rounded-full" style={{ bottom:-100,left:"25%",width:600,height:400,background:"rgba(1,210,67,0.04)",filter:"blur(120px)",animationDuration:"16s",animationDelay:"4s" }} />
      {/* Dot grid */}
      <div className="absolute inset-0" style={{ opacity:0.30, backgroundImage:"radial-gradient(circle, rgba(1,210,67,0.15) 1px, transparent 1px)", backgroundSize:"48px 48px" }} />
      {/* Line grid */}
      <div className="absolute inset-0" style={{ opacity:0.20, backgroundImage:"linear-gradient(rgba(1,210,67,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(1,210,67,0.04) 1px, transparent 1px)", backgroundSize:"96px 96px" }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────────────────────────────────────
function Header({ onProfile }: { onProfile: () => void }) {
  return (
    <header className="sticky top-0 z-50 w-full" style={{ background:"rgba(10,11,15,0.95)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-6">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-7 h-7" style={{ color:"#01d243" }} />
            <span className="text-xl font-semibold" style={{ color:"#e8e9ed" }}>NAM Market</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {["Markets","Politics","Sports","Crypto","Business"].map((item, i) => (
              <a key={item} href="#" style={{ color: i === 0 ? "#e8e9ed" : "#717182", textDecoration:"none" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#e8e9ed")}
                onMouseLeave={e => (e.currentTarget.style.color = i === 0 ? "#e8e9ed" : "#717182")}>
                {item}
              </a>
            ))}
          </nav>
        </div>
        {/* Right: search + wallet + profile */}
        <div className="flex items-center gap-4">
          <div className="relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color:"#717182" }} />
            <input type="text" placeholder="Search markets…"
              className="w-64 pl-10 pr-4 py-2 text-sm rounded-lg outline-none"
              style={{ background:"#1f2028", border:"1px solid rgba(255,255,255,0.08)", color:"#e8e9ed" }} />
          </div>
          <button className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm rounded-lg"
            style={{ background:"#1f2028", border:"1px solid rgba(255,255,255,0.08)", color:"#e8e9ed" }}>
            <Wallet className="w-4 h-4" />$1,234.56
          </button>
          <button onClick={onProfile} className="p-2 rounded-lg transition-colors"
            style={{ color:"#e8e9ed" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#1f2028")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <User className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE TICKER
// ─────────────────────────────────────────────────────────────────────────────
function LiveTicker() {
  const trackRef  = useRef<HTMLDivElement>(null);
  const posRef    = useRef(0);
  const rafRef    = useRef<number>(0);
  const pausedRef = useRef(false);
  const [newCount, setNewCount] = useState(0);

  // Single RAF loop — empty deps = mounts once, scrollWidth never changes
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

  // Cosmetic counter — completely decoupled from scroll DOM
  useEffect(() => {
    const id = setInterval(() => setNewCount(n => n + 1), 3800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="sticky z-40 w-full overflow-hidden"
      style={{ top:65, height:40, background:"rgba(9,10,14,0.88)", backdropFilter:"blur(18px)", borderBottom:"1px solid rgba(255,255,255,0.05)" }}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}>
      <div className="flex items-stretch h-full">

        {/* LIVE badge */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 z-20"
          style={{ background:"rgba(9,10,14,0.97)", borderRight:"1px solid rgba(255,255,255,0.05)" }}>
          <span className="relative flex h-2 w-2">
            <span className="anim-ping absolute inline-flex h-full w-full rounded-full" style={{ background:"#01d243", opacity:0.75 }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background:"#01d243" }} />
          </span>
          <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color:"#01d243" }} />
          <span className="text-[10px] font-semibold tracking-[0.15em] uppercase" style={{ color:"#01d243" }}>Live</span>
          {newCount > 0 && (
            <span key={newCount} className="anim-pop text-[9px] px-1.5 py-[2px] rounded-full"
              style={{ background:"rgba(1,210,67,0.15)", color:"#01d243" }}>+{newCount}</span>
          )}
        </div>

        {/* Scroll viewport */}
        <div className="flex-1 overflow-hidden relative">
          <div ref={trackRef} className="flex items-center h-full" style={{ willChange:"transform" }}>
            {DOUBLED_TRADES.map((t, i) => (
              <div key={t.id + i} className="flex items-center gap-2 px-5 h-full flex-shrink-0 whitespace-nowrap"
                style={{ borderRight:"1px solid rgba(255,255,255,0.04)" }}>
                {/* Avatar */}
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background:t.avatarColor, fontSize:"8px", fontWeight:700, color:"#fff" }}>
                  {t.initials}
                </div>
                <span className="text-[11px]" style={{ color:"rgba(113,113,130,0.8)" }}>{t.user}</span>
                <span className="text-[11px]" style={{ color:"rgba(232,233,237,0.35)" }}>bought</span>
                <span className="text-[10px] px-1.5 py-[2px] rounded font-bold"
                  style={ t.side === "YES"
                    ? { background:"rgba(1,210,67,0.12)",  color:"#01d243" }
                    : { background:"rgba(255,71,87,0.12)", color:"#ff4757" }}>
                  {t.side}
                </span>
                <span className="text-[11px]" style={{ color:"rgba(232,233,237,0.85)" }}>${t.amount}</span>
                <span className="text-[11px]" style={{ color:"rgba(232,233,237,0.35)" }}>on</span>
                <span className="text-[11px]" style={{ color:"rgba(232,233,237,0.70)" }}>{t.market}</span>
                <span className="text-[11px]" style={{ color: t.side === "YES" ? "rgba(1,210,67,0.55)" : "rgba(255,71,87,0.55)" }}>@{t.price}¢</span>
                <span className="text-[11px]" style={{ color:"rgba(232,233,237,0.20)" }}>·</span>
                <span className="text-[10px]" style={{ color:"rgba(113,113,130,0.40)" }}>{t.timeAgo}</span>
              </div>
            ))}
          </div>
          {/* Fade edges */}
          <div className="absolute inset-y-0 left-0 w-8 pointer-events-none z-10" style={{ background:"linear-gradient(to right, rgba(9,10,14,0.97), transparent)" }} />
          <div className="absolute inset-y-0 right-0 w-16 pointer-events-none z-10" style={{ background:"linear-gradient(to left, rgba(9,10,14,0.97), transparent)" }} />
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS BAR
// ─────────────────────────────────────────────────────────────────────────────
function StatsBar() {
  const stats = [
    { icon:<DollarSign className="w-5 h-5" style={{color:"#01d243"}} />, label:"Total Volume",   value:"$1.02M",  change:"+18.4%", pos:true },
    { icon:<Flame       className="w-5 h-5" style={{color:"#ff4757"}} />, label:"24h Volume",    value:"$84,320", change:"+12.4%", pos:true },
    { icon:<Users       className="w-5 h-5" style={{color:"#a855f7"}} />, label:"Active Traders",value:"6,187",   change:"+3.1%",  pos:true },
    { icon:<TrendingUp  className="w-5 h-5" style={{color:"#00e676"}} />, label:"Open Markets",  value:"3",       change:"15 date groups", pos:true },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
      {stats.map(s => (
        <div key={s.label} style={G70} className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg" style={{ ...G65, borderRadius:"0.5rem" }}>{s.icon}</div>
            <span className="text-xs" style={{ color:"#717182" }}>{s.label}</span>
          </div>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-semibold" style={{ color:"#e8e9ed" }}>{s.value}</span>
            <span className="text-xs" style={{ color: s.pos ? "#00e676" : "#ff4757" }}>{s.change}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRADING PANEL
// ─────────────────────────────────────────────────────────────────────────────
const QUICK = [1, 5, 10, 100];

function TradingPanel({ sel, onClear }: { sel: TradeSelection | null; onClear: () => void }) {
  const [amount, setAmount]     = useState("");
  const [side, setSide]         = useState<"YES"|"NO">(sel?.side ?? "YES");
  const selKey = sel ? `${sel.marketId}-${sel.dateLabel}-${sel.rowLabel}` : "none";

  const num        = parseFloat(amount) || 0;
  const price      = side === "YES" ? (sel?.yesPrice ?? 50) / 100 : (sel?.noPrice ?? 50) / 100;
  const shares     = price > 0 ? num / price : 0;
  const win        = shares;
  const profit     = win - num;
  const pct        = num > 0 ? (profit / num) * 100 : 0;
  const isYes      = side === "YES";
  const C          = isYes ? "#01d243" : "#ff4757";

  if (!sel) return (
    <div style={{ ...G70, minHeight: 340 }} className="p-6 flex flex-col items-center justify-center text-center gap-4">
      <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl" style={{ background:"rgba(31,32,40,0.60)" }}>📊</div>
      <div>
        <p className="text-sm mb-1" style={{ color:"rgba(232,233,237,0.80)" }}>Select an outcome</p>
        <p className="text-xs" style={{ color:"#717182" }}>Click Buy Yes or Buy No on any row to place a trade</p>
      </div>
    </div>
  );

  return (
    <div key={selKey} style={{ ...G70, overflow:"hidden" }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom:"0.5px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-xs" style={{ color:"#717182" }}>{sel.marketTitle}</p>
          <button onClick={onClear} className="text-xs transition-colors flex-shrink-0"
            style={{ color:"#717182" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#e8e9ed")}
            onMouseLeave={e => (e.currentTarget.style.color = "#717182")}>✕</button>
        </div>
        <p className="text-sm" style={{ color:"rgba(232,233,237,0.90)" }}>
          {sel.rowLabel} <span style={{ color:"#717182" }}>· {sel.dateLabel}</span>
        </p>
      </div>

      <div className="px-5 pt-4 pb-5">
        {/* Yes / No toggle */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {(["YES","NO"] as const).map(s => {
            const active = side === s;
            const sc = s === "YES" ? "#01d243" : "#ff4757";
            const price_c = s === "YES" ? sel.yesPrice : sel.noPrice;
            return (
              <button key={s} onClick={() => setSide(s)} className="py-2.5 rounded-lg text-sm font-semibold transition-all"
                style={ active
                  ? { background:`${sc}33`, color:sc, ...INNER_BORDER, borderColor:`${sc}4d` }
                  : { background:"rgba(31,32,40,0.50)", color:"#717182", ...INNER_BORDER }}>
                {s === "YES" ? "Yes" : "No"} {price_c}¢
              </button>
            );
          })}
        </div>

        {/* Amount */}
        <p className="text-xs mb-2" style={{ color:"#717182" }}>Amount</p>
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color:"#717182" }}>$</span>
          <input type="number" min="0" placeholder="0" value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full rounded-lg pl-7 pr-4 py-2.5 text-sm text-right outline-none"
            style={{ background:"rgba(31,32,40,0.60)", ...INNER_BORDER, color:"#e8e9ed" }} />
        </div>

        {/* Quick amounts */}
        <div className="flex gap-2 mb-5">
          {QUICK.map(q => (
            <button key={q} onClick={() => setAmount(s => String((parseFloat(s)||0) + q))}
              className="flex-1 py-1.5 rounded-md text-xs transition-all"
              style={{ background:"rgba(31,32,40,0.50)", color:"#717182", ...INNER_BORDER }}
              onMouseEnter={e => { e.currentTarget.style.background="rgba(31,32,40,0.80)"; e.currentTarget.style.color="#e8e9ed"; }}
              onMouseLeave={e => { e.currentTarget.style.background="rgba(31,32,40,0.50)"; e.currentTarget.style.color="#717182"; }}>
              +${q}
            </button>
          ))}
          <button onClick={() => setAmount("1000")}
            className="flex-1 py-1.5 rounded-md text-xs transition-all"
            style={{ background:"rgba(31,32,40,0.50)", color:"#717182", ...INNER_BORDER }}
            onMouseEnter={e => { e.currentTarget.style.background="rgba(31,32,40,0.80)"; e.currentTarget.style.color="#e8e9ed"; }}
            onMouseLeave={e => { e.currentTarget.style.background="rgba(31,32,40,0.50)"; e.currentTarget.style.color="#717182"; }}>
            Max
          </button>
        </div>

        {/* Return breakdown */}
        <div className="rounded-xl p-4 mb-5" style={{ background:"rgba(31,32,40,0.50)", ...INNER_BORDER }}>
          {[
            ["Avg price",  `${(price * 100).toFixed(0)}¢`, false],
            ["Shares",     num > 0 ? shares.toFixed(2) : "—", false],
          ].map(([label, val]) => (
            <div key={label as string} className="flex justify-between text-xs mb-2.5">
              <span style={{ color:"#717182" }}>{label}</span>
              <span style={{ color:"#e8e9ed" }}>{val}</span>
            </div>
          ))}
          <div className="my-2.5" style={{ height:1, background:"rgba(255,255,255,0.05)" }} />
          <div className="flex justify-between text-xs mb-2.5">
            <span style={{ color:"#717182" }}>Potential return</span>
            <span style={{ color: num > 0 ? C : "#717182", fontWeight: num > 0 ? 600 : 400 }}>
              {num > 0 ? `$${win.toFixed(2)} (+${pct.toFixed(1)}%)` : "—"}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color:"#717182" }}>Max win</span>
            <span style={{ color:"rgba(232,233,237,0.80)" }}>{num > 0 ? `$${win.toFixed(2)}` : "—"}</span>
          </div>
        </div>

        {/* Trade button */}
        <button disabled={num <= 0} className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
          style={ num > 0
            ? { background:C, color: isYes ? "#000" : "#fff", cursor:"pointer" }
            : { background:"rgba(31,32,40,0.50)", color:"#717182", cursor:"not-allowed" }}>
          {num > 0 ? `Buy ${side} · $${num.toFixed(2)}` : "Enter an amount"}
        </button>
        <p className="text-center text-[10px] mt-3" style={{ color:"rgba(113,113,130,0.50)" }}>By trading, you agree to the Terms of Use.</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKETS PAGE
// ─────────────────────────────────────────────────────────────────────────────
function MarketsPage() {
  const [activeMktId, setActiveMktId] = useState(MARKETS[0].id);
  const [datIdx,      setDatIdx]      = useState(0);
  const [sel,         setSel]         = useState<TradeSelection | null>(null);

  const mkt = MARKETS.find(m => m.id === activeMktId)!;
  const dg  = mkt.dates[datIdx];

  const handleBuy = (row: PredictionRow, side: "YES"|"NO") => {
    setSel({ marketId:mkt.id, marketTitle:mkt.title, dateLabel:dg.fullLabel,
             rowLabel:row.label, side, yesPrice:row.probability, noPrice:100-row.probability });
  };

  return (
    <div className="flex gap-6 items-start">

      {/* ── Left ── */}
      <div className="flex-1 min-w-0">

        {/* Market selector tabs */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-5">
          {MARKETS.map(m => {
            const active = activeMktId === m.id;
            return (
              <button key={m.id} onClick={() => { setActiveMktId(m.id); setDatIdx(0); setSel(null); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all whitespace-nowrap"
                style={ active
                  ? { background:"rgba(1,210,67,0.15)", color:"#01d243", ...INNER_BORDER, borderColor:"rgba(1,210,67,0.25)" }
                  : { background:"rgba(31,32,40,0.40)", color:"#717182", ...INNER_BORDER }}>
                <span>{m.icon}</span>
                <span className="hidden sm:inline">{m.title.replace(":","").trim()}</span>
              </button>
            );
          })}
        </div>

        {/* Market card */}
        <div style={{ ...G70, overflow:"hidden" }}>

          {/* Market header */}
          <div className="px-6 pt-5 pb-4" style={{ borderBottom:"0.5px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{mkt.icon}</span>
              <div>
                <h2 className="text-base" style={{ color:"#e8e9ed" }}>{mkt.title}</h2>
                <p className="text-xs mt-0.5" style={{ color:"#717182" }}>{mkt.subtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-5 text-xs" style={{ color:"#717182" }}>
              <span className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5" style={{ color:"#01d243" }} />
                <span style={{ color:"rgba(232,233,237,0.70)" }}>{mkt.totalVolume}</span> Vol.
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" style={{ color:"#01d243" }} />
                <span style={{ color:"rgba(232,233,237,0.70)" }}>{mkt.totalTraders}</span> traders
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" style={{ color:"#01d243" }} />
                Ends {dg.endDate}
              </span>
            </div>
          </div>

          {/* Date tabs */}
          <div className="flex items-center px-4 pt-3 pb-0 overflow-x-auto">
            {mkt.dates.map((d, i) => {
              const active = datIdx === i;
              return (
                <button key={d.label} onClick={() => { setDatIdx(i); setSel(null); }}
                  className="relative px-4 py-2 text-sm rounded-t-lg transition-all flex-shrink-0"
                  style={{ color: active ? "#01d243" : "#717182", background: active ? "rgba(1,210,67,0.08)" : "transparent" }}>
                  {d.label}
                  {active && <span className="absolute bottom-0 left-0 right-0 h-[1px] rounded-full" style={{ background:"#01d243" }} />}
                </button>
              );
            })}
          </div>

          {/* Table header */}
          <div className="flex items-center gap-3 px-5 py-2" style={{ borderTop:"0.5px solid rgba(255,255,255,0.05)", borderBottom:"0.5px solid rgba(255,255,255,0.05)", background:"rgba(31,32,40,0.20)" }}>
            <span className="w-40 flex-shrink-0 text-[11px] uppercase tracking-wider" style={{ color:"rgba(113,113,130,0.60)" }}>Outcome</span>
            <span className="flex-1 text-[11px] uppercase tracking-wider"             style={{ color:"rgba(113,113,130,0.60)" }}>Probability</span>
            <span className="w-[220px] flex-shrink-0 text-[11px] uppercase tracking-wider text-right pr-1" style={{ color:"rgba(113,113,130,0.60)" }}>Action</span>
          </div>

          {/* Prediction rows */}
          {dg.rows.map(row => {
            const yp = row.probability;
            const np = 100 - row.probability;
            return (
              <div key={row.id} className="flex items-center gap-3 px-5 py-3.5 transition-colors"
                style={{ borderBottom:"0.5px solid rgba(255,255,255,0.04)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                {/* Label + volume */}
                <div className="w-40 flex-shrink-0">
                  <p className="text-sm" style={{ color:"rgba(232,233,237,0.90)" }}>{row.label}</p>
                  <p className="text-[11px] mt-0.5" style={{ color:"rgba(113,113,130,0.60)" }}>{row.volume} Vol.</p>
                </div>
                {/* Probability bar */}
                <div className="flex-1 flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background:"rgba(31,32,40,0.60)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width:`${row.probability}%`, background:"rgba(1,210,67,0.70)" }} />
                  </div>
                  <div className="flex items-center gap-1.5 w-24 justify-end">
                    <span className="text-sm font-semibold" style={{ color:"rgba(232,233,237,0.90)" }}>{row.probability}%</span>
                    {row.change24h !== undefined && row.change24h !== 0 && (
                      <span className="text-[11px] flex items-center gap-0.5"
                        style={{ color: row.change24h > 0 ? "rgba(1,210,67,0.80)" : "rgba(255,71,87,0.80)" }}>
                        {row.change24h > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {Math.abs(row.change24h)}%
                      </span>
                    )}
                  </div>
                </div>
                {/* Buy buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => handleBuy(row, "YES")} className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
                    style={{ background:"rgba(1,210,67,0.15)", color:"#01d243", ...INNER_BORDER, borderColor:"rgba(1,210,67,0.15)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(1,210,67,0.25)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(1,210,67,0.15)")}>
                    Buy Yes {yp}¢
                  </button>
                  <button onClick={() => handleBuy(row, "NO")} className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
                    style={{ background:"rgba(255,71,87,0.15)", color:"#ff4757", ...INNER_BORDER, borderColor:"rgba(255,71,87,0.15)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,71,87,0.25)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,71,87,0.15)")}>
                    Buy No {np}¢
                  </button>
                </div>
              </div>
            );
          })}

          {/* Date volume footer */}
          <div className="px-5 py-3" style={{ borderTop:"0.5px solid rgba(255,255,255,0.05)", background:"rgba(31,32,40,0.10)" }}>
            <p className="text-xs" style={{ color:"rgba(113,113,130,0.60)" }}>
              Volume for {dg.fullLabel}:
              <span className="ml-1" style={{ color:"rgba(232,233,237,0.70)" }}>{dg.totalVolume}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ── Right: sticky trading panel ── */}
      <div className="w-80 flex-shrink-0 sticky" style={{ top:120 }}>
        <TradingPanel sel={sel} onClear={() => setSel(null)} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE PAGE
// ─────────────────────────────────────────────────────────────────────────────
function ProfilePage({ onBack }: { onBack: () => void }) {
  const positions = [
    { id:"1", market:"Will Bitcoin reach $100,000 by the end of 2026?",             side:"Yes", shares:150, avgPrice:0.65, currentPrice:0.67, value:100.5, profit:3.0  },
    { id:"2", market:"Will OpenAI release GPT-5 in 2026?",                          side:"Yes", shares:200, avgPrice:0.78, currentPrice:0.81, value:162,   profit:6.0  },
    { id:"3", market:"Will AI replace 30% of software engineering jobs by 2027?",   side:"No",  shares:100, avgPrice:0.60, currentPrice:0.58, value:58,    profit:-2.0 },
  ];
  const totalValue  = positions.reduce((s, p) => s + p.value,  0);
  const totalProfit = positions.reduce((s, p) => s + p.profit, 0);

  return (
    <div className="min-h-screen" style={{ background:"#0a0b0f" }}>
      <AnimatedBackground />
      {/* Back header */}
      <div className="sticky top-0 z-10" style={{ background:"rgba(10,11,15,0.95)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <button onClick={onBack} className="flex items-center gap-2 text-sm transition-colors"
            style={{ color:"#717182" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#e8e9ed")}
            onMouseLeave={e => (e.currentTarget.style.color = "#717182")}>
            <ArrowLeft className="w-5 h-5" /> Back to Markets
          </button>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Profile card */}
        <div style={G70} className="p-8 mb-8">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background:"linear-gradient(135deg, #01d243, #00e676)" }}>
                <User className="w-10 h-10" style={{ color:"#0a0b0f" }} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold mb-1" style={{ color:"#e8e9ed" }}>Your Profile</h1>
                <p className="text-sm" style={{ color:"#717182" }}>Member since April 2026</p>
              </div>
            </div>
            <button className="px-4 py-2 text-sm rounded-lg" style={{ background:"#1f2028", border:"1px solid rgba(255,255,255,0.08)", color:"#e8e9ed" }}>Edit Profile</button>
          </div>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon:<DollarSign className="w-4 h-4" style={{color:"#01d243"}} />, label:"Balance",   value:`$1,234.56`,                   color:"#e8e9ed" },
              { icon:<BarChart3  className="w-4 h-4" style={{color:"#01d243"}} />, label:"Portfolio", value:`$${totalValue.toFixed(2)}`,    color:"#e8e9ed" },
              { icon:<TrendingUp className="w-4 h-4" style={{color:"#00e676"}} />, label:"Total P&L", value:`${totalProfit>=0?"+":""}$${totalProfit.toFixed(2)}`, color: totalProfit>=0?"#00e676":"#ff4757" },
              { icon:<Award      className="w-4 h-4" style={{color:"#01d243"}} />, label:"Win Rate",  value:"68%",                         color:"#e8e9ed" },
            ].map(s => (
              <div key={s.label} style={G65} className="p-4">
                <div className="flex items-center gap-2 mb-2">{s.icon}<span className="text-xs" style={{color:"#717182"}}>{s.label}</span></div>
                <div className="text-2xl font-semibold" style={{ color:s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Positions card */}
        <div style={G70} className="p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold" style={{ color:"#e8e9ed" }}>Active Positions</h2>
            <span className="text-sm" style={{ color:"#717182" }}>{positions.length} positions</span>
          </div>
          <div className="space-y-4">
            {positions.map(p => (
              <div key={p.id} style={G65} className="p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-1 rounded-md"
                        style={ p.side==="Yes"
                          ? { background:"rgba(0,230,118,0.20)", color:"#00e676" }
                          : { background:"rgba(255,71,87,0.20)",  color:"#ff4757" }}>
                        {p.side}
                      </span>
                      <span className="text-xs" style={{ color:"#717182" }}>{p.shares} shares @ {(p.avgPrice*100).toFixed(1)}¢</span>
                    </div>
                    <p className="text-sm leading-tight" style={{ color:"#e8e9ed" }}>{p.market}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-semibold mb-1" style={{ color:"#e8e9ed" }}>${p.value.toFixed(2)}</div>
                    <div className="text-xs" style={{ color: p.profit>=0?"#00e676":"#ff4757" }}>
                      {p.profit>=0?"+":""}${p.profit.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs pt-3" style={{ borderTop:"0.5px solid rgba(255,255,255,0.05)", color:"#717182" }}>
                  <span>Current: {(p.currentPrice*100).toFixed(1)}¢</span>
                  <span>Avg: {(p.avgPrice*100).toFixed(1)}¢</span>
                  <span style={{ color: p.profit>=0?"#00e676":"#ff4757" }}>
                    {((p.profit/(p.shares*p.avgPrice))*100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button className="w-full mt-6 py-3 text-sm rounded-lg transition-colors"
            style={{ background:"#1f2028", color:"#717182" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(31,32,40,0.80)")}
            onMouseLeave={e => (e.currentTarget.style.background = "#1f2028")}>
            View Trading History
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<"markets"|"profile">("markets");

  if (page === "profile") return (
    <>
      <GlobalStyles />
      <ProfilePage onBack={() => setPage("markets")} />
    </>
  );

  return (
    <div className="min-h-screen" style={{ background:"#0a0b0f", color:"#e8e9ed" }}>
      <GlobalStyles />
      <AnimatedBackground />
      <Header onProfile={() => setPage("profile")} />
      <LiveTicker />

      <main className="max-w-[1400px] mx-auto px-6 py-8 relative" style={{ zIndex:10 }}>
        <div className="mb-8">
          <h1 className="text-2xl font-semibold mb-2" style={{ color:"#e8e9ed" }}>NAM Prediction Markets</h1>
          <p className="text-sm" style={{ color:"#717182" }}>Trade on NAM ecosystem milestones. Backed by real outcomes.</p>
        </div>
        <StatsBar />
        <MarketsPage />
      </main>
    </div>
  );
}