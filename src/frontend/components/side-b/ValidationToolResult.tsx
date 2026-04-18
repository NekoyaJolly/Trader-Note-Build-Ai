/**
 * ValidationToolResult - 個別検証ツールの結果カード（仕様書 §4.6）
 *
 * 4 ツール（screening / walk_forward / monte_carlo / buy_and_hold）それぞれの
 * 結果を視覚化する。ConsolidatedValidationReport の各フィールドを 1 コンポーネント
 * 1 つで表示する形を想定。
 *
 * 表示パターン:
 *   - passed=true:    グリーン系（成功）
 *   - passed=false:   レッド系（失敗）
 *   - success=false:  オレンジ系（実行失敗）
 *   - result=undef:   グレー系（未実行）
 *
 * expanded=true で metrics を全展開する（サマリは主要メトリクスのみ表示）。
 */

"use client";

import * as React from "react";

import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { ValidationToolResult as ToolResultType } from "@/types/sideB";

// ===========================================
// ツール名 → 表示ラベル / 主要メトリクス
// ===========================================

const TOOL_LABEL: Record<string, string> = {
    screening: "事前スクリーニング",
    screening_bt: "事前スクリーニング",
    walk_forward: "ウォークフォワード",
    monte_carlo: "モンテカルロ",
    buy_and_hold: "バイ&ホールド",
};

/**
 * 各ツールのサマリで優先的に出すメトリクスキー。
 * 表示順 = この配列の順。
 */
const PRIMARY_METRIC_KEYS: Record<string, string[]> = {
    screening: ["pf", "winRate", "tradeCount"],
    screening_bt: ["pf", "winRate", "tradeCount"],
    walk_forward: [
        "overfitScore",
        "avgInSampleWinRate",
        "avgOutOfSampleWinRate",
        "totalTradeCount",
    ],
    monte_carlo: ["p5FinalPnl", "medianFinalPnl", "simulationCount"],
    buy_and_hold: [
        "outperformance",
        "strategyReturn",
        "buyAndHoldReturn",
    ],
};

const METRIC_LABEL: Record<string, string> = {
    pf: "PF",
    winRate: "勝率",
    tradeCount: "トレード数",
    overfitScore: "過学習スコア",
    avgInSampleWinRate: "IS 勝率",
    avgOutOfSampleWinRate: "OOS 勝率",
    avgInSamplePF: "IS PF",
    avgOutOfSamplePF: "OOS PF",
    totalTradeCount: "総トレード数",
    splitCount: "分割数",
    windowsEvaluated: "有効窓数",
    p5FinalPnl: "下側5%PnL",
    medianFinalPnl: "中央値PnL",
    p95FinalPnl: "上側95%PnL",
    medianMaxDrawdown: "中央値DD",
    p5MaxDrawdown: "下側5%DD",
    simulationCount: "シミュレーション数",
    outperformance: "超過収益",
    strategyReturn: "戦略リターン",
    buyAndHoldReturn: "BH リターン",
    periodDays: "期間(日)",
};

/**
 * 特定メトリクスのフォーマット規則。
 * 数値の小数桁数やパーセント表記を統一する。
 */
function formatMetric(key: string, value: number | string | boolean): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") return value;
    if (!Number.isFinite(value)) return "-";

    // 勝率系（0-1 想定 / 念のため 1 超は 0-100 とみなして処理）
    if (
        key === "winRate" ||
        key === "avgInSampleWinRate" ||
        key === "avgOutOfSampleWinRate"
    ) {
        const normalized = value <= 1 ? value * 100 : value;
        return `${normalized.toFixed(1)}%`;
    }

    // 超過収益 / 各種リターン（0-1 想定）
    if (
        key === "outperformance" ||
        key === "strategyReturn" ||
        key === "buyAndHoldReturn"
    ) {
        return `${(value * 100).toFixed(2)}%`;
    }

    // 整数系
    if (
        key === "tradeCount" ||
        key === "totalTradeCount" ||
        key === "splitCount" ||
        key === "windowsEvaluated" ||
        key === "simulationCount" ||
        key === "periodDays"
    ) {
        return String(Math.round(value));
    }

    // スコア系（小数3桁）
    if (key === "overfitScore" || key === "pf" || key.endsWith("PF")) {
        return value.toFixed(3);
    }

    // デフォルト: 小数2桁
    return value.toFixed(2);
}

