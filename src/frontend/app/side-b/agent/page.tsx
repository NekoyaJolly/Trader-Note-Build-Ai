/**
 * AI Agent 詳細ページ
 *
 * エージェントの詳細状態、全思考ログ、メモリ内容を表示
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { sideBApi } from "@/lib/sideBApi";
import { formatPercent } from "@/lib/format";
import type { AITradePlanPayload, AgentRun, GetOrchestratorRunDetailResponse } from "@/types/sideB";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "") + "/api/side-b";

// ThinkingLog の data フィールドで使用する JSON ライクな再帰型
type ThinkingLogEntryDataValue =
    | string
    | number
    | boolean
    | null
    | ThinkingLogEntryDataValue[]
    | { [key: string]: ThinkingLogEntryDataValue };

type ThinkingLogEntryData = {
    [key: string]: ThinkingLogEntryDataValue;
};

interface ThinkingLogEntry {
    timestamp: string;
    cycle: number;
    state: string;
    action: string;
    reasoning: string;
    data?: ThinkingLogEntryData;
}

interface LessonEntryData {
    text: string;
    symbol: string;
    tradeId?: string;
    addedAt: string;
}

interface ConsolidatedLessonData {
    text: string;
    symbol: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    sourceTexts: string[];
}

interface SymbolLessonsData {
    entries: LessonEntryData[];
    consolidated: ConsolidatedLessonData[];
}

interface LessonsData {
    lessonsBySymbol: Record<string, SymbolLessonsData>;
    totalEntries: number;
    totalConsolidated: number;
    stats: {
        winRate: number;
        totalTrades: number;
        wins: number;
        losses: number;
    };
}

interface ValidationVisibilityData {
    pendingCount: number;
    recentlyValidatedCount: number;
}

const stateColors: Record<string, string> = {
    IDLE: "text-gray-400 bg-gray-500/20",
    SESSION_OPEN: "text-yellow-400 bg-yellow-500/20",
    MONITORING: "text-green-400 bg-green-500/20",
    EVALUATING_ENTRY: "text-blue-400 bg-blue-500/20",
    MANAGING_POSITION: "text-purple-400 bg-purple-500/20",
    REFLECTING: "text-cyan-400 bg-cyan-500/20",
    REVISING_STRATEGY: "text-orange-400 bg-orange-500/20",
};

const directionLabel: Record<"long" | "short", string> = {
    long: "ロング",
    short: "ショート",
};

function formatNumber(value: number | null | undefined, digits: number = 2): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    return value.toLocaleString("ja-JP", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
}

/**
 * レスポンスを安全にパースするヘルパー
 */
