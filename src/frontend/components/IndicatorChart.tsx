/**
 * IndicatorChart コンポーネント
 * 
 * 機能:
 * - RSI (相対力指数) の時系列チャート表示
 * - MACD (移動平均収束拡散法) のヒストグラム・ライン表示
 * - ボリンジャーバンドの可視化
 * - ダークモード対応 (Neon Dark テーマ)
 * 
 * 使用ライブラリ: recharts
 */
"use client";

import React from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Area,
} from "recharts";

// インジケーターデータポイントの型定義
export interface RSIDataPoint {
  timestamp: string;
  value: number;
}

export interface MACDDataPoint {
  timestamp: string;
  macd: number;
  signal: number;
  histogram: number;
}

export interface BBDataPoint {
  timestamp: string;
  upper: number;
  middle: number;
  lower: number;
  price?: number;
}

// コンポーネントの props 型定義
export interface IndicatorChartProps {
  /** インジケーター種別 */
  type: "RSI" | "MACD" | "BB";
  /** チャートデータ */
  data: RSIDataPoint[] | MACDDataPoint[] | BBDataPoint[];
  /** チャート高さ (px) */
  height?: number;
  /** チャートタイトル（省略時はインジケーター名） */
  title?: string;
  /** 追加の CSS クラス */
  className?: string;
}

/**
 * Neon Dark テーマ用のカラー定義
 */
const CHART_COLORS = {
  // RSI 用
  rsiLine: "#8B5CF6",      // Violet-500
  rsiOverbought: "#EF4444", // Red-500
  rsiOversold: "#22C55E",   // Green-500
  
  // MACD 用
  macdLine: "#EC4899",     // Pink-500
  signalLine: "#8B5CF6",   // Violet-500
  histogramPositive: "#22C55E", // Green-500
  histogramNegative: "#EF4444", // Red-500
  
  // BB 用
  bbUpper: "#F59E0B",      // Amber-500
  bbMiddle: "#8B5CF6",     // Violet-500
  bbLower: "#F59E0B",      // Amber-500
  bbFill: "rgba(139, 92, 246, 0.1)", // Violet with opacity
  priceLine: "#EC4899",    // Pink-500
  
  // 共通
  grid: "#334155",         // Slate-700
  text: "#9CA3AF",         // Gray-400
  background: "#1E293B",   // Slate-800
};

/**
 * カスタムツールチップコンポーネント
 */
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-lg">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {payload.map((entry: any, index: number) => (
        <p key={index} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value}
        </p>
      ))}
    </div>
  );
}

/**
 * RSI チャートコンポーネント
 */
