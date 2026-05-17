/**
 * /side-b/dashboard — 台帳俯瞰・4カードハブ（Phase 4d §4.5 改定版）
 */

"use client";

import * as React from "react";
import Link from "next/link";

import {
  enableAiDebugContextWindowPublish,
  mergeAiDebugContext,
  setAiDebugContext,
} from "@last-mile-context/app-bridge";
import type { AiDebugContext } from "@last-mile-context/schema";
import { CopyAiDebugContextButton } from "@last-mile-context/react-bridge";

import { Button } from "@/components/ui/Button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { NeonCard } from "@/components/ui/NeonCard";
import { HypothesisCard } from "@/components/side-b/HypothesisCard";
import { LedgerStats } from "@/components/side-b/LedgerStats";
import { DashboardCharts } from "@/components/side-b/DashboardCharts";
import { sideBApi, SideBApiError } from "@/lib/sideBApi";
import { parseEvolutionStatement } from "@/lib/evolutionStatement";
import type {
  StatsOverviewResponse,
  StatsTimeSeriesResponse,
  StatsByCategoryResponse,
  StatsValidationActivityResponse,
  EdgeHypothesis,
  DiscoveryLatestResponse,
  SystemHealthResponse,
} from "@/types/sideB";

/** dev 環境判定。production build では Copy ボタンを描画しない (個人情報露出回避)。 */
const isDevMode = process.env.NODE_ENV !== "production";

/**
 * AI Debug Context の初期値 (Phase 11 / AGENTS.md §「Last-Mile Shared Context Rule」§5)。
 *
 * - `target.type='dashboard'` / `target.id='overview'` 固定 (Dashboard は単一画面)
 * - 初期 `relatedIds` / `domain` は空。load() 成功時に mergeAiDebugContext で実状態を反映
 * - token / cTrader accountId / 取引額 等の機密値は **絶対に入れない**
 * - `screen.mode` は NODE_ENV から判定 (Copilot レビュー対応: ハードコード回避)
 */
const initialDashboardDebugContext: AiDebugContext = {
  screen: {
    name: "SideBDashboard",
    route: "/side-b/dashboard",
    mode: isDevMode ? "development" : "production",
  },
  target: {
    type: "dashboard",
    id: "overview",
    relatedIds: {},
  },
  action: {
    name: "idle",
    status: "idle",
    expected: "",
    actual: "",
  },
  domain: {},
  runtime: {
    latestApi: [],
    latestError: null,
    warnings: [],
  },
};

/**
 * dashboard の AI Debug Context patch を state から組み立てる純関数。
 *
 * 3 分岐:
 * - `loading=true` → action.status='pending'
 * - `error !== null` → action.status='failed' + domain にエラーサマリ
 * - 正常系 → action.status='success' + 実状態を domain / target.relatedIds に反映
 *
 * UI コンポーネントから副作用を分離するため pure に保つ。**個人情報・取引額・cTrader
 * accountId は絶対に流さない**。テスト: `__tests__/side-b/dashboardDebugContext.test.ts`
 */
export interface DashboardDebugContextInput {
  loading: boolean;
  error: string | null;
  overview: StatsOverviewResponse | null;
  health: SystemHealthResponse | null;
  discovery: DiscoveryLatestResponse | null;
  recentConfirmedCount: number;
  recentRejectedCount: number;
}

