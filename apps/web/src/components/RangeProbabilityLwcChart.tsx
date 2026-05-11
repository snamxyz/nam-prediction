"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  IChartApi,
  ISeriesApi,
  LineData,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { RangeOutcome, RangeTrade } from "@nam-prediction/shared";

interface RangeProbabilityLwcChartProps {
  ranges: RangeOutcome[];
  trades: RangeTrade[];
  currentPrices: number[];
  colors: string[];
  marketCreatedAt?: string;
  className?: string;
}

type ChartPoint = {
  time: UTCTimestamp;
  timestamp: number;
  values: number[];
};

type TooltipState = {
  x: number;
  y: number;
  point: ChartPoint;
};

type ChartTheme = {
  surface: string;
  muted: string;
  borderSubtle: string;
};

const H_DESKTOP = 260;
const H_COMPACT = 238;
const MIN_CHART_WIDTH = 300;
const CHART_BREAKPOINT = 560;
const TT_PAD = 8;

type LineSeriesApi = ISeriesApi<"Line">;

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

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function readChartTheme(): ChartTheme {
  return {
    surface: cssVar("--surface", "#0d0e14"),
    muted: cssVar("--muted", "#4c4e68"),
    borderSubtle: cssVar("--border-subtle", "rgba(255,255,255,0.04)"),
  };
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

function toTimestamp(ms: number, lastTime: number) {
  const rawTime = Math.floor(ms / 1000);
  return Math.max(rawTime, lastTime + 1);
}

function getSeriesValue(data: unknown) {
  if (data && typeof data === "object" && "value" in data) {
    const value = Number((data as { value: unknown }).value);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/** Line series centers points in each bar slot; fitContent leaves half-bar margins. Tighten logical range so data reaches the plot edges (see library time-scale docs). */
function fitTimeScaleContentToEdges(chart: IChartApi) {
  chart.timeScale().fitContent();
  const vr = chart.timeScale().getVisibleLogicalRange();
  if (vr === null) return;
  const from = vr.from + 0.5;
  const to = vr.to - 0.5;
  if (to > from) {
    chart.timeScale().setVisibleLogicalRange({ from, to });
  }
}

function formatPointDate(timestamp: number, compact: boolean) {
  return new Date(timestamp).toLocaleString([], compact
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function TradingViewAttribution() {
  return (
    <p className="mt-1 text-right text-[9px] leading-none text-[var(--muted)]">
      Charts by{" "}
      <a
        href="https://www.tradingview.com"
        target="_blank"
        rel="noreferrer"
        className="underline-offset-2 hover:underline"
      >
        TradingView
      </a>
    </p>
  );
}

export function RangeProbabilityLwcChart({
  ranges,
  trades,
  currentPrices,
  colors,
  marketCreatedAt,
  className,
}: RangeProbabilityLwcChartProps) {
  const { ref: wrapRef, width: containerWidth } = useContainerWidth<HTMLDivElement>();
  const chartElRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<LineSeriesApi[]>([]);
  const pointByTimeRef = useRef<Map<number, ChartPoint>>(new Map());
  const chartDataRef = useRef<ChartPoint[]>([]);
  const [liveTimestamp, setLiveTimestamp] = useState(() => Date.now());
  const [chartVersion, setChartVersion] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const currentPriceSignature = currentPrices.map((price) => price.toFixed(8)).join("|");
  const compact = containerWidth > 0 && containerWidth < CHART_BREAKPOINT;
  const chartHeight = compact ? H_COMPACT : H_DESKTOP;

  useEffect(() => {
    setLiveTimestamp(Date.now());
  }, [currentPriceSignature]);

  const chartData = useMemo(() => {
    if (ranges.length === 0) return [];

    const rawPoints: Array<{ timestamp: number; prices: number[] }> = [];
    const createdAt = marketCreatedAt ? new Date(marketCreatedAt).getTime() : NaN;
    if (Number.isFinite(createdAt)) {
      rawPoints.push({
        timestamp: createdAt,
        prices: Array.from({ length: ranges.length }, () => 1 / ranges.length),
      });
    }

    trades
      .slice()
      .reverse()
      .forEach((trade) => {
        if (!Array.isArray(trade.pricesSnapshot) || trade.pricesSnapshot.length === 0) return;
        const timestamp = new Date(trade.timestamp).getTime();
        if (!Number.isFinite(timestamp)) return;
        rawPoints.push({ timestamp, prices: trade.pricesSnapshot });
      });

    rawPoints.push({ timestamp: liveTimestamp, prices: currentPrices });
    rawPoints.sort((a, b) => a.timestamp - b.timestamp);

    let lastTime = 0;
    return rawPoints.map((point) => {
      const time = toTimestamp(point.timestamp, lastTime);
      lastTime = time;

      return {
        time: time as UTCTimestamp,
        timestamp: point.timestamp,
        values: normalizeToPercent(point.prices, ranges.length),
      };
    });
  }, [currentPrices, liveTimestamp, marketCreatedAt, ranges.length, trades]);

  const seriesData = useMemo(
    () =>
      ranges.map((_, index) =>
        chartData.map<LineData<UTCTimestamp>>((point) => ({
          time: point.time,
          value: point.values[index] ?? 0,
        }))
      ),
    [chartData, ranges]
  );

  pointByTimeRef.current = new Map(chartData.map((point) => [Number(point.time), point]));
  chartDataRef.current = chartData;

  useEffect(() => {
    const el = chartElRef.current;
    if (!el || ranges.length === 0) return;

    let cancelled = false;
    let cleanupChart = () => {};

    import("lightweight-charts").then(({ ColorType, CrosshairMode, LineSeries, createChart }) => {
      if (cancelled || !chartElRef.current) return;

      const theme = readChartTheme();
      const chart = createChart(chartElRef.current, {
        width: Math.max(chartElRef.current.clientWidth, MIN_CHART_WIDTH),
        height: chartHeight,
        layout: {
          background: { type: ColorType.Solid, color: theme.surface },
          textColor: theme.muted,
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
        },
        grid: {
          vertLines: { color: "transparent" },
          horzLines: { color: theme.borderSubtle },
        },
        rightPriceScale: {
          borderColor: theme.borderSubtle,
          scaleMargins: { top: 0, bottom: 0 },
        },
        timeScale: {
          borderColor: theme.borderSubtle,
          rightOffset: 0,
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "rgba(255,255,255,0.14)", labelVisible: false },
          horzLine: { color: "rgba(255,255,255,0.14)", labelVisible: false },
        },
        localization: {
          priceFormatter: (price: number) => `${price.toFixed(1)}%`,
        },
      });

      const nextSeries = ranges.map((range, index) =>
        chart.addSeries(LineSeries, {
          color: colors[index % colors.length],
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          title: range.label,
        })
      );

      const handleCrosshairMove = (param: MouseEventParams<Time>) => {
        if (!param.point || param.time === undefined) {
          setTooltip(null);
          return;
        }

        const timeKey = typeof param.time === "number" ? param.time : null;
        const point = timeKey === null ? null : pointByTimeRef.current.get(timeKey);
        if (!point) {
          setTooltip(null);
          return;
        }

        const values = point.values.map((value, index) => {
          const seriesValue = getSeriesValue(param.seriesData.get(seriesRefs.current[index]));
          return seriesValue ?? value;
        });

        setTooltip({
          x: param.point.x,
          y: param.point.y,
          point: { ...point, values },
        });
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);

      const themeObserver = new MutationObserver(() => {
        const nextTheme = readChartTheme();
        chart.applyOptions({
          layout: {
            background: { type: ColorType.Solid, color: nextTheme.surface },
            textColor: nextTheme.muted,
          },
          grid: {
            horzLines: { color: nextTheme.borderSubtle },
          },
          rightPriceScale: {
            borderColor: nextTheme.borderSubtle,
          },
          timeScale: {
            borderColor: nextTheme.borderSubtle,
          },
        });
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

      chartRef.current = chart;
      seriesRefs.current = nextSeries;
      setChartVersion((version) => version + 1);

      cleanupChart = () => {
        themeObserver.disconnect();
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        chart.remove();
      };
    });

    return () => {
      cancelled = true;
      cleanupChart();
      chartRef.current = null;
      seriesRefs.current = [];
      setTooltip(null);
    };
  }, [chartHeight, colors, ranges]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || containerWidth <= 0) return;
    chart.resize(Math.max(containerWidth, MIN_CHART_WIDTH), chartHeight);
    fitTimeScaleContentToEdges(chart);
  }, [chartHeight, containerWidth]);

  useEffect(() => {
    if (!chartRef.current || seriesRefs.current.length === 0) return;
    seriesRefs.current.forEach((series, index) => {
      series.setData(seriesData[index] ?? []);
      series.applyOptions({
        color: colors[index % colors.length],
        title: ranges[index]?.label,
      });
    });
    fitTimeScaleContentToEdges(chartRef.current);
  }, [chartVersion, colors, ranges, seriesData]);

  if (ranges.length === 0) {
    return null;
  }

  const tooltipWidth = compact ? 190 : 230;
  const tooltipLeft = tooltip
    ? Math.max(TT_PAD, Math.min(tooltip.x + TT_PAD, Math.max(TT_PAD, containerWidth - tooltipWidth - TT_PAD)))
    : 0;
  const tooltipTop = tooltip ? Math.max(TT_PAD, tooltip.y - 36) : 0;

  return (
    <div ref={wrapRef} className={className}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Probability Volatility</h2>
        <span className="text-[11px] text-[var(--muted)]">All ranges overlaid</span>
      </div>

      <div className="relative w-full" style={{ height: chartHeight }}>
        <div ref={chartElRef} className="h-full w-full" />
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 shadow-lg"
            style={{
              left: tooltipLeft,
              top: tooltipTop,
              width: tooltipWidth,
            }}
          >
            <div className="mb-1 font-mono text-[10px] text-[var(--muted)]">
              {formatPointDate(tooltip.point.timestamp, compact)}
            </div>
            <div className="space-y-1">
              {ranges.map((range, index) => (
                <div key={range.index} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="flex min-w-0 items-center gap-1.5 text-[var(--foreground)]">
                    <svg className="h-2 w-2 shrink-0" viewBox="0 0 8 8" aria-hidden="true">
                      <circle cx="4" cy="4" r="4" fill={colors[index % colors.length]} />
                    </svg>
                    <span className="truncate">{range.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[var(--foreground)]">
                    {(tooltip.point.values[index] ?? 0).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
        {ranges.map((range, index) => (
          <span key={range.index} className="inline-flex items-center gap-1.5">
            <svg className="h-2 w-2" viewBox="0 0 8 8" aria-hidden="true">
              <circle cx="4" cy="4" r="4" fill={colors[index % colors.length]} />
            </svg>
            {range.label}
          </span>
        ))}
      </div>
      <TradingViewAttribution />
    </div>
  );
}
