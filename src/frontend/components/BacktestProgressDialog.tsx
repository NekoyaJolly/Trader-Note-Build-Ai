/**
 * バックテスト進捗ダイアログコンポーネント
 * 
 * 目的:
 * - バックテスト実行中の進捗をリアルタイム表示
 * - ローソク足チャートとインジケーターを可視化
 * - エントリー/エグジットポイントをマーカー表示
 * 
 * 使用ライブラリ:
 * - lightweight-charts: ローソク足チャート
 * - recharts: インジケーターチャート（サブウィンドウ）
 */
"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { createChart, IChartApi, ISeriesApi, Time, ColorType, CandlestickSeries, HistogramSeries, LineSeries, OhlcData, SingleValueData } from "lightweight-charts";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from "recharts";

// 進捗状態の型定義
interface OHLCVData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface IndicatorValue {
  name: string;
  value: number;
  timestamp: string;
}

interface TradeMarker {
  timestamp: string;
  price: number;
  type: "entry" | "exit";
  side: "buy" | "sell";
  exitReason?: "take_profit" | "stop_loss" | "timeout" | "signal";
}

interface ProgressState {
  jobId: string;
  status: "initializing" | "processing" | "completed" | "error";
  processedCandles: number;
  totalCandles: number;
  progressPercent: number;
  currentTimestamp?: string;
  ohlcvData: OHLCVData[];
  indicators: Record<string, IndicatorValue[]>;
  tradeMarkers: TradeMarker[];
  errorMessage?: string;
  startedAt: string;
  estimatedTimeRemaining?: number;
}

// コンポーネントのProps
interface BacktestProgressDialogProps {
  /** 表示/非表示 */
  isOpen: boolean;
  /** 閉じるコールバック */
  onClose: () => void;
  /** ジョブID */
  jobId: string;
  /** バックテスト完了コールバック */
  onComplete?: () => void;
}

// インジケーターの色定義
const INDICATOR_COLORS: Record<string, string> = {
  RSI: "#8B5CF6",      // Violet
  MACD: "#EC4899",     // Pink
  "MACD Signal": "#8B5CF6",
  SMA: "#22C55E",      // Green
  EMA: "#3B82F6",      // Blue
  "BB Upper": "#F59E0B", // Amber
  "BB Middle": "#8B5CF6",
  "BB Lower": "#F59E0B",
  ATR: "#EF4444",      // Red
  Stochastic: "#06B6D4", // Cyan
  OBV: "#84CC16",      // Lime
  VWAP: "#A855F7",     // Purple
};

/**
 * バックテスト進捗ダイアログ
 */
