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

export function PriceChart({ trades }: PriceChartProps) {
  const data = trades
    .slice()
    .reverse()
    .map((t, i) => {
      const shares = Number(t.shares);
      const col = Number(t.collateral);
      const price = shares > 0 ? col / shares : 0;
      return {
        index: i,
        time: new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        yesPrice: t.isYes ? price * 100 : undefined,
        noPrice: !t.isYes ? price * 100 : undefined,
      };
    });

  if (data.length === 0) {
    return (
      <div className="glass-card p-5 flex items-center justify-center h-64">
        <p className="text-sm" style={{ color: "#717182" }}>No trades yet</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <h3 className="font-semibold mb-4 text-sm" style={{ color: "#e8e9ed" }}>Price History</h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#717182" }} stroke="rgba(255,255,255,0.05)" />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "#717182" }}
            tickFormatter={(v) => `${v}¢`}
            stroke="rgba(255,255,255,0.05)"
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
          />
          <Line type="monotone" dataKey="yesPrice" stroke="#01d243" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="noPrice" stroke="#ff4757" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
