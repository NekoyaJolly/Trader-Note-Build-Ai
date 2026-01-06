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

import React, { useEffect, useRef, useState } from "react";
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
 */
function toCandlestickData(ohlcv: OHLCVDataPoint[]): CandlestickData<Time>[] {
  return ohlcv.map((d) => ({
    time: toChartTime(d.timestamp),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
}

/**
 * インジケーターデータをラインデータに変換
 */
function toLineData(data: { timestamp: number; value: number }[]): LineData<Time>[] {
  return data.map((d) => ({
    time: toChartTime(d.timestamp),
    value: d.value,
  }));
}

/**
 * ボリュームデータをヒストグラムデータに変換
 */
function toVolumeData(ohlcv: OHLCVDataPoint[]): HistogramData<Time>[] {
  return ohlcv
    .filter((d) => d.volume !== undefined)
    .map((d) => ({
      time: toChartTime(d.timestamp),
      value: d.volume!,
      color: d.close >= d.open ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)",
    }));
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
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // v5 では ISeriesApi の型パラメータが変わった
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const [isLoading, setIsLoading] = useState(true);

  // チャートの初期化
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 既存のチャートをクリーンアップ
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

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
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: CHART_THEME.borderColor,
      },
    });

    chartRef.current = chart;

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

    // ボリュームシリーズ追加（オプション）
    const hasVolume = ohlcvData.some((d) => d.volume !== undefined);
    if (hasVolume) {
      const volumeSer = chart.addSeries(HistogramSeries, {
        color: "#26a69a",
        priceFormat: {
          type: "volume",
        },
        priceScaleId: "volume",
      });
      volumeSer.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });
      volumeSeriesRef.current = volumeSer;
    }

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
    };
  }, [height, ohlcvData]);

  // データ更新
  useEffect(() => {
    if (!candlestickSeriesRef.current || ohlcvData.length === 0) return;

    // ローソク足データをセット
    const candleData = toCandlestickData(ohlcvData);
    candlestickSeriesRef.current.setData(candleData);

    // ボリュームデータをセット
    if (volumeSeriesRef.current) {
      const volumeData = toVolumeData(ohlcvData);
      volumeSeriesRef.current.setData(volumeData);
    }

    // 表示範囲を調整
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [ohlcvData]);

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

      {/* チャートコンテナ */}
      <div
        ref={chartContainerRef}
        className="w-full rounded-lg overflow-hidden border border-zinc-800"
        style={{ height: `${height}px` }}
      />

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
