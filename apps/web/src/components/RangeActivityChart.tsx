"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RangeActivity } from "@/hooks/useRangeMarkets";

interface RangeActivityChartProps {
  activity?: RangeActivity;
  isLoading?: boolean;
  label: string;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizePoints(activity?: RangeActivity) {
  const points = activity?.points ?? [];
  if (points.length === 0) return [];

  const first = points[0];
  const startsAtZero = first.value === 0;
  return (startsAtZero ? points : [{ timestamp: first.timestamp, value: 0 }, ...points]).map((point) => ({
    ...point,
    time: formatTime(point.timestamp),
  }));
}

export function RangeActivityChart({ activity, isLoading, label }: RangeActivityChartProps) {
  const data = normalizePoints(activity);
  const target = activity?.target ?? null;
  const maxValue = Math.max(target ?? 0, ...data.map((point) => point.value), 1);

  return (
    <div className="">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">
            Actual {label} Progress
          </h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Cumulative count for the current market day.
          </p>
        </div>
        {target != null && (
          <span className="rounded bg-yes/10 px-2 py-1 font-mono text-[11px] text-yes">
            Target {target.toLocaleString()}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-[180px] animate-pulse rounded-lg bg-[var(--surface)]" />
      ) : !activity?.configured ? (
        <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--muted)]">
          Configure range activity API env vars to show actual {label.toLowerCase()} counts.
        </div>
      ) : data.length === 0 ? (
        <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--muted)]">
          No actual {label.toLowerCase()} count data yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#01d243" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#01d243" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#4c4e68" }} stroke="transparent" minTickGap={28} />
            <YAxis
              domain={[0, Math.ceil(maxValue)]}
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "#4c4e68" }}
              stroke="transparent"
              width={42}
            />
            {target != null && (
              <ReferenceLine y={target} stroke="#4c4e68" strokeDasharray="4 4" label={{ value: "Target", fill: "#4c4e68", fontSize: 10 }} />
            )}
            <Tooltip
              content={({ active, payload }) => {
                const value = payload?.[0]?.value;
                if (!active || typeof value !== "number") return null;
                return (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--foreground)]">
                    <span className="font-mono">{value.toLocaleString()}</span> {label.toLowerCase()}
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="value" stroke="#01d243" strokeWidth={2} fill="url(#activityFill)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