function RSIChart({ data, height }: { data: RSIDataPoint[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
        />
        <Tooltip content={<CustomTooltip />} />
        
        {/* 買われすぎライン (70) */}
        <ReferenceLine
          y={70}
          stroke={CHART_COLORS.rsiOverbought}
          strokeDasharray="5 5"
          strokeOpacity={0.5}
        />
        {/* 売られすぎライン (30) */}
        <ReferenceLine
          y={30}
          stroke={CHART_COLORS.rsiOversold}
          strokeDasharray="5 5"
          strokeOpacity={0.5}
        />
        {/* 中央ライン (50) */}
        <ReferenceLine
          y={50}
          stroke={CHART_COLORS.text}
          strokeDasharray="3 3"
          strokeOpacity={0.3}
        />
        
        <Line
          type="monotone"
          dataKey="value"
          name="RSI"
          stroke={CHART_COLORS.rsiLine}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: CHART_COLORS.rsiLine }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * MACD チャートコンポーネント
 */
function MACDChart({ data, height }: { data: MACDDataPoint[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
        />
        <YAxis
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
        />
        <Tooltip content={<CustomTooltip />} />
        
        {/* ゼロライン */}
        <ReferenceLine y={0} stroke={CHART_COLORS.text} strokeOpacity={0.5} />
        
        {/* ヒストグラム（正/負で色分け） */}
        <Bar
          dataKey="histogram"
          name="Histogram"
          fill={CHART_COLORS.histogramPositive}
          // 正負で色を変える処理は Cell で行う
        />
        
        {/* MACD ライン */}
        <Line
          type="monotone"
          dataKey="macd"
          name="MACD"
          stroke={CHART_COLORS.macdLine}
          strokeWidth={2}
          dot={false}
        />
        
        {/* シグナルライン */}
        <Line
          type="monotone"
          dataKey="signal"
          name="Signal"
          stroke={CHART_COLORS.signalLine}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * ボリンジャーバンドチャートコンポーネント
 */
function BBChart({ data, height }: { data: BBDataPoint[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
        />
        <YAxis
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickLine={{ stroke: CHART_COLORS.grid }}
          axisLine={{ stroke: CHART_COLORS.grid }}
          domain={["auto", "auto"]}
        />
        <Tooltip content={<CustomTooltip />} />
        
        {/* バンド領域 (Area) */}
        <Area
          type="monotone"
          dataKey="upper"
          stroke="transparent"
          fill={CHART_COLORS.bbFill}
        />
        
        {/* 上限バンド */}
        <Line
          type="monotone"
          dataKey="upper"
          name="Upper"
          stroke={CHART_COLORS.bbUpper}
          strokeWidth={1}
          strokeDasharray="5 5"
          dot={false}
        />
        
        {/* 中央バンド (SMA) */}
        <Line
          type="monotone"
          dataKey="middle"
          name="Middle"
          stroke={CHART_COLORS.bbMiddle}
          strokeWidth={2}
          dot={false}
        />
        
        {/* 下限バンド */}
        <Line
          type="monotone"
          dataKey="lower"
          name="Lower"
          stroke={CHART_COLORS.bbLower}
          strokeWidth={1}
          strokeDasharray="5 5"
          dot={false}
        />
        
        {/* 価格ライン（オプション） */}
        {data[0]?.price !== undefined && (
          <Line
            type="monotone"
            dataKey="price"
            name="Price"
            stroke={CHART_COLORS.priceLine}
            strokeWidth={2}
            dot={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * IndicatorChart メインコンポーネント
 * 
 * @param type - インジケーター種別 (RSI / MACD / BB)
 * @param data - チャートデータ
 * @param height - チャート高さ (デフォルト: 200px)
 * @param title - チャートタイトル
 * @param className - 追加の CSS クラス
 */
export default function IndicatorChart({
  type,
  data,
  height = 200,
  title,
  className = "",
}: IndicatorChartProps) {
  // タイトルのデフォルト値
  const chartTitle = title || {
    RSI: "RSI (相対力指数)",
    MACD: "MACD (移動平均収束拡散法)",
    BB: "Bollinger Bands (ボリンジャーバンド)",
  }[type];

  // データが空の場合の表示
  if (!data || data.length === 0) {
    return (
      <div className={`card-surface rounded-xl p-4 ${className}`}>
        <h3 className="text-lg font-semibold text-white mb-4">{chartTitle}</h3>
        <div className="flex items-center justify-center h-40 text-gray-400">
          データがありません
        </div>
      </div>
    );
  }

  return (
    <div className={`card-surface rounded-xl p-4 ${className}`}>
      <h3 className="text-lg font-semibold text-white mb-4">{chartTitle}</h3>
      
      {type === "RSI" && <RSIChart data={data as RSIDataPoint[]} height={height} />}
      {type === "MACD" && <MACDChart data={data as MACDDataPoint[]} height={height} />}
      {type === "BB" && <BBChart data={data as BBDataPoint[]} height={height} />}
      
      {/* インジケーター説明 */}
      <div className="mt-3 text-xs text-gray-500">
        {type === "RSI" && (
          <span>
            <span className="text-red-400">70以上</span>: 買われすぎ / 
            <span className="text-green-400 ml-1">30以下</span>: 売られすぎ
          </span>
        )}
        {type === "MACD" && (
          <span>
            <span className="text-pink-400">MACD</span> と 
            <span className="text-violet-400 ml-1">シグナル</span> のクロスに注目
          </span>
        )}
        {type === "BB" && (
          <span>
            バンド幅はボラティリティを示す / 上下限への接近に注意
          </span>
        )}
      </div>
    </div>
  );
}
