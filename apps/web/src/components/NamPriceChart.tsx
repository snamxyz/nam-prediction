"use client";

import { useMemo, useRef, useState } from "react";

interface NamPricePoint {
  ts: string;
  priceUsd: string;
}

interface NamPriceChartProps {
  points: NamPricePoint[];
  threshold: number | null;
  tokenIconUrl?: string | null;
}

const W = 800;
const H = 200;
const PL = 64;
const PR = 20;
const PT = 14;
const PB = 26;
const X_LABELS = 10;
const TT_ICON = 18;
const TT_PAD = 8;

export function NamPriceChart({ points, threshold, tokenIconUrl }: NamPriceChartProps) {
  // Track hover by timestamp so the tooltip stays anchored to the same
  // data point even when new points arrive and all x-coordinates shift.
  const [hoveredTs, setHoveredTs] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(
    () =>
      points
        .map((p) => ({ ts: new Date(p.ts), price: Number(p.priceUsd) }))
        .filter((p) => Number.isFinite(p.price)),
    [points]
  );

  if (data.length < 2) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <p className="text-xs text-[var(--muted)]">Waiting for NAM price data…</p>
      </div>
    );
  }

  const cw = W - PL - PR;
  const ch = H - PT - PB;

  // ── Time-based x scale ──────────────────────────────────────────────────
  // Positioning by actual timestamp means a point's pixel x is determined
  // by WHEN it occurred, not its array index. When new points arrive the
  // denominator (tsRange) grows by only ~5 s, causing a tiny proportional
  // shift — far smaller than the index-based shift that was jumping 4-7 px
  // per update near the right edge.
  const minTs = data[0].ts.getTime();
  const maxTs = data[data.length - 1].ts.getTime();
  const tsRange = Math.max(maxTs - minTs, 1);

  const scaleX = (ts: Date) => PL + ((ts.getTime() - minTs) / tsRange) * cw;
  const scaleXMs = (ms: number) => PL + ((ms - minTs) / tsRange) * cw;

  // ── Price (y) scale ─────────────────────────────────────────────────────
  const vals = data.map((d) => d.price);
  const target = threshold ?? vals[vals.length - 1];
  const allVals = [...vals, target];
  const lo = Math.min(...allVals) * 0.9985;
  const hi = Math.max(...allVals) * 1.0015;
  const scaleY = (v: number) => PT + ch - ((v - lo) / (hi - lo || 1)) * ch;
  const ty = scaleY(target);

  const currentPrice = vals[vals.length - 1];
  const above = currentPrice >= target;
  const color = above ? "#01d243" : "#f0324c";

  // ── Paths ────────────────────────────────────────────────────────────────
  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${scaleX(d.ts).toFixed(1)},${scaleY(d.price).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${scaleX(data[data.length - 1].ts).toFixed(1)},${H - PB} L${PL},${H - PB} Z`;

  // ── Y-axis ticks ─────────────────────────────────────────────────────────
  const range = hi - lo || 1;
  const rawStep = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const step = Math.ceil(rawStep / mag) * mag;
  const firstTick = Math.ceil(lo / step) * step;
  const yTicks: number[] = [];
  for (let v = firstTick; v <= hi; v += step) yTicks.push(Number(v.toFixed(8)));

  // ── X-axis labels ────────────────────────────────────────────────────────
  // Derived from X_LABELS evenly-spaced TIME positions, not data indices.
  // This means the label set never jumps when data.length crosses a modulo
  // boundary — each label simply slides a tiny amount when the time window
  // widens by ~5 s.
  const xLabels = useMemo(
    () =>
      Array.from({ length: X_LABELS }, (_, i) => {
        const ms = minTs + (i / (X_LABELS - 1)) * tsRange;
        return { x: scaleXMs(ms), ts: new Date(ms) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minTs, maxTs]
  );

  // ── Hover ─────────────────────────────────────────────────────────────────
  // Find the nearest data point to the stored timestamp — if new data arrives
  // while hovering the same timestamp maps to the same (or nearest) point,
  // so the tooltip content stays stable and the crosshair barely moves.
  const hoveredPoint = useMemo(() => {
    if (hoveredTs === null) return null;
    let best = data[0];
    let bestDiff = Math.abs(best.ts.getTime() - hoveredTs);
    for (let i = 1; i < data.length; i++) {
      const diff = Math.abs(data[i].ts.getTime() - hoveredTs);
      if (diff < bestDiff) { bestDiff = diff; best = data[i]; }
    }
    return best;
  }, [hoveredTs, data]);

  const hovX = hoveredPoint ? scaleX(hoveredPoint.ts) : 0;
  const hovY = hoveredPoint ? scaleY(hoveredPoint.price) : 0;

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const ms = minTs + ((svgX - PL) / cw) * tsRange;
    setHoveredTs(Math.max(minTs, Math.min(maxTs, ms)));
  };

  // ── Tooltip layout ────────────────────────────────────────────────────────
  const hasIcon = Boolean(tokenIconUrl);
  const TT_W = hasIcon ? 148 : 120;
  const TT_H = hasIcon ? 44 : 36;
  const ttX = hovX + TT_W + TT_PAD + PR > W ? hovX - TT_W - TT_PAD : hovX + TT_PAD;
  const ttY = Math.max(PT + 2, hovY - TT_H - TT_PAD);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block h-[200px] w-full"
    >
      <defs>
        <linearGradient id="namFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <clipPath id="namClip">
          <rect x={PL} y={PT} width={cw} height={ch} />
        </clipPath>
        <clipPath id="namTTIcon">
          <circle cx={TT_ICON / 2} cy={TT_ICON / 2} r={TT_ICON / 2} />
        </clipPath>
      </defs>

      {/* Horizontal grid lines */}
      {yTicks.map((v) => (
        <line
          key={v}
          x1={PL} x2={W - PR}
          y1={scaleY(v).toFixed(1)} y2={scaleY(v).toFixed(1)}
          stroke="rgba(255,255,255,0.04)" strokeWidth="1"
        />
      ))}

      {/* Target threshold */}
      <line
        x1={PL} x2={W - PR}
        y1={ty.toFixed(1)} y2={ty.toFixed(1)}
        stroke="#4c4e68" strokeWidth="1" strokeDasharray="5 4" opacity="0.7"
      />
      <rect
        x={W - PR - 54} y={ty - 10} width={54} height={18} rx="4"
        fill="#111320" stroke="rgba(255,255,255,0.07)"
      />
      <text
        x={W - PR - 27} y={ty + 3}
        textAnchor="middle" fontSize="9" fill="#4c4e68"
        fontFamily="'DM Mono', monospace"
      >
        Target
      </text>

      {/* Area + line — React diffs d attribute in-place, no flash */}
      <g clipPath="url(#namClip)">
        <path d={areaPath} fill="url(#namFill)" />
        <path d={linePath} stroke={color} strokeWidth="2" fill="none" />

        {/* Hover dot (only when not on the live trailing dot) */}
        {hoveredPoint && hoveredPoint !== data[data.length - 1] && (
          <circle
            cx={hovX.toFixed(1)} cy={hovY.toFixed(1)}
            r="4" fill={color} stroke="#07080c" strokeWidth="2"
          />
        )}

        {/* Live trailing dot */}
        <circle
          cx={scaleX(data[data.length - 1].ts).toFixed(1)}
          cy={scaleY(currentPrice).toFixed(1)}
          r="4" fill={color} stroke="#07080c" strokeWidth="2"
          className="nam-live-dot"
        />
      </g>

      {/* Y-axis labels */}
      {yTicks.map((v) => (
        <text
          key={`y-${v}`}
          x={PL - 8} y={scaleY(v) + 4}
          textAnchor="end" fontSize="9" fill="#4c4e68"
          fontFamily="'DM Mono', monospace"
        >
          ${v.toFixed(5)}
        </text>
      ))}

      {/* X-axis baseline */}
      <line
        x1={PL} x2={W - PR}
        y1={H - PB} y2={H - PB}
        stroke="rgba(255,255,255,0.06)" strokeWidth="1"
      />

      {/* X-axis: 20 time-interval labels — positions are time-based, never jump */}
      {xLabels.map((lbl, i) => (
        <g key={i}>
          <line
            x1={lbl.x.toFixed(1)} x2={lbl.x.toFixed(1)}
            y1={H - PB} y2={H - PB + 3}
            stroke="rgba(255,255,255,0.1)" strokeWidth="1"
          />
          <text
            x={lbl.x.toFixed(1)} y={H - 7}
            textAnchor="middle" fontSize="7" fill="#4c4e68"
            fontFamily="'DM Mono', monospace"
          >
            {lbl.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </text>
        </g>
      ))}

      {/* Hover crosshair */}
      {hoveredPoint && (
        <line
          x1={hovX.toFixed(1)} x2={hovX.toFixed(1)}
          y1={PT} y2={H - PB}
          stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="3 3"
        />
      )}

      {/* Hover tooltip: icon + price (large, colored) + time (small, muted) */}
      {hoveredPoint && (
        <g>
          <rect
            x={ttX} y={ttY} width={TT_W} height={TT_H} rx="5"
            fill="#111320" stroke="rgba(255,255,255,0.10)"
          />
          {hasIcon && (
            <g transform={`translate(${ttX + TT_PAD}, ${ttY + TT_PAD})`}>
              <circle cx={TT_ICON / 2} cy={TT_ICON / 2} r={TT_ICON / 2} fill="rgba(255,255,255,0.06)" />
              <image
                href={tokenIconUrl!}
                x="0" y="0" width={TT_ICON} height={TT_ICON}
                clipPath="url(#namTTIcon)"
                preserveAspectRatio="xMidYMid slice"
              />
            </g>
          )}
          <text
            x={ttX + TT_PAD + (hasIcon ? TT_ICON + 6 : 0)}
            y={ttY + TT_PAD + 11}
            fontSize="11" fontWeight="700" fill={color}
            fontFamily="'DM Mono', monospace"
          >
            ${hoveredPoint.price.toFixed(5)}
          </text>
          <text
            x={ttX + TT_PAD + (hasIcon ? TT_ICON + 6 : 0)}
            y={ttY + TT_PAD + 26}
            fontSize="9" fill="#4c4e68"
            fontFamily="'DM Mono', monospace"
          >
            {hoveredPoint.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </text>
        </g>
      )}

      {/* Invisible mouse-tracking overlay — must be last so it's on top */}
      <rect
        x={PL} y={PT} width={cw} height={ch}
        fill="transparent"
        className="cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredTs(null)}
      />
    </svg>
  );
}
