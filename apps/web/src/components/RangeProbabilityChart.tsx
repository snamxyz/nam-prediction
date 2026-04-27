"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RangeOutcome, RangeTrade } from "@nam-prediction/shared";

interface RangeProbabilityChartProps {
  ranges: RangeOutcome[];
  trades: RangeTrade[];
  currentPrices: number[];
  colors: string[];
  marketCreatedAt?: string;
}

type ChartPoint = {
  time: string;
  timestamp: number;
} & Record<string, number | string>;

function formatChartTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeToPercent(prices: number[], rangeCount: number) {
  const total = prices.reduce((sum, price) => sum + (Number.isFinite(price) ? price : 0), 0);
  if (total <= 0) {
    return Array.from({ length: rangeCount }, () => +(100 / Math.max(1, rangeCount)).toFixed(1));
  }

  return Array.from({ length: rangeCount }, (_, index) =>
    +(((prices[index] ?? 0) / total) * 100).toFixed(1)
  );
}

function buildPoint(timestamp: number, prices: number[], rangeCount: number): ChartPoint {
  const point: ChartPoint = {
    time: formatChartTime(timestamp),
    timestamp,
  };

  normalizeToPercent(prices, rangeCount).forEach((probability, index) => {
    point[`range${index}`] = probability;
  });

  return point;
}

export function RangeProbabilityChart({
  ranges,
  trades,
  currentPrices,
  colors,
  marketCreatedAt,
}: RangeProbabilityChartProps) {
  const currentPriceSignature = currentPrices.map((price) => price.toFixed(8)).join("|");
  const [liveTimestamp, setLiveTimestamp] = useState(() => Date.now());

  useEffect(() => {
    setLiveTimestamp(Date.now());
  }, [currentPriceSignature]);

  const data = useMemo(() => {
    if (ranges.length === 0) return [];

    const points: ChartPoint[] = [];
    const createdAt = marketCreatedAt ? new Date(marketCreatedAt).getTime() : NaN;
    if (Number.isFinite(createdAt)) {
      points.push(
        buildPoint(
          createdAt,
          Array.from({ length: ranges.length }, () => 1 / ranges.length),
          ranges.length
        )
      );
    }

    trades
      .slice()
      .reverse()
      .forEach((trade) => {
        if (!Array.isArray(trade.pricesSnapshot) || trade.pricesSnapshot.length === 0) return;
        const timestamp = new Date(trade.timestamp).getTime();
        if (!Number.isFinite(timestamp)) return;
        points.push(buildPoint(timestamp, trade.pricesSnapshot, ranges.length));
      });

    points.push(buildPoint(liveTimestamp, currentPrices, ranges.length));

    return points.sort((a, b) => a.timestamp - b.timestamp);
  }, [currentPrices, liveTimestamp, marketCreatedAt, ranges.length, trades]);

  if (ranges.length === 0) {
    return null;
  }

  return (
    <div className="card mb-4 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Probability Volatility
        </h2>
        <span className="text-[11px] text-[var(--muted)]">
          All ranges overlaid
        </span>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
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
            tickFormatter={(value) => `${value}%`}
            stroke="transparent"
            width={34}
          />
          <Tooltip
            content={({ active, label, payload }) => {
              if (!active || !payload?.length) return null;

              return (
                <div className="mono rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--foreground)]">
                  <div className="mb-1 text-[#8081a0]">{label}</div>
                  <div className="space-y-1">
                    {payload.map((item) => (
                      <div key={item.dataKey} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5">
                          <svg className="h-2 w-2" viewBox="0 0 8 8" aria-hidden="true">
                            <circle cx="4" cy="4" r="4" fill={item.color} />
                          </svg>
                          {item.name}
                        </span>
                        <span>{Number(item.value).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }}
          />
          <Legend
            iconType="circle"
            content={({ payload }) => (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 text-[11px] text-[#8081a0]">
                {payload?.map((item) => (
                  <span key={item.value} className="inline-flex items-center gap-1.5">
                    <svg className="h-2 w-2" viewBox="0 0 8 8" aria-hidden="true">
                      <circle cx="4" cy="4" r="4" fill={item.color} />
                    </svg>
                    {item.value}
                  </span>
                ))}
              </div>
            )}
          />
          {ranges.map((range, index) => {
            const color = colors[index % colors.length];
            return (
              <Line
                key={range.index}
                type="monotone"
                dataKey={`range${index}`}
                name={range.label}
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: color,
                  stroke: "#07080c",
                  strokeWidth: 2,
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
