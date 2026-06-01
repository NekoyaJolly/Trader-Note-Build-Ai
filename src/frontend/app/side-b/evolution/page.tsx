"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { sideBApi } from "@/lib/sideBApi";
import type {
  DslJsonValue,
  EvolutionDslSnapshot,
  EvolutionLesson,
  EvolutionRunCandidate,
  EvolutionRunListItem,
  EvolutionRunSummary,
} from "@/types/sideB";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Loader2 } from "lucide-react";

// ===== 進化詳細(before→action→after)表示ヘルパー =====

// 生成元(createdBy)を日本語の操作ラベルに（StrategyDSLSchema.metadata.createdBy の実値に合わせる）。
function actionLabel(createdBy?: string | null): string {
  switch (createdBy) {
    case "mutation":
      return "変異 (mutation: パラメータ最適化)";
    case "crossover":
      return "交叉 (crossover: インジ/フィルタ追加)";
    case "initial_random":
      return "初期個体 (ランダム生成)";
    case "llm_generated":
      return "初期個体 (LLM 生成)";
    default:
      return createdBy ? `生成元: ${createdBy}` : "生成元: 不明";
  }
}

// JSON 値（数値 / ParamRef 文字列 / range・structured オブジェクト）を安全に文字列化する。
function formatDslValue(v: DslJsonValue | undefined): string {
  if (v === undefined || v === null) return "?";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// SL/TP 仕様を短い文字列に。value は ParamRef 文字列やオブジェクトになり得る。
function riskSpecText(spec?: { type?: string; value?: DslJsonValue; lookbackBars?: DslJsonValue } | null): string {
  if (!spec || !spec.type) return "-";
  if (spec.type === "swing_point") return `swing_point(${formatDslValue(spec.lookbackBars)}本)`;
  return `${spec.type}(${formatDslValue(spec.value)})`;
}

// DSL の主要構造を「キー: 値」の比較しやすい形へ。
function describeDsl(dsl?: EvolutionDslSnapshot | null): Record<string, string> {
  if (!dsl) return {};
  const out: Record<string, string> = {
    entry: dsl.entry?.kind ?? "-",
    stopLoss: riskSpecText(dsl.stopLoss),
    takeProfit: riskSpecText(dsl.takeProfit),
  };
  if (dsl.parameters) {
    for (const [k, v] of Object.entries(dsl.parameters)) {
      out[`param.${k}`] = formatDslValue(v);
    }
  }
  return out;
}

// 親と子の構造差分（変化したキーだけ）を返す。
function diffDsl(
  parent: EvolutionDslSnapshot | null | undefined,
  child: EvolutionDslSnapshot | null | undefined,
): Array<{ key: string; before: string; after: string }> {
  const p = describeDsl(parent);
  const c = describeDsl(child);
  const keys = Array.from(new Set([...Object.keys(p), ...Object.keys(c)])).sort();
  const changed: Array<{ key: string; before: string; after: string }> = [];
  for (const k of keys) {
    const before = p[k] ?? "-";
    const after = c[k] ?? "-";
    if (before !== after) changed.push({ key: k, before, after });
  }
  return changed;
}

export default function EvolutionPage() {
  const [activeTab, setActiveTab] = useState<"runs" | "lessons">("runs");
  const [lessons, setLessons] = useState<EvolutionLesson[]>([]);
  const [runs, setRuns] = useState<EvolutionRunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<EvolutionRunSummary | null>(null);
  const [runCandidates, setRunCandidates] = useState<EvolutionRunCandidate[]>([]);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === "runs") {
        const res = await sideBApi.getEvolutionRuns({ limit: 20 });
        if (res.runs) setRuns(res.runs);
      } else {
        const res = await sideBApi.getEvolutionLessons({ limit: 50 });
        if (res.lessons) setLessons(res.lessons);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const fetchRunDetails = useCallback(async (runId: string) => {
    setLoading(true);
    try {
      const [summaryRes, candidatesRes] = await Promise.all([
        sideBApi.getEvolutionRunSummary(runId),
        sideBApi.getEvolutionRunCandidates(runId),
      ]);
      if (summaryRes.summary) setRunSummary(summaryRes.summary);
      if (candidatesRes.candidates) setRunCandidates(candidatesRes.candidates);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (selectedRunId) {
      void fetchRunDetails(selectedRunId);
    }
  }, [selectedRunId, fetchRunDetails]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">進化</h1>
          <p className="text-muted-foreground mt-1">
            AIが自律的に実行したバックテスト結果と、世代ごとの学習の軌跡を確認します。
          </p>
        </div>
      </div>

      <div className="flex gap-4 border-b pb-2">
        <Button
          variant={activeTab === "runs" ? "default" : "outline"}
          onClick={() => setActiveTab("runs")}
        >
          進化ループ履歴
        </Button>
        <Button
          variant={activeTab === "lessons" ? "default" : "outline"}
          onClick={() => setActiveTab("lessons")}
        >
          世代ごとの学び
        </Button>
      </div>

      {loading && !selectedRunId && (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}

      {activeTab === "lessons" && !loading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {lessons.length === 0 ? (
            <div className="col-span-full p-8 text-center text-muted-foreground border border-dashed rounded-lg">
              学習メモがまだありません
            </div>
          ) : (
            lessons.map((lesson) => (
              <Card key={lesson.id} className="overflow-hidden">
                <CardHeader className="pb-2 bg-muted/30">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full">
                        {lesson.category}
                      </span>
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">Gen {lesson.generation}</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <p className="text-sm">{lesson.lesson}</p>
                  {/* 根拠の可視化: confidence(信頼度) と metrics(親勝率→子勝率 / lift / dsr 等) */}
                  {(typeof lesson.confidence === "number" ||
                    (lesson.metrics && Object.keys(lesson.metrics).length > 0)) && (
                    <div className="mt-3 pt-3 border-t border-dashed space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">根拠</div>
                      {typeof lesson.confidence === "number" && (() => {
                        // 数値表示とバー幅を同じクランプ結果で整合させる（範囲外データの 150% 等を防ぐ）。
                        const clamped = Math.max(0, Math.min(1, lesson.confidence));
                        return (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">信頼度</span>
                            <span className="font-mono">{(clamped * 100).toFixed(0)}%</span>
                            <span className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                              <span className="block h-full bg-primary" style={{ width: `${clamped * 100}%` }} />
                            </span>
                          </div>
                        );
                      })()}
                      {lesson.metrics && Object.keys(lesson.metrics).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(lesson.metrics).map(([k, v]) => (
                            <span key={k} className="text-[11px] px-1.5 py-0.5 bg-muted rounded font-mono">
                              {k}: {typeof v === "number" ? v.toFixed(3) : String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
                    <span>Regime: {lesson.regime}</span>
                    <span>{new Date(lesson.recordedAt).toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === "runs" && !loading && !selectedRunId && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {runs.length === 0 ? (
            <div className="col-span-full p-8 text-center text-muted-foreground border border-dashed rounded-lg">
              進化ループ履歴がまだありません
            </div>
          ) : (
            runs.map((run) => (
              <Card 
                key={run.evolutionRunId} 
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setSelectedRunId(run.evolutionRunId)}
              >
                <CardHeader className="pb-2 bg-muted/30">
                  <CardTitle className="text-sm font-medium truncate" title={run.evolutionRunId}>
                    Run: {run.evolutionRunId.split('-')[0]}...
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">
                    Started: {new Date(run.createdAt).toLocaleString()}
                  </p>
                  <div className="mt-4">
                    <Button variant="secondary" className="w-full" size="sm">詳細を見る</Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === "runs" && selectedRunId && (
        <div className="space-y-6">
          <Button variant="outline" onClick={() => setSelectedRunId(null)}>
            &larr; 一覧に戻る
          </Button>

          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {runSummary && (
                <Card>
                  <CardHeader>
                    <CardTitle>サマリー (Run ID: {selectedRunId})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="p-4 border rounded bg-muted/20">
                        <div className="text-xs text-muted-foreground mb-1">評価された候補数</div>
                        <div className="text-2xl font-bold">{runSummary.totalCandidates}</div>
                      </div>
                      <div className="p-4 border rounded bg-green-500/10">
                        <div className="text-xs text-green-600 dark:text-green-400 mb-1">合格 (Passed)</div>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">{runSummary.passed}</div>
                      </div>
                      <div className="p-4 border rounded bg-red-500/10">
                        <div className="text-xs text-red-600 dark:text-red-400 mb-1">不合格 (Failed)</div>
                        <div className="text-2xl font-bold text-red-600 dark:text-red-400">{runSummary.failed}</div>
                      </div>
                      <div className="p-4 border rounded bg-muted/20">
                        <div className="text-xs text-muted-foreground mb-1">通過率</div>
                        <div className="text-2xl font-bold">
                          {runSummary.totalCandidates > 0 
                            ? ((runSummary.passed / runSummary.totalCandidates) * 100).toFixed(1)
                            : 0}%
                        </div>
                      </div>
                    </div>
                    
                    {Object.keys(runSummary.failureReasonCounts).length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">不合格理由の分布</h4>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(runSummary.failureReasonCounts).map(([reason, count]) => (
                            <span key={reason} className="text-xs px-2 py-1 bg-secondary rounded-md">
                              {reason}: {count as number}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>評価された候補一覧</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="p-2 font-medium w-6"></th>
                          <th className="p-2 font-medium">Generation</th>
                          <th className="p-2 font-medium">Candidate Hash</th>
                          <th className="p-2 font-medium">Surrogate Score</th>
                          <th className="p-2 font-medium">Status</th>
                          <th className="p-2 font-medium" title="in-sample合格に加えOOS/WFも通過したか">確証(OOS)</th>
                          <th className="p-2 font-medium">PF</th>
                          <th className="p-2 font-medium">Win Rate</th>
                          <th className="p-2 font-medium">Trades</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runCandidates.map((cand) => {
                          const metrics = cand.formalBtMetrics || {};
                          const oos = cand.oosResult;
                          const isOpen = expandedCandidateId === cand.id;
                          const toggle = () => setExpandedCandidateId(isOpen ? null : cand.id);
                          // 親の突き合わせ（find）は展開時のみ実行する（全行で走らせない）。
                          const parents = isOpen
                            ? (cand.dslSnapshot?.parentIds ?? [])
                                .map((pid) =>
                                  runCandidates.find((c) => (c.candidateId ?? c.dslSnapshot?.id) === pid),
                                )
                                .filter((p): p is EvolutionRunCandidate => Boolean(p))
                            : [];
                          const parentIds = cand.dslSnapshot?.parentIds ?? [];
                          return (
                            <Fragment key={cand.id}>
                            <tr
                              className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                              role="button"
                              tabIndex={0}
                              aria-expanded={isOpen}
                              onClick={toggle}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggle();
                                }
                              }}
                            >
                              <td className="p-2 text-center text-muted-foreground">{isOpen ? "▼" : "▶"}</td>
                              <td className="p-2 text-center">{cand.generation}</td>
                              <td className="p-2 font-mono text-xs text-muted-foreground" title={cand.candidateHash}>
                                {cand.candidateHash.substring(0, 8)}...
                              </td>
                              <td className="p-2">{cand.surrogateScore.toFixed(3)}</td>
                              <td className="p-2">
                                {cand.formalBtPassed ? (
                                  <span className="text-green-500 font-medium">Passed</span>
                                ) : (
                                  <span className="text-red-500 text-xs" title={cand.formalBtFailureReason ?? undefined}>
                                    Failed
                                  </span>
                                )}
                              </td>
                              <td className="p-2">
                                {!oos ? (
                                  <span className="text-xs text-muted-foreground" title="OOS未評価">—</span>
                                ) : oos.confirmed ? (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400 font-medium" title={oos.oosStatus ?? undefined}>
                                    ✅ 確証
                                  </span>
                                ) : (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400" title={oos.oosStatus ?? undefined}>
                                    未確証
                                  </span>
                                )}
                              </td>
                              <td className="p-2">{metrics.pf != null ? metrics.pf.toFixed(2) : '-'}</td>
                              <td className="p-2">{metrics.winRate != null ? (metrics.winRate * 100).toFixed(1) + '%' : '-'}</td>
                              <td className="p-2">{metrics.tradeCount != null ? metrics.tradeCount : '-'}</td>
                            </tr>
                            {isOpen && (
                              <tr className="border-b last:border-0 bg-muted/20">
                                <td colSpan={9} className="p-4">
                                  <div className="space-y-4 text-xs">
                                    {/* 由来(action) */}
                                    <div>
                                      <div className="font-medium mb-1">由来</div>
                                      <div className="text-muted-foreground">
                                        {actionLabel(cand.dslSnapshot?.metadata?.createdBy)}
                                        {parentIds.length > 0 && (
                                          <span className="ml-2 font-mono">親: {parentIds.map((p) => p.substring(0, 8)).join(", ")}</span>
                                        )}
                                      </div>
                                    </div>
                                    {/* before → after 差分（crossover は親が2件になり得るため親ごとに表示） */}
                                    <div>
                                      <div className="font-medium mb-1">親 → (操作) → 子 の差分</div>
                                      {parents.length === 0 ? (
                                        <div className="text-muted-foreground">
                                          {parentIds.length === 0
                                            ? "初期個体のため親なし。"
                                            : "親候補がこの実行の一覧に含まれていないため差分は表示できません（親ID のみ上記参照）。"}
                                        </div>
                                      ) : (
                                        <div className="space-y-3">
                                          {parents.map((parent, pi) => {
                                            const changes = diffDsl(parent.dslSnapshot, cand.dslSnapshot);
                                            const parentLabel =
                                              parents.length > 1 ? `親${pi + 1} (` : "親 (";
                                            const parentId = (parent.candidateId ?? parent.dslSnapshot?.id ?? "").substring(0, 8);
                                            return (
                                              <div key={parent.id}>
                                                {parents.length > 1 && (
                                                  <div className="text-muted-foreground mb-1 font-mono">
                                                    {parentLabel}{parentId}) との差分
                                                  </div>
                                                )}
                                                {changes.length === 0 ? (
                                                  <div className="text-muted-foreground">構造的な差分は検出されませんでした（パラメータ範囲外の変化の可能性）。</div>
                                                ) : (
                                                  <table className="w-full border-collapse">
                                                    <thead>
                                                      <tr className="text-muted-foreground">
                                                        <th className="text-left p-1 font-medium">項目</th>
                                                        <th className="text-left p-1 font-medium">親 (before)</th>
                                                        <th className="text-left p-1 font-medium">子 (after)</th>
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {changes.map((ch) => (
                                                        <tr key={ch.key} className="border-t border-dashed">
                                                          <td className="p-1 font-mono">{ch.key}</td>
                                                          <td className="p-1 font-mono text-muted-foreground">{ch.before}</td>
                                                          <td className="p-1 font-mono text-foreground">{ch.after}</td>
                                                        </tr>
                                                      ))}
                                                    </tbody>
                                                  </table>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                    {/* OOS確証 詳細 */}
                                    <div>
                                      <div className="font-medium mb-1">OOS / WF 検証</div>
                                      {!oos ? (
                                        <div className="text-muted-foreground">OOS未評価。</div>
                                      ) : (
                                        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                                          <span>状態: {oos.confirmed ? "✅ OOS確証" : "未確証"}</span>
                                          <span>verdict: {oos.oosStatus ?? "-"}</span>
                                          <span>OOS PF: {oos.oosPf != null ? oos.oosPf.toFixed(2) : "-"}</span>
                                          <span>OOS 勝率: {oos.oosWinRate != null ? (oos.oosWinRate * 100).toFixed(1) + "%" : "-"}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
