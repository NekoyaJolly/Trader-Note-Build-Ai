"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramData,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineData,
  LineSeries,
  LineStyle,
  LineWidth,
  Time,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";
import type {
  DrawnLine,
  IndicatorLineConfig,
  OHLCVDataPoint,
  PositionOverlay,
} from "@/components/CandlestickChart";
import { DrawingMode, DrawingOverlay } from "@/components/chart/DrawingOverlay";

interface ChartPaneContainerProps {
  ohlcvData: OHLCVDataPoint[];
  indicators?: IndicatorLineConfig[];
  height?: number;
  drawingMode?: DrawingMode;
  drawnLines?: DrawnLine[];
  positionOverlays?: PositionOverlay[];
  onCompleteLine?: (line: DrawnLine) => void;
  onUpdateLine?: (id: string, payload: Partial<DrawnLine>) => void;
  onDeleteLine?: (id: string) => void;
  onExitDrawing?: () => void;
}

interface PaneDefinition {
  key: string;
  title: string;
  indicators: IndicatorLineConfig[];
  fixedRange?: { min: number; max: number };
}

const CHART_THEME = {
  background: "#0a0a0a",
  textColor: "#a1a1aa",
  gridColor: "#27272a",
  borderColor: "#3f3f46",
  upColor: "#22c55e",
  downColor: "#ef4444",
  wickUpColor: "#22c55e",
  wickDownColor: "#ef4444",
  crosshairColor: "#71717a",
};

