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

export function PriceChart({ trades, marketCreatedAt, outcomeLabel = "YES" }: PriceChartProps) {
  const tradePoints: ChartPoint[] = trades
    .slice()
    .reverse()
    .map((t) => ({
      time: formatChartTime(t.timestamp),
      yesProbability: +((t.yesPrice ?? 0.5) * 100).toFixed(1),
    }));
  const data: ChartPoint[] = marketCreatedAt
    ? [{ time: formatChartTime(marketCreatedAt), yesProbability: 50 }, ...tradePoints]
    : tradePoints;

  if (data.length === 0) {
    return (
      <div className="card flex h-[200px] items-center justify-center p-5">
        <p className="text-xs text-[var(--muted)]">No trades yet</p>
      </div>
    );
  }

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
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            allowDecimals={false}
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
