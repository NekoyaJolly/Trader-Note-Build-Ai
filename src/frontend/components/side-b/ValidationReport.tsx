/**
 * ValidationReport - 仮説検証レポートのコンポジット表示（仕様書 §4.3）
 *
 * 4 つの検証ツール（screening / walk_forward / monte_carlo / buy_and_hold）の
 * 結果を並列表示する。個別ツールの表示は ValidationToolResult を使い、
 * 本コンポーネントはその束ねと「データソースの選択」「全体サマリ」を担当。
 *
 * データソースの優先順位:
 *   1. hypothesis.fullValidationReport (Phase 4c の統合レポート)
 *      → 4 ツール全てがここから取れる
 *   2. hypothesis.screeningResult (Phase 4b の事前スクリーニングのみ)
 *      → screening だけ表示、他 3 ツールは未実行扱い
 *   3. どちらも無い
 *      → 全ツール未実行
 *
 * UX 方針:
 *   - fullValidationReport が欠けている場合は「本格検証は未実施です」案内を添える
 *     (Phase 4c コードは揃っているが実データがまだ、という状態を明示)
 *   - Phase 4c 完了後に自動的に 4 ツール揃った表示に切り替わる形
 */

"use client";

import * as React from "react";

import { ValidationToolResult } from "@/components/side-b/ValidationToolResult";
import { Card } from "@/components/ui/Card";
import type {
    ConsolidatedValidationReport,
    EdgeHypothesis,
    ScreeningResult,
    ValidationToolResult as ToolResultType,
} from "@/types/sideB";

// ===========================================
// Props
// ===========================================

export interface ValidationReportProps {
    hypothesis: EdgeHypothesis;
    /** ツールカードを常に展開表示するか（詳細ページ推奨 true） */
    expanded?: boolean;
    className?: string;
}

// ===========================================
// ScreeningResult → ValidationToolResult アダプタ
// ===========================================

/**
 * Phase 4b の `ScreeningResult`（独自スキーマ）を `ValidationToolResult`
 * の汎用シェイプに変換する。reasons は interpretation に結合。
 */
function adaptScreeningToToolResult(sr: ScreeningResult): ToolResultType {
    return {
        toolName: "screening",
        success: true,
        passed: sr.passed,
        metrics: {
            pf: sr.metrics.pf,
            winRate: sr.metrics.winRate,
            tradeCount: sr.metrics.tradeCount,
        },
        interpretation:
            sr.reasons && sr.reasons.length > 0
                ? sr.reasons.join(" / ")
                : undefined,
        durationMs: 0,
    };
}

// ===========================================
// ツール結果の組み立て
// ===========================================

interface ToolResultsPayload {
    screening?: ToolResultType;
    walkForward?: ToolResultType;
    monteCarlo?: ToolResultType;
    buyAndHold?: ToolResultType;
    /** 本格検証 (Phase 4c) のレポート実体。無ければ未実施案内を出す目印。 */
    fullReport?: ConsolidatedValidationReport;
}

function buildToolResults(hypothesis: EdgeHypothesis): ToolResultsPayload {
    const full = hypothesis.fullValidationReport;
    if (full) {
        return {
            screening: full.screening,
            walkForward: full.walkForward,
            monteCarlo: full.monteCarlo,
            buyAndHold: full.buyAndHold,
            fullReport: full,
        };
    }

    // fullReport 無し: screeningResult のみ（あれば）表示
    if (hypothesis.screeningResult) {
        return {
            screening: adaptScreeningToToolResult(hypothesis.screeningResult),
        };
    }

    return {};
}

// ===========================================
// 本体
// ===========================================

export function ValidationReport({
    hypothesis,
    expanded = true,
    className,
}: ValidationReportProps) {
    const { screening, walkForward, monteCarlo, buyAndHold, fullReport } =
        buildToolResults(hypothesis);

    const hasFullReport = Boolean(fullReport);
    const hasScreeningOnly = Boolean(!hasFullReport && screening);
    const hasNothing = !hasFullReport && !hasScreeningOnly;

    return (
        <div
            data-testid="validation-report"
            data-has-full-report={hasFullReport}
            className={className}
        >
            {/* サマリ行（本格検証がある場合のみ） */}
            {hasFullReport && fullReport && (
                <Card
                    data-testid="validation-report-summary"
                    className="p-3 mb-3 border-slate-700"
                >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                            <p className="text-xs text-gray-400">本格検証レポート</p>
                            <p className="text-sm text-gray-100">
                                {fullReport.passedCount} / {fullReport.totalCount} ツール通過
                                {fullReport.allPassed ? (
                                    <span className="ml-2 text-green-300">✓ 全通過</span>
                                ) : (
                                    <span className="ml-2 text-orange-300">一部未達</span>
                                )}
                            </p>
                        </div>
                        <div className="text-[11px] text-gray-500 text-right">
                            <p>
                                検証期間: {fullReport.periodUsed.start} ~{" "}
                                {fullReport.periodUsed.end}
                            </p>
                            <p>
                                実行時間: {(fullReport.totalDurationMs / 1000).toFixed(2)}s
                            </p>
                        </div>
                    </div>
                    {fullReport.errors.length > 0 && (
                        <div
                            className="mt-2 text-[11px] text-orange-300"
                            data-testid="validation-report-errors"
                        >
                            <p className="font-semibold">一部ツールでエラー:</p>
                            <ul className="list-disc list-inside">
                                {fullReport.errors.map((e, i) => (
                                    <li key={i}>{e}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Card>
            )}

            {/* 本格検証未実施案内 */}
            {hasScreeningOnly && (
                <Card
                    data-testid="validation-report-pending-full"
                    className="p-3 mb-3 border-blue-500/30 bg-blue-500/5 text-xs text-blue-200"
                >
                    <p className="font-semibold mb-1">本格検証は未実施です</p>
                    <p className="text-blue-300/80">
                        事前スクリーニング (Phase 4b) のみ記録されています。
                        本格検証 (Phase 4c: WalkForward / MonteCarlo / BuyAndHold) を
                        実行すると、以下の全 4 ツールの結果が揃います。
                    </p>
                </Card>
            )}

            {/* 何も無い */}
            {hasNothing && (
                <Card
                    data-testid="validation-report-empty"
                    className="p-3 mb-3 border-slate-700 text-xs text-gray-400"
                >
                    <p className="font-semibold mb-1 text-gray-300">
                        検証はまだ実施されていません
                    </p>
                    <p>
                        Phase 4b のスクリーニングまたは Phase 4c の本格検証が走ると、
                        ここに結果が表示されます。
                    </p>
                </Card>
            )}

            {/* 4 ツールグリッド（結果が無いツールは自動的に「未実行」表示） */}
            <div
                className="grid grid-cols-1 md:grid-cols-2 gap-3"
                data-testid="validation-tools-grid"
            >
                <ValidationToolResult
                    toolName="screening"
                    result={screening}
                    expanded={expanded}
                />
                <ValidationToolResult
                    toolName="walk_forward"
                    result={walkForward}
                    expanded={expanded}
                />
                <ValidationToolResult
                    toolName="monte_carlo"
                    result={monteCarlo}
                    expanded={expanded}
                />
                <ValidationToolResult
                    toolName="buy_and_hold"
                    result={buyAndHold}
                    expanded={expanded}
                />
            </div>
        </div>
    );
}
