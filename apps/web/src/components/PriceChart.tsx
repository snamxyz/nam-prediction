"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
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
  const minSpan = 4;

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

  yMin = clampProbability(yMin);
  yMax = clampProbability(yMax);

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

  return [roundProbability(yMin), roundProbability(yMax)];
}

function getYAxisTicks([yMin, yMax]: [number, number]) {
  return Array.from({ length: 5 }, (_, index) => roundProbability(yMin + ((yMax - yMin) * index) / 4));
}

export function PriceChart({ trades, marketCreatedAt, outcomeLabel = "YES", currentYesProbabilityPct }: PriceChartProps) {
  const liveYesProbability = roundProbability(currentYesProbabilityPct);
  const tradePoints: ChartPoint[] = trades
    .slice()
    .reverse()
    .map((t) => ({
      time: formatChartTime(t.timestamp),
      yesProbability: roundProbability((t.yesPrice ?? 0.5) * 100),
    }));
  // Use the first recorded trade as the opening anchor; otherwise mirror the live header value.
  const openingProbability = tradePoints[0]?.yesProbability ?? liveYesProbability;
  const data: ChartPoint[] = marketCreatedAt
    ? [{ time: formatChartTime(marketCreatedAt), yesProbability: openingProbability }, ...tradePoints, { time: "Now", yesProbability: liveYesProbability }]
    : [...tradePoints, { time: "Now", yesProbability: liveYesProbability }];
  const yDomain = getYAxisDomain(data);
  const yTicks = getYAxisTicks(yDomain);

  return (
    <div className="card p-5">
      <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">
        Probabilities
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 8, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id="yesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#01d243" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#01d243" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#4c4e68" }}
            stroke="transparent"
            minTickGap={32}
          />
          <YAxis
            domain={yDomain}
            ticks={yTicks}
            allowDecimals
            tick={{ fontSize: 10, fill: "#4c4e68" }}
            tickFormatter={(v) => `${v}%`}
            stroke="transparent"
            width={34}
          />
          <Tooltip
            content={({ active, payload }) => {
              const value = payload?.[0]?.value;
              if (!active || typeof value !== "number") return null;

              return (
                <div className="mono rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--foreground)]">
                  {outcomeLabel}: {value.toFixed(1)}%
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
            dot={false}
            activeDot={{
              r: 3,
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
