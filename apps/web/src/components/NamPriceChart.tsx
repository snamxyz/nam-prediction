"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface NamPricePoint {
  ts: string;
  priceUsd: string;
}

type ParsedNamPricePoint = {
  ts: Date;
  price: number;
};

interface NamPriceChartProps {
  points: NamPricePoint[];
  threshold: number | null;
  tokenIconUrl?: string | null;
}

const LAST_NAM_TICKS = 5;
/** Wide desktop layout: with `meet`, narrow CSS width shrinks the whole viewBox → tiny plot. */
const W_DESKTOP = 800;
const H_DESKTOP = 200;
/** Mobile: viewBox width ≈ container so scale is ~1; extra height for readable ticks/labels. */
const H_COMPACT = 248;
const PT = 14;
const PB = 28;
const TT_ICON = 18;
const TT_PAD = 8;

function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

function clientPointToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  return pt.matrixTransform(ctm.inverse());
}

export function NamPriceChart({ points, threshold, tokenIconUrl }: NamPriceChartProps) {
  const data = useMemo(
    () =>
      points
        .map((p) => ({ ts: new Date(p.ts), price: Number(p.priceUsd) }))
        .filter((p) => Number.isFinite(p.ts.getTime()) && Number.isFinite(p.price))
        .sort((a, b) => a.ts.getTime() - b.ts.getTime())
        .slice(-LAST_NAM_TICKS),
    [points]
  );

  if (data.length < 2) {
    return (
      <div className="flex h-[200px] max-md:h-[248px] items-center justify-center">
        <p className="text-xs text-[var(--muted)]">Waiting for NAM price data…</p>
      </div>
    );
  }

  return <NamPriceSvgChart data={data} threshold={threshold} tokenIconUrl={tokenIconUrl} />;
}

