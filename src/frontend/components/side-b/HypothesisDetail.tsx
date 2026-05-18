/**
 * 単一仮説の詳細表示（Phase 4d §4.3）
 *
 * ページは `hypothesisId` の受け渡しのみとし、UI とデータ取得は本コンポーネントに集約する。
 */

"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { ValidationTrigger } from "@/components/side-b/ValidationTrigger";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/side-b/StatusBadge";
import { ValidationReport } from "@/components/side-b/ValidationReport";
import { LensSnapshotView } from "@/components/side-b/LensSnapshotView";
import { sideBApi, SideBApiError } from "@/lib/sideBApi";
import type {
    EdgeCategory,
    EdgeHypothesis,
    EdgeSource,
    MachineReadableCondition,
    PromotionVerdictType,
    ValidationHistoryEntry,
} from "@/types/sideB";
import { cn } from "@/lib/utils";
import { parseEvolutionStatement } from "@/lib/evolutionStatement";
import { formatPercent } from "@/lib/format";

// ===========================================
// ラベル
// ===========================================

const CATEGORY_LABEL: Record<EdgeCategory, string> = {
    time: "時間",
    level: "レベル",
    event: "イベント",
    correlation: "相関",
    positioning: "ポジショニング",
    volatility: "ボラ",
    structure: "構造",
    other: "その他",
};

const SOURCE_LABEL: Record<EdgeSource, string> = {
    ai_generated: "AI 生成",
    reflection: "振り返り",
    user_input: "手入力",
    backtest: "バックテスト",
    discovery: "Discovery",
};

// ===========================================
// ユーティリティ
// ===========================================

function formatDateTime(iso?: string): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatConditionValue(v: MachineReadableCondition["value"]): string {
    if (Array.isArray(v)) return `[${v.join(", ")}]`;
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
}

function computeObservationWinRate(h: EdgeHypothesis): number | undefined {
    const total = h.winCount + h.lossCount;
    if (total <= 0) return undefined;
    return h.winCount / total;
}

function riskSpecLabel(
    spec:
        | { type: string; value?: number; lookbackBars?: number }
        | undefined,
): string {
    if (!spec) return "—";
    switch (spec.type) {
        case "atr_multiple":
            return `ATR × ${spec.value}`;
        case "fixed_pips":
            return `${spec.value} pips`;
        case "rr_ratio":
            return `RR ${spec.value}`;
        case "swing_point":
            return `swing point (lookback ${spec.lookbackBars})`;
        default:
            return spec.type;
    }
}

export interface HypothesisDetailProps {
    /** 仮説 ID（URL の [id]） */
    hypothesisId: string;
}

