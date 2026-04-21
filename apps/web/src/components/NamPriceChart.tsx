"use client";

import { useMemo } from "react";

interface NamPricePoint {
  ts: string;
  priceUsd: string;
}

interface NamPriceChartProps {
  points: NamPricePoint[];
  threshold: number | null;
}

export function NamPriceChart({ points, threshold }: NamPriceChartProps) {
  const W = 800;
  const H = 200;
  const PL = 60;
  const PR = 20;
  const PT = 14;
  const PB = 28;

  const data = useMemo(
    () =>
      points
        .map((p) => ({ ts: new Date(p.ts), price: Number(p.priceUsd) }))
        .filter((p) => Number.isFinite(p.price)),
    [points]
  );

  if (data.length < 2) {
    return (
      <div className="card" style={{ padding: 20, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 12, color: "#4c4e68" }}>Waiting for NAM price data…</p>
      </div>
    );
  }

  const cw = W - PL - PR;
  const ch = H - PT - PB;
  const vals = data.map((d) => d.price);
  const target = threshold ?? vals[vals.length - 1];
  const allVals = [...vals, target];
  const lo = Math.min(...allVals) * 0.9985;
  const hi = Math.max(...allVals) * 1.0015;
  const px = (i: number) => PL + (i / (data.length - 1)) * cw;
  const py = (v: number) => PT + ch - ((v - lo) / (hi - lo || 1)) * ch;
  const ty = py(target);
  const currentPrice = vals[vals.length - 1];
  const above = currentPrice >= target;
  const color = above ? "#01d243" : "#f0324c";
  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(d.price).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${px(data.length - 1)},${H - PB} L${PL},${H - PB} Z`;

  const range = hi - lo || 1;
  const rawStep = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const step = Math.ceil(rawStep / mag) * mag;
  const firstTick = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = firstTick; v <= hi; v += step) ticks.push(Number(v.toFixed(8)));
  const xTickMod = Math.max(1, Math.floor(data.length / 5));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}>
      <defs>
        <linearGradient id="namFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <clipPath id="namClip">
          <rect x={PL} y={PT} width={cw} height={ch} />
        </clipPath>
      </defs>
      {ticks.map((v) => (
        <line key={v} x1={PL} x2={W - PR} y1={py(v).toFixed(1)} y2={py(v).toFixed(1)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      ))}
      <line x1={PL} x2={W - PR} y1={ty.toFixed(1)} y2={ty.toFixed(1)} stroke="#4c4e68" strokeWidth="1" strokeDasharray="5 4" opacity="0.7" />
      <rect x={W - PR - 54} y={ty - 10} width={54} height={18} rx="4" fill="#111320" stroke="rgba(255,255,255,0.07)" />
      <text x={W - PR - 27} y={ty + 3} textAnchor="middle" fontSize="9" fill="#4c4e68" fontFamily="'DM Mono', monospace">Target</text>
      <g clipPath="url(#namClip)">
        <path d={areaPath} fill="url(#namFill)" />
        <path d={linePath} stroke={color} strokeWidth="2" fill="none" />
        <circle cx={px(data.length - 1).toFixed(1)} cy={py(currentPrice).toFixed(1)} r="4" fill={color} stroke="#07080c" strokeWidth="2" />
      </g>
      {ticks.map((v) => (
        <text key={`y-${v}`} x={PL - 7} y={py(v) + 4} textAnchor="end" fontSize="9" fill="#4c4e68" fontFamily="'DM Mono', monospace">
          ${v.toFixed(5)}
        </text>
      ))}
      {data.map((d, i) => {
        if (i % xTickMod !== 0) return null;
        return (
          <text key={`x-${d.ts.toISOString()}`} x={px(i).toFixed(1)} y={H - 7} textAnchor="middle" fontSize="9" fill="#4c4e68" fontFamily="'DM Mono', monospace">
            {d.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </text>
        );
      })}
      <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
    </svg>
  );
}