function NamPriceSvgChart({
  data,
  threshold,
  tokenIconUrl,
}: {
  data: ParsedNamPricePoint[];
  threshold: number | null;
  tokenIconUrl?: string | null;
}) {
  const { ref: wrapRef, width: containerWidth } = useContainerWidth<HTMLDivElement>();
  const compact = containerWidth > 0 && containerWidth < 480;
  /** Match viewBox width to layout width so `meet` no longer crushes vertical size on phones. */
  const svgW =
    compact && containerWidth > 0
      ? Math.max(300, Math.min(Math.round(containerWidth), 520))
      : W_DESKTOP;
  const svgH = compact && containerWidth > 0 ? H_COMPACT : H_DESKTOP;
  const PTc = compact ? 16 : PT;
  const PBc = compact ? 34 : PB;
  const PL = compact ? 52 : 64;
  const PR = compact ? 14 : 20;
  const xLabelCount = compact ? 3 : 5;
  const yLabelFont = compact ? 10 : 9;
  const priceDecimals = compact ? 4 : 5;

  // Track hover by timestamp so the tooltip stays anchored to the same
  // data point even when new points arrive and all x-coordinates shift.
  const [hoveredTs, setHoveredTs] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const cw = svgW - PL - PR;
  const ch = svgH - PTc - PBc;

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
  const scaleY = (v: number) => PTc + ch - ((v - lo) / (hi - lo || 1)) * ch;
  const ty = scaleY(target);

  const currentPrice = vals[vals.length - 1];
  const above = currentPrice >= target;
  const color = above ? "#01d243" : "#f0324c";

  // ── Paths ────────────────────────────────────────────────────────────────
  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${scaleX(d.ts).toFixed(1)},${scaleY(d.price).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${scaleX(data[data.length - 1].ts).toFixed(1)},${svgH - PBc} L${PL},${svgH - PBc} Z`;

  // ── Y-axis ticks ─────────────────────────────────────────────────────────
  const range = hi - lo || 1;
  const rawStep = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const step = Math.ceil(rawStep / mag) * mag;
  const firstTick = Math.ceil(lo / step) * step;
  const yTicks: number[] = [];
  for (let v = firstTick; v <= hi; v += step) yTicks.push(Number(v.toFixed(8)));

  // ── X-axis labels ────────────────────────────────────────────────────────
  // Evenly-spaced TIME positions (not data indices) so labels slide smoothly
  // as the window widens. Count is reduced on narrow screens to avoid overlap.
  const xLabels = useMemo(() => {
    if (xLabelCount < 2) return [];
    return Array.from({ length: xLabelCount }, (_, i) => {
      const ms = minTs + (i / (xLabelCount - 1)) * tsRange;
      return { x: scaleXMs(ms), ts: new Date(ms) };
    });
  }, [minTs, maxTs, tsRange, xLabelCount, PL, cw]);

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

  const updateHoverFromClient = (clientX: number, clientY: number) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const p = clientPointToSvg(svgEl, clientX, clientY);
    if (!p) return;
    const svgX = p.x;
    if (svgX < PL || svgX > svgW - PR) {
      setHoveredTs(null);
      return;
    }
    const ms = minTs + ((svgX - PL) / cw) * tsRange;
    setHoveredTs(Math.max(minTs, Math.min(maxTs, ms)));
  };

  const handlePointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    updateHoverFromClient(e.clientX, e.clientY);
  };

  // ── Tooltip layout ────────────────────────────────────────────────────────
  const hasIcon = Boolean(tokenIconUrl);
  const TT_W = hasIcon ? 148 : 120;
  const TT_H = hasIcon ? 44 : 36;
  const ttX = hovX + TT_W + TT_PAD + PR > svgW ? hovX - TT_W - TT_PAD : hovX + TT_PAD;
  const ttY = Math.max(PTc + 2, hovY - TT_H - TT_PAD);

  const timeOpts: Intl.DateTimeFormatOptions = compact
    ? { hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", second: "2-digit" };

  return (
    <div ref={wrapRef} className="w-full">
    <svg
      ref={svgRef}
      viewBox={`0 0 ${svgW} ${svgH}`}
      preserveAspectRatio="xMidYMid meet"
      className="block w-full max-w-full"
      style={{ height: svgH }}
    >
      <defs>
        <linearGradient id="namFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <clipPath id="namClip">
          <rect x={PL} y={PTc} width={cw} height={ch} />
        </clipPath>
        <clipPath id="namTTIcon">
          <circle cx={TT_ICON / 2} cy={TT_ICON / 2} r={TT_ICON / 2} />
        </clipPath>
      </defs>

      {/* Horizontal grid lines */}
      {yTicks.map((v) => (
        <line
          key={v}
          x1={PL} x2={svgW - PR}
          y1={scaleY(v).toFixed(1)} y2={scaleY(v).toFixed(1)}
          stroke="rgba(255,255,255,0.04)" strokeWidth="1"
        />
      ))}

      {/* Target threshold */}
      <line
        x1={PL} x2={svgW - PR}
        y1={ty.toFixed(1)} y2={ty.toFixed(1)}
        stroke="#4c4e68" strokeWidth="1" strokeDasharray="5 4" opacity="0.7"
      />
      <rect
        x={svgW - PR - (compact ? 46 : 54)} y={ty - 10} width={compact ? 46 : 54} height={18} rx="4"
        fill="#111320" stroke="rgba(255,255,255,0.07)"
      />
      <text
        x={svgW - PR - (compact ? 23 : 27)} y={ty + 3}
        textAnchor="middle" fontSize={compact ? 8 : 9} fill="#4c4e68"
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
          x={PL - (compact ? 6 : 8)} y={scaleY(v) + 4}
          textAnchor="end" fontSize={yLabelFont} fill="#4c4e68"
          fontFamily="'DM Mono', monospace"
        >
          ${v.toFixed(priceDecimals)}
        </text>
      ))}

      {/* X-axis baseline */}
      <line
        x1={PL} x2={svgW - PR}
        y1={svgH - PBc} y2={svgH - PBc}
        stroke="rgba(255,255,255,0.06)" strokeWidth="1"
      />

      {/* X-axis labels: positions are time-based, never jump */}
      {xLabels.map((lbl, i) => (
        <g key={i}>
          <line
            x1={lbl.x.toFixed(1)} x2={lbl.x.toFixed(1)}
            y1={svgH - PBc} y2={svgH - PBc + 3}
            stroke="rgba(255,255,255,0.1)" strokeWidth="1"
          />
          <text
            x={lbl.x.toFixed(1)} y={svgH - 8}
            textAnchor="middle" fontSize={compact ? 9 : 7} fill="#4c4e68"
            fontFamily="'DM Mono', monospace"
          >
            {lbl.ts.toLocaleTimeString([], timeOpts)}
          </text>
        </g>
      ))}

      {/* Hover crosshair */}
      {hoveredPoint && (
        <line
          x1={hovX.toFixed(1)} x2={hovX.toFixed(1)}
          y1={PTc} y2={svgH - PBc}
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
            ${hoveredPoint.price.toFixed(priceDecimals)}
          </text>
          <text
            x={ttX + TT_PAD + (hasIcon ? TT_ICON + 6 : 0)}
            y={ttY + TT_PAD + 26}
            fontSize="9" fill="#4c4e68"
            fontFamily="'DM Mono', monospace"
          >
            {hoveredPoint.ts.toLocaleTimeString([], timeOpts)}
          </text>
        </g>
      )}

      {/* Invisible mouse-tracking overlay — must be last so it's on top */}
      <rect
        x={PL} y={PTc} width={cw} height={ch}
        fill="transparent"
        className="touch-none cursor-crosshair"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredTs(null)}
        onPointerCancel={() => setHoveredTs(null)}
      />
    </svg>
    </div>
  );
}
