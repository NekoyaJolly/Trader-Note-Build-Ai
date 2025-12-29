/**
 * TimeframePicker コンポーネント
 * 
 * 機能:
 * - 時間足の選択 (1h, 4h, 1d など)
 * - タブスタイルまたはドロップダウンスタイル
 * - ダークモード対応 (Neon Dark テーマ)
 */
"use client";

import React from "react";

// 時間足の型定義
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

// 時間足のラベル定義
export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1m": "1分",
  "5m": "5分",
  "15m": "15分",
  "30m": "30分",
  "1h": "1時間",
  "4h": "4時間",
  "1d": "日足",
  "1w": "週足",
};

export interface TimeframePickerProps {
  /** 利用可能な時間足リスト */
  timeframes?: Timeframe[];
  /** 選択中の時間足 */
  value: Timeframe;
  /** 選択変更時のコールバック */
  onChange: (timeframe: Timeframe) => void;
  /** 表示スタイル */
  variant?: "tabs" | "dropdown" | "pills";
  /** 無効状態 */
  disabled?: boolean;
  /** 追加の CSS クラス */
  className?: string;
}

/**
 * タブスタイルの時間足ピッカー
 */
function TabsStyle({
  timeframes,
  value,
  onChange,
  disabled,
}: {
  timeframes: Timeframe[];
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex border border-slate-700 rounded-lg overflow-hidden">
      {timeframes.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => !disabled && onChange(tf)}
          disabled={disabled}
          className={`
            px-4 py-2 text-sm font-medium transition-all duration-200
            ${tf === value
              ? "bg-gradient-to-r from-pink-500 to-violet-500 text-white"
              : "bg-slate-800 text-gray-400 hover:text-white hover:bg-slate-700"
            }
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
            border-r border-slate-700 last:border-r-0
          `}
        >
          {TIMEFRAME_LABELS[tf]}
        </button>
      ))}
    </div>
  );
}

/**
 * ピルスタイルの時間足ピッカー
 */
function PillsStyle({
  timeframes,
  value,
  onChange,
  disabled,
}: {
  timeframes: Timeframe[];
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {timeframes.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => !disabled && onChange(tf)}
          disabled={disabled}
          className={`
            px-3 py-1.5 text-sm font-medium rounded-full transition-all duration-200
            ${tf === value
              ? "bg-gradient-to-r from-pink-500 to-violet-500 text-white shadow-[0_0_15px_rgba(236,72,153,0.3)]"
              : "bg-slate-700 text-gray-400 hover:text-white hover:bg-slate-600"
            }
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          `}
        >
          {TIMEFRAME_LABELS[tf]}
        </button>
      ))}
    </div>
  );
}

/**
 * ドロップダウンスタイルの時間足ピッカー
 */
function DropdownStyle({
  timeframes,
  value,
  onChange,
  disabled,
}: {
  timeframes: Timeframe[];
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  disabled: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Timeframe)}
        disabled={disabled}
        className={`
          w-full px-4 py-2.5 pr-10 rounded-lg
          bg-slate-800 border border-slate-700
          text-white text-sm font-medium
          appearance-none cursor-pointer
          transition-all duration-200
          hover:border-slate-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        {timeframes.map((tf) => (
          <option key={tf} value={tf}>
            {TIMEFRAME_LABELS[tf]}
          </option>
        ))}
      </select>
      {/* カスタム矢印アイコン */}
      <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none">
        <svg
          className="w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}

/**
 * TimeframePicker コンポーネント
 * 
 * 時間足を選択するためのUIコンポーネント
 * - tabs: 横並びのタブスタイル
 * - pills: 丸みを帯びたボタンスタイル
 * - dropdown: プルダウンスタイル
 */
export default function TimeframePicker({
  timeframes = ["1h", "4h", "1d"],
  value,
  onChange,
  variant = "tabs",
  disabled = false,
  className = "",
}: TimeframePickerProps) {
  return (
    <div className={className}>
      {variant === "tabs" && (
        <TabsStyle
          timeframes={timeframes}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )}
      {variant === "pills" && (
        <PillsStyle
          timeframes={timeframes}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )}
      {variant === "dropdown" && (
        <DropdownStyle
          timeframes={timeframes}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}
