/**
 * StatusBadge - Side-B の EdgeHypothesis ステータスを表示するバッジ
 *
 * 仕様書 §4.6 の色マッピングに準拠:
 *   unverified:         slate（グレー）
 *   screening_passed:   blue（情報）
 *   testing:            yellow（進行中、パルス効果）
 *   confirmed:          green（成功）
 *   rejected:           red（失敗）
 *   stale:              orange（警告）
 *   insufficient_data:  slate
 *   not_testable:       slate（斜線）
 *
 * 既存 Badge コンポーネントのバリアントでは 8 状態を区別しきれないため、
 * ステータス専用のローカルスタイルを定義する（Card と同じ Tailwind 記法）。
 */

"use client";

import * as React from "react";

import type { EdgeStatus } from "@/types/sideB";
import { cn } from "@/lib/utils";

export type StatusBadgeSize = "sm" | "md" | "lg";

export interface StatusBadgeProps
    extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
    status: EdgeStatus;
    size?: StatusBadgeSize;
}

/** ステータス→表示ラベル（日本語） */
const STATUS_LABEL: Record<EdgeStatus, string> = {
    unverified: "未検証",
    screening_passed: "スクリーニング通過",
    testing: "検証中",
    confirmed: "採用",
    rejected: "棄却",
    stale: "劣化",
    insufficient_data: "データ不足",
    not_testable: "検証不能",
};

/**
 * ステータス→配色クラス。
 * Card / Badge の `bg-xxx-500/20 text-xxx-400 border-xxx-500/30` パターンに揃える。
 */
const STATUS_CLASSES: Record<EdgeStatus, string> = {
    unverified: "bg-slate-500/15 text-slate-300 border-slate-500/30",
    screening_passed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    testing: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30 animate-pulse",
    confirmed: "bg-green-500/15 text-green-300 border-green-500/30",
    rejected: "bg-red-500/15 text-red-300 border-red-500/30",
    stale: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    insufficient_data: "bg-slate-500/15 text-slate-300 border-slate-500/30",
    not_testable: "bg-slate-500/10 text-slate-400 border-slate-500/30 line-through",
};

/** サイズ→パディング・フォントサイズ */
const SIZE_CLASSES: Record<StatusBadgeSize, string> = {
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-2.5 py-0.5 text-xs",
    lg: "px-3 py-1 text-sm",
};

export function StatusBadge({
    status,
    size = "md",
    className,
    ...rest
}: StatusBadgeProps) {
    return (
        <span
            role="status"
            aria-label={`ステータス: ${STATUS_LABEL[status]}`}
            data-status={status}
            className={cn(
                "inline-flex items-center rounded-full border font-semibold whitespace-nowrap",
                "transition-colors duration-200",
                SIZE_CLASSES[size],
                STATUS_CLASSES[status],
                className,
            )}
            {...rest}
        >
            {STATUS_LABEL[status]}
        </span>
    );
}

/** 外部からラベルを参照したい場合に使う（ユーザー向け表示文字列のソース・オブ・トゥルース） */
export const STATUS_BADGE_LABEL = STATUS_LABEL;
