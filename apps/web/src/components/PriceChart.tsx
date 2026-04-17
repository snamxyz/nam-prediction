"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { Trade } from "@nam-prediction/shared";

interface PriceChartProps {
  trades: Trade[];
}

interface ChartPoint {
  time: string;
  yesPrice: number;
  noPrice: number;
}

const Y_TICKS = [0, 25, 50, 75, 100];

export function PriceChart({ trades }: PriceChartProps) {
  // Use the AMM-implied probabilities snapshotted onto each trade row in the
  // API. Deriving the price from collateral / shares looks sensible but is not
  // the probability in this CPMM (the ratio can exceed 1 and can move in the
  // opposite direction on sells), which is what used to cause the chart and
  // the market header to disagree.
  const data: ChartPoint[] = trades
    .slice()
    .reverse()
    .map((t) => ({
      time: new Date(t.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      yesPrice: +((t.yesPrice ?? 0.5) * 100).toFixed(1),
      noPrice: +((t.noPrice ?? 0.5) * 100).toFixed(1),
    }));

  if (data.length === 0) {
    return (
      <div className="glass-card p-5 flex items-center justify-center h-64">
        <p className="text-sm" style={{ color: "#717182" }}>
          No trades yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-x-4 flex">
      <SideChart
        title="YES Price History"
        data={data}
        dataKey="yesPrice"
        color="#01d243"
        label="YES"
      />
      <SideChart
        title="NO Price History"
        data={data}
        dataKey="noPrice"
        color="#ff4757"
        label="NO"
      />
    </div>
  );
}

interface SideChartProps {
  title: string;
  data: ChartPoint[];
  dataKey: "yesPrice" | "noPrice";
  color: string;
  label: string;
}

function SideChart({ title, data, dataKey, color, label }: SideChartProps) {
  return (
    <div className="glass-card p-4">
      <h3 className="font-semibold mb-2 text-xs uppercase tracking-wide" style={{ color: "#e8e9ed" }}>
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: "#717182" }}
            stroke="rgba(255,255,255,0.05)"
            minTickGap={24}
          />
          <YAxis
            domain={[0, 100]}
            ticks={Y_TICKS}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#717182" }}
            tickFormatter={(v) => `${v}¢`}
            stroke="rgba(255,255,255,0.05)"
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(19,20,26,0.95)",
              border: "0.5px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              fontSize: 12,
              color: "#e8e9ed",
              backdropFilter: "blur(12px)",
            }}
            formatter={(v: number) => [`${v.toFixed(1)}¢`, label]}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
