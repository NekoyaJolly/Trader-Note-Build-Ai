"use client";

/**
 * ストラテジー横断分析ページ
 * 
 * 機能:
 * - 複数ストラテジーのパフォーマンス比較
 * - 相関分析（ピアソン/スピアマン）
 * - ポートフォリオ最適化シミュレーション
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  fetchStrategies,
  fetchComparisonSessions,
  createComparisonSession,
  deleteComparisonSession,
  runPortfolioOptimization,
  type ComparisonSession,
  type StrategyPerformance,
  type OptimizationMethod,
  type OptimizationResult,
} from "@/lib/api";
import type { StrategyDirection } from "@/types/strategy";

// ============================================
// 型定義
// ============================================

interface Strategy {
  id: string;
  name: string;
  symbol: string;
  side: StrategyDirection;
  status: string;
}

// ============================================
// コンポーネント
// ============================================

export default function StrategyComparisonPage() {
  // 状態管理
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [sessions, setSessions] = useState<ComparisonSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ComparisonSession | null>(null);
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // フォーム状態
  const [sessionName, setSessionName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [timeframe, setTimeframe] = useState("1h");
  const [optimizationMethod, setOptimizationMethod] = useState<OptimizationMethod>("equal_weight");
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  
  // データ取得
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [strategiesRes, sessionsRes] = await Promise.all([
        fetchStrategies(),
        fetchComparisonSessions(20, 0),
      ]);
      
      setStrategies(strategiesRes);
      setSessions(sessionsRes.sessions);
      
      // デフォルト日付を設定（過去90日）
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 90);
      setEndDate(end.toISOString().split("T")[0]);
      setStartDate(start.toISOString().split("T")[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    loadData();
  }, [loadData]);
  
  // ストラテジー選択トグル
  const toggleStrategy = (id: string) => {
    setSelectedStrategies((prev) =>
      prev.includes(id)
        ? prev.filter((s) => s !== id)
        : prev.length < 10
        ? [...prev, id]
        : prev
    );
  };
  
  // 比較セッション作成
  const handleCreateSession = async () => {
    if (selectedStrategies.length < 2) {
      setError("比較には2つ以上のストラテジーを選択してください");
      return;
    }
    if (!sessionName.trim()) {
      setError("セッション名を入力してください");
      return;
    }
    
    try {
      setCreating(true);
      setError(null);
      
      const session = await createComparisonSession({
        name: sessionName,
        strategyIds: selectedStrategies,
        startDate,
        endDate,
        timeframe,
      });
      
      setSessions((prev) => [session, ...prev]);
      setSelectedSession(session);
      setSessionName("");
      setSelectedStrategies([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "セッションの作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };
  
  // セッション削除
  const handleDeleteSession = async (id: string) => {
    if (!confirm("このセッションを削除しますか？")) return;
    
    try {
      await deleteComparisonSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (selectedSession?.id === id) {
        setSelectedSession(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "セッションの削除に失敗しました");
    }
  };
  
  // ポートフォリオ最適化
  const handleOptimize = async () => {
    if (!selectedSession) return;
    
    try {
      setOptimizing(true);
      setError(null);
      
      const result = await runPortfolioOptimization(selectedSession.id, {
        method: optimizationMethod,
        riskFreeRate: 0,
      });
      
      setOptimizationResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "最適化に失敗しました");
    } finally {
      setOptimizing(false);
    }
  };
  
  // ローディング表示
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-cyan-400 animate-pulse text-lg">読み込み中...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* ヘッダー */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/strategies"
              className="text-slate-400 hover:text-cyan-400 transition-colors"
            >
              ← ストラテジー一覧
            </Link>
            <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
              ストラテジー横断分析
            </h1>
          </div>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
            {error}
          </div>
        )}
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左カラム: ストラテジー選択 & セッション作成 */}
          <div className="lg:col-span-1 space-y-6">
            {/* ストラテジー選択 */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">
                ストラテジー選択
                <span className="text-sm text-slate-400 ml-2">
                  ({selectedStrategies.length}/10)
                </span>
              </h2>
              
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {strategies.map((strategy) => (
                  <label
                    key={strategy.id}
                    className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedStrategies.includes(strategy.id)
                        ? "bg-cyan-500/20 border border-cyan-500/50"
                        : "bg-slate-700/50 border border-transparent hover:bg-slate-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedStrategies.includes(strategy.id)}
                      onChange={() => toggleStrategy(strategy.id)}
                      className="rounded border-slate-600 text-cyan-500 focus:ring-cyan-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-200 truncate">
                        {strategy.name}
                      </div>
                      <div className="text-xs text-slate-400">
                        {strategy.symbol} / {strategy.side === "buy" ? "買い" : "売り"}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            
            {/* セッション作成フォーム */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">
                新規比較セッション
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    セッション名
                  </label>
                  <input
                    type="text"
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    placeholder="例: 2025年Q1比較"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">
                      開始日
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">
                      終了日
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    時間足
                  </label>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="15m">15分足</option>
                    <option value="30m">30分足</option>
                    <option value="1h">1時間足</option>
                    <option value="4h">4時間足</option>
                    <option value="1d">日足</option>
                  </select>
                </div>
                
                <button
                  onClick={handleCreateSession}
                  disabled={creating || selectedStrategies.length < 2}
                  className="w-full py-2 px-4 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-medium rounded-lg hover:from-cyan-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {creating ? "作成中..." : "比較セッションを作成"}
                </button>
              </div>
            </div>
            
            {/* セッション履歴 */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">
                セッション履歴
              </h2>
              
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {sessions.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">
                    セッションがありません
                  </p>
                ) : (
                  sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedSession?.id === session.id
                          ? "bg-cyan-500/20 border border-cyan-500/50"
                          : "bg-slate-700/50 hover:bg-slate-700"
                      }`}
                      onClick={() => {
                        setSelectedSession(session);
                        setOptimizationResult(null);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-slate-200">
                          {session.name}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(session.id);
                          }}
                          className="text-slate-500 hover:text-red-400 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {session.results.length}ストラテジー / {session.startDate} 〜 {session.endDate}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          
          {/* 右カラム: 分析結果 */}
          <div className="lg:col-span-2 space-y-6">
            {selectedSession ? (
              <>
                {/* パフォーマンス比較表 */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 overflow-x-auto">
                  <h2 className="text-lg font-semibold text-slate-100 mb-4">
                    パフォーマンス比較
                  </h2>
                  
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="text-left py-2 px-3">ストラテジー</th>
                        <th className="text-right py-2 px-3">トレード数</th>
                        <th className="text-right py-2 px-3">勝率</th>
                        <th className="text-right py-2 px-3">PF</th>
                        <th className="text-right py-2 px-3">純損益</th>
                        <th className="text-right py-2 px-3">最大DD</th>
                        <th className="text-right py-2 px-3">シャープ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSession.results.map((result) => (
                        <tr
                          key={result.strategyId}
                          className="border-b border-slate-700/50 hover:bg-slate-700/30"
                        >
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-200">
                              {result.strategyName}
                            </div>
                            <div className="text-xs text-slate-400">
                              {result.symbol} / {result.side === "buy" ? "買い" : "売り"}
                            </div>
                          </td>
                          <td className="text-right py-3 px-3 text-slate-300">
                            {result.totalTrades}
                          </td>
                          <td className="text-right py-3 px-3">
                            <span
                              className={
                                result.winRate >= 0.5
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {(result.winRate * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="text-right py-3 px-3">
                            <span
                              className={
                                (result.profitFactor || 0) >= 1
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {result.profitFactor?.toFixed(2) || "-"}
                            </span>
                          </td>
                          <td className="text-right py-3 px-3">
                            <span
                              className={
                                result.netProfit >= 0
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {result.netProfit >= 0 ? "+" : ""}
                              {result.netProfit.toLocaleString()}
                            </span>
                          </td>
                          <td className="text-right py-3 px-3 text-red-400">
                            -{result.maxDrawdown.toLocaleString()}
                          </td>
                          <td className="text-right py-3 px-3">
                            <span
                              className={
                                (result.sharpeRatio || 0) >= 1
                                  ? "text-green-400"
                                  : (result.sharpeRatio || 0) >= 0
                                  ? "text-yellow-400"
                                  : "text-red-400"
                              }
                            >
                              {result.sharpeRatio?.toFixed(2) || "-"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* サマリー */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                  <h2 className="text-lg font-semibold text-slate-100 mb-4">
                    ベスト指標
                  </h2>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-900/50 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">最高勝率</div>
                      <div className="text-lg font-bold text-green-400">
                        {(selectedSession.summary.bestWinRate.value * 100).toFixed(1)}%
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {selectedSession.summary.bestWinRate.strategyName}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">最高PF</div>
                      <div className="text-lg font-bold text-green-400">
                        {selectedSession.summary.bestProfitFactor.value.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {selectedSession.summary.bestProfitFactor.strategyName}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">最小DD</div>
                      <div className="text-lg font-bold text-cyan-400">
                        {selectedSession.summary.lowestDrawdown.value.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {selectedSession.summary.lowestDrawdown.strategyName}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">最高シャープ</div>
                      <div className="text-lg font-bold text-purple-400">
                        {selectedSession.summary.bestSharpe.value.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {selectedSession.summary.bestSharpe.strategyName}
                      </div>
                    </div>
                  </div>
                  
                  {selectedSession.summary.recommendations.length > 0 && (
                    <div className="mt-4 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                      <div className="text-sm font-medium text-cyan-400 mb-2">
                        💡 レコメンデーション
                      </div>
                      <ul className="text-sm text-slate-300 space-y-1">
                        {selectedSession.summary.recommendations.map((rec, i) => (
                          <li key={i}>• {rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                
                {/* 相関マトリクス */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 overflow-x-auto">
                  <h2 className="text-lg font-semibold text-slate-100 mb-4">
                    相関マトリクス（ピアソン）
                  </h2>
                  
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="text-left py-2 px-2"></th>
                        {selectedSession.correlations.strategyNames.map((name, i) => (
                          <th key={i} className="text-center py-2 px-2 max-w-[100px] truncate">
                            {name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSession.correlations.strategyNames.map((name, i) => (
                        <tr key={i} className="border-t border-slate-700/50">
                          <td className="py-2 px-2 text-slate-300 font-medium max-w-[100px] truncate">
                            {name}
                          </td>
                          {selectedSession.correlations.pearson[i].map((corr, j) => (
                            <td
                              key={j}
                              className="text-center py-2 px-2"
                              style={{
                                backgroundColor:
                                  i === j
                                    ? "transparent"
                                    : corr > 0.5
                                    ? `rgba(239, 68, 68, ${corr * 0.5})`
                                    : corr < -0.3
                                    ? `rgba(34, 197, 94, ${Math.abs(corr) * 0.5})`
                                    : `rgba(148, 163, 184, ${Math.abs(corr) * 0.3})`,
                              }}
                            >
                              <span className="text-slate-200">
                                {i === j ? "-" : corr.toFixed(2)}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded bg-red-500/50"></span>
                      高相関（分散効果低）
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded bg-green-500/50"></span>
                      負相関（分散効果高）
                    </span>
                  </div>
                </div>
                
                {/* ポートフォリオ最適化 */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                  <h2 className="text-lg font-semibold text-slate-100 mb-4">
                    ポートフォリオ最適化
                  </h2>
                  
                  <div className="flex flex-wrap items-end gap-4 mb-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">
                        最適化手法
                      </label>
                      <select
                        value={optimizationMethod}
                        onChange={(e) => setOptimizationMethod(e.target.value as OptimizationMethod)}
                        className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                      >
                        <option value="equal_weight">等ウェイト</option>
                        <option value="risk_parity">リスクパリティ</option>
                        <option value="minimum_variance">最小分散</option>
                        <option value="max_sharpe">最大シャープ</option>
                        <option value="mean_variance">平均分散（マーコビッツ）</option>
                      </select>
                    </div>
                    
                    <button
                      onClick={handleOptimize}
                      disabled={optimizing}
                      className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {optimizing ? "計算中..." : "最適化を実行"}
                    </button>
                  </div>
                  
                  {optimizationResult && (
                    <div className="bg-slate-900/50 rounded-lg p-4">
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                          <div className="text-xs text-slate-400 mb-1">期待リターン（年率）</div>
                          <div className="text-lg font-bold text-green-400">
                            {(optimizationResult.expectedReturn * 100).toFixed(2)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400 mb-1">期待リスク（年率）</div>
                          <div className="text-lg font-bold text-yellow-400">
                            {(optimizationResult.expectedRisk * 100).toFixed(2)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400 mb-1">シャープレシオ</div>
                          <div className="text-lg font-bold text-purple-400">
                            {optimizationResult.sharpeRatio?.toFixed(2) || "-"}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-sm text-slate-400 mb-2">推奨配分比率</div>
                      <div className="space-y-2">
                        {optimizationResult.weights.map((w) => (
                          <div key={w.strategyId} className="flex items-center gap-3">
                            <div className="flex-1 text-sm text-slate-300 truncate">
                              {w.strategyName}
                            </div>
                            <div className="w-32 bg-slate-700 rounded-full h-2">
                              <div
                                className="bg-gradient-to-r from-cyan-500 to-purple-500 h-2 rounded-full"
                                style={{ width: `${w.weight * 100}%` }}
                              />
                            </div>
                            <div className="w-16 text-right text-sm font-medium text-slate-200">
                              {(w.weight * 100).toFixed(1)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <div className="text-4xl mb-4">📊</div>
                <h2 className="text-xl font-semibold text-slate-200 mb-2">
                  ストラテジーを比較しましょう
                </h2>
                <p className="text-slate-400">
                  左側から2つ以上のストラテジーを選択し、比較セッションを作成してください。
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

