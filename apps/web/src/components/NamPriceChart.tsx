"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AreaData,
  AutoscaleInfo,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

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
const H_DESKTOP = 200;
const H_COMPACT = 248;
const TT_ICON = 18;
const TT_PAD = 8;
const MIN_CHART_WIDTH = 300;
const CHART_BREAKPOINT = 480;

type AreaSeriesApi = ISeriesApi<"Area">;

type ChartPoint = AreaData<UTCTimestamp> & {
  source: ParsedNamPricePoint;
};

type TooltipState = {
  x: number;
  y: number;
  price: number;
  ts: Date;
};

type ChartTheme = {
  surface: string;
  muted: string;
  borderSubtle: string;
};

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

function toChartData(data: ParsedNamPricePoint[]): ChartPoint[] {
  let lastTime = 0;

  return data.map((point) => {
    const rawTime = Math.floor(point.ts.getTime() / 1000);
    const time = Math.max(rawTime, lastTime + 1);
    lastTime = time;

    return {
      time: time as UTCTimestamp,
      value: point.price,
      source: point,
    };
  });
}

function toTimeKey(time: unknown) {
  if (typeof time === "number") return time;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return null;
}

function getSeriesPrice(data: unknown) {
  if (data && typeof data === "object" && "value" in data) {
    const value = Number((data as { value: unknown }).value);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function areaColors(color: string) {
  return {
    lineColor: color,
    topColor: `${color}33`,
    bottomColor: `${color}00`,
  };
}

function formatPrice(price: number, decimals: number) {
  return `$${price.toFixed(decimals)}`;
}

function setTightTimeRange(chart: IChartApi, data: ChartPoint[]) {
  if (data.length < 2) {
    chart.timeScale().fitContent();
    return;
  }

  const timeScale = chart.timeScale();
  const paneWidth = chart.paneSize().width;

  timeScale.applyOptions({
    barSpacing: paneWidth / Math.max(data.length - 1, 1),
    rightOffset: 0,
  });
  // Lightweight Charts pads visible logical ranges by about half a bar on
  // each side. Offset the requested range inward so the real 5-point NAM
  // window fills the available pane instead of sitting in the middle.
  timeScale.setVisibleLogicalRange({
    from: 0.5,
    to: data.length - 1.5,
  });
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
      <div>
        <div className="flex h-[200px] items-center justify-center max-md:h-[248px]">
          <p className="text-xs text-[var(--muted)]">Waiting for NAM price data…</p>
        </div>
        <TradingViewAttribution />
      </div>
    );
  }

  return <NamPriceLightweightChart data={data} threshold={threshold} tokenIconUrl={tokenIconUrl} />;
}

