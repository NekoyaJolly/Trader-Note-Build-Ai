/**
 * PlanEvidenceCard — 1 件の AITradePlan を「根拠」込みで描画する共通コンポーネント。
 *
 * 設計意図 (根拠サーフェシング):
 *   - プラン本体 (市場分析 summary / シナリオ / 信頼度) は常時表示。
 *   - 深い根拠 (採用/不採用指標・SL/TP 根拠・無効化条件・過学習防御・強気弱気の討論・
 *     テクニカル統合解釈) は `<details>` で折りたたみ、開くと段階的に展開する。
 *   - プラン詳細 (旧 /side-b/agent) と運転席 (/side-b) で同じ描画を共有するため共通化
 *     (重複排除)。
 */

"use client";

import { formatPercent } from "@/lib/format";
import type { AITradePlanPayload } from "@/types/sideB";

const directionLabel: Record<"long" | "short", string> = {
    long: "ロング",
    short: "ショート",
};

function fmtNum(value: number | null | undefined, digits = 2): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    return value.toLocaleString("ja-JP", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function fmtDate(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export interface PlanEvidenceCardProps {
    plan: AITradePlanPayload;
    className?: string;
}

export function PlanEvidenceCard({ plan, className }: PlanEvidenceCardProps) {
    const ma = plan.marketAnalysis;
    return (
        <article className={`rounded-xl border border-slate-700/60 bg-slate-900/30 p-3 ${className ?? ""}`}>
            {/* ヘッダー: 銘柄 / 日付 / 全体信頼度 */}
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div>
                    <p className="text-sm font-semibold text-white">
                        {plan.symbol} / {fmtDate(plan.targetDate)}
                    </p>
                    <p className="text-[11px] text-gray-500 font-mono">{plan.id}</p>
                </div>
                <div className="text-right">
                    <p className="text-xs text-gray-500">全体信頼度</p>
                    <p className="text-sm font-semibold text-cyan-300">{formatPercent(plan.overallConfidence)}</p>
                </div>
            </div>

            {/* 市場分析 */}
            <p className="text-xs text-gray-300 mb-2">{ma.summary}</p>
            <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-3">
                <span>regime: {ma.regime}</span>
                <span>trend: {ma.trendDirection}</span>
                <span>vol: {ma.volatility}</span>
            </div>
            {ma.additionalInsights && ma.additionalInsights.length > 0 && (
                <ul className="list-disc list-inside text-[11px] text-gray-400 mb-2 space-y-0.5">
                    {ma.additionalInsights.map((insight, i) => (
                        <li key={i}>{insight}</li>
                    ))}
                </ul>
            )}
            {ma.macroAssessment && (
                <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2 mb-2">
                    <p className="text-[11px] text-indigo-300 mb-1">マクロ環境</p>
                    <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-1">
                        <span>センチメント: {ma.macroAssessment.riskSentiment}</span>
                        <span>vol: {ma.macroAssessment.volatilityRegime}</span>
                        <span>金利: {ma.macroAssessment.yieldCurveSignal}</span>
                    </div>
                    <p className="text-[11px] text-gray-300">{ma.macroAssessment.macroSummary}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                        <span className="text-gray-500">トレード影響: </span>
                        {ma.macroAssessment.tradingImpact}
                    </p>
                </div>
            )}
            {ma.mtfAnalysis && (
                <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2 mb-2">
                    <p className="text-[11px] text-sky-300 mb-1">上位足分析 ({ma.mtfAnalysis.higherTFTimeframe})</p>
                    <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-1">
                        <span>バイアス: {ma.mtfAnalysis.higherTFBias}</span>
                        <span>整合性: {ma.mtfAnalysis.alignment}</span>
                    </div>
                    <p className="text-[11px] text-gray-300">{ma.mtfAnalysis.note}</p>
                </div>
            )}

            {/* シナリオ */}
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
                                <p className="text-[11px] text-gray-500">RR {fmtNum(scenario.riskReward, 2)}</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                                <div>
                                    <p className="text-gray-500">Entry</p>
                                    <p className="text-gray-200">{fmtNum(scenario.entry.price, 2)}</p>
                                </div>
                                <div>
                                    <p className="text-gray-500">SL</p>
                                    <p className="text-rose-300">{fmtNum(scenario.stopLoss.price, 2)}</p>
                                </div>
                                <div>
                                    <p className="text-gray-500">TP</p>
                                    <p className="text-emerald-300">{fmtNum(scenario.takeProfit.price, 2)}</p>
                                </div>
                            </div>
                            {scenario.patternLabel && (
                                <p className="text-[11px] text-purple-300 mt-2">パターン: {scenario.patternLabel}</p>
                            )}
                            <p className="text-[11px] text-gray-400 mt-2">{scenario.rationale}</p>
                            {scenario.reasonForSelection && (
                                <p className="text-[11px] text-emerald-300/90 mt-1">
                                    <span className="text-gray-500">採用理由: </span>
                                    {scenario.reasonForSelection}
                                </p>
                            )}
                            {/* 深い根拠は折りたたみ (一覧のスキャン性を保ちつつ「なぜ」を辿れるように) */}
                            <details className="mt-2">
                                <summary className="text-[11px] text-cyan-400 cursor-pointer select-none">
                                    詳しい根拠を見る
                                </summary>
                                <div className="mt-2 space-y-1.5 border-l-2 border-slate-700/60 pl-2.5">
                                    {scenario.entry.condition && (
                                        <p className="text-[11px] text-gray-400">
                                            <span className="text-gray-500">エントリー条件: </span>
                                            {scenario.entry.condition}
                                        </p>
                                    )}
                                    {scenario.stopLoss.reason && (
                                        <p className="text-[11px] text-gray-400">
                                            <span className="text-gray-500">SL 根拠: </span>
                                            {scenario.stopLoss.reason}
                                        </p>
                                    )}
                                    {scenario.takeProfit.reason && (
                                        <p className="text-[11px] text-gray-400">
                                            <span className="text-gray-500">TP 根拠: </span>
                                            {scenario.takeProfit.reason}
                                        </p>
                                    )}
                                    {scenario.indicatorsUsed && scenario.indicatorsUsed.length > 0 && (
                                        <p className="text-[11px] text-gray-400">
                                            <span className="text-gray-500">採用指標: </span>
                                            {scenario.indicatorsUsed.join(", ")}
                                        </p>
                                    )}
                                    {scenario.indicatorsIgnored && scenario.indicatorsIgnored.length > 0 && (
                                        <p className="text-[11px] text-gray-400">
                                            <span className="text-gray-500">不採用指標: </span>
                                            {scenario.indicatorsIgnored.join(", ")}
                                        </p>
                                    )}
                                    {scenario.reasonForIgnoring && (
                                        <p className="text-[11px] text-gray-400">
                                            <span className="text-gray-500">不採用理由: </span>
                                            {scenario.reasonForIgnoring}
                                        </p>
                                    )}
                                    {scenario.invalidationConditions.length > 0 && (
                                        <div className="text-[11px] text-gray-400">
                                            <span className="text-gray-500">無効化条件:</span>
                                            <ul className="list-disc list-inside">
                                                {scenario.invalidationConditions.map((c, i) => (
                                                    <li key={i}>{c}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {scenario.multipleTestingDefense && (
                                        <p className="text-[11px] text-gray-400">
                                            <span className="text-gray-500">過学習でない根拠: </span>
                                            {scenario.multipleTestingDefense}
                                        </p>
                                    )}
                                    {scenario.warnings && scenario.warnings.length > 0 && (
                                        <p className="text-[11px] text-amber-300/90">
                                            <span className="text-gray-500">警告: </span>
                                            {scenario.warnings.join(" / ")}
                                        </p>
                                    )}
                                </div>
                            </details>
                        </div>
                    ))}
                </div>
            )}

            {/* 強気 vs 弱気の討論 (P0-a で永続化) */}
            {plan.debate && (
                <details className="mt-3">
                    <summary className="text-[11px] text-fuchsia-300 cursor-pointer select-none">
                        🐂 強気 vs 🐻 弱気の討論 (優勢: {plan.debate.synthesis.preferredDirection} / 確信度 {formatPercent(plan.debate.synthesis.preferredConfidence)})
                    </summary>
                    <div className="mt-2 space-y-2 border-l-2 border-fuchsia-500/30 pl-2.5">
                        <p className="text-[11px] text-gray-300">{plan.debate.synthesis.reasoning}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                                <p className="text-[11px] text-emerald-300 mb-1">
                                    🐂 強気 (確信度 {formatPercent(plan.debate.bull.confidence)})
                                </p>
                                <p className="text-[11px] text-gray-300">{plan.debate.bull.scenario}</p>
                                {plan.debate.bull.rationale.length > 0 && (
                                    <ul className="list-disc list-inside text-[11px] text-gray-400 mt-1">
                                        {plan.debate.bull.rationale.map((r, i) => (
                                            <li key={i}>{r}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-2">
                                <p className="text-[11px] text-rose-300 mb-1">
                                    🐻 弱気 (確信度 {formatPercent(plan.debate.bear.confidence)})
                                </p>
                                <p className="text-[11px] text-gray-300">{plan.debate.bear.scenario}</p>
                                {plan.debate.bear.rationale.length > 0 && (
                                    <ul className="list-disc list-inside text-[11px] text-gray-400 mt-1">
                                        {plan.debate.bear.rationale.map((r, i) => (
                                            <li key={i}>{r}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                        {plan.debate.synthesis.actionableInsight && (
                            <p className="text-[11px] text-cyan-300/90">
                                <span className="text-gray-500">結論: </span>
                                {plan.debate.synthesis.actionableInsight}
                            </p>
                        )}
                    </div>
                </details>
            )}

            {/* テクニカル統合解釈 (P0-a で永続化) */}
            {plan.indicatorAnalysis && (
                <details className="mt-2">
                    <summary className="text-[11px] text-amber-300 cursor-pointer select-none">
                        📊 テクニカル統合解釈 (確信度 {formatPercent(plan.indicatorAnalysis.confidence)})
                    </summary>
                    <div className="mt-2 space-y-1.5 border-l-2 border-amber-500/30 pl-2.5">
                        <p className="text-[11px] text-gray-300">{plan.indicatorAnalysis.interpretation}</p>
                        <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
                            <span>トレンド: {plan.indicatorAnalysis.current.trendState}</span>
                            <span>モメンタム: {plan.indicatorAnalysis.current.momentum}</span>
                            <span>MTF整合: {plan.indicatorAnalysis.mtfAlignment.trendAlignment}</span>
                        </div>
                    </div>
                </details>
            )}

            {plan.warnings.length > 0 && (
                <p className="text-[11px] text-amber-300 mt-2">警告: {plan.warnings.slice(0, 2).join(" / ")}</p>
            )}
        </article>
    );
}
