"use client";

import { useCallback, useEffect, useState } from "react";
import { sideBApi } from "@/lib/sideBApi";
import type {
  EvolutionLesson,
  EvolutionRunCandidate,
  EvolutionRunListItem,
  EvolutionRunSummary,
} from "@/types/sideB";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Loader2 } from "lucide-react";

export default function EvolutionPage() {
  const [activeTab, setActiveTab] = useState<"runs" | "lessons">("runs");
  const [lessons, setLessons] = useState<EvolutionLesson[]>([]);
  const [runs, setRuns] = useState<EvolutionRunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<EvolutionRunSummary | null>(null);
  const [runCandidates, setRunCandidates] = useState<EvolutionRunCandidate[]>([]);
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
          <h1 className="text-2xl font-bold tracking-tight">進化トラッキング (Evolution)</h1>
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
                          <th className="p-2 font-medium">Generation</th>
                          <th className="p-2 font-medium">Candidate Hash</th>
                          <th className="p-2 font-medium">Surrogate Score</th>
                          <th className="p-2 font-medium">Status</th>
                          <th className="p-2 font-medium">PF</th>
                          <th className="p-2 font-medium">Win Rate</th>
                          <th className="p-2 font-medium">Trades</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runCandidates.map((cand) => {
                          const metrics = cand.formalBtMetrics || {};
                          return (
                            <tr key={cand.id} className="border-b last:border-0 hover:bg-muted/30">
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
                              <td className="p-2">{metrics.pf?.toFixed(2) || '-'}</td>
                              <td className="p-2">{metrics.winRate ? (metrics.winRate * 100).toFixed(1) + '%' : '-'}</td>
                              <td className="p-2">{metrics.tradeCount || '-'}</td>
                            </tr>
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
