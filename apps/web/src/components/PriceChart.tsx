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
}

interface ChartPoint {
  time: string;
  yesPrice: number;
}

export function PriceChart({ trades }: PriceChartProps) {
  const data: ChartPoint[] = trades
    .slice()
    .reverse()
    .map((t) => ({
      time: new Date(t.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      yesPrice: +((t.yesPrice ?? 0.5) * 100).toFixed(1),
    }));

  if (data.length === 0) {
    return (
      <div
        className="card"
        style={{
          padding: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 200,
        }}
      >
        <p style={{ fontSize: 12, color: "#4c4e68" }}>No trades yet</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          color: "#4c4e68",
          marginBottom: 16,
        }}
      >
        Yes Price History
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
            tickFormatter={(v) => `${v}¢`}
            stroke="transparent"
            width={34}
          />
          <Tooltip
            contentStyle={{
              background: "#0d0e14",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 8,
              fontSize: 11,
              color: "#e4e5eb",
              fontFamily: "'DM Mono', monospace",
            }}
            formatter={(v: number) => [`${v.toFixed(1)}¢`, "YES"]}
          />
          <Area
            type="monotone"
            dataKey="yesPrice"
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
