/**
 * Side-B: AI エージェントダッシュボード
 *
 * 自律型トレーディングAI の操作・監視画面
 * - エージェント状態（Start/Stop）・サイクル数・勝率
 * - 思考ログ（リアルタイム自動更新）
 * - 現在の戦略・オープンポジション
 * - トレード結果 + AI振り返り
 *
 * @see docs/side-b/TradeAssistant-AI.md
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { sideBApi, SideBApiError } from "@/lib/sideBApi";
import { Button } from "@/components/ui/Button";
import { PlanEvidenceCard } from "@/components/side-b/PlanEvidenceCard";
import type { AITradePlanPayload, AgentRun, GetOrchestratorRunDetailResponse } from "@/types/sideB";

interface ValidationVisibilityData {
  pendingCount: number;
  recentlyValidatedCount: number;
}

// APIベースURL
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "") + "/api/side-b";

// --- 型定義 ---

interface TradeResult {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  pnlPips: number;
  outcome: "win" | "loss" | "breakeven";
  exitReason: string;
  reflection?: string;
  tradedAt: string;
  closedAt: string;
}

interface OpenPosition {
  tradeId: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  currentPnlPips: number;
}

interface AgentStatus {
  isRunning: boolean;
  state: string;
  cycleCount: number;
  watchSymbols: string[];
  startedAt?: string;
  lastTickAt?: string;
  nextTickAt?: string;
  lastAction?: string;
  lastError?: string;
  lastTickDurationMs?: number;
  memory: {
    currentState: string;
    recentTradeResults: TradeResult[];
    openPositions: OpenPosition[];
    lessonsBySymbol: Record<string, { entries: Array<{ text: string }>; consolidated: Array<{ text: string; count: number }> }>;
    totalEntries: number;
    totalConsolidated: number;
    cycleCount: number;
  };
}

interface ThinkingLogEntry {
  timestamp: string;
  cycle: number;
  state: string;
  action: string;
  reasoning: string;
}

// --- ステート色マッピング ---

const stateConfig: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  IDLE: { color: "text-gray-400", bg: "bg-gray-500/20", label: "待機中", icon: "⏸" },
  SESSION_OPEN: { color: "text-yellow-400", bg: "bg-yellow-500/20", label: "戦略立案中", icon: "🧠" },
  MONITORING: { color: "text-green-400", bg: "bg-green-500/20", label: "監視中", icon: "👁" },
  EVALUATING_ENTRY: { color: "text-blue-400", bg: "bg-blue-500/20", label: "エントリー評価", icon: "🎯" },
  MANAGING_POSITION: { color: "text-purple-400", bg: "bg-purple-500/20", label: "ポジション管理", icon: "📊" },
  REFLECTING: { color: "text-cyan-400", bg: "bg-cyan-500/20", label: "振り返り中", icon: "🔄" },
  REVISING_STRATEGY: { color: "text-orange-400", bg: "bg-orange-500/20", label: "戦略修正", icon: "📝" },
};

function getStateDisplay(state: string) {
  return stateConfig[state] || { color: "text-gray-400", bg: "bg-gray-500/20", label: state, icon: "❓" };
}

function formatStatusDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * レスポンスを安全にパースするヘルパー
 * HTTPエラーまたはJSON parse 失敗時は null を返す
 */