// ===========================================
// ステータス判定
// ===========================================

type VisualState = "passed" | "failed" | "errored" | "not_run";

function determineState(result?: ToolResultType): VisualState {
    if (!result) return "not_run";
    if (!result.success) return "errored";
    return result.passed ? "passed" : "failed";
}

const STATE_CLASSES: Record<VisualState, string> = {
    passed: "border-green-500/40 bg-green-500/5",
    failed: "border-red-500/40 bg-red-500/5",
    errored: "border-orange-500/40 bg-orange-500/5",
    not_run: "border-slate-600/40 bg-slate-700/20",
};

const STATE_LABEL: Record<VisualState, string> = {
    passed: "通過",
    failed: "未達",
    errored: "実行失敗",
    not_run: "未実行",
};

const STATE_BADGE_CLASSES: Record<VisualState, string> = {
    passed: "bg-green-500/20 text-green-300 border-green-500/30",
    failed: "bg-red-500/20 text-red-300 border-red-500/30",
    errored: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    not_run: "bg-slate-600/20 text-slate-400 border-slate-600/30",
};

// ===========================================
// Props
// ===========================================

export interface ValidationToolResultProps {
    /** ツール識別子 (e.g. 'walk_forward'). result.toolName と別に渡せる */
    toolName: string;
    result?: ToolResultType;
    /** 既定 false。true で全メトリクスを表示する */
    expanded?: boolean;
    className?: string;
}

// ===========================================
// 本体
// ===========================================

export function ValidationToolResult({
    toolName,
    result,
    expanded = false,
    className,
}: ValidationToolResultProps) {
    const state = determineState(result);
    const label = TOOL_LABEL[toolName] ?? toolName;

    const primaryKeys =
        PRIMARY_METRIC_KEYS[toolName] ??
        (result ? Object.keys(result.metrics).slice(0, 3) : []);

    const allMetrics = result?.metrics ?? {};
    const shownKeys = expanded ? Object.keys(allMetrics) : primaryKeys;

    return (
        <Card
            data-testid="validation-tool-result"
            data-tool-name={toolName}
            data-state={state}
            className={cn("p-4", STATE_CLASSES[state], className)}
        >
            <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-white">{label}</h3>
                <span
                    className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
                        STATE_BADGE_CLASSES[state],
                    )}
                    data-testid="state-badge"
                >
                    {STATE_LABEL[state]}
                </span>
            </div>

            {state === "not_run" && (
                <p className="text-xs text-gray-500">
                    このツールはまだ実行されていません
                </p>
            )}

            {state === "errored" && (
                <p className="text-xs text-orange-300" data-testid="error-message">
                    {result?.error ?? "実行失敗（詳細不明）"}
                </p>
            )}

            {(state === "passed" || state === "failed") && result && (
                <>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {shownKeys.map((key) => {
                            const raw = allMetrics[key];
                            if (raw === undefined) return null;
                            return (
                                <React.Fragment key={key}>
                                    <dt className="text-gray-400">
                                        {METRIC_LABEL[key] ?? key}
                                    </dt>
                                    <dd
                                        className="text-gray-100 text-right tabular-nums"
                                        data-metric-key={key}
                                    >
                                        {formatMetric(key, raw)}
                                    </dd>
                                </React.Fragment>
                            );
                        })}
                    </dl>

                    {result.interpretation && (
                        <p
                            className="mt-2 text-[11px] text-gray-400 leading-relaxed"
                            data-testid="interpretation"
                        >
                            {result.interpretation}
                        </p>
                    )}

                    {typeof result.durationMs === "number" && (
                        <p className="mt-2 text-[10px] text-gray-500 text-right">
                            {(result.durationMs / 1000).toFixed(2)}s
                        </p>
                    )}
                </>
            )}
        </Card>
    );
}

// テスト・外部利用向け export
export const VALIDATION_TOOL_LABEL = TOOL_LABEL;
