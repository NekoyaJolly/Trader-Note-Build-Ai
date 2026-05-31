/**
 * /side-b/dashboard — 台帳俯瞰・4カードハブ（Phase 4d §4.5 改定版）
 */

"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

import { Button } from "@/components/ui/Button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { NeonCard } from "@/components/ui/NeonCard";
import { HypothesisCard } from "@/components/side-b/HypothesisCard";
import { LedgerStats } from "@/components/side-b/LedgerStats";
import { DashboardCharts } from "@/components/side-b/DashboardCharts";
import { DiscoveryFunnelPanel } from "@/components/side-b/DiscoveryFunnelPanel";
import {
  initialDashboardDebugContext,
  buildDashboardDebugContextPatch,
} from "@/app/side-b/dashboard/debugContext";
import { sideBApi, SideBApiError } from "@/lib/sideBApi";
import { parseEvolutionStatement } from "@/lib/evolutionStatement";
import type {
  StatsOverviewResponse,
  StatsTimeSeriesResponse,
  StatsByCategoryResponse,
  StatsValidationActivityResponse,
  EdgeHypothesis,
  DiscoveryLatestResponse,
  DiscoveryFunnelResponse,
  SystemHealthResponse,
} from "@/types/sideB";

/** dev 環境判定。production build では Copy ボタンを描画しない (個人情報露出回避)。 */
const isDevMode = process.env.NODE_ENV !== "production";
const DevCopyAiDebugContextButton = dynamic(
  () => import("@last-mile-context/react-bridge").then((module) => module.CopyAiDebugContextButton),
  { ssr: false },
);

export default function SideBDashboardPage() {
  const [overview, setOverview] = React.useState<StatsOverviewResponse | null>(null);
  const [timeSeries, setTimeSeries] = React.useState<StatsTimeSeriesResponse | null>(null);
  const [byCategory, setByCategory] = React.useState<StatsByCategoryResponse | null>(null);
  const [activity, setActivity] = React.useState<StatsValidationActivityResponse | null>(null);
  const [recentConf, setRecentConf] = React.useState<EdgeHypothesis[]>([]);
  const [recentRej, setRecentRej] = React.useState<EdgeHypothesis[]>([]);
  const [discovery, setDiscovery] = React.useState<DiscoveryLatestResponse | null>(null);
  const [funnel, setFunnel] = React.useState<DiscoveryFunnelResponse | null>(null);
  const [health, setHealth] = React.useState<SystemHealthResponse | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const debugContextBridgeRef = React.useRef<
    | {
        mergeAiDebugContext: (
          patch: ReturnType<typeof buildDashboardDebugContextPatch>,
        ) => void;
      }
    | null
  >(null);

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
        fnl,
        hl,
      ] = await Promise.all([
        sideBApi.getOverviewStats(),
        sideBApi.getTimeSeriesStats("monthly", 12),
        sideBApi.getCategoryStats(),
        sideBApi.getValidationActivity(30),
        sideBApi.getRecentConfirmed(5),
        sideBApi.getRecentRejected(5),
        sideBApi.getLatestDiscovery(),
        sideBApi.getDiscoveryFunnel(),
        sideBApi.getSystemHealth(),
      ]);
      setOverview(ov);
      setTimeSeries(ts);
      setByCategory(cat);
      setActivity(act);
      setRecentConf(rc);
      setRecentRej(rr);
      setDiscovery(disc);
      setFunnel(fnl);
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
    let mounted = true;
    void import("@last-mile-context/app-bridge").then((bridge) => {
      if (!mounted) {
        return;
      }
      bridge.enableAiDebugContextWindowPublish({ allowProduction: false });
      bridge.setAiDebugContext(initialDashboardDebugContext);
      debugContextBridgeRef.current = {
        mergeAiDebugContext: bridge.mergeAiDebugContext,
      };
    });
    return () => {
      mounted = false;
      debugContextBridgeRef.current = null;
    };
  }, []);

  // load() の各種 state が更新されたら、AI Debug Context にも実状態を反映 (P11-05)。
  // Domain ID は AGENTS.md §「Last-Mile Shared Context Rule」§5 で定義したマッピングに従う。
  React.useEffect(() => {
    const bridge = debugContextBridgeRef.current;
    if (bridge === null) {
      return;
    }
    bridge.mergeAiDebugContext(
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
  }, [loading, error, overview, health, discovery, recentConf, recentRej]);

  return (
    <div className="min-h-screen bg-slate-900 text-gray-100">
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">統計</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              エッジ台帳の成長・検証活動・システム状態の俯瞰
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isDevMode && (
              <DevCopyAiDebugContextButton
                label="Copy AI Context"
                className="text-xs px-2 py-1 border border-cyan-500/40 rounded bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
                buttonProps={{
                  title: "現在の window.__AI_DEBUG_CONTEXT__ を整形して clipboard へコピー (dev のみ)",
                }}
              />
            )}
            {/* 「エージェントへ」ボタンは下のクイックリンク「プラン」と重複するため削除 (2026-05-31) */}
          </div>
        </div>

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">クイックリンク</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <NeonCard icon="📋" title="仮説" href="/side-b/hypotheses" color="purple" />
            <NeonCard icon="⚙️" title="検証" href="/side-b/validation" color="cyan" />
            <NeonCard icon="🤖" title="プラン" href="/side-b" color="green" />
            <NeonCard icon="📊" title="比較" href="/side-b/comparison" color="pink" />
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

        <DiscoveryFunnelPanel funnel={funnel} />

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