export function HypothesisDetail({ hypothesisId }: HypothesisDetailProps) {
    const id = hypothesisId;

    const [hypothesis, setHypothesis] = React.useState<EdgeHypothesis | null>(null);
    const [history, setHistory] = React.useState<ValidationHistoryEntry[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const [validateMessage, setValidateMessage] = React.useState<{
        type: "success" | "error";
        text: string;
        verdict?: PromotionVerdictType;
    } | null>(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [hyp, hist] = await Promise.all([
                sideBApi.getHypothesis(id),
                sideBApi.getValidationHistory(id),
            ]);
            setHypothesis(hyp);
            setHistory(hist);
        } catch (err) {
            const msg = err instanceof SideBApiError ? err.message : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [id]);

    React.useEffect(() => {
        load();
    }, [load]);

    if (loading) {
        return <DetailSkeleton />;
    }

    if (error || !hypothesis) {
        return (
            <div className="min-h-screen bg-slate-900 text-gray-100">
                <main className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
                    <Link
                        href="/side-b/hypotheses"
                        className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        ← 仮説一覧に戻る
                    </Link>
                    <div
                        role="alert"
                        data-testid="detail-error"
                        className="mt-4 p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-sm text-red-200"
                    >
                        <p className="font-semibold mb-1">仮説の読み込みに失敗しました</p>
                        <p className="text-xs text-red-300 mb-3">
                            {error ?? "仮説が見つかりません"}
                        </p>
                        <Button variant="outline" size="sm" onClick={load}>
                            再試行
                        </Button>
                    </div>
                </main>
            </div>
        );
    }

    const observationWR = computeObservationWinRate(hypothesis);

    return (
        <div className="min-h-screen bg-slate-900 text-gray-100">
            <main
                className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6"
                data-testid="hypothesis-detail"
            >
                <div className="flex items-center justify-between mb-3">
                    <Link
                        href="/side-b/hypotheses"
                        className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        ← 仮説一覧に戻る
                    </Link>
                </div>

                <Card className="p-4 mb-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={hypothesis.status} size="lg" />
                            <Badge variant="outline">
                                {CATEGORY_LABEL[hypothesis.category]}
                            </Badge>
                            <span className="text-xs text-gray-500">
                                {SOURCE_LABEL[hypothesis.source]}
                            </span>
                            {parseEvolutionStatement(hypothesis.statement).isEvolutionPrefixed && (
                                <Badge variant="default" className="text-[10px]">
                                    進化由来
                                </Badge>
                            )}
                        </div>
                        <div className="text-right text-[11px] text-gray-500">
                            <p>作成: {formatDateTime(hypothesis.createdAt)}</p>
                            <p>
                                状態更新: {formatDateTime(hypothesis.statusUpdatedAt)}
                            </p>
                        </div>
                    </div>

                    <p
                        className="text-base text-gray-100 mb-3"
                        data-testid="detail-statement"
                    >
                        {parseEvolutionStatement(hypothesis.statement).displayText}
                    </p>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                        <span>
                            対象:{" "}
                            <span className="text-gray-200">
                                {hypothesis.symbols.join(", ")}
                            </span>
                        </span>
                        <span>
                            時間足:{" "}
                            <span className="text-gray-200">
                                {hypothesis.timeframes.join(", ")}
                            </span>
                        </span>
                        <span>
                            方向:{" "}
                            <span className="text-gray-200">
                                {hypothesis.expectedDirection}
                            </span>
                        </span>
                    </div>

                    <dl
                        className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs"
                        data-testid="detail-observations"
                    >
                        <Stat label="観測数" value={String(hypothesis.observationCount)} />
                        <Stat label="勝ち / 負け / BE" value={`${hypothesis.winCount} / ${hypothesis.lossCount} / ${hypothesis.breakevenCount}`} />
                        <Stat label="観測勝率" value={formatPercent(observationWR)} />
                        <Stat label="平均 RR" value={hypothesis.avgRR.toFixed(2)} />
                    </dl>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <ValidationTrigger
                            hypothesisId={id}
                            data-testid="revalidate-button"
                            size="sm"
                            onComplete={(result) => {
                                setValidateMessage({
                                    type: "success",
                                    text: `判定: ${result.verdict}`,
                                    verdict: result.verdict,
                                });
                                void load();
                            }}
                            onError={(msg) => {
                                setValidateMessage({ type: "error", text: msg });
                            }}
                        />
                        {validateMessage && (
                            <p
                                data-testid="revalidate-message"
                                className={cn(
                                    "text-xs",
                                    validateMessage.type === "success"
                                        ? "text-green-300"
                                        : "text-red-300",
                                )}
                            >
                                {validateMessage.text}
                            </p>
                        )}
                    </div>
                </Card>

                <Section title="検証レポート">
                    <ValidationReport hypothesis={hypothesis} />
                </Section>

                {(hypothesis.confirmationInterpretation ||
                    hypothesis.rejectionInterpretation ||
                    (hypothesis.actionableInsights?.length ?? 0) > 0) && (
                        <Section title="AI の解釈">
                            <Card
                                className="p-4 space-y-3"
                                data-testid="detail-interpretation"
                            >
                                {hypothesis.confirmationInterpretation && (
                                    <div>
                                        <p className="text-[11px] text-green-400 mb-1">採用理由</p>
                                        <p className="text-sm text-gray-200 leading-relaxed">
                                            {hypothesis.confirmationInterpretation}
                                        </p>
                                    </div>
                                )}
                                {hypothesis.rejectionInterpretation && (
                                    <div>
                                        <p className="text-[11px] text-red-400 mb-1">棄却理由</p>
                                        <p className="text-sm text-gray-200 leading-relaxed">
                                            {hypothesis.rejectionInterpretation}
                                        </p>
                                    </div>
                                )}
                                {hypothesis.actionableInsights &&
                                    hypothesis.actionableInsights.length > 0 && (
                                        <div>
                                            <p className="text-[11px] text-cyan-400 mb-1">
                                                改善提案
                                            </p>
                                            <ul className="list-disc list-inside text-sm text-gray-200 space-y-1">
                                                {hypothesis.actionableInsights.map((insight, i) => (
                                                    <li key={i}>{insight}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                            </Card>
                        </Section>
                    )}

                <Section title="機械判定条件">
                    <Card className="p-4" data-testid="detail-conditions">
                        {hypothesis.conditions.length === 0 ? (
                            <p className="text-xs text-gray-500">条件が登録されていません</p>
                        ) : (
                            <ul className="space-y-1.5 text-sm">
                                {hypothesis.conditions.map((c, i) => (
                                    <li key={i} className="flex flex-wrap items-center gap-1.5">
                                        <Badge variant="outline" className="text-[10px]">
                                            {c.lensName}
                                        </Badge>
                                        <span className="text-gray-300">{c.featureKey}</span>
                                        <span className="text-gray-500">{c.op}</span>
                                        <span className="text-gray-100 tabular-nums">
                                            {formatConditionValue(c.value)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {hypothesis.defaultRiskManagement && (
                            <div className="mt-3 pt-3 border-t border-slate-700">
                                <p className="text-[11px] text-gray-500 mb-1">リスク管理</p>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
                                    <span>
                                        SL: {riskSpecLabel(hypothesis.defaultRiskManagement.stopLoss)}
                                    </span>
                                    <span>
                                        TP:{" "}
                                        {riskSpecLabel(hypothesis.defaultRiskManagement.takeProfit)}
                                    </span>
                                    {hypothesis.defaultRiskManagement.maxHoldingBars && (
                                        <span>
                                            最大保有:{" "}
                                            {hypothesis.defaultRiskManagement.maxHoldingBars} bar
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </Card>
                </Section>

                <Section title="レンズスナップショット">
                    <LensSnapshotView />
                </Section>

                <Section title="関連">
                    <Card className="p-4 text-xs text-gray-400 space-y-2" data-testid="detail-related">
                        {hypothesis.materializedTradeNoteIds?.length ? (
                            <div>
                                <p className="mb-1">Materialized TradeNote</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    {hypothesis.materializedTradeNoteIds.map((noteId) => (
                                        <li key={noteId} className="text-gray-300 break-all">
                                            {noteId}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                        {hypothesis.relatedNoteIds?.length ? (
                            <div>
                                <p className="mb-1">関連 AITradeNote</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    {hypothesis.relatedNoteIds.map((noteId) => (
                                        <li key={noteId} className="text-gray-300 break-all">
                                            {noteId}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                        {!hypothesis.materializedTradeNoteIds?.length &&
                            !hypothesis.relatedNoteIds?.length && (
                                <p className="text-gray-500">関連エントリはありません</p>
                            )}
                    </Card>
                </Section>

                <Section title="検証履歴">
                    <Card className="p-4" data-testid="detail-history">
                        {history.length === 0 ? (
                            <p className="text-xs text-gray-500">
                                検証履歴はまだありません
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {history.map((entry, i) => (
                                    <li
                                        key={i}
                                        className="flex items-center justify-between text-xs border-b border-slate-700 last:border-b-0 pb-2 last:pb-0"
                                        data-history-type={entry.type}
                                    >
                                        <span>
                                            <Badge
                                                variant={entry.passed ? "secondary" : "destructive"}
                                                className="mr-2"
                                            >
                                                {entry.type === "screening"
                                                    ? "事前スクリーニング"
                                                    : "本格検証"}
                                            </Badge>
                                            <span className="text-gray-400">
                                                {entry.passed ? "通過" : "未達"}
                                            </span>
                                        </span>
                                        <span className="text-gray-500">
                                            {formatDateTime(entry.executedAt)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                </Section>
            </main>
        </div>
    );
}

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="mb-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-2 px-1">{title}</h2>
            {children}
        </section>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-[10px] text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-100 tabular-nums">{value}</dd>
        </div>
    );
}

function DetailSkeleton() {
    return (
        <div className="min-h-screen bg-slate-900 text-gray-100">
            <main className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
                <Skeleton className="h-4 w-24 mb-3" />
                <Skeleton className="h-32 w-full mb-4 rounded-xl" />
                <Skeleton className="h-48 w-full mb-4 rounded-xl" />
                <Skeleton className="h-24 w-full mb-4 rounded-xl" />
            </main>
        </div>
    );
}