export function buildDashboardDebugContextPatch(
  input: DashboardDebugContextInput,
): Partial<AiDebugContext> {
  const { loading, error, overview, health, discovery, recentConfirmedCount, recentRejectedCount } =
    input;

  if (loading) {
    return {
      action: {
        name: "load-dashboard",
        status: "pending",
        expected: "8 種の Dashboard API がすべて成功して画面に反映される",
        actual: "API 取得中",
      },
    };
  }

  if (error !== null) {
    return {
      action: {
        name: "load-dashboard",
        status: "failed",
        expected: "8 種の Dashboard API がすべて成功して画面に反映される",
        actual: `エラー: ${error}`,
      },
      domain: {
        hypothesisCount: overview?.totalHypotheses ?? null,
        databaseHealth: health?.database ?? null,
        pythonValidatorHealth: health?.pythonValidator ?? null,
        loadError: error,
      },
      runtime: {
        latestApi: [],
        latestError: {
          message: error,
          timestamp: new Date().toISOString(),
        },
        warnings: [],
      },
    };
  }

  // 正常系: overview / health / discovery などのサマリだけを domain に流す
  // (個別の数値・取引額・個人情報・cTrader accountId は入れない原則)
  const sampleDiscoveryId = discovery?.sampleHypotheses[0]?.id;
  return {
    action: {
      name: "load-dashboard",
      status: "success",
      expected: "8 種の Dashboard API がすべて成功して画面に反映される",
      actual: overview === null ? "ロード完了だが overview なし" : "ロード完了",
    },
    target: {
      type: "dashboard",
      id: "overview",
      relatedIds:
        sampleDiscoveryId !== undefined ? { latestDiscoveryHypothesisId: sampleDiscoveryId } : {},
    },
    domain: {
      hypothesisCount: overview?.totalHypotheses ?? null,
      confirmedCount: overview?.confirmedCount ?? null,
      newHypothesesThisWeek: overview?.newHypothesesThisWeek ?? null,
      databaseHealth: health?.database ?? null,
      pythonValidatorHealth: health?.pythonValidator ?? null,
      recentConfirmedCount,
      recentRejectedCount,
      hasLatestDiscoveryWeeklyReport: discovery?.hasWeeklyReport ?? false,
    },
    runtime: {
      latestApi: [],
      latestError: null,
      warnings: [],
    },
  };
}

