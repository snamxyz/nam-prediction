"use client";

import { useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { Trade } from "@nam-prediction/shared";

interface PriceChartProps {
  trades: Trade[];
  marketCreatedAt?: string;
  outcomeLabel?: string;
  currentYesProbabilityPct: number;
}

interface ChartPoint {
  time: string;
  yesProbability: number;
  isLive?: boolean;
}

function formatChartTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clampProbability(value: number) {
  return Math.min(100, Math.max(0, value));
}

function roundProbability(value: number) {
  return +clampProbability(value).toFixed(1);
}

function getYAxisDomain(points: ChartPoint[]): [number, number] {
  const values = points.map((point) => point.yesProbability);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const minSpan = 10;

  let yMin: number;
  let yMax: number;

  if (max - min < minSpan) {
    const midpoint = (min + max) / 2;
    yMin = midpoint - minSpan / 2;
    yMax = midpoint + minSpan / 2;
  } else {
    const padding = Math.max((max - min) * 0.1, 1);
    yMin = min - padding;
    yMax = max + padding;
  }

  yMin = Math.floor(clampProbability(yMin) / 5) * 5;
  yMax = Math.ceil(clampProbability(yMax) / 5) * 5;

  if (yMax - yMin < minSpan) {
    if (yMin === 0) {
      yMax = Math.min(100, yMin + minSpan);
    } else if (yMax === 100) {
      yMin = Math.max(0, yMax - minSpan);
    } else {
      const midpoint = (yMin + yMax) / 2;
      yMin = clampProbability(midpoint - minSpan / 2);
      yMax = clampProbability(midpoint + minSpan / 2);
    }
  }

  return [clampProbability(yMin), clampProbability(yMax)];
}

function getYAxisTicks([yMin, yMax]: [number, number]) {
  const step = Math.max(5, Math.ceil((yMax - yMin) / 4 / 5) * 5);
  const ticks = [];
  for (let value = yMin; value <= yMax; value += step) {
    ticks.push(roundProbability(value));
  }
  if (ticks[ticks.length - 1] !== yMax) ticks.push(roundProbability(yMax));
  return ticks;
}

/** Pulsing dot rendered on the last ("Now") chart point */
function LiveDot(props: any) {
  const { cx, cy, index, dataLength } = props;
  if (index !== dataLength - 1) return null;
  return (
    <g>
      {/* Outer pulse ring */}
      <circle cx={cx} cy={cy} r={7} fill="none" stroke="#01d243" strokeOpacity={0.25}>
        <animate attributeName="r" values="5;10;5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
      </circle>
      {/* Solid dot */}
      <circle cx={cx} cy={cy} r={3.5} fill="#01d243" stroke="#07080c" strokeWidth={2} />
    </g>
  );
}

export function PriceChart({
  trades,
  marketCreatedAt,
  outcomeLabel = "YES",
  currentYesProbabilityPct,
}: PriceChartProps) {
  const liveYesProbability = roundProbability(currentYesProbabilityPct);
  const tradePoints: ChartPoint[] = trades
    .slice()
    .reverse()
    .map((t) => ({
      time: formatChartTime(t.timestamp),
      yesProbability: roundProbability((t.yesPrice ?? 0.5) * 100),
    }));
  const openingProbability = tradePoints[0]?.yesProbability ?? liveYesProbability;
  const data: ChartPoint[] = marketCreatedAt
    ? [
        { time: formatChartTime(marketCreatedAt), yesProbability: openingProbability },
        ...tradePoints,
        { time: "Now", yesProbability: liveYesProbability, isLive: true },
      ]
    : [...tradePoints, { time: "Now", yesProbability: liveYesProbability, isLive: true }];
  const yDomain = getYAxisDomain(data);
  const yTicks = getYAxisTicks(yDomain);
  const dataLength = data.length;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">
          {outcomeLabel} Price History
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="live-dot" />
          <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">Live</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 10, right: 14, bottom: 5, left: 4 }}>
          <defs>
            <linearGradient id="yesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#01d243" stopOpacity={0.22} />
              <stop offset="85%" stopColor="#01d243" stopOpacity={0.03} />
              <stop offset="100%" stopColor="#01d243" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#4c4e68" }}
            stroke="transparent"
            minTickGap={40}
          />
          <YAxis
            domain={yDomain}
            ticks={yTicks}
            allowDecimals
            tick={{ fontSize: 10, fill: "#4c4e68" }}
            tickFormatter={(v) => `${v}%`}
            stroke="transparent"
            width={44}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.07)", strokeWidth: 1, strokeDasharray: "4 2" }}
            content={({ active, payload, label }) => {
              const value = payload?.[0]?.value;
              if (!active || typeof value !== "number") return null;
              return (
                <div className="mono rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] shadow-lg">
                  <div className="text-[var(--muted)]">{label}</div>
                  <div className="text-yes font-medium">
                    {outcomeLabel}: {value.toFixed(1)}%
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="yesProbability"
            stroke="#01d243"
            strokeWidth={1.5}
            fill="url(#yesFill)"
            isAnimationActive={true}
            animationDuration={600}
            animationEasing="ease-out"
            dot={(props: any) => (
              <LiveDot key={props.index} {...props} dataLength={dataLength} />
            )}
            activeDot={{
              r: 4,
              fill: "#01d243",
              stroke: "#07080c",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