function toChartTime(timestamp: number): UTCTimestamp {
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

function toCandleData(ohlcvData: OHLCVDataPoint[]): CandlestickData<Time>[] {
  return ohlcvData.map((d) => ({
    time: toChartTime(d.timestamp),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
}

function toVolumeData(ohlcvData: OHLCVDataPoint[]): HistogramData<Time>[] {
  return ohlcvData
    .filter((d) => d.volume !== undefined)
    .map((d) => ({
      time: toChartTime(d.timestamp),
      value: d.volume as number,
      color: d.close >= d.open ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)",
    }));
}

function toLineData(
  data: { timestamp: number; value: number }[],
  shiftBars: number,
  barMs: number
): LineData<Time>[] {
  return data.map((d) => ({
    time: toChartTime(d.timestamp + shiftBars * barMs),
    value: d.value,
  }));
}

function resolvePaneKey(indicator: IndicatorLineConfig): string {
  if (indicator.pane === "main") return "main";
  if (indicator.paneGroup) return indicator.paneGroup;
  if (indicator.id.startsWith("macd")) return "macd";
  if (indicator.id.startsWith("stoch")) return "stochastic";
  if (indicator.id.startsWith("rsi")) return "rsi";
  if (indicator.id.startsWith("williams")) return "williams";
  if (indicator.id.startsWith("mfi")) return "mfi";
  return indicator.id.split("-")[0] || indicator.id;
}

function paneTitleFromKey(key: string): string {
  const map: Record<string, string> = {
    main: "メイン",
    macd: "MACD",
    rsi: "RSI",
    stochastic: "Stochastic",
    williams: "Williams %R",
    mfi: "MFI",
  };
  return map[key] || key.toUpperCase();
}

export function ChartPaneContainer({
  ohlcvData,
  indicators = [],
  height = 500,
  drawingMode = "none",
  drawnLines = [],
  positionOverlays = [],
  onCompleteLine,
  onUpdateLine,
  onDeleteLine,
  onExitDrawing,
}: ChartPaneContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainPaneRef = useRef<HTMLDivElement>(null);
  const subPaneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const mainChartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // DrawingOverlay には ref.current の値そのものを渡す必要があるため、
  // render 中に ref を読まずに済むよう state で同期する (react-hooks/refs 対策)。
  const [drawingChart, setDrawingChart] = useState<IChartApi | null>(null);
  const [drawingSeries, setDrawingSeries] = useState<ISeriesApi<"Candlestick"> | null>(null);
  const subChartsRef = useRef<Map<string, IChartApi>>(new Map());
  const allSeriesRef = useRef<Map<string, ISeriesApi<"Line"> | ISeriesApi<"Histogram">>>(new Map());
  const drawnSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const syncingRef = useRef(false);

  const paneDefs = useMemo<PaneDefinition[]>(() => {
    const grouped = new Map<string, IndicatorLineConfig[]>();
    for (const indicator of indicators) {
      const key = resolvePaneKey(indicator);
      const current = grouped.get(key) ?? [];
      current.push(indicator);
      grouped.set(key, current);
    }

    const mainIndicators = grouped.get("main") ?? [];
    grouped.delete("main");

    const subPanes: PaneDefinition[] = Array.from(grouped.entries()).map(([key, values]) => {
      const fixedRange = values.find((v) => v.scaleRange)?.scaleRange;
      return {
        key,
        title: paneTitleFromKey(key),
        indicators: values,
        fixedRange: fixedRange ?? undefined,
      };
    });

    return [
      {
        key: "main",
        title: "メイン",
        indicators: mainIndicators,
      },
      ...subPanes,
    ];
  }, [indicators]);

  const mainHeight = paneDefs.length > 1 ? Math.floor(height * 0.6) : height;
  const subHeight = paneDefs.length > 1 ? Math.max(120, Math.floor((height - mainHeight) / (paneDefs.length - 1))) : 0;
  const barMs = ohlcvData.length >= 2 ? Math.max(1000, ohlcvData[1].timestamp - ohlcvData[0].timestamp) : 60_000;

  // チャート初期化
  useEffect(() => {
    if (!mainPaneRef.current) return;

    mainChartRef.current?.remove();
    subChartsRef.current.forEach((chart) => chart.remove());
    subChartsRef.current.clear();
    allSeriesRef.current.clear();
    drawnSeriesRef.current.clear();

    const createBaseChart = (container: HTMLDivElement, paneHeight: number): IChartApi => {
      return createChart(container, {
        width: container.clientWidth,
        height: paneHeight,
        layout: {
          background: { type: ColorType.Solid, color: CHART_THEME.background },
          textColor: CHART_THEME.textColor,
        },
        grid: {
          vertLines: { color: CHART_THEME.gridColor },
          horzLines: { color: CHART_THEME.gridColor },
        },
        rightPriceScale: {
          borderColor: CHART_THEME.borderColor,
          entireTextOnly: true,
        },
        timeScale: {
          borderColor: CHART_THEME.borderColor,
          timeVisible: true,
          secondsVisible: true,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: CHART_THEME.crosshairColor,
            style: LineStyle.Dashed,
            width: 1,
          },
          horzLine: {
            color: CHART_THEME.crosshairColor,
            style: LineStyle.Dashed,
            width: 1,
          },
        },
      });
    };

    const mainChart = createBaseChart(mainPaneRef.current, mainHeight);
    mainChartRef.current = mainChart;
    setDrawingChart(mainChart);
    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: CHART_THEME.upColor,
      downColor: CHART_THEME.downColor,
      wickUpColor: CHART_THEME.wickUpColor,
      wickDownColor: CHART_THEME.wickDownColor,
      borderVisible: true,
      borderUpColor: CHART_THEME.upColor,
      borderDownColor: CHART_THEME.downColor,
    });
    mainSeriesRef.current = candleSeries;
    setDrawingSeries(candleSeries);

    const volumeSeries = mainChart.addSeries(HistogramSeries, {
      color: "#26a69a",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    allSeriesRef.current.set("main-volume", volumeSeries);

    for (const pane of paneDefs.filter((p) => p.key !== "main")) {
      const ref = subPaneRefs.current[pane.key];
      if (!ref) continue;
      const chart = createBaseChart(ref, subHeight);
      subChartsRef.current.set(pane.key, chart);
      if (pane.fixedRange) {
        chart.priceScale("right").applyOptions({
          autoScale: false,
        });
      }
    }

    const syncVisibleRangeFromMain = (range: { from: Time; to: Time } | null) => {
      if (!range || syncingRef.current) return;
      syncingRef.current = true;
      subChartsRef.current.forEach((chart) => {
        chart.timeScale().setVisibleRange(range);
      });
      syncingRef.current = false;
    };

    mainChart.timeScale().subscribeVisibleTimeRangeChange(syncVisibleRangeFromMain);

    const syncCrosshair = (source: IChartApi, param: { time?: Time; point?: { x: number; y: number } }) => {
      const currentTime = param.time;
      if (!currentTime || !param.point) {
        const clear = (chart: IChartApi) => (chart as IChartApi & { clearCrosshairPosition?: () => void }).clearCrosshairPosition?.();
        clear(mainChart);
        subChartsRef.current.forEach((chart) => clear(chart));
        return;
      }

      const sourceSeries =
        source === mainChart
          ? mainSeriesRef.current
          : ((null as unknown) as ISeriesApi<"Line"> | null);

      const setCrosshair = (chart: IChartApi) => {
        const helper = chart as IChartApi & {
          setCrosshairPosition?: (price: number, time: Time, series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">) => void;
        };
        if (!helper.setCrosshairPosition || !sourceSeries) return;
        const currentPoint = param.point;
        if (!currentPoint) return;
        const price = mainSeriesRef.current?.coordinateToPrice(currentPoint.y);
        if (price === null || price === undefined) return;
        helper.setCrosshairPosition(price, currentTime, sourceSeries);
      };

      if (source !== mainChart) setCrosshair(mainChart);
      subChartsRef.current.forEach((chart) => {
        if (chart !== source) setCrosshair(chart);
      });
    };

    mainChart.subscribeCrosshairMove((param) => syncCrosshair(mainChart, param));
    subChartsRef.current.forEach((chart) => {
      chart.subscribeCrosshairMove((param) => syncCrosshair(chart, param));
    });

    const handleResize = () => {
      if (!containerRef.current || !mainPaneRef.current || !mainChartRef.current) return;
      mainChartRef.current.applyOptions({ width: mainPaneRef.current.clientWidth, height: mainHeight });
      subChartsRef.current.forEach((chart, key) => {
        const pane = subPaneRefs.current[key];
        if (!pane) return;
        chart.applyOptions({ width: pane.clientWidth, height: subHeight });
      });
    };

    window.addEventListener("resize", handleResize);
    // クリーンアップ時に ref.current が別チャートに差し替わっている可能性があるため、
    // effect 内で参照を固定してから cleanup で使う (react-hooks/exhaustive-deps 警告対策)。
    const subCharts = subChartsRef.current;
    const allSeries = allSeriesRef.current;
    const drawnSeries = drawnSeriesRef.current;
    return () => {
      window.removeEventListener("resize", handleResize);
      mainChartRef.current?.remove();
      mainChartRef.current = null;
      setDrawingChart(null);
      setDrawingSeries(null);
      subCharts.forEach((chart) => chart.remove());
      subCharts.clear();
      allSeries.clear();
      drawnSeries.clear();
    };
  }, [mainHeight, paneDefs, subHeight]);

  // データ反映
  useEffect(() => {
    if (!mainSeriesRef.current || !mainChartRef.current) return;
    mainSeriesRef.current.setData(toCandleData(ohlcvData));
    const volumeSeries = allSeriesRef.current.get("main-volume");
    if (volumeSeries && "setData" in volumeSeries) {
      (volumeSeries as ISeriesApi<"Histogram">).setData(toVolumeData(ohlcvData));
    }
    mainChartRef.current.timeScale().fitContent();
  }, [ohlcvData]);

  // インジケーター反映
  useEffect(() => {
    if (!mainChartRef.current) return;

    allSeriesRef.current.forEach((series, key) => {
      if (key.startsWith("main-indicator-")) {
        mainChartRef.current?.removeSeries(series);
      }
      if (key.startsWith("sub-indicator-")) {
        const paneKey = key.split("-")[2];
        const chart = subChartsRef.current.get(paneKey);
        chart?.removeSeries(series);
      }
    });
    for (const key of Array.from(allSeriesRef.current.keys())) {
      if (key.includes("-indicator-")) {
        allSeriesRef.current.delete(key);
      }
    }

    const renderOnChart = (chart: IChartApi, prefix: string, indicator: IndicatorLineConfig) => {
      const shift = indicator.shiftBars ?? 0;
      if (indicator.seriesType === "histogram") {
        const series = chart.addSeries(HistogramSeries, {
          priceLineVisible: false,
          title: indicator.name,
        });
        series.setData(
          indicator.data.map((d) => ({
            time: toChartTime(d.timestamp + shift * barMs),
            value: d.value,
            color:
              d.value >= 0
                ? indicator.histogramPositiveColor ?? "rgba(34, 197, 94, 0.8)"
                : indicator.histogramNegativeColor ?? "rgba(239, 68, 68, 0.8)",
          }))
        );
        allSeriesRef.current.set(prefix, series);
        return;
      }

      const series = chart.addSeries(LineSeries, {
        color: indicator.color,
        lineWidth: (indicator.lineWidth ?? 2) as LineWidth,
        title: indicator.name,
        lineStyle: indicator.lineStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(toLineData(indicator.data, shift, barMs));
      if (indicator.scaleRange) {
        series.applyOptions({
          autoscaleInfoProvider: () => ({
            priceRange: {
              minValue: indicator.scaleRange!.min,
              maxValue: indicator.scaleRange!.max,
            },
          }),
        });
      }
      allSeriesRef.current.set(prefix, series);
    };

    for (const pane of paneDefs) {
      if (pane.key === "main") {
        for (const indicator of pane.indicators) {
          renderOnChart(mainChartRef.current, `main-indicator-${indicator.id}`, indicator);
        }
      } else {
        const chart = subChartsRef.current.get(pane.key);
        if (!chart) continue;
        for (const indicator of pane.indicators) {
          renderOnChart(chart, `sub-indicator-${pane.key}-${indicator.id}`, indicator);
        }
      }
    }
  }, [barMs, paneDefs]);

  // BB・一目の塗り
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const chart = mainChartRef.current;
    const series = mainSeriesRef.current;
    if (!canvas || !chart || !series || !mainPaneRef.current) return;

    const width = mainPaneRef.current.clientWidth;
    const heightPx = mainPaneRef.current.clientHeight;
    canvas.width = width;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, heightPx);

    const drawFill = (fromId: string, toId: string, color: string) => {
      const fromCfg = indicators.find((v) => v.id === fromId);
      const toCfg = indicators.find((v) => v.id === toId);
      if (!fromCfg || !toCfg) return;
      const toMap = new Map(toCfg.data.map((v) => [v.timestamp, v.value]));
      const pointsTop: { x: number; y: number }[] = [];
      const pointsBottom: { x: number; y: number }[] = [];
      for (const top of fromCfg.data) {
        const bottomValue = toMap.get(top.timestamp);
        if (bottomValue === undefined) continue;
        const x = chart.timeScale().timeToCoordinate(toChartTime(top.timestamp));
        const yTop = series.priceToCoordinate(top.value);
        const yBottom = series.priceToCoordinate(bottomValue);
        if (x == null || yTop == null || yBottom == null) continue;
        pointsTop.push({ x, y: yTop });
        pointsBottom.push({ x, y: yBottom });
      }
      if (pointsTop.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pointsTop[0].x, pointsTop[0].y);
      for (let i = 1; i < pointsTop.length; i += 1) {
        ctx.lineTo(pointsTop[i].x, pointsTop[i].y);
      }
      for (let i = pointsBottom.length - 1; i >= 0; i -= 1) {
        ctx.lineTo(pointsBottom[i].x, pointsBottom[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    drawFill("bb-upper", "bb-lower", "rgba(99, 102, 241, 0.1)");
    drawFill("ichimoku-senkou-a", "ichimoku-senkou-b", "rgba(139, 92, 246, 0.12)");
  }, [indicators, ohlcvData]);

  // 手動描画ライン・ポジションラインをメインペインに描画
  useEffect(() => {
    const chart = mainChartRef.current;
    if (!chart || ohlcvData.length === 0) return;

    drawnSeriesRef.current.forEach((series) => chart.removeSeries(series));
    drawnSeriesRef.current.clear();
    const start = ohlcvData[0].timestamp;
    const end = ohlcvData[ohlcvData.length - 1].timestamp;

    const addLine = (id: string, p1: { time: number; value: number }, p2: { time: number; value: number }, color: string, width = 2, dashed = false) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: width as LineWidth,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData([
        { time: toChartTime(p1.time), value: p1.value },
        { time: toChartTime(p2.time), value: p2.value },
      ]);
      drawnSeriesRef.current.set(id, series);
    };

    for (const line of drawnLines) {
      if (line.type === "horizontal") {
        addLine(line.id, { time: line.startTime, value: line.price }, { time: line.endTime, value: line.price }, line.color ?? "#fbbf24", line.lineWidth ?? 2);
      } else if (line.type === "trend") {
        addLine(line.id, { time: line.startTime, value: line.startPrice }, { time: line.endTime, value: line.endPrice }, line.color ?? "#fbbf24", line.lineWidth ?? 2);
      } else if (line.type === "rectangle") {
        const top = Math.max(line.startPrice, line.endPrice);
        const bottom = Math.min(line.startPrice, line.endPrice);
        const left = Math.min(line.startTime, line.endTime);
        const right = Math.max(line.startTime, line.endTime);
        addLine(`${line.id}-t`, { time: left, value: top }, { time: right, value: top }, line.color ?? "#60a5fa", line.lineWidth ?? 2);
        addLine(`${line.id}-b`, { time: left, value: bottom }, { time: right, value: bottom }, line.color ?? "#60a5fa", line.lineWidth ?? 2);
        addLine(`${line.id}-l`, { time: left, value: top }, { time: left, value: bottom }, line.color ?? "#60a5fa", line.lineWidth ?? 2);
        addLine(`${line.id}-r`, { time: right, value: top }, { time: right, value: bottom }, line.color ?? "#60a5fa", line.lineWidth ?? 2);
      } else if (line.type === "fibonacci") {
        const low = Math.min(line.startPrice, line.endPrice);
        const high = Math.max(line.startPrice, line.endPrice);
        const left = Math.min(line.startTime, line.endTime);
        const right = Math.max(line.startTime, line.endTime);
        const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 1];
        fibLevels.forEach((level) => {
          const price = high - (high - low) * level;
          addLine(`${line.id}-fib-${level}`, { time: left, value: price }, { time: right, value: price }, line.color ?? "#a78bfa", 1, true);
        });
      } else if (line.type === "text") {
        addLine(line.id, { time: line.time, value: line.price }, { time: line.time + barMs, value: line.price }, line.color ?? "#fbbf24", 2);
      }
    }

    for (const position of positionOverlays) {
      const baseColor = position.side === "BUY" ? "#22c55e" : "#ef4444";
      addLine(`pos-${position.positionId}-entry`, { time: start, value: position.entryPrice }, { time: end, value: position.entryPrice }, baseColor, 2);
      if (position.takeProfit !== undefined) {
        addLine(`pos-${position.positionId}-tp`, { time: start, value: position.takeProfit }, { time: end, value: position.takeProfit }, "rgba(34,197,94,0.85)", 1, true);
      }
      if (position.stopLoss !== undefined) {
        addLine(`pos-${position.positionId}-sl`, { time: start, value: position.stopLoss }, { time: end, value: position.stopLoss }, "rgba(239,68,68,0.85)", 1, true);
      }
    }
  }, [barMs, drawnLines, ohlcvData, positionOverlays]);

  return (
    <div ref={containerRef} className="w-full rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
      <div className="relative">
        <div ref={mainPaneRef} style={{ height: `${mainHeight}px` }} />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 8 }}
        />
        <DrawingOverlay
          chart={drawingChart}
          candleSeries={drawingSeries}
          drawingMode={drawingMode}
          drawnLines={drawnLines}
          onCreateLine={(line) => onCompleteLine?.(line)}
          onUpdateLine={(id, payload) => onUpdateLine?.(id, payload)}
          onDeleteLine={(id) => onDeleteLine?.(id)}
          onExitDrawing={onExitDrawing}
        />
      </div>
      {paneDefs
        .filter((pane) => pane.key !== "main")
        .map((pane) => (
          <div key={pane.key} className="border-t border-zinc-800">
            <div className="px-2 py-1 text-[10px] text-zinc-500 bg-zinc-900/60">{pane.title}</div>
            <div
              ref={(el) => {
                subPaneRefs.current[pane.key] = el;
              }}
              style={{ height: `${subHeight}px` }}
            />
          </div>
        ))}
    </div>
  );
}

export default ChartPaneContainer;
