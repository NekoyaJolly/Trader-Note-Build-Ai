/**
 * JobProgressBar コンポーネント
 * 
 * 機能:
 * - 再評価ジョブの進捗表示
 * - ステップ表示（完了/進行中/未実行）
 * - リアルタイム更新対応
 * - ダークモード対応 (Neon Dark テーマ)
 */
"use client";

import React from "react";

// ジョブステータス
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// ジョブステップ
export interface JobStep {
  /** ステップ ID */
  id: string;
  /** ステップ名 */
  name: string;
  /** ステータス */
  status: "pending" | "running" | "completed" | "failed";
  /** 進捗率 (0-100)、running 時のみ */
  progress?: number;
  /** エラーメッセージ */
  error?: string;
}

export interface JobProgressBarProps {
  /** ジョブタイトル */
  title: string;
  /** 全体ステータス */
  status: JobStatus;
  /** 全体進捗率 (0-100) */
  progress: number;
  /** ステップ一覧（オプション） */
  steps?: JobStep[];
  /** 開始時刻 */
  startedAt?: string;
  /** 推定残り時間（秒） */
  estimatedTimeRemaining?: number;
  /** キャンセルボタンクリック時のコールバック */
  onCancel?: () => void;
  /** 追加の CSS クラス */
  className?: string;
}

/**
 * ステータスに応じたカラー設定
 */
const statusColors: Record<JobStatus, { bg: string; text: string; bar: string }> = {
  pending: {
    bg: "bg-gray-500/20",
    text: "text-gray-400",
    bar: "bg-gray-500",
  },
  running: {
    bg: "bg-violet-500/20",
    text: "text-violet-400",
    bar: "bg-gradient-to-r from-pink-500 to-violet-500",
  },
  completed: {
    bg: "bg-green-500/20",
    text: "text-green-400",
    bar: "bg-green-500",
  },
  failed: {
    bg: "bg-red-500/20",
    text: "text-red-400",
    bar: "bg-red-500",
  },
  cancelled: {
    bg: "bg-amber-500/20",
    text: "text-amber-400",
    bar: "bg-amber-500",
  },
};

/**
 * ステータスラベル
 */
const statusLabels: Record<JobStatus, string> = {
  pending: "待機中",
  running: "実行中",
  completed: "完了",
  failed: "失敗",
  cancelled: "キャンセル",
};

/**
 * 残り時間のフォーマット
 */
function formatTimeRemaining(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}分`;
  return `${Math.floor(seconds / 3600)}時間${Math.ceil((seconds % 3600) / 60)}分`;
}

/**
 * ステップインジケーター
 */
function StepIndicator({ step, index }: { step: JobStep; index: number }) {
  const isCompleted = step.status === "completed";
  const isRunning = step.status === "running";
  const isFailed = step.status === "failed";

  return (
    <div className="flex items-center gap-3">
      {/* ステップ番号/アイコン */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
          isCompleted
            ? "bg-green-500/20 text-green-400"
            : isRunning
            ? "bg-violet-500/20 text-violet-400"
            : isFailed
            ? "bg-red-500/20 text-red-400"
            : "bg-slate-700 text-gray-500"
        }`}
      >
        {isCompleted ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : isFailed ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        ) : isRunning ? (
          <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          index + 1
        )}
      </div>

      {/* ステップ情報 */}
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span
            className={`text-sm font-medium ${
              isCompleted
                ? "text-green-400"
                : isRunning
                ? "text-violet-400"
                : isFailed
                ? "text-red-400"
                : "text-gray-500"
            }`}
          >
            {step.name}
          </span>
          {isRunning && step.progress !== undefined && (
            <span className="text-xs text-violet-400">{step.progress}%</span>
          )}
        </div>
        
        {/* ステップ内プログレスバー（実行中のみ） */}
        {isRunning && step.progress !== undefined && (
          <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-300"
              style={{ width: `${step.progress}%` }}
            />
          </div>
        )}
        
        {/* エラーメッセージ */}
        {isFailed && step.error && (
          <p className="mt-1 text-xs text-red-400">{step.error}</p>
        )}
      </div>
    </div>
  );
}

/**
 * JobProgressBar コンポーネント
 * 
 * バックグラウンドジョブの進捗状況を表示
 */
export default function JobProgressBar({
  title,
  status,
  progress,
  steps,
  startedAt,
  estimatedTimeRemaining,
  onCancel,
  className = "",
}: JobProgressBarProps) {
  const colors = statusColors[status];
  const isRunning = status === "running";

  return (
    <div className={`card-surface rounded-xl p-4 ${className}`}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors.bg} ${colors.text}`}
            >
              {statusLabels[status]}
            </span>
            {startedAt && (
              <span className="text-xs text-gray-500">
                開始: {new Date(startedAt).toLocaleTimeString("ja-JP")}
              </span>
            )}
          </div>
        </div>

        {/* キャンセルボタン */}
        {isRunning && onCancel && (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            キャンセル
          </button>
        )}
      </div>

      {/* メインプログレスバー */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">全体進捗</span>
          <span className={`text-sm font-medium ${colors.text}`}>{progress}%</span>
        </div>
        <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {isRunning && estimatedTimeRemaining !== undefined && estimatedTimeRemaining > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            推定残り時間: {formatTimeRemaining(estimatedTimeRemaining)}
          </p>
        )}
      </div>

      {/* ステップ一覧 */}
      {steps && steps.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-700">
          {steps.map((step, index) => (
            <StepIndicator key={step.id} step={step} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
