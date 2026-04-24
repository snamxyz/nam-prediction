"use client";

import { useMemo, useRef } from "react";

interface NamPricePoint {
  ts: string;
  priceUsd: string;
}

interface NamPriceChartProps {
  points: NamPricePoint[];
  threshold: number | null;
  tokenIconUrl?: string | null;
}

const ICON_SIZE = 14;
const W = 800;
const H = 230;
const PL = 64;
const PR = 20;
const PT = 14;
// Bottom padding large enough for 3-line X-axis labels (icon + price + time)
const PB = 58;

export function NamPriceChart({ points, threshold, tokenIconUrl }: NamPriceChartProps) {
  const prevLengthRef = useRef(0);

  const data = useMemo(
    () =>
      points
        .map((p) => ({ ts: new Date(p.ts), price: Number(p.priceUsd) }))
        .filter((p) => Number.isFinite(p.price)),
    [points]
  );

  if (data.length < 2) {
    return (
      <div
        style={{
          padding: 20,
          height: H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
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

  // Split path: historical (all but last point) + new segment (last two points)
  const histData = data.slice(0, -1);
  const lastTwo = data.slice(-2);

  const buildPath = (pts: typeof data) =>
    pts.map((d, i) => {
      const globalIdx = data.indexOf(d);
      return `${i === 0 ? "M" : "L"}${px(globalIdx).toFixed(1)},${py(d.price).toFixed(1)}`;
    }).join(" ");

  const histPath = buildPath(histData);
  const fullPath = buildPath(data);
  const newSegmentPath = lastTwo.length === 2 ? buildPath(lastTwo) : "";
  const areaPath = `${fullPath} L${px(data.length - 1)},${H - PB} L${PL},${H - PB} Z`;

  // Y-axis ticks
  const range = hi - lo || 1;
  const rawStep = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const step = Math.ceil(rawStep / mag) * mag;
  const firstTick = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = firstTick; v <= hi; v += step) ticks.push(Number(v.toFixed(8)));

  // X-axis ticks — target ~4–5 labels; cap label width ~160px
  const xTickCount = Math.min(5, Math.max(2, Math.floor(cw / 155)));
  const xTickMod = Math.max(1, Math.floor(data.length / xTickCount));

  // Detect if new data was added for animation triggering
  const newPointAdded = data.length > prevLengthRef.current;
  prevLengthRef.current = data.length;
  const newSegmentKey = data.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: H, display: "block", overflow: "visible" }}
    >
      <defs>
        <style>{`
          @keyframes namLineDraw {
            from { stroke-dashoffset: 100; }
            to   { stroke-dashoffset: 0; }
          }
          @keyframes namDotPulse {
            0%,100% { r: 4; }
            50%     { r: 6.5; }
          }
          @keyframes namAreaFadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          .nam-new-segment {
            stroke-dasharray: 100;
            stroke-dashoffset: 0;
            animation: namLineDraw 0.45s cubic-bezier(0.22,1,0.36,1) forwards;
          }
          .nam-live-dot {
            animation: namDotPulse 2.2s ease-in-out infinite;
          }
          .nam-area {
            animation: namAreaFadeIn 0.5s ease forwards;
          }
        `}</style>
        <linearGradient id="namFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <clipPath id="namClip">
          <rect x={PL} y={PT} width={cw} height={ch} />
        </clipPath>
        {/* Clip path for circular icon */}
        <clipPath id="iconCircle">
          <circle cx={ICON_SIZE / 2} cy={ICON_SIZE / 2} r={ICON_SIZE / 2} />
        </clipPath>
      </defs>

      {/* Horizontal grid lines */}
      {ticks.map((v) => (
        <line
          key={v}
          x1={PL}
          x2={W - PR}
          y1={py(v).toFixed(1)}
          y2={py(v).toFixed(1)}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="1"
        />
      ))}

      {/* Target threshold line */}
      <line
        x1={PL}
        x2={W - PR}
        y1={ty.toFixed(1)}
        y2={ty.toFixed(1)}
        stroke="#4c4e68"
        strokeWidth="1"
        strokeDasharray="5 4"
        opacity="0.7"
      />
      <rect
        x={W - PR - 54}
        y={ty - 10}
        width={54}
        height={18}
        rx="4"
        fill="#111320"
        stroke="rgba(255,255,255,0.07)"
      />
      <text
        x={W - PR - 27}
        y={ty + 3}
        textAnchor="middle"
        fontSize="9"
        fill="#4c4e68"
        fontFamily="'DM Mono', monospace"
      >
        Target
      </text>

      {/* Chart area + lines (clipped) */}
      <g clipPath="url(#namClip)">
        {/* Area fill — re-keyed on length so fade-in replays subtly */}
        <path
          key={`area-${data.length}`}
          d={areaPath}
          fill="url(#namFill)"
          className="nam-area"
        />
        {/* Historical path segment (no animation) */}
        {histPath && (
          <path
            d={histPath}
            stroke={color}
            strokeWidth="1.8"
            fill="none"
            opacity="0.85"
          />
        )}
        {/* New segment: animated draw from previous last point to latest */}
        {newSegmentPath && (
          <path
            key={`seg-${newSegmentKey}`}
            d={newSegmentPath}
            stroke={color}
            strokeWidth="2.2"
            fill="none"
            pathLength="100"
            className="nam-new-segment"
          />
        )}
        {/* Live dot */}
        <circle
          cx={px(data.length - 1).toFixed(1)}
          cy={py(currentPrice).toFixed(1)}
          r="4"
          fill={color}
          stroke="#07080c"
          strokeWidth="2"
          className="nam-live-dot"
        />
      </g>

      {/* Y-axis labels */}
      {ticks.map((v) => (
        <text
          key={`y-${v}`}
          x={PL - 8}
          y={py(v) + 4}
          textAnchor="end"
          fontSize="9"
          fill="#4c4e68"
          fontFamily="'DM Mono', monospace"
        >
          ${v.toFixed(5)}
        </text>
      ))}

      {/* X-axis baseline */}
      <line
        x1={PL}
        x2={W - PR}
        y1={H - PB}
        y2={H - PB}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="1"
      />

      {/* X-axis tick labels — rich format: icon + price + time */}
      {data.map((d, i) => {
        if (i % xTickMod !== 0) return null;
        const xPos = px(i);
        const priceStr = `$${d.price.toFixed(5)}`;
        const timeStr = d.ts.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const labelTop = H - PB + 6;

        return (
          <g key={`x-${d.ts.toISOString()}`}>
            {/* Tick mark */}
            <line
              x1={xPos.toFixed(1)}
              x2={xPos.toFixed(1)}
              y1={H - PB}
              y2={H - PB + 4}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1"
            />

            {/* Token icon (if available) */}
            {tokenIconUrl && (
              <g transform={`translate(${(xPos - ICON_SIZE / 2).toFixed(1)}, ${labelTop})`}>
                <circle
                  cx={ICON_SIZE / 2}
                  cy={ICON_SIZE / 2}
                  r={ICON_SIZE / 2}
                  fill="rgba(255,255,255,0.06)"
                />
                <image
                  href={tokenIconUrl}
                  x="0"
                  y="0"
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  clipPath="url(#iconCircle)"
                  preserveAspectRatio="xMidYMid slice"
                />
              </g>
            )}

            {/* Price — large, highlighted */}
            <text
              x={xPos.toFixed(1)}
              y={(labelTop + (tokenIconUrl ? ICON_SIZE + 12 : 10)).toFixed(1)}
              textAnchor="middle"
              fontSize="10"
              fontWeight="700"
              fill={color}
              fontFamily="'DM Mono', monospace"
            >
              {priceStr}
            </text>

            {/* Time with seconds — small, muted */}
            <text
              x={xPos.toFixed(1)}
              y={(labelTop + (tokenIconUrl ? ICON_SIZE + 25 : 23)).toFixed(1)}
              textAnchor="middle"
              fontSize="8"
              fill="#4c4e68"
              fontFamily="'DM Mono', monospace"
            >
              {timeStr}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
