"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { sideBApi } from "@/lib/sideBApi";
import type {
  DslConditionGroup,
  DslConditionLeaf,
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

// run 一覧で既定表示する最新件数（過去はトグルで展開）。
const RECENT_RUNS_COUNT = 3;

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

// SL/TP 仕様を平易な文字列に。value は ParamRef 文字列やオブジェクトになり得る。
function riskSpecText(spec?: { type?: string; value?: DslJsonValue; lookbackBars?: DslJsonValue } | null): string {
  if (!spec || !spec.type) return "-";
  switch (spec.type) {
    case "atr_multiple":
      return `ATR × ${formatDslValue(spec.value)}`;
    case "fixed_pips":
      return `固定 ${formatDslValue(spec.value)} pips`;
    case "rr_ratio":
      return `リスクリワード 1 : ${formatDslValue(spec.value)}`;
    case "swing_point":
      return `直近スイング（${formatDslValue(spec.lookbackBars)}本）`;
    default:
      return `${spec.type}(${formatDslValue(spec.value)})`;
  }
}

const DIRECTION_LABEL: Record<string, string> = { long: "ロング（買い）", short: "ショート（売り）" };

// 比較演算子を日本語に。
function opLabel(op: string): string {
  const m: Record<string, string> = {
    "<": "<", "<=": "≤", ">": ">", ">=": "≥", "==": "=", "!=": "≠",
    cross_above: "を上抜け", cross_below: "を下抜け",
    between: "が範囲内", in: "がいずれか",
    touch_close: "に終値タッチ", touch_wick: "にヒゲタッチ",
    is_true: "が成立", is_false: "が不成立",
  };
  return m[op] ?? op;
}

// インジ参照を短く（例: ema(20) / rsi）。
function operandLabel(feature: string, params?: Record<string, DslJsonValue> | null): string {
  const period = params && params.period != null ? `(${formatDslValue(params.period)})` : "";
  return `${feature}${period}`;
}

// 条件 leaf を平易な1行に（例: rsi < 30 / ema(20) を上抜け ema(50)）。
function formatConditionLeaf(c: DslConditionLeaf): string {
  const left = operandLabel(c.feature, c.params);
  if (c.op === "is_true" || c.op === "is_false") return `${left}${opLabel(c.op)}`;
  const right = c.compareTarget
    ? operandLabel(c.compareTarget.feature, c.compareTarget.params)
    : formatDslValue(c.value);
  return `${left} ${opLabel(c.op)} ${right}`;
}

// 条件グループ（AND/OR 再帰）を平易な文に。
function conditionGroupToText(g?: DslConditionGroup | null): string {
  if (!g || !Array.isArray(g.conditions) || g.conditions.length === 0) return "（条件なし）";
  const join = g.logic === "AND" ? " かつ " : " または ";
  return g.conditions
    .map((c) => ("logic" in c ? `(${conditionGroupToText(c)})` : formatConditionLeaf(c)))
    .join(join);
}

// エントリーの条件グループを取り出す（immediate=trigger / wait_for_trigger=triggerConditions）。
function entryConditionGroup(entry?: EvolutionDslSnapshot["entry"]): DslConditionGroup | null {
  if (!entry) return null;
  return entry.trigger ?? entry.triggerConditions ?? null;
}

// DSL の主要構造を「キー: 値」の比較しやすい形へ（差分用）。
function describeDsl(dsl?: EvolutionDslSnapshot | null): Record<string, string> {
  if (!dsl) return {};
  const out: Record<string, string> = {
    方向: dsl.entry?.direction ? DIRECTION_LABEL[dsl.entry.direction] ?? dsl.entry.direction : "-",
    エントリー条件: conditionGroupToText(entryConditionGroup(dsl.entry)),
    損切り: riskSpecText(dsl.stopLoss),
    利確: riskSpecText(dsl.takeProfit),
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
  // 既定は最新数件のみ表示し、過去 run はトグルで展開（履歴は消さず非破壊で畳む）。
  const [showAllRuns, setShowAllRuns] = useState(false);
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
        <>
          {runs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg">
              進化ループ履歴がまだありません
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {(showAllRuns ? runs : runs.slice(0, RECENT_RUNS_COUNT)).map((run, idx) => (
                  <Card
                    key={run.evolutionRunId}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => setSelectedRunId(run.evolutionRunId)}
                  >
                    <CardHeader className="pb-2 bg-muted/30">
                      <CardTitle className="text-sm font-medium truncate" title={run.evolutionRunId}>
                        {idx === 0 ? "最新 Run" : "Run"}: {run.evolutionRunId.split("-")[0]}...
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">
                        実行日時: {new Date(run.createdAt).toLocaleString()}
                      </p>
                      <div className="mt-4">
                        <Button variant="secondary" className="w-full" size="sm">詳細を見る</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {runs.length > RECENT_RUNS_COUNT && (
                <div className="mt-4 text-center">
                  <Button variant="outline" size="sm" onClick={() => setShowAllRuns((v) => !v)}>
                    {showAllRuns
                      ? `最新 ${RECENT_RUNS_COUNT} 件だけ表示`
                      : `過去の run を表示（+${runs.length - RECENT_RUNS_COUNT}）`}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
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
                                    {/* 1. 戦略の中身（主役） */}
                                    <div>
                                      <div className="font-medium mb-1">戦略の中身</div>
                                      {cand.dslSnapshot ? (
                                        <div className="space-y-1 text-muted-foreground">
                                          <div>
                                            <span className="inline-block w-28 text-foreground/70">方向</span>
                                            {cand.dslSnapshot.entry?.direction
                                              ? DIRECTION_LABEL[cand.dslSnapshot.entry.direction] ?? cand.dslSnapshot.entry.direction
                                              : "-"}
                                          </div>
                                          <div>
                                            <span className="inline-block w-28 text-foreground/70 align-top">エントリー条件</span>
                                            <span className="font-mono">{conditionGroupToText(entryConditionGroup(cand.dslSnapshot.entry))}</span>
                                          </div>
                                          <div>
                                            <span className="inline-block w-28 text-foreground/70">損切り (SL)</span>
                                            {riskSpecText(cand.dslSnapshot.stopLoss)}
                                          </div>
                                          <div>
                                            <span className="inline-block w-28 text-foreground/70">利確 (TP)</span>
                                            {riskSpecText(cand.dslSnapshot.takeProfit)}
                                          </div>
                                          {cand.dslSnapshot.parameters &&
                                            Object.keys(cand.dslSnapshot.parameters).length > 0 && (
                                              <div className="flex flex-wrap gap-1.5 pt-1">
                                                {Object.entries(cand.dslSnapshot.parameters).map(([k, v]) => (
                                                  <span key={k} className="text-[11px] px-1.5 py-0.5 bg-muted rounded font-mono">
                                                    {k}: {formatDslValue(v)}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                        </div>
                                      ) : (
                                        <div className="text-muted-foreground">戦略スナップショットがありません。</div>
                                      )}
                                    </div>

                                    {/* 2. この世代でしたこと（元戦略に何をしたか） */}
                                    <div>
                                      <div className="font-medium mb-1">この世代でしたこと</div>
                                      <div className="text-muted-foreground mb-1">{actionLabel(cand.dslSnapshot?.metadata?.createdBy)}</div>
                                      {parents.length === 0 ? (
                                        <div className="text-muted-foreground">
                                          {parentIds.length === 0
                                            ? "初期個体のため変更なし（元戦略そのもの）。"
                                            : "親候補がこの実行の一覧に無いため変更点は表示できません。"}
                                        </div>
                                      ) : (
                                        <div className="space-y-2">
                                          {parents.map((parent, pi) => {
                                            const changes = diffDsl(parent.dslSnapshot, cand.dslSnapshot);
                                            const parentId = (parent.candidateId ?? parent.dslSnapshot?.id ?? "").substring(0, 8);
                                            return (
                                              <div key={parent.id}>
                                                {parents.length > 1 && (
                                                  <div className="text-muted-foreground mb-0.5 font-mono">親{pi + 1} ({parentId}) からの変更</div>
                                                )}
                                                {changes.length === 0 ? (
                                                  <div className="text-muted-foreground">構造的な変更は検出されませんでした。</div>
                                                ) : (
                                                  <ul className="space-y-0.5">
                                                    {changes.map((ch) => (
                                                      <li key={ch.key} className="font-mono">
                                                        <span className="text-foreground/70">{ch.key}</span>:{" "}
                                                        <span className="text-muted-foreground">{ch.before}</span>
                                                        {" → "}
                                                        <span className="text-foreground">{ch.after}</span>
                                                      </li>
                                                    ))}
                                                  </ul>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>

                                    {/* 3. 結果（良くなったか） */}
                                    <div>
                                      <div className="font-medium mb-1">結果</div>
                                      {(() => {
                                        const m = cand.formalBtMetrics;
                                        if (!m) return <div className="text-muted-foreground">正式BT結果なし。</div>;
                                        const parentPf = parents[0]?.formalBtMetrics?.pf;
                                        return (
                                          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                                            <span>
                                              PF: {m.pf != null ? m.pf.toFixed(2) : "-"}
                                              {parentPf != null && m.pf != null
                                                ? `（親 ${parentPf.toFixed(2)} → ${m.pf >= parentPf ? "改善" : "悪化"}）`
                                                : ""}
                                            </span>
                                            <span>勝率: {m.winRate != null ? (m.winRate * 100).toFixed(1) + "%" : "-"}</span>
                                            <span>トレード: {m.tradeCount != null ? m.tradeCount : "-"}</span>
                                            <span>判定: {cand.formalBtPassed ? "合格" : "不合格"}</span>
                                          </div>
                                        );
                                      })()}
                                    </div>

                                    {/* 4. OOS/WF 検証（現状はデータ未生成のことが多い） */}
                                    <div>
                                      <div className="font-medium mb-1">OOS / WF 検証</div>
                                      {!oos ? (
                                        <div className="text-muted-foreground">OOS 未実行（今後の進化ループで確証が付きます）。</div>
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
