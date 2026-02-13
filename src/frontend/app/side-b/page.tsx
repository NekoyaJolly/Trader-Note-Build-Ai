/**
 * Side-B: AI Agent Dashboard
 *
 * 自律型トレーディング AI のダッシュボード
 * - エージェント状態・サイクル・勝率
 * - 思考ログ（リアルタイム更新）
 * - 現在の戦略
 * - トレード結果 + 学び
 *
 * @see docs/side-b/TradeAssistant-AI.md
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// APIベースURL
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "") + "/api/side-b";

// 自動更新間隔（ミリ秒）
const REFRESH_INTERVAL = 15_000;

// --- 型定義 ---

interface AgentStatus {
  isRunning: boolean;
  state: string;
  cycleCount: number;
  watchSymbols: string[];
  memory: {
    currentState: string;
    recentTradeResults: TradeResult[];
    openPositions: OpenPosition[];
    lessons: string[];
    cycleCount: number;
  };
}

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

// --- ナビリンク ---

const navLinks = [
  { icon: "📊", label: "Trades", href: "/side-b/trades" },
  { icon: "📝", label: "AI Notes", href: "/side-b/ai-notes" },
  { icon: "🔍", label: "Comparison", href: "/side-b/comparison" },
  { icon: "⚙️", label: "Settings", href: "/side-b/settings" },
];

export default function SideBDashboard() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [thinkingLog, setThinkingLog] = useState<ThinkingLogEntry[]>([]);
  const [lessons, setLessons] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- データ取得 ---

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, logRes, lessonsRes] = await Promise.allSettled([
        fetch(`${API_BASE}/agent/status`),
        fetch(`${API_BASE}/agent/thinking-log?limit=20`),
        fetch(`${API_BASE}/agent/lessons`),
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value.ok) {
        setStatus(await statusRes.value.json());
      }
      if (logRes.status === "fulfilled" && logRes.value.ok) {
        const data = await logRes.value.json();
        setThinkingLog(data.log || []);
      }
      if (lessonsRes.status === "fulfilled" && lessonsRes.value.ok) {
        const data = await lessonsRes.value.json();
        setLessons(data.lessons || []);
      }

      setError(null);
    } catch (err) {
      setError("データ取得に失敗しました");
      console.error("[Dashboard] fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // --- エージェント制御 ---

  const startAgent = async () => {
    setIsStarting(true);
    try {
      const res = await fetch(`${API_BASE}/agent/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const res = await fetch(`${API_BASE}/agent/stop`, { method: "POST" });
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

          {/* ナビゲーション */}
          <div className="flex items-center gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-slate-700/50 transition-colors"
              >
                <span>{link.icon}</span>
                <span className="hidden sm:inline">{link.label}</span>
              </Link>
            ))}
          </div>
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

              {/* Start/Stop ボタン */}
              {!isRunning ? (
                <button
                  onClick={startAgent}
                  disabled={isStarting}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  {isStarting ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "▶"
                  )}
                  <span>{isStarting ? "起動中..." : "Start"}</span>
                </button>
              ) : (
                <button
                  onClick={stopAgent}
                  disabled={isStopping}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-red-500 to-rose-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  {isStopping ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "⏹"
                  )}
                  <span>{isStopping ? "停止中..." : "Stop"}</span>
                </button>
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

          {error && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* ===== メインコンテンツ (2カラム) ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 左: 思考ログ */}
          <div className="card-surface rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>🧠</span> 思考ログ
              </h2>
              <span className="text-xs text-gray-500">{thinkingLog.length}件</span>
            </div>
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
          </div>

          {/* 右: 現在の戦略 + オープンポジション */}
          <div className="card-surface rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>📋</span> ポジション & 戦略
              </h2>
            </div>
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

              {/* 学び */}
              <div className="px-4 py-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  💡 AIの学び ({lessons.length})
                </p>
                {lessons.length === 0 ? (
                  <p className="text-xs text-gray-500">まだ学びがありません</p>
                ) : (
                  <div className="space-y-2">
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
              </div>
            </div>
          </div>
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
          <p>
            TradeAssistant-AI • 自動更新 {REFRESH_INTERVAL / 1000}秒
            <span className="ml-2 inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          </p>
        </div>
      </main>
    </div>
  );
}
