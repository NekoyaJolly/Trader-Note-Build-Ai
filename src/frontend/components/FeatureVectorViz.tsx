/**
 * FeatureVectorViz コンポーネント
 * 
 * 機能:
 * - 特徴量ベクトルのレーダーチャート表示
 * - 2つのベクトル比較（ノート時 vs 現在）
 * - ダークモード対応 (Neon Dark テーマ)
 * 
 * 使用ライブラリ: recharts
 */
"use client";

import React from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

// 特徴量データポイントの型定義
export interface FeatureDataPoint {
  /** 特徴量名 */
  feature: string;
  /** 短縮ラベル（チャート表示用） */
  label?: string;
  /** ノート作成時の値 (0-100 に正規化) */
  noteValue: number;
  /** 現在の値 (0-100 に正規化) */
  currentValue?: number;
  /** フルレンジ（参照用） */
  fullMark?: number;
}

export interface FeatureVectorVizProps {
  /** 特徴量データの配列 */
  data: FeatureDataPoint[];
  /** 比較モード（現在値を表示するか） */
  showComparison?: boolean;
  /** チャート高さ (px) */
  height?: number;
  /** チャートタイトル */
  title?: string;
  /** 追加の CSS クラス */
  className?: string;
}

/**
 * Neon Dark テーマ用のカラー定義
 */
const CHART_COLORS = {
  noteValue: "#EC4899",      // Pink-500
  currentValue: "#8B5CF6",   // Violet-500
  grid: "#334155",           // Slate-700
  text: "#9CA3AF",           // Gray-400
  noteFill: "rgba(236, 72, 153, 0.2)",
  currentFill: "rgba(139, 92, 246, 0.2)",
};

/**
 * カスタムツールチップコンポーネント
 */
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0].payload;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-lg">
      <p className="text-sm font-medium text-white mb-2">{data.feature}</p>
      {payload.map((entry: any, index: number) => (
        <p key={index} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: {entry.value.toFixed(1)}
        </p>
      ))}
    </div>
  );
}

/**
 * カスタム軸ラベルコンポーネント
 */
function CustomAxisTick({ payload, x, y, cx, cy }: any) {
  // ラベルの位置調整
  const radius = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  const angle = Math.atan2(y - cy, x - cx);
  const labelX = cx + (radius + 15) * Math.cos(angle);
  const labelY = cy + (radius + 15) * Math.sin(angle);

  return (
    <text
      x={labelX}
      y={labelY}
      fill={CHART_COLORS.text}
      fontSize={11}
      textAnchor="middle"
      dominantBaseline="middle"
    >
      {payload.value}
    </text>
  );
}

/**
 * FeatureVectorViz コンポーネント
 * 
 * 特徴量ベクトルをレーダーチャートで可視化
 * - ノート作成時の特徴量を表示
 * - オプションで現在の特徴量と比較表示
 */
export default function FeatureVectorViz({
  data,
  showComparison = true,
  height = 300,
  title = "特徴量ベクトル",
  className = "",
}: FeatureVectorVizProps) {
  // データが空の場合
  if (!data || data.length === 0) {
    return (
      <div className={`card-surface rounded-xl p-4 ${className}`}>
        <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
        <div className="flex items-center justify-center h-40 text-gray-400">
          特徴量データがありません
        </div>
      </div>
    );
  }

  // ラベルの調整（短縮ラベルがあればそちらを使用）
  const chartData = data.map((d) => ({
    ...d,
    feature: d.label || d.feature,
    fullMark: d.fullMark || 100,
  }));

  // 比較データがあるかチェック
  const hasComparison = showComparison && data.some((d) => d.currentValue !== undefined);

  return (
    <div className={`card-surface rounded-xl p-4 ${className}`}>
      <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
      
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={chartData} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
          <PolarGrid stroke={CHART_COLORS.grid} />
          <PolarAngleAxis
            dataKey="feature"
            tick={<CustomAxisTick />}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
            axisLine={{ stroke: CHART_COLORS.grid }}
          />
          <Tooltip content={<CustomTooltip />} />
          
          {/* ノート時の値 */}
          <Radar
            name="ノート作成時"
            dataKey="noteValue"
            stroke={CHART_COLORS.noteValue}
            fill={CHART_COLORS.noteFill}
            strokeWidth={2}
          />
          
          {/* 現在の値（比較モード時のみ） */}
          {hasComparison && (
            <Radar
              name="現在"
              dataKey="currentValue"
              stroke={CHART_COLORS.currentValue}
              fill={CHART_COLORS.currentFill}
              strokeWidth={2}
            />
          )}
          
          <Legend
            wrapperStyle={{ paddingTop: 20 }}
            formatter={(value) => (
              <span className="text-gray-400 text-sm">{value}</span>
            )}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* 特徴量一覧（テキスト） */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2">
        {data.map((item, index) => (
          <div key={index} className="flex items-center justify-between text-xs">
            <span className="text-gray-400 truncate">{item.feature}</span>
            <div className="flex gap-2">
              <span className="text-pink-400 font-mono">{item.noteValue.toFixed(0)}</span>
              {hasComparison && item.currentValue !== undefined && (
                <>
                  <span className="text-gray-600">/</span>
                  <span className="text-violet-400 font-mono">{item.currentValue.toFixed(0)}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