export default function SideBDashboardPage() {
  const [overview, setOverview] = React.useState<StatsOverviewResponse | null>(null);
  const [timeSeries, setTimeSeries] = React.useState<StatsTimeSeriesResponse | null>(null);
  const [byCategory, setByCategory] = React.useState<StatsByCategoryResponse | null>(null);
  const [activity, setActivity] = React.useState<StatsValidationActivityResponse | null>(null);
  const [recentConf, setRecentConf] = React.useState<EdgeHypothesis[]>([]);
  const [recentRej, setRecentRej] = React.useState<EdgeHypothesis[]>([]);
  const [discovery, setDiscovery] = React.useState<DiscoveryLatestResponse | null>(null);
  const [health, setHealth] = React.useState<SystemHealthResponse | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        ov,
        ts,
        cat,
        act,
        rc,
        rr,
        disc,
        hl,
      ] = await Promise.all([
        sideBApi.getOverviewStats(),
        sideBApi.getTimeSeriesStats("monthly", 12),
        sideBApi.getCategoryStats(),
        sideBApi.getValidationActivity(30),
        sideBApi.getRecentConfirmed(5),
        sideBApi.getRecentRejected(5),
        sideBApi.getLatestDiscovery(),
        sideBApi.getSystemHealth(),
      ]);
      setOverview(ov);
      setTimeSeries(ts);
      setByCategory(cat);
      setActivity(act);
      setRecentConf(rc);
      setRecentRej(rr);
      setDiscovery(disc);
      setHealth(hl);
    } catch (e) {
      setError(e instanceof SideBApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // AI Debug Context を window.__AI_DEBUG_CONTEXT__ に公開する (mount 時 1 回のみ)。
  // production では `enableAiDebugContextWindowPublish({ allowProduction: false })` により NO-OP。
  React.useEffect(() => {
    enableAiDebugContextWindowPublish({ allowProduction: false });
    setAiDebugContext(initialDashboardDebugContext);
  }, []);

  // load() の各種 state が更新されたら、AI Debug Context にも実状態を反映 (P11-05)。
  // Domain ID は AGENTS.md §「Last-Mile Shared Context Rule」§5 で定義したマッピングに従う。
  React.useEffect(() => {
    mergeAiDebugContext(
      buildDashboardDebugContextPatch({
        loading,
        error,
        overview,
        health,
        discovery,
        recentConfirmedCount: recentConf.length,
        recentRejectedCount: recentRej.length,
      }),
    );
  }, [loading, error, overview, health, discovery, recentConf.length, recentRej.length]);

  return (
    <div className="min-h-screen bg-slate-900 text-gray-100">
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">台帳ダッシュボード</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              エッジ台帳の成長・検証活動・システム状態の俯瞰
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isDevMode && (
              <CopyAiDebugContextButton
                label="Copy AI Context"
                className="text-xs px-2 py-1 border border-cyan-500/40 rounded bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
                buttonProps={{
                  title: "現在の window.__AI_DEBUG_CONTEXT__ を整形して clipboard へコピー (dev のみ)",
                }}
              />
            )}
            <Link href="/side-b">
              <Button variant="outline" size="sm">
                エージェントへ
              </Button>
            </Link>
          </div>
        </div>

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">クイックリンク</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <NeonCard icon="📋" title="仮説一覧" href="/side-b/hypotheses" color="purple" />
            <NeonCard icon="⚙️" title="検証キュー" href="/side-b/validation" color="cyan" />
            <NeonCard icon="🤖" title="AI エージェント" href="/side-b" color="green" />
            <NeonCard icon="📊" title="比較ダッシュボード" href="/side-b/comparison" color="pink" />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">現状サマリー</h2>
          {loading && !overview ? (
            <LedgerStats overview={null} loading />
          ) : error && !overview ? (
            <div className="space-y-2">
              <Alert variant="destructive">
                <AlertTitle>読み込みに失敗しました</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <Button variant="outline" size="sm" onClick={load}>
                再試行
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <LedgerStats overview={overview} error={error} />
              {overview && (
                <p className="text-[11px] text-gray-500">
                  最終検証完了:{" "}
                  {overview.lastValidationCompletedAt
                    ? new Date(overview.lastValidationCompletedAt).toLocaleString("ja-JP")
                    : "—"}
                </p>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">チャート</h2>
          <DashboardCharts
            timeSeries={timeSeries}
            byCategory={byCategory}
            activity={activity}
            loading={loading}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-2">最近 confirmed</h2>
            <div className="space-y-2">
              {recentConf.length === 0 ? (
                <Card className="p-4 text-xs text-gray-500">データがありません</Card>
              ) : (
                recentConf.map((h) => (
                  <HypothesisCard key={h.id} hypothesis={h} href={`/side-b/hypotheses/${h.id}`} />
                ))
              )}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-2">最近 rejected</h2>
            <div className="space-y-2">
              {recentRej.length === 0 ? (
                <Card className="p-4 text-xs text-gray-500">データがありません</Card>
              ) : (
                recentRej.map((h) => (
                  <HypothesisCard key={h.id} hypothesis={h} href={`/side-b/hypotheses/${h.id}`} />
                ))
              )}
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-2">Discovery サマリー</h2>
          <Card className="p-4 text-xs text-gray-300 space-y-2">
            {discovery ? (
              <>
                <p className="text-gray-400">{discovery.message}</p>
                <p>
                  直近7日の discovery 由来新規仮説:{" "}
                  <span className="text-white font-medium">
                    {discovery.newHypothesesFromDiscovery7d}
                  </span>
                </p>
                {discovery.sampleHypotheses.length > 0 && (
                  <ul className="list-disc list-inside text-gray-400 space-y-1">
                    {discovery.sampleHypotheses.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/side-b/hypotheses/${s.id}`}
                          className="text-cyan-400 hover:underline"
                        >
                          {(() => {
                            const t = parseEvolutionStatement(s.statement).displayText;
                            return t.length > 48 ? t.slice(0, 48) + "…" : t;
                          })()}
                        </Link>
                        <span className="text-gray-600"> ({s.status})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-gray-500">読み込み中…</p>
            )}
          </Card>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-2">システム状態</h2>
          <Card className="p-4 text-xs flex flex-wrap gap-4">
            {health ? (
              <>
                <span>
                  DB:{" "}
                  <span className={health.database === "ok" ? "text-emerald-400" : "text-red-400"}>
                    {health.database}
                  </span>
                </span>
                <span>
                  Python 検証:{" "}
                  <span
                    className={
                      health.pythonValidator === "ok"
                        ? "text-emerald-400"
                        : health.pythonValidator === "local_only"
                          ? "text-sky-400"
                          : health.pythonValidator === "not_configured"
                            ? "text-gray-400"
                            : "text-amber-400"
                    }
                  >
                    {health.pythonValidator}
                  </span>
                </span>
                <span className="text-gray-500">
                  確認: {new Date(health.checkedAt).toLocaleString("ja-JP")}
                </span>
              </>
            ) : (
              <span className="text-gray-500">—</span>
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}
