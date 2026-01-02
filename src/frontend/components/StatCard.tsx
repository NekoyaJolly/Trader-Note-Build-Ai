/**
 * StatCard コンポーネント
 * 
 * 機能:
 * - ダッシュボード用の統計カード表示
 * - 数値、トレンド、アイコン表示
 * - ダークモード対応 (Neon Dark テーマ)
 */
"use client";

import React from "react";

// カラーバリアント
export type StatCardVariant = "default" | "success" | "warning" | "danger" | "neon";

// トレンド方向
export type TrendDirection = "up" | "down" | "neutral";

export interface StatCardProps {
  /** 統計のタイトル */
  title: string;
  /** 統計値（数値または文字列） */
  value: string | number;
  /** 単位（オプション: %, 件, 円 など） */
  unit?: string;
  /** カラーバリアント */
  variant?: StatCardVariant;
  /** トレンド方向 */
  trend?: TrendDirection;
  /** トレンドの変化量（例: "+5.2%"） */
  trendValue?: string;
  /** アイコン（ReactNode） */
  icon?: React.ReactNode;
  /** 追加の CSS クラス */
  className?: string;
  /** クリックハンドラ */
  onClick?: () => void;
}

/**
 * バリアントに応じたスタイル設定
 */
const variantStyles: Record<StatCardVariant, { border: string; iconBg: string; valueColor: string }> = {
  default: {
    border: "border-slate-700",
    iconBg: "bg-slate-700",
    valueColor: "text-white",
  },
  success: {
    border: "border-green-500/30",
    iconBg: "bg-green-500/20",
    valueColor: "text-green-400",
  },
  warning: {
    border: "border-amber-500/30",
    iconBg: "bg-amber-500/20",
    valueColor: "text-amber-400",
  },
  danger: {
    border: "border-red-500/30",
    iconBg: "bg-red-500/20",
    valueColor: "text-red-400",
  },
  neon: {
    border: "border-pink-500/30",
    iconBg: "bg-gradient-to-r from-pink-500/20 to-violet-500/20",
    valueColor: "text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-violet-400",
  },
};

/**
 * トレンドアイコンコンポーネント
 */
function TrendIcon({ direction }: { direction: TrendDirection }) {
  if (direction === "up") {
    return (
      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    );
  }
  if (direction === "down") {
    return (
      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
    </svg>
  );
}

/**
 * StatCard コンポーネント
 * 
 * ダッシュボードで使用する統計サマリーカード
 */
export default function StatCard({
  title,
  value,
  unit,
  variant = "default",
  trend,
  trendValue,
  icon,
  className = "",
  onClick,
}: StatCardProps) {
  const styles = variantStyles[variant];
  const isClickable = !!onClick;

  return (
    <div
      className={`
        card-surface rounded-xl p-3 sm:p-4 border ${styles.border}
        transition-all duration-300
        ${isClickable ? "cursor-pointer hover:border-slate-600 hover:shadow-[0_0_20px_rgba(139,92,246,0.15)]" : ""}
        ${className}
      `}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <div className="flex items-start justify-between">
        {/* 左側: タイトル + 値 */}
        <div className="flex-1">
          <p className="text-xs sm:text-sm text-gray-400 mb-1">{title}</p>
          <div className="flex items-baseline gap-1">
            <span className={`text-xl sm:text-2xl md:text-3xl font-bold ${styles.valueColor}`}>
              {value}
            </span>
            {unit && (
              <span className="text-xs sm:text-sm text-gray-500">{unit}</span>
            )}
          </div>
          
          {/* トレンド表示 */}
          {trend && (
            <div className="flex items-center gap-1 mt-2">
              <TrendIcon direction={trend} />
              {trendValue && (
                <span className={`text-sm ${
                  trend === "up" ? "text-green-400" :
                  trend === "down" ? "text-red-400" :
                  "text-gray-400"
                }`}>
                  {trendValue}
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* 右側: アイコン */}
        {icon && (
          <div className={`p-2 sm:p-3 rounded-lg ${styles.iconBg}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