async function safeFetchJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function SideBDashboard() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [thinkingLog, setThinkingLog] = useState<ThinkingLogEntry[]>([]);
  const [lessons, setLessons] = useState<string[]>([]);
  const [recentPlans, setRecentPlans] = useState<AITradePlanPayload[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // プラン生成 (運転席から直接トリガー)
  const [planGenSymbol, setPlanGenSymbol] = useState("XAUUSD");
  const [planGenLoading, setPlanGenLoading] = useState(false);
  const [planGenError, setPlanGenError] = useState<string | null>(null);

  // 本番耐用化: キルスイッチ + 容量監視 (旧 /side-b/agent から移設)
  const [isEmergencyStopped, setIsEmergencyStopped] = useState(false);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [dbWarning, setDbWarning] = useState(false);
  const [dbSizeBytes, setDbSizeBytes] = useState(0);
  const [isEmergencyActionLoading, setIsEmergencyActionLoading] = useState(false);

  // Orchestrator 意思決定履歴 + 検証可視化 (旧 /side-b/agent から移設)
  const [orchestratorRuns, setOrchestratorRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<GetOrchestratorRunDetailResponse | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const activeRunIdRef = useRef<string | null>(null);
  const [validationVisibility, setValidationVisibility] = useState<ValidationVisibilityData | null>(null);

  // --- データ取得 ---

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, logRes, lessonsRes, plansRes, emergencyRes, healthRes, runsRes, pendingValidationRes, recentlyValidatedRes] = await Promise.allSettled([
        fetch(`${API_BASE}/agent/status`, { cache: "no-store" }),
        fetch(`${API_BASE}/agent/thinking-log?limit=20`, { cache: "no-store" }),
        fetch(`${API_BASE}/agent/lessons`, { cache: "no-store" }),
        sideBApi.listPlans({ limit: 5 }),
        sideBApi.getEmergencyStatus(),
        sideBApi.getSystemHealth(),
        sideBApi.getOrchestratorRuns(undefined, 10),
        sideBApi.getPendingValidation(),
        sideBApi.getRecentlyValidated(24),
      ]);

      if (plansRes.status === "fulfilled") {
        setRecentPlans(plansRes.value.plans);
      }
      if (emergencyRes.status === "fulfilled" && emergencyRes.value) {
        setIsEmergencyStopped(emergencyRes.value.data.isEmergencyStopped);
        setConsecutiveErrors(emergencyRes.value.data.consecutiveErrors);
      }
      if (healthRes.status === "fulfilled" && healthRes.value) {
        setDbWarning(!!healthRes.value.dbWarning);
        setDbSizeBytes(healthRes.value.dbSizeBytes || 0);
      }
      if (runsRes.status === "fulfilled") {
        setOrchestratorRuns(runsRes.value.runs || []);
      }
      const nextValidation: ValidationVisibilityData = { pendingCount: 0, recentlyValidatedCount: 0 };
      if (pendingValidationRes.status === "fulfilled") {
        nextValidation.pendingCount = pendingValidationRes.value.length;
      }
      if (recentlyValidatedRes.status === "fulfilled") {
        nextValidation.recentlyValidatedCount = recentlyValidatedRes.value.length;
      }
      setValidationVisibility(nextValidation);

      let hasError = false;

      if (statusRes.status === "fulfilled") {
        const data = await safeFetchJson<AgentStatus>(statusRes.value);
        if (data) {
          setStatus(data);
        } else {
          hasError = true;
        }
      } else {
        hasError = true;
      }

      if (logRes.status === "fulfilled") {
        const data = await safeFetchJson<{ log: ThinkingLogEntry[]; count: number }>(logRes.value);
        if (data) {
          setThinkingLog(data.log || []);
        } else {
          hasError = true;
        }
      } else {
        hasError = true;
      }

      if (lessonsRes.status === "fulfilled") {
        const data = await safeFetchJson<{
          lessonsBySymbol: Record<string, { entries: Array<{ text: string }>; consolidated: Array<{ text: string; count: number }> }>;
        }>(lessonsRes.value);
        if (data && data.lessonsBySymbol) {
          // 新構造からフラットなリストに変換（確信ルール優先）
          const flatLessons: string[] = [];
          for (const sl of Object.values(data.lessonsBySymbol)) {
            for (const c of sl.consolidated) {
              flatLessons.push(`📌 ${c.text} (${c.count}回確認)`);
            }
            for (const e of sl.entries) {
              flatLessons.push(e.text);
            }
          }
          setLessons(flatLessons);
        } else {
          hasError = true;
        }
      } else {
        hasError = true;
      }

      if (hasError) {
        setError("データの一部の取得に失敗しました");
      } else {
        setError(null);
      }
    } catch (err) {
      setError("データ取得に失敗しました");
      console.error("[Dashboard] fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 自動ポーリングは廃止 (2026-05-31)。
  // 表示するのは PDCA ループのメモリ状態で、実 cadence は最速 5 分・通常 1h〜日次。
  // プラン確定後の執行は決定論で AI が常時張り付く必要がないため、開いた時に 1 回 fetch +
  // 手動「更新」ボタンに切替え、15 秒ポーリングによる Cloud Run / Supabase の無駄叩きを排除する。
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchData();
    } finally {
      setIsRefreshing(false);
    }
  };

  // プラン生成 → 完了後に一覧を再取得して最新プランをヒーロー表示
  const handleGeneratePlan = async () => {
    setPlanGenLoading(true);
    setPlanGenError(null);
    try {
      await sideBApi.generatePlan({
        symbol: planGenSymbol.trim() || "XAUUSD",
        forceRefresh: true,
        timeframe: "15m",
      });
      await fetchData();
    } catch (err) {
      setPlanGenError(err instanceof SideBApiError ? err.message : "プラン生成に失敗しました");
    } finally {
      setPlanGenLoading(false);
    }
  };

  // --- 緊急キルスイッチ (旧 /side-b/agent から移設) ---

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

  // Orchestrator ステップ詳細のアコーディオン開閉 (旧 /side-b/agent から移設)
  const fetchRunDetail = async (runId: string) => {
    if (selectedRunId === runId) {
      setSelectedRunId(null);
      setSelectedRunDetail(null);
      activeRunIdRef.current = null;
      return;
    }
    setSelectedRunId(runId);
    activeRunIdRef.current = runId;
    // 別 run の古い詳細が残って新 run の下に表示されるのを防ぐため、取得開始時にクリア
    setSelectedRunDetail(null);
    setIsDetailLoading(true);
    try {
      const detail = await sideBApi.getOrchestratorRunDetail(runId);
      if (activeRunIdRef.current === runId) {
        setSelectedRunDetail(detail);
      }
    } catch (err) {
      console.error("fetchRunDetail error:", err);
      if (activeRunIdRef.current === runId) {
        setSelectedRunDetail(null);
      }
    } finally {
      if (activeRunIdRef.current === runId) {
        setIsDetailLoading(false);
      }
    }
  };

  // --- エージェント制御 ---

  const startAgent = async () => {
    setIsStarting(true);
    try {
      const res = await fetch(`${API_BASE}/agent/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error("[Dashboard] start error:", err);
    } finally {
      setIsStarting(false);
    }
  };

  const stopAgent = async () => {
    setIsStopping(true);
    try {
      const res = await fetch(`${API_BASE}/agent/stop`, { method: "POST", cache: "no-store" });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error("[Dashboard] stop error:", err);
    } finally {
      setIsStopping(false);
    }
  };

  // --- 計算 ---

  const recentResults = status?.memory?.recentTradeResults || [];
  const winCount = recentResults.filter((r) => r.outcome === "win").length;
  const lossCount = recentResults.filter((r) => r.outcome === "loss").length;
  const winRate = recentResults.length > 0 ? Math.round((winCount / recentResults.length) * 100) : 0;
  const totalPnl = recentResults.reduce((acc, r) => acc + r.pnlPips, 0);
  const agentState = status?.memory?.currentState || "IDLE";
  const stateDisplay = getStateDisplay(agentState);
  const isRunning = status?.isRunning || false;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* 緊急停止バー (旧 /side-b/agent から移設) */}
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
        <div className="bg-yellow-500/20 border-b border-yellow-500/30 text-yellow-200 px-4 py-3 text-center text-xs font-semibold">
          ⚠️ データベース容量警告: Supabase の総使用量が 400MB を超過しています（現在: {(dbSizeBytes / (1024 * 1024)).toFixed(1)} MB）。
        </div>
      )}
      <main className="max-w-6xl w-full mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8">
        {/* ===== ヘッダー ===== */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
                TradeAssistant-AI
              </span>
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              自律型トレーディングAI ダッシュボード
            </p>
          </div>
          {/* 上部タブは廃止 (2026-05-31)。ナビは左サイドバーに一本化し二重ナビを解消。 */}
        </div>

        {/* ===== ステータスバー ===== */}
        <div className="card-surface rounded-xl p-4 sm:p-5 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* 左: 状態 + コントロール */}
            <div className="flex items-center gap-4">
              {/* 状態インジケータ */}
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${stateDisplay.bg}`}>
                <span className="text-lg">{stateDisplay.icon}</span>
                <span className={`text-sm font-medium ${stateDisplay.color}`}>
                  {stateDisplay.label}
                </span>
                {isRunning && (
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                )}
              </div>

              {/* Start/Stop ボタン (共通 Button で形・高さ・幅を統一) */}
              {!isRunning ? (
                <Button onClick={startAgent} disabled={isStarting} variant="secondary" size="sm">
                  {isStarting ? (
                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "▶"
                  )}
                  <span>{isStarting ? "起動中..." : "Start"}</span>
                </Button>
              ) : (
                <Button onClick={stopAgent} disabled={isStopping} variant="destructive" size="sm">
                  {isStopping ? (
                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "⏹"
                  )}
                  <span>{isStopping ? "停止中..." : "Stop"}</span>
                </Button>
              )}

              {/* 手動更新 */}
              <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline" size="sm" title="最新の状態を取得">
                <span className={isRefreshing ? "animate-spin" : ""}>⟳</span>
                <span>{isRefreshing ? "更新中..." : "更新"}</span>
              </Button>

              {/* 緊急キルスイッチ (旧 /side-b/agent から移設) */}
              {isEmergencyStopped ? (
                <Button onClick={handleEmergencyResume} disabled={isEmergencyActionLoading} variant="secondary" size="sm">
                  {isEmergencyActionLoading ? "処理中..." : "緊急停止を解除"}
                </Button>
              ) : (
                <Button onClick={handleEmergencyStop} disabled={isEmergencyActionLoading} variant="destructive" size="sm">
                  {isEmergencyActionLoading ? "処理中..." : "🚨 緊急停止"}
                </Button>
              )}
            </div>

            {/* 右: メトリクス */}
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="text-center">
                <p className="text-xs text-gray-500">サイクル</p>
                <p className="text-lg font-bold text-white">#{status?.memory?.cycleCount || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">勝率</p>
                <p className={`text-lg font-bold ${winRate >= 50 ? "text-green-400" : winRate > 0 ? "text-red-400" : "text-gray-400"}`}>
                  {winRate}%
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">損益</p>
                <p className={`text-lg font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(1)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">W / L</p>
                <p className="text-lg font-bold text-white">
                  <span className="text-green-400">{winCount}</span>
                  <span className="text-gray-500"> / </span>
                  <span className="text-red-400">{lossCount}</span>
                </p>
              </div>
            </div>
          </div>

          {/* 監視シンボル */}
          {status?.watchSymbols && status.watchSymbols.length > 0 && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700/50">
              <span className="text-xs text-gray-500">監視中:</span>
              {status.watchSymbols.map((s) => (
                <span
                  key={s}
                  className="px-2 py-0.5 rounded-md bg-slate-700/50 text-xs text-gray-300 font-mono"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-700/50 text-xs">
            <div className="rounded-lg bg-slate-800/50 px-3 py-2">
              <p className="text-gray-500">最終Tick</p>
              <p className="text-gray-200 font-mono">{formatStatusDateTime(status?.lastTickAt)}</p>
              {typeof status?.lastTickDurationMs === "number" && (
                <p className="text-gray-600 mt-0.5">{status.lastTickDurationMs}ms</p>
              )}
            </div>
            <div className="rounded-lg bg-slate-800/50 px-3 py-2">
              <p className="text-gray-500">次回予定</p>
              <p className="text-gray-200 font-mono">{formatStatusDateTime(status?.nextTickAt)}</p>
              {status?.startedAt && (
                <p className="text-gray-600 mt-0.5">開始: {formatStatusDateTime(status.startedAt)}</p>
              )}
            </div>
            <div className="rounded-lg bg-slate-800/50 px-3 py-2">
              <p className="text-gray-500">直近アクション</p>
              <p className="text-gray-200 line-clamp-2">{status?.lastAction || "—"}</p>
              {status?.lastError && (
                <p className="text-red-400 mt-0.5 line-clamp-1">{status.lastError}</p>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* ===== AI プラン (主役) ===== */}
        <section className="card-surface rounded-xl overflow-hidden mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-700/50">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>🎯</span> 最新のAIプラン
            </h2>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={planGenSymbol}
                onChange={(e) => setPlanGenSymbol(e.target.value)}
                placeholder="銘柄 (例: XAUUSD)"
                className="w-32 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
              <Button onClick={handleGeneratePlan} disabled={planGenLoading} variant="default" size="sm">
                {planGenLoading ? (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "✨"
                )}
                <span>{planGenLoading ? "生成中..." : "プラン生成"}</span>
              </Button>
            </div>
          </div>
          <div className="p-4">
            {planGenError && <p className="text-xs text-rose-400 mb-3">{planGenError}</p>}
            {recentPlans.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">
                まだプランがありません。右上の「プラン生成」で作成してください。
              </p>
            ) : (
              <div className="space-y-4">
                {/* 最新プラン = ヒーロー (根拠は各カード内で折りたたみ) */}
                {recentPlans[0] && <PlanEvidenceCard plan={recentPlans[0]} />}
                {/* 直近プラン履歴 (折りたたみ) */}
                {recentPlans.length > 1 && (
                  <details>
                    <summary className="text-xs text-gray-400 hover:text-white cursor-pointer select-none">
                      📋 直近プラン履歴 ({recentPlans.length - 1} 件)
                    </summary>
                    <div className="mt-3 space-y-3">
                      {recentPlans.slice(1).map((plan) => (
                        <PlanEvidenceCard key={plan.id} plan={plan} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ===== 検証の見える化 (旧 /side-b/agent から移設) ===== */}
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

        {/* ===== Orchestrator 意思決定履歴 (旧 /side-b/agent から移設・既定折りたたみ) ===== */}
        <details className="card-surface rounded-xl overflow-hidden mb-6">
          <summary className="px-4 py-3 border-b border-slate-700/50 cursor-pointer select-none">
            <span className="text-sm font-semibold text-white">🤖 Orchestrator 意思決定履歴 (直近10件)</span>
            <span className="block text-[11px] text-gray-500 mt-0.5">
              最上位のオーケストレーターが「次に回すループ」を LLM 判断した履歴です。
            </span>
          </summary>
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
                  <div key={run.id} className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[run.status] || "text-gray-400 bg-gray-500/20"}`}>
                          {run.status.toUpperCase()}
                        </span>
                        <span className="text-sm font-semibold text-white font-mono">{run.kind}</span>
                      </div>
                      <span className="text-[10px] text-gray-500 font-mono">
                        {new Date(run.startedAt).toLocaleString("ja-JP")}
                      </span>
                    </div>
                    {run.summary && (
                      <p className="text-xs text-gray-300 mb-2 whitespace-pre-wrap font-sans">{run.summary}</p>
                    )}
                    {run.errorMessage && (
                      <p className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded p-2 mb-2 font-mono">
                        エラー: {run.errorMessage}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">Trigger: {run.triggeredBy}</span>
                      <button
                        onClick={() => fetchRunDetail(run.id)}
                        className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        {isSelected ? "詳細を閉じる ▲" : "ステップ詳細を表示 ▼"}
                      </button>
                    </div>
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
        </details>

        {/* ===== メインコンテンツ (2カラム) ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 左: 思考ログ (既定で折りたたみ。主役はプランのため副次情報として下部に格納) */}
          <details className="card-surface rounded-xl overflow-hidden self-start">
            <summary className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 cursor-pointer select-none">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>🧠</span> 思考ログ
              </h2>
              <span className="text-xs text-gray-500">{thinkingLog.length}件</span>
            </summary>
            <div className="h-80 sm:h-96 overflow-y-auto">
              {thinkingLog.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-gray-500">
                    {isRunning ? "ログを待っています..." : "エージェントを起動してください"}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-700/30">
                  {thinkingLog.map((entry, idx) => {
                    const entryState = getStateDisplay(entry.state);
                    return (
                      <div key={idx} className="px-4 py-3 hover:bg-slate-700/20 transition-colors">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${entryState.bg} ${entryState.color}`}>
                            {entryState.icon} {entryState.label}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            #{entry.cycle} • {new Date(entry.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-sm text-white font-medium">{entry.action}</p>
                        {entry.reasoning && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{entry.reasoning}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>

          {/* 右: 現在の戦略 + オープンポジション (既定で折りたたみ。主役はプランのため副次情報として格納) */}
          <details className="card-surface rounded-xl overflow-hidden self-start">
            <summary className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 cursor-pointer select-none">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>📋</span> ポジション & 戦略
              </h2>
            </summary>
            <div className="h-80 sm:h-96 overflow-y-auto">
              {/* オープンポジション */}
              {(status?.memory?.openPositions?.length ?? 0) > 0 && (
                <div className="px-4 py-3 border-b border-slate-700/30">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                    オープンポジション
                  </p>
                  {status?.memory?.openPositions?.map((pos) => (
                    <div
                      key={pos.tradeId}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-700/30 mb-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${pos.direction === "long" ? "text-green-400" : "text-red-400"}`}>
                          {pos.direction === "long" ? "▲ LONG" : "▼ SHORT"}
                        </span>
                        <span className="text-sm text-white font-mono">{pos.symbol}</span>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${pos.currentPnlPips >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {pos.currentPnlPips >= 0 ? "+" : ""}{pos.currentPnlPips.toFixed(1)} pips
                        </p>
                        <p className="text-[10px] text-gray-500">@{pos.entryPrice}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 学び (既定で折りたたみ) */}
              <details className="px-4 py-3">
                <summary className="text-xs text-gray-500 uppercase tracking-wider mb-2 cursor-pointer select-none">
                  💡 AIの学び ({lessons.length})
                </summary>
                {lessons.length === 0 ? (
                  <p className="text-xs text-gray-500 mt-2">まだ学びがありません</p>
                ) : (
                  <div className="space-y-2 mt-2">
                    {lessons.slice(-5).reverse().map((lesson, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10"
                      >
                        <span className="text-cyan-400 text-xs mt-0.5">•</span>
                        <p className="text-xs text-gray-300">{lesson}</p>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            </div>
          </details>
        </div>

        {/* ===== 最近のトレード結果 ===== */}
        <div className="card-surface rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>📈</span> 最近のトレード結果
            </h2>
            <Link
              href="/side-b/trades"
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              すべて表示 →
            </Link>
          </div>
          {recentResults.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-500">まだトレード結果がありません</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/30">
              {recentResults.slice(0, 5).map((result) => (
                <div key={result.id} className="px-4 py-3 hover:bg-slate-700/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {result.outcome === "win" ? "✅" : result.outcome === "loss" ? "❌" : "➖"}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-white">{result.symbol}</span>
                          <span className={`text-xs font-bold ${result.direction === "long" ? "text-green-400" : "text-red-400"}`}>
                            {result.direction === "long" ? "▲" : "▼"} {result.direction.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-500">
                          {new Date(result.tradedAt).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" })}
                          {" "}{result.exitReason}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${result.pnlPips >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {result.pnlPips >= 0 ? "+" : ""}{result.pnlPips.toFixed(1)} pips
                      </p>
                    </div>
                  </div>
                  {result.reflection && (
                    <div className="mt-2 ml-9 px-3 py-2 rounded-lg bg-slate-700/30">
                      <p className="text-xs text-gray-400">{result.reflection}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="text-center mt-6 text-xs text-gray-500">
          <p>TradeAssistant-AI • 手動更新（右上の「更新」ボタン）</p>
        </div>
      </main>
    </div>
  );
}