async function safeFetchJson<T>(res: Response): Promise<T | null> {
    if (!res.ok) return null;
    try {
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

export default function AgentDetailPage() {
    const [thinkingLog, setThinkingLog] = useState<ThinkingLogEntry[]>([]);
    const [lessonsData, setLessonsData] = useState<LessonsData | null>(null);
    const [recentPlans, setRecentPlans] = useState<AITradePlanPayload[]>([]);
    const [validationVisibility, setValidationVisibility] = useState<ValidationVisibilityData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [logLimit, setLogLimit] = useState(50);

    const [orchestratorRuns, setOrchestratorRuns] = useState<AgentRun[]>([]);
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [selectedRunDetail, setSelectedRunDetail] = useState<GetOrchestratorRunDetailResponse | null>(null);
    const [isDetailLoading, setIsDetailLoading] = useState(false);
    const activeRunIdRef = useRef<string | null>(null);

    // 本番耐用化: キルスイッチと容量監視用の状態
    const [isEmergencyStopped, setIsEmergencyStopped] = useState(false);
    const [consecutiveErrors, setConsecutiveErrors] = useState(0);
    const [dbWarning, setDbWarning] = useState(false);
    const [dbSizeBytes, setDbSizeBytes] = useState(0);
    const [isEmergencyActionLoading, setIsEmergencyActionLoading] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [logRes, lessonsRes, plansRes, pendingValidationRes, recentlyValidatedRes, runsRes, emergencyRes, healthRes] = await Promise.allSettled([
                fetch(`${API_BASE}/agent/thinking-log?limit=${logLimit}`),
                fetch(`${API_BASE}/agent/lessons`),
                sideBApi.listPlans({ limit: 5 }),
                sideBApi.getPendingValidation(),
                sideBApi.getRecentlyValidated(24),
                sideBApi.getOrchestratorRuns(undefined, 10),
                sideBApi.getEmergencyStatus(),
                sideBApi.getSystemHealth(),
            ]);

            if (logRes.status === "fulfilled") {
                const data = await safeFetchJson<{ log: ThinkingLogEntry[]; count: number }>(logRes.value);
                if (data) {
                    setThinkingLog(data.log || []);
                }
            }
            if (lessonsRes.status === "fulfilled") {
                const data = await safeFetchJson<LessonsData>(lessonsRes.value);
                if (data) {
                    setLessonsData(data);
                }
            }
            if (plansRes.status === "fulfilled") {
                setRecentPlans(plansRes.value.plans);
            }
            if (runsRes.status === "fulfilled") {
                setOrchestratorRuns(runsRes.value.runs || []);
            }
            if (emergencyRes.status === "fulfilled" && emergencyRes.value) {
                setIsEmergencyStopped(emergencyRes.value.data.isEmergencyStopped);
                setConsecutiveErrors(emergencyRes.value.data.consecutiveErrors);
            }
            if (healthRes.status === "fulfilled" && healthRes.value) {
                setDbWarning(!!healthRes.value.dbWarning);
                setDbSizeBytes(healthRes.value.dbSizeBytes || 0);
            }
            const nextValidation: ValidationVisibilityData = {
                pendingCount: 0,
                recentlyValidatedCount: 0,
            };
            if (pendingValidationRes.status === "fulfilled") {
                nextValidation.pendingCount = pendingValidationRes.value.length;
            }
            if (recentlyValidatedRes.status === "fulfilled") {
                nextValidation.recentlyValidatedCount = recentlyValidatedRes.value.length;
            }
            setValidationVisibility(nextValidation);
        } catch (err) {
            console.error("[Agent] fetch error:", err);
        } finally {
            setIsLoading(false);
        }
    }, [logLimit]);

    const handleEmergencyStop = async () => {
        if (!window.confirm("本当に緊急キルスイッチを作動させますか？\n保有しているすべての実ポジション（cTrader）及び仮想ポジションが強制決済され、システムが一時停止します。")) {
            return;
        }
        setIsEmergencyActionLoading(true);
        try {
            const res = await sideBApi.triggerEmergencyStop();
            const closeSummaryMsg = res.data.closeSummary.length > 0
                ? "\n\n決済ログ:\n" + res.data.closeSummary.join("\n")
                : "\n\n決済対象のポジションはありませんでした。";
            alert(res.message + closeSummaryMsg);
            await fetchData();
        } catch (err) {
            alert("緊急停止の実行中にエラーが発生しました: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsEmergencyActionLoading(false);
        }
    };

    const handleEmergencyResume = async () => {
        if (!window.confirm("緊急停止状態を解除して、自律取引サイクルを再開しますか？")) {
            return;
        }
        setIsEmergencyActionLoading(true);
        try {
            const res = await sideBApi.triggerEmergencyResume();
            alert(res.message);
            await fetchData();
        } catch (err) {
            alert("緊急停止解除中にエラーが発生しました: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsEmergencyActionLoading(false);
        }
    };


    const fetchRunDetail = async (runId: string) => {
        if (selectedRunId === runId) {
            setSelectedRunId(null);
            setSelectedRunDetail(null);
            activeRunIdRef.current = null;
            return;
        }
        setSelectedRunId(runId);
        activeRunIdRef.current = runId;
        setIsDetailLoading(true);
        try {
            const detail = await sideBApi.getOrchestratorRunDetail(runId);
            if (activeRunIdRef.current === runId) {
                setSelectedRunDetail(detail);
            }
        } catch (err) {
            console.error("fetchRunDetail error:", err);
        } finally {
            if (activeRunIdRef.current === runId) {
                setIsDetailLoading(false);
            }
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10_000);
        return () => clearInterval(interval);
    }, [fetchData]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            {/* 警告バー */}
            {isEmergencyStopped && (
                <div className="bg-red-500/20 border-b border-red-500/30 text-red-200 px-4 py-3 text-center text-xs font-semibold flex items-center justify-center gap-3 animate-pulse">
                    <span>⚠️ システム緊急停止中（キルスイッチ作動中）です。意思決定サイクルおよび新規取引はすべて停止されています。{consecutiveErrors > 0 && `(連続エラー数: ${consecutiveErrors})`}</span>
                    <button
                        onClick={handleEmergencyResume}
                        disabled={isEmergencyActionLoading}
                        className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded font-bold text-[11px] transition-colors disabled:opacity-50"
                    >
                        {isEmergencyActionLoading ? "処理中..." : "停止状態を解除"}
                    </button>
                </div>
            )}
            {dbWarning && (
                <div className="bg-yellow-500/20 border-b border-yellow-500/30 text-yellow-200 px-4 py-3 text-center text-xs font-semibold flex items-center justify-center gap-3">
                    <span>⚠️ データベース容量警告: Supabase の総使用量が 400MB を超過しています（現在: {(dbSizeBytes / (1024 * 1024)).toFixed(1)} MB）。</span>
                    <Link
                        href="/side-b"
                        className="underline hover:text-white transition-colors font-bold text-[11px]"
                    >
                        クリーンアップを推奨
                    </Link>
                </div>
            )}

            <main className="max-w-5xl w-full mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8">
                {/* ヘッダー */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/side-b"
                            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
                        >
                            ← Dashboard
                        </Link>
                        <span className="text-gray-600">|</span>
                        <h1 className="text-xl font-bold text-white">AI Agent 詳細</h1>
                    </div>
                    <div>
                        {isEmergencyStopped ? (
                            <button
                                onClick={handleEmergencyResume}
                                disabled={isEmergencyActionLoading}
                                className="bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {isEmergencyActionLoading ? "処理中..." : "緊急停止を解除"}
                            </button>
                        ) : (
                            <button
                                onClick={handleEmergencyStop}
                                disabled={isEmergencyActionLoading}
                                className="bg-red-950/40 hover:bg-red-900/60 border border-red-700/50 text-red-200 font-bold text-xs px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                            >
                                {isEmergencyActionLoading ? "処理中..." : "🚨 緊急停止 (KILL SWITCH)"}
                            </button>
                        )}
                    </div>
                </div>


                {/* 統計カード */}
                {lessonsData && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                        <div className="card-surface rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500">勝率</p>
                            <p className={`text-2xl font-bold ${lessonsData.stats.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                                {Math.round(lessonsData.stats.winRate)}%
                            </p>
                        </div>
                        <div className="card-surface rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500">総トレード</p>
                            <p className="text-2xl font-bold text-white">{lessonsData.stats.totalTrades}</p>
                        </div>
                        <div className="card-surface rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500">勝ち</p>
                            <p className="text-2xl font-bold text-green-400">{lessonsData.stats.wins}</p>
                        </div>
                        <div className="card-surface rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500">負け</p>
                            <p className="text-2xl font-bold text-red-400">{lessonsData.stats.losses}</p>
                        </div>
                    </div>
                )}

                {/* 保存済み戦略 */}
                <div className="card-surface rounded-xl overflow-hidden mb-6">
                    <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-sm font-semibold text-white">保存済み戦略</h2>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                                DBに保存された直近のAITradePlanです。思考ログとは別に、実際の戦略成果物を確認できます。
                            </p>
                        </div>
                        <Link
                            href="/side-b/trades"
                            className="text-xs text-purple-400 hover:text-purple-300 transition-colors shrink-0"
                        >
                            プラン生成へ
                        </Link>
                    </div>
                    <div className="px-4 py-3 space-y-3">
                        {recentPlans.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-6">保存済み戦略がありません</p>
                        ) : (
                            recentPlans.map((plan) => (
                                <article
                                    key={plan.id}
                                    className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                                        <div>
                                            <p className="text-sm font-semibold text-white">
                                                {plan.symbol} / {formatDate(plan.targetDate)}
                                            </p>
                                            <p className="text-[11px] text-gray-500 font-mono">{plan.id}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-gray-500">全体信頼度</p>
                                            <p className="text-sm font-semibold text-cyan-300">
                                                {formatPercent(plan.overallConfidence)}
                                            </p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-300 mb-2">
                                        {plan.marketAnalysis.summary}
                                    </p>
                                    <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-3">
                                        <span>regime: {plan.marketAnalysis.regime}</span>
                                        <span>trend: {plan.marketAnalysis.trendDirection}</span>
                                        <span>vol: {plan.marketAnalysis.volatility}</span>
                                    </div>
                                    {plan.scenarios.length === 0 ? (
                                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                                            <p className="text-xs text-amber-200">
                                                ノートレード判断: このプランには実行シナリオがありません。
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {plan.scenarios.map((scenario) => (
                                                <div
                                                    key={scenario.id}
                                                    className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2"
                                                >
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <p className="text-xs font-medium text-white">
                                                            {scenario.name}{" "}
                                                            <span className="text-gray-500">
                                                                ({directionLabel[scenario.direction]} / 信頼度 {formatPercent(scenario.confidence)})
                                                            </span>
                                                        </p>
                                                        <p className="text-[11px] text-gray-500">
                                                            RR {formatNumber(scenario.riskReward, 2)}
                                                        </p>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                                                        <div>
                                                            <p className="text-gray-500">Entry</p>
                                                            <p className="text-gray-200">{formatNumber(scenario.entry.price, 2)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-gray-500">SL</p>
                                                            <p className="text-rose-300">{formatNumber(scenario.stopLoss.price, 2)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-gray-500">TP</p>
                                                            <p className="text-emerald-300">{formatNumber(scenario.takeProfit.price, 2)}</p>
                                                        </div>
                                                    </div>
                                                    <p className="text-[11px] text-gray-500 mt-2 line-clamp-2">
                                                        {scenario.rationale}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {plan.warnings.length > 0 && (
                                        <p className="text-[11px] text-amber-300 mt-2">
                                            警告: {plan.warnings.slice(0, 2).join(" / ")}
                                        </p>
                                    )}
                                </article>
                            ))
                        )}
                    </div>
                </div>

                {/* Orchestrator 意思決定履歴 */}
                <div className="card-surface rounded-xl overflow-hidden mb-6">
                    <div className="px-4 py-3 border-b border-slate-700/50">
                        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                            <span>🤖</span> Orchestrator 意思決定履歴 (直近10件)
                        </h2>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                            最上位のオーケストレーターが「次に回すループ」を LLM 判断した履歴です。
                        </p>
                    </div>
                    <div className="px-4 py-3 space-y-3">
                        {orchestratorRuns.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-6">意思決定履歴がありません</p>
                        ) : (
                            orchestratorRuns.map((run) => {
                                const isSelected = selectedRunId === run.id;
                                const statusColors: Record<string, string> = {
                                    succeeded: "text-green-400 bg-green-500/20",
                                    failed: "text-red-400 bg-red-500/20",
                                    running: "text-blue-400 bg-blue-500/20 animate-pulse",
                                    pending: "text-gray-400 bg-gray-500/20",
                                    cancelled: "text-yellow-400 bg-yellow-500/20",
                                };
                                return (
                                    <div
                                        key={run.id}
                                        className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[run.status] || "text-gray-400 bg-gray-500/20"}`}>
                                                    {run.status.toUpperCase()}
                                                </span>
                                                <span className="text-sm font-semibold text-white font-mono">
                                                    {run.kind}
                                                </span>
                                            </div>
                                            <span className="text-[10px] text-gray-500 font-mono">
                                                {new Date(run.startedAt).toLocaleString("ja-JP")}
                                            </span>
                                        </div>
                                        {run.summary && (
                                            <p className="text-xs text-gray-300 mb-2 whitespace-pre-wrap font-sans">
                                                {run.summary}
                                            </p>
                                        )}
                                        {run.errorMessage && (
                                            <p className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded p-2 mb-2 font-mono">
                                                エラー: {run.errorMessage}
                                            </p>
                                        )}
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-gray-500">
                                                Trigger: {run.triggeredBy}
                                            </span>
                                            <button
                                                onClick={() => fetchRunDetail(run.id)}
                                                className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                                            >
                                                {isSelected ? "詳細を閉じる ▲" : "ステップ詳細を表示 ▼"}
                                            </button>
                                        </div>

                                        {/* アコーディオンの中身 */}
                                        {isSelected && (
                                            <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2">
                                                {isDetailLoading ? (
                                                    <div className="flex items-center justify-center py-4">
                                                        <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                                                    </div>
                                                ) : selectedRunDetail && selectedRunDetail.steps.length === 0 ? (
                                                    <p className="text-xs text-gray-500 text-center py-2">実行されたステップはありません</p>
                                                ) : selectedRunDetail ? (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">実行ステップ一覧</p>
                                                        {selectedRunDetail.steps.map((step) => (
                                                            <div
                                                                key={step.id}
                                                                className="text-xs rounded-lg border border-slate-800 bg-slate-900/50 p-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                                            >
                                                                <div>
                                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                                        <span className="font-semibold text-white">{step.stepName}</span>
                                                                        <span className="text-[10px] text-gray-500">(Attempt #{step.attempt})</span>
                                                                        <span className={`px-1 rounded text-[10px] ${
                                                                            step.status === "succeeded" ? "text-green-400 bg-green-950/20" :
                                                                            step.status === "failed" ? "text-red-400 bg-red-950/20" : "text-gray-400 bg-slate-800"
                                                                        }`}>
                                                                            {step.status}
                                                                        </span>
                                                                    </div>
                                                                    {step.summary && <p className="text-[11px] text-gray-400 mt-1 font-mono">{step.summary}</p>}
                                                                    {step.errorMessage && <p className="text-[10px] text-red-400 mt-0.5 font-mono">Error: {step.errorMessage}</p>}
                                                                </div>
                                                                <div className="text-right shrink-0">
                                                                    {step.durationMs !== null && (
                                                                        <p className="text-[10px] text-gray-500 font-mono">{(step.durationMs / 1000).toFixed(2)}s</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* 仮説検証の見える化 */}
                {validationVisibility && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                        <Link
                            href="/side-b/validation"
                            className="card-surface rounded-xl p-4 border border-slate-700/50 hover:border-purple-500/40 transition-colors"
                        >
                            <p className="text-xs text-gray-500">本格検証待ち</p>
                            <p className="text-2xl font-bold text-amber-300">{validationVisibility.pendingCount}</p>
                            <p className="text-[11px] text-gray-500 mt-1">screening_passed の仮説</p>
                        </Link>
                        <Link
                            href="/side-b/validation"
                            className="card-surface rounded-xl p-4 border border-slate-700/50 hover:border-purple-500/40 transition-colors"
                        >
                            <p className="text-xs text-gray-500">直近24hの検証完了</p>
                            <p className="text-2xl font-bold text-cyan-300">{validationVisibility.recentlyValidatedCount}</p>
                            <p className="text-[11px] text-gray-500 mt-1">confirmed / rejected</p>
                        </Link>
                    </div>
                )}

                {/* 学び一覧（シンボル別） */}
                {lessonsData && (lessonsData.totalConsolidated > 0 || lessonsData.totalEntries > 0) && (
                    <div className="card-surface rounded-xl overflow-hidden mb-6">
                        <div className="px-4 py-3 border-b border-slate-700/50">
                            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                <span>💡</span> AI の学び (📌{lessonsData.totalConsolidated} / 📝{lessonsData.totalEntries})
                            </h2>
                        </div>
                        <div className="px-4 py-3 space-y-4 max-h-80 overflow-y-auto">
                            {Object.entries(lessonsData.lessonsBySymbol).map(([symbol, sl]) => (
                                <div key={symbol}>
                                    <p className="text-xs font-bold text-purple-400 mb-2">{symbol}</p>
                                    {/* 確信ルール */}
                                    {sl.consolidated.map((c, idx) => (
                                        <div
                                            key={`c-${idx}`}
                                            className="flex items-start gap-2 px-3 py-2 mb-1 rounded-lg bg-amber-500/10 border border-amber-500/20"
                                        >
                                            <span className="text-amber-400 text-xs mt-0.5 shrink-0">📌</span>
                                            <div>
                                                <p className="text-xs text-amber-200 font-medium">{c.text}</p>
                                                <p className="text-[10px] text-gray-500">{c.count}回確認</p>
                                            </div>
                                        </div>
                                    ))}
                                    {/* 通常の学び */}
                                    {sl.entries.slice(-5).map((e, idx) => (
                                        <div
                                            key={`e-${idx}`}
                                            className="flex items-start gap-2 px-3 py-2 mb-1 rounded-lg bg-cyan-500/5 border border-cyan-500/10"
                                        >
                                            <span className="text-cyan-400 text-xs mt-0.5 shrink-0">📝</span>
                                            <p className="text-xs text-gray-300">{e.text}</p>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 全思考ログ */}
                <div className="card-surface rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
                        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                            <span>🧠</span> 思考ログ ({thinkingLog.length})
                        </h2>
                        <div className="flex items-center gap-2">
                            <select
                                value={logLimit}
                                onChange={(e) => setLogLimit(Number(e.target.value))}
                                className="bg-slate-700 text-xs text-gray-300 rounded px-2 py-1 border-0"
                            >
                                <option value={20}>20件</option>
                                <option value={50}>50件</option>
                                <option value={100}>100件</option>
                            </select>
                            <button
                                onClick={fetchData}
                                className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                            >
                                更新
                            </button>
                        </div>
                    </div>
                    <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-700/30">
                        {thinkingLog.length === 0 ? (
                            <div className="px-4 py-12 text-center">
                                <p className="text-sm text-gray-500">思考ログがありません</p>
                            </div>
                        ) : (
                            thinkingLog.map((entry, idx) => {
                                const colorClass = stateColors[entry.state] || "text-gray-400 bg-gray-500/20";
                                return (
                                    <div key={idx} className="px-4 py-3 hover:bg-slate-700/20 transition-colors">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${colorClass}`}>
                                                {entry.state}
                                            </span>
                                            <span className="text-[10px] text-gray-500 font-mono">
                                                #{entry.cycle} •{" "}
                                                {new Date(entry.timestamp).toLocaleString("ja-JP", {
                                                    month: "2-digit",
                                                    day: "2-digit",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                    second: "2-digit",
                                                })}
                                            </span>
                                        </div>
                                        <p className="text-sm text-white font-medium">{entry.action}</p>
                                        {entry.reasoning && (
                                            <p className="text-xs text-gray-400 mt-1">{entry.reasoning}</p>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
