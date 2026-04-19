/**
 * /side-b/validation — 検証キュー・進行中・直近結果（Phase 4d §4.4）
 *
 * クエリ: `?focus=<仮説UUID>` で該当行へスクロール＆ハイライト（§5.3）
 */

"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { HypothesisCard } from "@/components/side-b/HypothesisCard";
import { ValidationTrigger } from "@/components/side-b/ValidationTrigger";
import { ValidationProgressBar } from "@/components/side-b/ValidationProgressBar";
import { sideBApi, SideBApiError } from "@/lib/sideBApi";
import type { EdgeHypothesis, HypothesisListItem, ValidationStatusResponse } from "@/types/sideB";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usePollingIntervalMs(): number {
  const [hidden, setHidden] = React.useState(
    typeof document !== "undefined" ? document.hidden : false,
  );
  React.useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return hidden ? 60_000 : 10_000;
}

function ValidationPageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-900 text-gray-100">
      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <p className="text-xs text-gray-500">読み込み中…</p>
      </main>
    </div>
  );
}

export default function ValidationPage() {
  return (
    <Suspense fallback={<ValidationPageSkeleton />}>
      <ValidationPageInner />
    </Suspense>
  );
}

function ValidationPageInner() {
  const searchParams = useSearchParams();
  const rawFocus = searchParams.get("focus");
  const focusId =
    rawFocus && UUID_RE.test(rawFocus.trim()) ? rawFocus.trim() : null;

  const pollMs = usePollingIntervalMs();

  const [pending, setPending] = React.useState<HypothesisListItem[]>([]);
  const [testing, setTesting] = React.useState<EdgeHypothesis[]>([]);
  const [recent, setRecent] = React.useState<EdgeHypothesis[]>([]);
  const [statusById, setStatusById] = React.useState<
    Record<string, ValidationStatusResponse>
  >({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [batchMsg, setBatchMsg] = React.useState<string | null>(null);
  const [manualId, setManualId] = React.useState("");

  const loadStatic = React.useCallback(async () => {
    setError(null);
    try {
      const [p, t, r] = await Promise.all([
        sideBApi.getPendingValidation(),
        sideBApi.getTestingHypotheses(),
        sideBApi.getRecentlyValidated(24),
      ]);
      setPending(p);
      setTesting(t);
      setRecent(r);
    } catch (e) {
      setError(e instanceof SideBApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadStatic();
  }, [loadStatic]);

  /** §5.3: focus クエリで該当仮説行へスクロール */
  React.useEffect(() => {
    if (loading || !focusId) return;
    const id = window.setTimeout(() => {
      const el = document.getElementById(`validation-focus-${focusId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add(
          "ring-2",
          "ring-cyan-500/70",
          "ring-offset-2",
          "ring-offset-slate-900",
          "rounded-xl",
        );
        window.setTimeout(() => {
          el.classList.remove(
            "ring-2",
            "ring-cyan-500/70",
            "ring-offset-2",
            "ring-offset-slate-900",
            "rounded-xl",
          );
        }, 4000);
      }
    }, 100);
    return () => window.clearTimeout(id);
  }, [loading, focusId, pending, testing, recent]);

  const refreshTestingStatuses = React.useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setStatusById({});
      return;
    }
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const s = await sideBApi.getValidationStatus(id);
          return [id, s] as const;
        } catch {
          return null;
        }
      }),
    );
    const next: Record<string, ValidationStatusResponse> = {};
    for (const e of entries) {
      if (e) next[e[0]] = e[1];
    }
    setStatusById(next);
  }, []);

  React.useEffect(() => {
    const ids = testing.map((h) => h.id);
    if (ids.length === 0) {
      setStatusById({});
      return;
    }
    void refreshTestingStatuses(ids);
    const t = window.setInterval(() => {
      void refreshTestingStatuses(ids);
      void loadStatic();
    }, pollMs);
    return () => window.clearInterval(t);
  }, [testing, pollMs, refreshTestingStatuses, loadStatic]);

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else if (n.size < 10) n.add(id);
      return n;
    });
  };

  const runBatch = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBatchMsg(null);
    try {
      const res = await sideBApi.batchValidate(ids);
      const ok = res.results.filter((r) => r.ok).length;
      const ng = res.results.length - ok;
      setBatchMsg(`完了: 成功 ${ok} / 失敗 ${ng}`);
      setSelected(new Set());
      await loadStatic();
    } catch (e) {
      setBatchMsg(e instanceof SideBApiError ? e.message : String(e));
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-gray-100">
      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">検証キュー</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              検証待ち・実行中・直近24時間の結果をまとめて表示します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/side-b/hypotheses"
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              仮説一覧
            </Link>
            <Link
              href="/side-b/dashboard"
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              ダッシュボード
            </Link>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>読み込みエラー</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => loadStatic()}>
                再読込
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <section className="scroll-mt-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-2">検証待ち（screening_passed）</h2>
          {loading ? (
            <p className="text-xs text-gray-500">読み込み中…</p>
          ) : pending.length === 0 ? (
            <Card className="p-4 text-xs text-gray-500">検証待ちの仮説はありません</Card>
          ) : (
            <div className="space-y-3">
              {batchMsg && (
                <p className="text-xs text-amber-300" data-testid="batch-message">
                  {batchMsg}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={selected.size === 0}
                  onClick={runBatch}
                >
                  選択をバッチ検証（最大10）
                </Button>
                <span className="text-[11px] text-gray-500 self-center">
                  選択 {selected.size} / 10
                </span>
              </div>
              <div className="grid gap-3">
                {pending.map((h) => (
                  <div
                    key={h.id}
                    id={`validation-focus-${h.id}`}
                    className="flex flex-col sm:flex-row sm:items-start gap-2 transition-shadow"
                  >
                    <label className="flex items-start gap-2 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(h.id)}
                        onChange={() => toggleSel(h.id)}
                      />
                      <span className="sr-only">選択</span>
                    </label>
                    <div className="flex-1 min-w-0">
                      <HypothesisCard hypothesis={h} href={`/side-b/hypotheses/${h.id}`} />
                    </div>
                    <ValidationTrigger
                      hypothesisId={h.id}
                      label="今すぐ検証"
                      className="shrink-0"
                      onComplete={() => loadStatic()}
                      onError={() => loadStatic()}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="scroll-mt-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-2">検証中（testing）</h2>
          {testing.length === 0 ? (
            <Card className="p-4 text-xs text-gray-500">実行中の検証はありません</Card>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500">
                アクティブタブでは約10秒ごとに状態を更新します（非アクティブ時は60秒）。
              </p>
              {testing.map((h) => {
                const st = statusById[h.id];
                return (
                  <div
                    key={h.id}
                    id={`validation-focus-${h.id}`}
                    className="space-y-2 transition-shadow"
                  >
                    <ValidationProgressBar
                      hypothesisId={h.id}
                      status={h.status}
                      report={st?.fullValidationReport ?? h.fullValidationReport}
                      startedAtIso={
                        st?.fullValidationReport?.startedAt ??
                        h.fullValidationReport?.startedAt ??
                        h.statusUpdatedAt
                      }
                    />
                    <Link
                      href={`/side-b/hypotheses/${h.id}`}
                      className="text-[11px] text-cyan-400 hover:underline"
                    >
                      詳細を開く
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="scroll-mt-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-2">直近24時間の検証結果</h2>
          {recent.length === 0 ? (
            <Card className="p-4 text-xs text-gray-500">該当する仮説はありません</Card>
          ) : (
            <div className="grid gap-2">
              {recent.map((h) => (
                <div key={h.id} id={`validation-focus-${h.id}`} className="transition-shadow">
                  <HypothesisCard hypothesis={h} href={`/side-b/hypotheses/${h.id}`} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-2">ID を指定して検証</h2>
          <Card className="p-4 flex flex-col sm:flex-row gap-2 sm:items-center">
            <input
              className="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm min-h-[44px]"
              placeholder="仮説 UUID"
              value={manualId}
              onChange={(e) => setManualId(e.target.value.trim())}
            />
            <ValidationTrigger
              hypothesisId={manualId}
              label="検証開始"
              disabled={!manualId}
              onComplete={() => {
                setManualId("");
                loadStatic();
              }}
            />
          </Card>
        </section>
      </main>
    </div>
  );
}