export function BacktestProgressDialog({
  isOpen,
  onClose,
  jobId,
  onComplete,
}: BacktestProgressDialogProps) {
  // 進捗状態
  const [progress, setProgress] = useState<ProgressState | null>(null);
  // 選択中のインジケーター（サブウィンドウ用）
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>(["RSI"]);
  
  // チャート参照
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  
  // SSE接続
  useEffect(() => {
    if (!isOpen || !jobId) return;
    
    const eventSource = new EventSource(`/api/backtest/progress/${jobId}`);
    
    eventSource.addEventListener("progress", (event) => {
      const data = JSON.parse(event.data) as ProgressState;
      setProgress(data);
      
      // 完了時のコールバック
      if (data.status === "completed" && onComplete) {
        onComplete();
      }
    });
    
    eventSource.addEventListener("error", () => {
      console.error("SSE接続エラー");
      eventSource.close();
    });
    
    return () => {
      eventSource.close();
    };
  }, [isOpen, jobId, onComplete]);
  
  // チャート初期化
  useEffect(() => {
    if (!isOpen || !chartContainerRef.current) return;
    
    // チャート作成
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#1E293B" },
        textColor: "#9CA3AF",
      },
      grid: {
        vertLines: { color: "#334155" },
        horzLines: { color: "#334155" },
      },
      width: chartContainerRef.current.clientWidth,
      height: 300,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
      },
    });
    
    // ローソク足シリーズ追加（v5 API）
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22C55E",
      downColor: "#EF4444",
      borderUpColor: "#22C55E",
      borderDownColor: "#EF4444",
      wickUpColor: "#22C55E",
      wickDownColor: "#EF4444",
    });
    
    // 出来高シリーズ追加（v5 API）
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#3B82F6",
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    
    // リサイズ対応
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);
    
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [isOpen]);
  
  // チャートデータ更新
  useEffect(() => {
    if (!progress || !candleSeriesRef.current) return;
    
    // OHLCVデータを変換（v5 API: OhlcData型を使用）
    const candleData: OhlcData[] = progress.ohlcvData.map((d) => ({
      time: (new Date(d.timestamp).getTime() / 1000) as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    
    // ローソク足更新
    candleSeriesRef.current.setData(candleData);
    
    // 出来高更新
    if (volumeSeriesRef.current) {
      const volumeData = progress.ohlcvData
        .filter((d) => d.volume !== undefined)
        .map((d) => ({
          time: (new Date(d.timestamp).getTime() / 1000) as Time,
          value: d.volume!,
          color: d.close >= d.open ? "#22C55E80" : "#EF444480",
        }));
      volumeSeriesRef.current.setData(volumeData);
    }
    
    // トレードマーカー追加
    // Note: lightweight-charts v5ではsetMarkersが削除されたため、
    // トレードマーカーはサブウィンドウのrechartsで別途表示する
    // 将来的にはprimitives APIを使用してカスタムマーカーを実装予定
    console.log(`[BacktestProgressDialog] トレードマーカー: ${progress.tradeMarkers.length}件`);
    
    // 最新データにスクロール
    if (candleData.length > 0) {
      chartRef.current?.timeScale().scrollToPosition(0, false);
    }
  }, [progress?.ohlcvData, progress?.tradeMarkers]);
  
  // 推定残り時間のフォーマット
  const formatTimeRemaining = (seconds?: number): string => {
    if (seconds === undefined || seconds <= 0) return "-";
    if (seconds < 60) return `${seconds}秒`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };
  
  // インジケーターデータをrecharts用に変換
  const getIndicatorChartData = useCallback((indicatorName: string) => {
    if (!progress?.indicators[indicatorName]) return [];
    return progress.indicators[indicatorName].map((v) => ({
      timestamp: new Date(v.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
      value: v.value,
    }));
  }, [progress?.indicators]);
  
  // 利用可能なインジケーター一覧を取得
  const availableIndicators = progress ? Object.keys(progress.indicators) : [];
  
  if (!isOpen) return null;
  
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              progress?.status === "processing" ? "bg-blue-500 animate-pulse" :
              progress?.status === "completed" ? "bg-green-500" :
              progress?.status === "error" ? "bg-red-500" :
              "bg-yellow-500"
            }`} />
            <h2 className="text-lg font-bold text-white">
              バックテスト実行中
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-slate-700 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* 進捗バー */}
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">
              進捗: {progress?.processedCandles || 0} / {progress?.totalCandles || 0} 本
            </span>
            <span className="text-sm text-gray-400">
              残り: {formatTimeRemaining(progress?.estimatedTimeRemaining)}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
              style={{ width: `${progress?.progressPercent || 0}%` }}
            />
          </div>
          <div className="mt-2 text-right">
            <span className="text-xl font-bold neon-text">
              {progress?.progressPercent || 0}%
            </span>
          </div>
        </div>
        
        {/* メインコンテンツ */}
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {/* ローソク足チャート */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">
              📊 チャートプレビュー（直近{progress?.ohlcvData.length || 0}本）
            </h3>
            <div
              ref={chartContainerRef}
              className="w-full rounded-lg overflow-hidden border border-slate-700"
            />
          </div>
          
          {/* インジケーター選択 */}
          {availableIndicators.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-2">
                📈 インジケーター表示
              </h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {availableIndicators.map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      setSelectedIndicators((prev) =>
                        prev.includes(name)
                          ? prev.filter((n) => n !== name)
                          : [...prev, name]
                      );
                    }}
                    className={`px-3 py-1 text-xs rounded-full transition-all ${
                      selectedIndicators.includes(name)
                        ? "bg-cyan-500/30 text-cyan-300 border border-cyan-500/50"
                        : "bg-slate-700 text-gray-400 border border-transparent hover:border-slate-600"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              
              {/* インジケーターチャート */}
              {selectedIndicators.map((indicatorName) => (
                <div key={indicatorName} className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: INDICATOR_COLORS[indicatorName] || "#9CA3AF" }}
                    />
                    <span className="text-xs text-gray-400">{indicatorName}</span>
                  </div>
                  <div className="h-24 bg-slate-800 rounded-lg border border-slate-700">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={getIndicatorChartData(indicatorName)}>
                        <XAxis
                          dataKey="timestamp"
                          tick={{ fill: "#6B7280", fontSize: 10 }}
                          axisLine={{ stroke: "#334155" }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: "#6B7280", fontSize: 10 }}
                          axisLine={{ stroke: "#334155" }}
                          tickLine={false}
                          width={40}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#1E293B",
                            border: "1px solid #334155",
                            borderRadius: "8px",
                          }}
                          labelStyle={{ color: "#9CA3AF" }}
                        />
                        {/* RSI の基準線 */}
                        {indicatorName === "RSI" && (
                          <>
                            <ReferenceLine y={70} stroke="#EF4444" strokeDasharray="3 3" />
                            <ReferenceLine y={30} stroke="#22C55E" strokeDasharray="3 3" />
                          </>
                        )}
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke={INDICATOR_COLORS[indicatorName] || "#9CA3AF"}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* トレード情報 */}
          {progress && progress.tradeMarkers.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2">
                🎯 検出されたトレード ({progress.tradeMarkers.filter((m) => m.type === "entry").length}件)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {progress.tradeMarkers
                  .filter((m) => m.type === "entry")
                  .slice(-8)
                  .map((marker, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg border ${
                        marker.side === "buy"
                          ? "bg-green-500/10 border-green-500/30"
                          : "bg-red-500/10 border-red-500/30"
                      }`}
                    >
                      <div className="text-xs text-gray-400">
                        {new Date(marker.timestamp).toLocaleTimeString("ja-JP")}
                      </div>
                      <div className={`text-sm font-bold ${
                        marker.side === "buy" ? "text-green-400" : "text-red-400"
                      }`}>
                        {marker.side.toUpperCase()} @ {marker.price.toFixed(2)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
          
          {/* エラー表示 */}
          {progress?.status === "error" && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-center gap-2 text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-semibold">エラーが発生しました</span>
              </div>
              <p className="mt-2 text-sm text-gray-400">{progress.errorMessage}</p>
            </div>
          )}
        </div>
        
        {/* フッター */}
        <div className="p-4 border-t border-slate-700 flex justify-end gap-3">
          {progress?.status === "completed" ? (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              結果を確認
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 text-gray-300 rounded-lg font-medium hover:bg-slate-600 transition-colors"
            >
              バックグラウンドで実行
            </button>
          )}
        </div>
      </div>
      
      <style jsx>{`
        .neon-text {
          background: linear-gradient(90deg, #ec4899, #8b5cf6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>
    </div>
  );
}

export default BacktestProgressDialog;
