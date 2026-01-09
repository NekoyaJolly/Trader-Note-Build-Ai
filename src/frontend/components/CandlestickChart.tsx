/**
 * CandlestickChart コンポーネント
 *
 * 機能:
 * - OHLCVデータをローソク足チャートで表示
 * - インジケーターの描画（メインチャート・サブチャート）
 * - エントリーポイントのマーカー表示
 * - リアルタイム更新対応
 *
 * 使用ライブラリ: lightweight-charts v5.x (TradingView)
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  HistogramData,
  ColorType,
  CrosshairMode,
  Time,
  UTCTimestamp,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineWidth,
  LineStyle,
  createSeriesMarkers,
  ISeriesMarkersPluginApi,
} from "lightweight-charts";

// ========================================
// 型定義
// ========================================

/** OHLCVデータポイント */
export interface OHLCVDataPoint {
  timestamp: number; // Unix timestamp (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** インジケーターライン設定 */
export interface IndicatorLineConfig {
  id: string;
  name: string;
  data: { timestamp: number; value: number }[];
  color: string;
  lineWidth?: number;
  // メインチャートに重ねるか、サブチャートに表示するか
  pane: "main" | "sub";
}

/** マーカー設定 */
export interface ChartMarker {
  timestamp: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text?: string;
}

/** 手動描画ライン */
export type DrawnLine =
  | {
      id: string;
      type: "horizontal";
      price: number;
      startTime: number;
      endTime: number;
      color?: string;
      lineWidth?: number;
    }
  | {
      id: string;
      type: "trend";
      startTime: number;
      endTime: number;
      startPrice: number;
      endPrice: number;
      color?: string;
      lineWidth?: number;
    };

/** チャートのプロパティ */
export interface CandlestickChartProps {
  /** OHLCVデータ */
  ohlcvData: OHLCVDataPoint[];
  /** インジケーターライン設定 */
  indicators?: IndicatorLineConfig[];
  /** マーカー（エントリーポイント等） */
  markers?: ChartMarker[];
  /** チャート高さ (px) */
  height?: number;
  /** チャートタイトル */
  title?: string;
  /** 追加の CSS クラス */
  className?: string;
  /** シンボル名 */
  symbol?: string;
  /** 時間足 */
  timeframe?: string;
  /** リアルタイム更新を有効化 */
  enableRealtime?: boolean;
  /** 新しいデータが来た時のコールバック */
  onNewData?: (data: OHLCVDataPoint) => void;
  /** ライン描画モード */
  drawingMode?: "none" | "horizontal" | "trend";
  /** 既存の手動ライン */
  drawnLines?: DrawnLine[];
  /** ライン描画完了時 */
  onCompleteLine?: (line: DrawnLine) => void;
  /** 描画モード終了通知 */
  onExitDrawing?: () => void;
}

// ========================================
// ユーティリティ関数
// ========================================

/**
 * Unix timestamp (ms) を lightweight-charts の Time 型に変換
 */
function toChartTime(timestamp: number): UTCTimestamp {
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

/**
 * OHLCVデータをローソク足データに変換
 * - 時間順にソート
 * - 重複タイムスタンプは最新のデータで上書き（Map使用）
 */
function toCandlestickData(ohlcv: OHLCVDataPoint[]): CandlestickData<Time>[] {
  // 重複を排除（同じ時間のデータは後のデータで上書き）
  const uniqueMap = new Map<number, CandlestickData<Time>>();
  
  for (const d of ohlcv) {
    const time = toChartTime(d.timestamp);
    uniqueMap.set(time as number, {
      time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    });
  }
  
  // 時間順にソートして返す
  return Array.from(uniqueMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
}

/**
 * インジケーターデータをラインデータに変換
 * - 時間順にソート、重複排除
 */
function toLineData(data: { timestamp: number; value: number }[]): LineData<Time>[] {
  const uniqueMap = new Map<number, LineData<Time>>();
  
  for (const d of data) {
    const time = toChartTime(d.timestamp);
    uniqueMap.set(time as number, { time, value: d.value });
  }
  
  return Array.from(uniqueMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
}

/**
 * ボリュームデータをヒストグラムデータに変換
 * - 時間順にソート、重複排除
 */
function toVolumeData(ohlcv: OHLCVDataPoint[]): HistogramData<Time>[] {
  const uniqueMap = new Map<number, HistogramData<Time>>();
  
  for (const d of ohlcv) {
    // volumeがundefinedまたは0の場合はスキップ（チャートに0が表示されるのを防ぐ）
    if (d.volume === undefined || d.volume === 0) continue;
    const time = toChartTime(d.timestamp);
    uniqueMap.set(time as number, {
      time,
      value: d.volume,
      color: d.close >= d.open ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)",
    });
  }
  
  return Array.from(uniqueMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
}

// ========================================
// Neon Dark テーマカラー
// ========================================

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

// 手動ラインのデフォルトスタイル
const DEFAULT_LINE_COLOR = "#fbbf24";
const DEFAULT_LINE_WIDTH: LineWidth = 2 as LineWidth;
const GUIDE_LINE_COLOR = "rgba(251, 191, 36, 0.6)";

// ========================================
// メインコンポーネント
// ========================================

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  ohlcvData,
  indicators = [],
  markers = [],
  height = 400,
  title,
  className = "",
  symbol = "",
  timeframe = "",
  enableRealtime = false,
  drawingMode = "none",
  drawnLines = [],
  onCompleteLine,
  onExitDrawing,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // v5 では ISeriesApi の型パラメータが変わった
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const drawnLineSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const guideLineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastFitCountRef = useRef<number>(0);
  const draftPointRef = useRef<{ time: number; price: number } | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  const [isLoading, setIsLoading] = useState(true);

  // チャートの初期化
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 既存のチャートをクリーンアップ
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    // 参照もリセット（削除済みの series に setData しないため）
    candlestickSeriesRef.current = null;
    volumeSeriesRef.current = null;
    indicatorSeriesRef.current.clear();
    drawnLineSeriesRef.current.clear();
    guideLineSeriesRef.current = null;
    markersPluginRef.current = null;
    lastFitCountRef.current = 0;

    // チャート作成
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: CHART_THEME.background },
        textColor: CHART_THEME.textColor,
      },
      grid: {
        vertLines: { color: CHART_THEME.gridColor },
        horzLines: { color: CHART_THEME.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CHART_THEME.crosshairColor,
          width: 1,
          style: 2,
          labelBackgroundColor: "#3f3f46",
        },
        horzLine: {
          color: CHART_THEME.crosshairColor,
          width: 1,
          style: 2,
          labelBackgroundColor: "#3f3f46",
        },
      },
      timeScale: {
        borderColor: CHART_THEME.borderColor,
        timeVisible: true,
        secondsVisible: true,
        timeZone: "utc", // UTC 基準で統一
      },
      rightPriceScale: {
        borderColor: CHART_THEME.borderColor,
      },
    });

    chartRef.current = chart;

    drawnLineSeriesRef.current.clear();
    // ローソク足シリーズ追加（v5 API: addSeries(CandlestickSeries, options)）
    const candlestickSer = chart.addSeries(CandlestickSeries, {
      upColor: CHART_THEME.upColor,
      downColor: CHART_THEME.downColor,
      wickUpColor: CHART_THEME.wickUpColor,
      wickDownColor: CHART_THEME.wickDownColor,
      borderVisible: false,
    });
    candlestickSeriesRef.current = candlestickSer;

    // マーカープラグインを作成（v5 API）
    const markersPlugin = createSeriesMarkers(candlestickSer, []);
    markersPluginRef.current = markersPlugin;

    // ボリュームシリーズは初期化では作らない
    // 理由: リアルタイム更新で ohlcvData が頻繁に変わるため、初期化をデータ依存にしない
    // 必要になったタイミングで data 更新側で遅延生成する

    // リサイズハンドラ
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    setIsLoading(false);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candlestickSeriesRef.current = null;
      volumeSeriesRef.current = null;
      indicatorSeriesRef.current.clear();
      if (guideLineSeriesRef.current) {
        chartRef.current?.removeSeries(guideLineSeriesRef.current);
      }
      markersPluginRef.current = null;
    };
  }, [height]);

  // データ更新
  useEffect(() => {
    if (!candlestickSeriesRef.current || ohlcvData.length === 0) return;

    // ローソク足データをセット
    const candleData = toCandlestickData(ohlcvData);
    candlestickSeriesRef.current.setData(candleData);

    // ボリュームデータをセット
    const volumeData = toVolumeData(ohlcvData);
    if (volumeData.length > 0) {
      // 初回のみ遅延生成
      if (!volumeSeriesRef.current && chartRef.current) {
        const volumeSer = chartRef.current.addSeries(HistogramSeries, {
          color: "#26a69a",
          priceFormat: {
            type: "volume",
          },
          priceScaleId: "volume",
          visible: true,
        });
        volumeSer.priceScale().applyOptions({
          scaleMargins: {
            top: 0.8,
            bottom: 0,
          },
        });
        volumeSeriesRef.current = volumeSer;
      }
      volumeSeriesRef.current?.applyOptions({ visible: true });
      volumeSeriesRef.current?.setData(volumeData);
    } else {
      // ボリュームが無い場合は非表示（チャート領域を余計に使わない）
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData([]);
        volumeSeriesRef.current.applyOptions({ visible: false });
      }
    }

    // 表示範囲を調整
    // リアルタイムでは毎tick fitContent すると重くなり更新が追従しないため、
    // データ本数が増えた時（新バー追加）にだけ実行する
    if (chartRef.current && candleData.length !== lastFitCountRef.current) {
      chartRef.current.timeScale().fitContent();
      lastFitCountRef.current = candleData.length;
    }
  }, [ohlcvData]);

  // 手動ラインの描画・更新
  useEffect(() => {
    if (!chartRef.current) return;

    // 既存ラインを一旦削除
    drawnLineSeriesRef.current.forEach((series) => {
      chartRef.current?.removeSeries(series);
    });
    drawnLineSeriesRef.current.clear();

    const fallbackColor = DEFAULT_LINE_COLOR; // デフォルトは黄系

    const ensureEndpoints = (line: DrawnLine): { points: LineData<Time>[] } => {
      if (line.type === "horizontal") {
        const start = toChartTime(line.startTime);
        const end = toChartTime(line.endTime);
        const sorted: LineData<Time>[] = [
          { time: start, value: line.price },
          { time: end, value: line.price },
        ].sort((a, b) => (a.time as number) - (b.time as number));
        if (sorted[0].time === sorted[1].time) {
          // time が同一だと lightweight-charts が例外を投げるため終点を +1 秒補正
          sorted[1] = { ...sorted[1], time: ((sorted[1].time as number) + 1) as Time };
        }
        return { points: sorted };
      }
      const start = toChartTime(line.startTime);
      const end = toChartTime(line.endTime);
      const sorted: LineData<Time>[] = [
        { time: start, value: line.startPrice },
        { time: end, value: line.endPrice },
      ].sort((a, b) => (a.time as number) - (b.time as number));
      if (sorted[0].time === sorted[1].time) {
        // 始点と終点が同一なら終点だけ +1 秒にずらす
        sorted[1] = { ...sorted[1], time: ((sorted[1].time as number) + 1) as Time };
      }
      return { points: sorted };
    };

    drawnLines.forEach((line) => {
      const { points } = ensureEndpoints(line);
      const series = chartRef.current!.addSeries(LineSeries, {
        color: line.color || fallbackColor,
        lineWidth: (line.lineWidth ?? DEFAULT_LINE_WIDTH) as LineWidth,
        title: line.type === "horizontal" ? "水平線" : "トレンドライン",
        priceLineVisible: false,
      });
      series.setData(points);
      drawnLineSeriesRef.current.set(line.id, series);
    });
  }, [drawnLines]);

  // 描画モード解除時に下書きをクリア
  useEffect(() => {
    if (drawingMode === "none") {
      draftPointRef.current = null;
      if (guideLineSeriesRef.current) {
        chartRef.current?.removeSeries(guideLineSeriesRef.current);
        guideLineSeriesRef.current = null;
      }
        isDraggingRef.current = false;
    }
  }, [drawingMode]);

  // 描画モード中はドラッグパンのみ抑止し、ホイールズーム/スクロールは維持
  useEffect(() => {
    if (!chartRef.current) return;
    const disableDrag = drawingMode !== "none";
    chartRef.current.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: !disableDrag,
        vertTouchDrag: !disableDrag,
        horzTouchDrag: !disableDrag,
      },
      handleScale: {
        mouseWheel: true,
        axisPressedMouseMove: !disableDrag,
        pinch: true,
      },
    });
  }, [drawingMode]);

  // プレビューラインをクリア
  const clearGuideLine = useCallback(() => {
    if (guideLineSeriesRef.current && chartRef.current) {
      chartRef.current.removeSeries(guideLineSeriesRef.current);
      guideLineSeriesRef.current = null;
    }
  }, []);

  // プレビューラインを更新
  const updateGuideLine = useCallback(
    (points: LineData<Time>[]) => {
      if (!chartRef.current) return;
      if (!guideLineSeriesRef.current) {
        guideLineSeriesRef.current = chartRef.current.addSeries(LineSeries, {
          color: GUIDE_LINE_COLOR,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1 as LineWidth,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          title: "draft-line",
        });
      }
        const sorted = [...points].sort((a, b) => (a.time as number) - (b.time as number));
        if (sorted.length === 2 && sorted[0].time === sorted[1].time) {
          sorted[1] = { ...sorted[1], time: ((sorted[1].time as number) + 1) as Time };
        }
        guideLineSeriesRef.current.setData(sorted);
    },
    []
  );

  const getRangeForHorizontal = useCallback(() => {
    const timestamps = ohlcvData.map((d) => d.timestamp).sort((a, b) => a - b);
    const startTime = timestamps[0] ?? Date.now();
    const endTime = timestamps[timestamps.length - 1] ?? startTime;
    return { startTime, endTime };
  }, [ohlcvData]);

  // 描画用オーバーレイのクリック処理
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (drawingMode === "none") return;
      if (!chartRef.current || !candlestickSeriesRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = chartRef.current.timeScale().coordinateToTime(x);
      const price = candlestickSeriesRef.current.coordinateToPrice(y);

      if (time === null || price === null) return;

      const point = { time: (time as number) * 1000, price };
      draftPointRef.current = point;
      isDraggingRef.current = true;

      if (drawingMode === "horizontal") {
        // 押下開始位置でプレビューを出す（離した位置で確定）
        const { startTime, endTime } = getRangeForHorizontal();
        updateGuideLine([
          { time: toChartTime(startTime), value: point.price },
          { time: toChartTime(endTime), value: point.price },
        ]);
        return;
      }

      // トレンドラインは押下点を始点として保持
      updateGuideLine([
        { time: toChartTime(point.time), value: point.price },
        { time: toChartTime(point.time), value: point.price },
      ]);
    },
    [drawingMode, getRangeForHorizontal, updateGuideLine]
  );

  const handleOverlayMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (drawingMode === "none") return;
      if (!chartRef.current || !candlestickSeriesRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = chartRef.current.timeScale().coordinateToTime(x);
      const price = candlestickSeriesRef.current.coordinateToPrice(y);

      if (time === null || price === null) {
        clearGuideLine();
        draftPointRef.current = null;
        isDraggingRef.current = false;
        return;
      }

      const point = { time: (time as number) * 1000, price };

      // 水平線: マウスアップ位置の価格で確定
      if (drawingMode === "horizontal") {
        const { startTime, endTime } = getRangeForHorizontal();
        const line: DrawnLine = {
          id: `line-${Date.now()}`,
          type: "horizontal",
          price: point.price,
          startTime,
          endTime,
          color: DEFAULT_LINE_COLOR,
          lineWidth: DEFAULT_LINE_WIDTH,
        };
        onCompleteLine?.(line);
        onExitDrawing?.();
        clearGuideLine();
        draftPointRef.current = null;
        isDraggingRef.current = false;
        return;
      }

      // トレンドライン: 始点が無ければスキップ
      if (!draftPointRef.current) {
        clearGuideLine();
        isDraggingRef.current = false;
        return;
      }

      const start = draftPointRef.current;
      const end = point;
      draftPointRef.current = null;

      const line: DrawnLine = {
        id: `line-${Date.now()}`,
        type: "trend",
        startTime: start.time,
        endTime: end.time,
        startPrice: start.price,
        endPrice: end.price,
        color: DEFAULT_LINE_COLOR,
        lineWidth: DEFAULT_LINE_WIDTH,
      };
      onCompleteLine?.(line);
      onExitDrawing?.();
      clearGuideLine();
      isDraggingRef.current = false;
    },
    [clearGuideLine, drawingMode, getRangeForHorizontal, onCompleteLine, onExitDrawing]
  );

  // 描画用オーバーレイのマウス移動処理（ガイドライン）
  const handleOverlayMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (drawingMode === "none") return;
      if (!chartRef.current || !candlestickSeriesRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = chartRef.current.timeScale().coordinateToTime(x);
      const price = candlestickSeriesRef.current.coordinateToPrice(y);

      if (time === null || price === null) {
        clearGuideLine();
        return;
      }

      const point = { time: (time as number) * 1000, price };

      if (drawingMode === "horizontal") {
        const { startTime, endTime } = getRangeForHorizontal();
        updateGuideLine([
          { time: toChartTime(startTime), value: point.price },
          { time: toChartTime(endTime), value: point.price },
        ]);
        return;
      }

      if (drawingMode === "trend" && draftPointRef.current) {
        updateGuideLine([
          { time: toChartTime(draftPointRef.current.time), value: draftPointRef.current.price },
          { time: toChartTime(point.time), value: point.price },
        ]);
        return;
      }

      clearGuideLine();
    },
    [candlestickSeriesRef, chartRef, clearGuideLine, drawingMode, getRangeForHorizontal, updateGuideLine]
  );

  const handleOverlayMouseLeave = useCallback(() => {
    clearGuideLine();
  }, [clearGuideLine]);

  const handleOverlayContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (drawingMode === "none") return;
    e.preventDefault();
    e.stopPropagation();
  }, [drawingMode]);

  // インジケーターの描画
  useEffect(() => {
    if (!chartRef.current) return;

    // 既存のインジケーターシリーズをクリア
    indicatorSeriesRef.current.forEach((series) => {
      chartRef.current?.removeSeries(series);
    });
    indicatorSeriesRef.current.clear();

    // 新しいインジケーターを追加
    indicators.forEach((indicator) => {
      if (indicator.data.length === 0) return;

      // メインチャートに重ねるインジケーター
      if (indicator.pane === "main") {
        const lineSer = chartRef.current!.addSeries(LineSeries, {
          color: indicator.color,
          lineWidth: (indicator.lineWidth || 2) as LineWidth,
          title: indicator.name,
        });
        lineSer.setData(toLineData(indicator.data));
        indicatorSeriesRef.current.set(indicator.id, lineSer);
      }
      // サブチャート用インジケーター（別のpriceScaleを使用）
      else {
        const lineSer = chartRef.current!.addSeries(LineSeries, {
          color: indicator.color,
          lineWidth: (indicator.lineWidth || 2) as LineWidth,
          title: indicator.name,
          priceScaleId: indicator.id,
        });
        lineSer.priceScale().applyOptions({
          scaleMargins: {
            top: 0.7,
            bottom: 0.1,
          },
        });
        lineSer.setData(toLineData(indicator.data));
        indicatorSeriesRef.current.set(indicator.id, lineSer);
      }
    });
  }, [indicators]);

  // マーカーの描画
  useEffect(() => {
    if (!markersPluginRef.current) return;

    if (markers.length === 0) {
      markersPluginRef.current.setMarkers([]);
      return;
    }

    const chartMarkers = markers.map((m) => ({
      time: toChartTime(m.timestamp) as Time,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text || "",
    }));

    markersPluginRef.current.setMarkers(chartMarkers);
  }, [markers]);

  return (
    <div className={`relative ${className}`}>
      {/* ヘッダー */}
      {(title || symbol || timeframe) && (
        <div className="flex items-center justify-between mb-2 px-2">
          <div className="flex items-center gap-2">
            {title && <h3 className="text-sm font-medium text-zinc-300">{title}</h3>}
            {symbol && (
              <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">{symbol}</span>
            )}
            {timeframe && (
              <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">
                {timeframe}
              </span>
            )}
          </div>
          {enableRealtime && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      )}

      {/* チャートコンテナ + 描画オーバーレイ */}
      <div className="relative">
        <div
          ref={chartContainerRef}
          className="w-full rounded-lg overflow-hidden border border-zinc-800"
          style={{ height: `${height}px` }}
        />
        <div
          className="absolute inset-0"
          onMouseDown={handleOverlayClick}
          onMouseUp={handleOverlayMouseUp}
          onMouseMove={handleOverlayMouseMove}
          onMouseLeave={handleOverlayMouseLeave}
          onContextMenu={handleOverlayContextMenu}
          style={{
            pointerEvents: drawingMode === "none" ? "none" : "auto",
            cursor: drawingMode === "none" ? "default" : "crosshair",
            zIndex: 10,
            touchAction: "none",
          }}
        />
      </div>

      {/* ローディング表示 */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80">
          <div className="text-zinc-400">チャートを読み込み中...</div>
        </div>
      )}

      {/* データなし表示 */}
      {!isLoading && ohlcvData.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-zinc-500">データがありません</div>
        </div>
      )}
    </div>
  );
};

export default CandlestickChart;