function NamPriceLightweightChart({
  data,
  threshold,
  tokenIconUrl,
}: {
  data: ParsedNamPricePoint[];
  threshold: number | null;
  tokenIconUrl?: string | null;
}) {
  const { ref: wrapRef, width: containerWidth } = useContainerWidth<HTMLDivElement>();
  const chartElRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AreaSeriesApi | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const pointByTimeRef = useRef<Map<number, ParsedNamPricePoint>>(new Map());
  const chartDataRef = useRef<ChartPoint[]>([]);
  const thresholdRef = useRef<number | null>(null);
  const priceDecimalsRef = useRef(5);
  const colorRef = useRef("#01d243");
  const [chartVersion, setChartVersion] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const compact = containerWidth > 0 && containerWidth < CHART_BREAKPOINT;
  const chartHeight = compact ? H_COMPACT : H_DESKTOP;
  const priceDecimals = compact ? 4 : 5;
  const chartData = useMemo(() => toChartData(data), [data]);
  const seriesData = useMemo<AreaData<Time>[]>(
    () => chartData.map(({ time, value }) => ({ time, value })),
    [chartData]
  );
  const finiteThreshold = typeof threshold === "number" && Number.isFinite(threshold) ? threshold : null;
  const vals = data.map((d) => d.price);
  const currentPrice = vals[vals.length - 1];
  const target = finiteThreshold ?? currentPrice;
  const above = currentPrice >= target;
  const color = above ? "#01d243" : "#f0324c";
  const hasIcon = Boolean(tokenIconUrl);
  const timeOpts: Intl.DateTimeFormatOptions = compact
    ? { hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", second: "2-digit" };

  chartDataRef.current = chartData;
  pointByTimeRef.current = new Map(chartData.map((point) => [Number(point.time), point.source]));
  thresholdRef.current = finiteThreshold;
  priceDecimalsRef.current = priceDecimals;
  colorRef.current = color;

  const autoscaleInfoProvider = useMemo(
    () =>
      (): AutoscaleInfo | null => {
        const values = chartDataRef.current.map((point) => point.value);
        const targetValue = thresholdRef.current;
        if (targetValue !== null) values.push(targetValue);
        if (values.length === 0) return null;

        const min = Math.min(...values);
        const max = Math.max(...values);
        const padding = Math.max((max - min) * 0.0015, Math.abs(max || 1) * 0.0002);

        return {
          priceRange: {
            minValue: min - padding,
            maxValue: max + padding,
          },
          margins: {
            above: 8,
            below: 8,
          },
        };
      },
    []
  );

  useEffect(() => {
    const el = chartElRef.current;
    if (!el) return;

    let cancelled = false;
    let unsubscribeCrosshair: (() => void) | null = null;

    import("lightweight-charts").then(({ AreaSeries, ColorType, CrosshairMode, createChart }) => {
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
          scaleMargins: { top: 0.16, bottom: 0.18 },
        },
        timeScale: {
          borderColor: theme.borderSubtle,
          fixLeftEdge: true,
          fixRightEdge: true,
          rightOffset: 0,
          secondsVisible: !compact,
          timeVisible: true,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "rgba(255,255,255,0.14)", labelVisible: false },
          horzLine: { color: "rgba(255,255,255,0.14)", labelVisible: false },
        },
        localization: {
          priceFormatter: (price: number) => formatPrice(price, priceDecimalsRef.current),
        },
      });

      const series = chart.addSeries(AreaSeries, {
        ...areaColors(colorRef.current),
        autoscaleInfoProvider,
        lastValueVisible: true,
        lineWidth: 2,
        priceLineVisible: false,
      });

      const handleCrosshairMove = (param: MouseEventParams<Time>) => {
        if (!param.point || param.time === undefined || !seriesRef.current) {
          setTooltip(null);
          return;
        }

        const timeKey = toTimeKey(param.time);
        const source = timeKey === null ? null : pointByTimeRef.current.get(timeKey);
        const seriesPoint = param.seriesData.get(seriesRef.current);
        const price = getSeriesPrice(seriesPoint) ?? source?.price ?? null;

        if (price === null) {
          setTooltip(null);
          return;
        }

        setTooltip({
          x: param.point.x,
          y: param.point.y,
          price,
          ts: source?.ts ?? (timeKey === null ? new Date() : new Date(timeKey * 1000)),
        });
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);
      unsubscribeCrosshair = () => chart.unsubscribeCrosshairMove(handleCrosshairMove);

      chartRef.current = chart;
      seriesRef.current = series;
      setChartVersion((version) => version + 1);

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

      if (cancelled) {
        themeObserver.disconnect();
        unsubscribeCrosshair();
        chart.remove();
        return;
      }

      unsubscribeCrosshair = () => {
        themeObserver.disconnect();
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
      };
    });

    return () => {
      cancelled = true;
      unsubscribeCrosshair?.();
      priceLineRef.current = null;
      seriesRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
      setTooltip(null);
    };
  }, [autoscaleInfoProvider, chartHeight, compact]);

  useEffect(() => {
    if (!chartRef.current || containerWidth <= 0) return;
    chartRef.current.resize(Math.max(containerWidth, MIN_CHART_WIDTH), chartHeight);
    setTightTimeRange(chartRef.current, chartDataRef.current);
  }, [chartHeight, containerWidth]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    series.setData(seriesData);
    series.applyOptions({
      ...areaColors(color),
      autoscaleInfoProvider,
    });

    let cancelled = false;

    import("lightweight-charts").then(({ LineStyle }) => {
      if (cancelled || !seriesRef.current) return;

      if (priceLineRef.current) {
        seriesRef.current.removePriceLine(priceLineRef.current);
        priceLineRef.current = null;
      }

      if (finiteThreshold !== null) {
        priceLineRef.current = seriesRef.current.createPriceLine({
          price: finiteThreshold,
          color: readChartTheme().muted,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "Target",
        });
      }

      setTightTimeRange(chart, chartDataRef.current);
    });

    return () => {
      cancelled = true;
    };
  }, [autoscaleInfoProvider, chartVersion, color, finiteThreshold, seriesData]);

  const tooltipWidth = hasIcon ? 148 : 120;
  const tooltipHeight = hasIcon ? 44 : 36;
  const tooltipLeft = tooltip
    ? Math.max(TT_PAD, Math.min(tooltip.x + TT_PAD, Math.max(TT_PAD, containerWidth - tooltipWidth - TT_PAD)))
    : 0;
  const tooltipTop = tooltip ? Math.max(TT_PAD, tooltip.y - tooltipHeight - TT_PAD) : 0;

  return (
    <div ref={wrapRef} className="w-full">
      <div className="relative w-full" style={{ height: chartHeight }}>
        <div ref={chartElRef} className="h-full w-full" />

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 flex items-center gap-1.5 rounded-[5px] border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1.5 shadow-lg"
            style={{
              left: tooltipLeft,
              top: tooltipTop,
              width: tooltipWidth,
              minHeight: tooltipHeight,
            }}
          >
            {hasIcon && (
              <span
                className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5"
                style={{ width: TT_ICON, height: TT_ICON }}
              >
                <img src={tokenIconUrl!} alt="" className="h-full w-full object-cover" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block font-mono text-[11px] font-bold leading-tight" style={{ color }}>
                {formatPrice(tooltip.price, priceDecimals)}
              </span>
              <span className="block font-mono text-[9px] leading-tight text-[var(--muted)]">
                {tooltip.ts.toLocaleTimeString([], timeOpts)}
              </span>
            </span>
          </div>
        )}
      </div>
      <TradingViewAttribution />
    </div>
  );
}
