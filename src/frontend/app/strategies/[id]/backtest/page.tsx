/**
 * ストラテジーバックテスト画面
 * 
 * 目的:
 * - バックテストの実行パラメータを設定
 * - バックテスト結果の表示（サマリー、トレード一覧）
 * - バックテスト履歴の閲覧
 * - モンテカルロシミュレーション（Phase 15）
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchStrategy,
  runStrategyBacktest,
  fetchStrategyBacktestHistory,
  fetchStrategyBacktestResult,
  createNotesFromBacktest,
  runWalkForwardTest,
  fetchWalkForwardHistory,
  fetchFilterAnalysis,
  verifyFilters,
  checkBacktestDataCoverage,
  BacktestHistoryItem,
  WalkForwardResult,
  FilterAnalysisResult,
  FilterVerifyResult,
  FilterCondition,
  AnalysisIndicator,
  CoverageCheckResult,
} from "@/lib/api";
import type { Strategy, BacktestResult, BacktestResultSummary, BacktestTradeEvent } from "@/types/strategy";
import { MonteCarloTab } from "@/components/MonteCarloTab";

// ============================================
// 型定義
// ============================================

/** バックテスト実行パラメータ */
interface BacktestParams {
  startDate: string;
  endDate: string;
  stage1Timeframe: "15m" | "30m" | "1h" | "4h" | "1d";
  enableStage2: boolean;
  initialCapital: number;
  lotSize: number; // 固定ロット数（通貨量、例: 10000 = 1万通貨）
  leverage: number; // レバレッジ（1〜1000倍）
}

// BacktestHistoryItemはlib/api.tsからインポート

// ============================================
// サブコンポーネント
// ============================================

/** パフォーマンスメトリクスカード（コンパクト版） */
function MetricCard({ 
  label, 
  value, 
  unit, 
  color = "text-white" 
}: { 
  label: string; 
  value: number | string; 
  unit?: string;
  color?: string;
}) {
  return (
    <div className="bg-slate-700/50 rounded px-2 py-1.5 sm:px-3 sm:py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400 truncate">{label}</span>
        <span className={`text-sm sm:text-base font-semibold ${color} whitespace-nowrap`}>
          {typeof value === "number" ? value.toLocaleString() : value}
          {unit && <span className="text-xs ml-0.5 text-gray-500">{unit}</span>}
        </span>
      </div>
    </div>
  );
}

/** トレード結果テーブル */
function TradeResultTable({ trades }: { trades: BacktestTradeEvent[] }) {
  if (!trades || trades.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8">
        トレード履歴がありません
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-700 text-gray-300">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">エントリー日時</th>
            <th className="px-3 py-2 text-right">エントリー価格</th>
            <th className="px-3 py-2 text-left">決済日時</th>
            <th className="px-3 py-2 text-right">決済価格</th>
            <th className="px-3 py-2 text-center">方向</th>
            <th className="px-3 py-2 text-center">決済理由</th>
            <th className="px-3 py-2 text-right">損益</th>
            <th className="px-3 py-2 text-right">損益率</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {trades.map((trade, index) => (
            <tr key={trade.eventId} className="hover:bg-slate-700/50">
              <td className="px-3 py-2 text-gray-400">{index + 1}</td>
              <td className="px-3 py-2 text-gray-200">
                {new Date(trade.entryTime).toLocaleString("ja-JP")}
              </td>
              <td className="px-3 py-2 text-right text-gray-200">
                {trade.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className="px-3 py-2 text-gray-200">
                {new Date(trade.exitTime).toLocaleString("ja-JP")}
              </td>
              <td className="px-3 py-2 text-right text-gray-200">
                {trade.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className="px-3 py-2 text-center">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  trade.side === "buy" 
                    ? "bg-green-600/30 text-green-400"
                    : "bg-red-600/30 text-red-400"
                }`}>
                  {trade.side === "buy" ? "買い" : "売り"}
                </span>
              </td>
              <td className="px-3 py-2 text-center">
                <span className={`px-2 py-0.5 rounded text-xs ${
                  trade.exitReason === "take_profit"
                    ? "bg-green-600/30 text-green-400"
                    : trade.exitReason === "stop_loss"
                    ? "bg-red-600/30 text-red-400"
                    : "bg-gray-600/30 text-gray-400"
                }`}>
                  {trade.exitReason === "take_profit" ? "利確" 
                    : trade.exitReason === "stop_loss" ? "損切" 
                    : trade.exitReason === "timeout" ? "タイムアウト"
                    : "シグナル"}
                </span>
              </td>
              <td className={`px-3 py-2 text-right font-medium ${
                trade.pnl >= 0 ? "text-green-400" : "text-red-400"
              }`}>
                {trade.pnl >= 0 ? "+" : ""}{trade.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className={`px-3 py-2 text-right font-medium ${
                trade.pnlPercent >= 0 ? "text-green-400" : "text-red-400"
              }`}>
                {trade.pnlPercent >= 0 ? "+" : ""}{(trade.pnlPercent * 100).toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** バックテスト履歴リスト（コンパクト版） */
function BacktestHistoryList({ 
  history, 
  onSelect 
}: { 
  history: BacktestHistoryItem[]; 
  onSelect: (id: string) => void;
}) {
  if (!history || history.length === 0) {
    return (
      <div className="text-center text-gray-500 py-3 text-xs">
        バックテスト履歴がありません
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {history.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className="w-full text-left bg-slate-700/50 hover:bg-slate-600/50 rounded px-2 py-1.5 transition-colors border border-slate-600/50 hover:border-cyan-500/30"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {new Date(item.executedAt).toLocaleString("ja-JP")}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              item.status === "completed" 
                ? "bg-green-600/30 text-green-400"
                : item.status === "failed"
                ? "bg-red-600/30 text-red-400"
                : "bg-yellow-600/30 text-yellow-400"
            }`}>
              {item.status === "completed" ? "完了" 
                : item.status === "failed" ? "失敗" 
                : "実行中"}
            </span>
          </div>
          {item.summary && (
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-gray-500">
                勝率: <span className="text-cyan-400">{(item.summary.winRate * 100).toFixed(1)}%</span>
              </span>
              <span className="text-gray-500">
                PF: <span className="text-cyan-400">{item.summary.profitFactor.toFixed(2)}</span>
              </span>
              <span className="text-gray-500">
                {item.summary.totalTrades}件
              </span>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export default function StrategyBacktestPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = params.id as string;

  // ストラテジー情報
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  
  // バックテスト実行パラメータ
  const [backtestParams, setBacktestParams] = useState<BacktestParams>({
    startDate: getDefaultStartDate(),
    endDate: getDefaultEndDate(),
    stage1Timeframe: "1h",
    enableStage2: false,
    initialCapital: 1000000,
    lotSize: 10000, // デフォルト1万通貨
    leverage: 25, // デフォルト25倍
  });

  // バックテスト結果
  const [result, setResult] = useState<BacktestResult | null>(null);
  
  // バックテスト履歴
  const [history, setHistory] = useState<BacktestHistoryItem[]>([]);
  
  // UIステート
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "trades" | "history" | "walkforward" | "filter" | "montecarlo">("summary");
  
  // ウォークフォワードテストステート
  const [walkForwardParams, setWalkForwardParams] = useState({
    splitCount: 5,
    startDate: getDefaultStartDate(),
    endDate: getDefaultEndDate(),
  });
  const [walkForwardResult, setWalkForwardResult] = useState<WalkForwardResult | null>(null);
  const [walkForwardHistory, setWalkForwardHistory] = useState<WalkForwardResult[]>([]);
  const [runningWalkForward, setRunningWalkForward] = useState(false);
  
  // フィルター分析ステート
  const [filterAnalysis, setFilterAnalysis] = useState<FilterAnalysisResult | null>(null);
  const [filterVerifyResult, setFilterVerifyResult] = useState<FilterVerifyResult | null>(null);
  const [selectedFilters, setSelectedFilters] = useState<FilterCondition[]>([]);
  const [loadingFilter, setLoadingFilter] = useState(false);
  const [verifyingFilter, setVerifyingFilter] = useState(false);
  
  // ノート作成ステート
  const [creatingNotes, setCreatingNotes] = useState(false);
  const [noteCreationResult, setNoteCreationResult] = useState<{
    success: boolean;
    message: string;
    createdCount?: number;
  } | null>(null);

  // データカバレッジチェックステート
  const [coverageCheckResult, setCoverageCheckResult] = useState<CoverageCheckResult | null>(null);
  const [showCoverageDialog, setShowCoverageDialog] = useState(false);
  const [checkingCoverage, setCheckingCoverage] = useState(false);

  /** デフォルト開始日（3ヶ月前）を取得 */
  function getDefaultStartDate(): string {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return date.toISOString().split("T")[0];
  }

  /** デフォルト終了日（今日）を取得 */
  function getDefaultEndDate(): string {
    return new Date().toISOString().split("T")[0];
  }

  // ============================================
  // データ取得
  // ============================================

  /** ストラテジーとバックテスト履歴を取得 */
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ストラテジーを取得
      const strategyData = await fetchStrategy(strategyId);
      setStrategy(strategyData);

      // バックテスト履歴を取得
      const historyData = await fetchStrategyBacktestHistory(strategyId);
      setHistory(historyData);

      // ウォークフォワード履歴を取得
      try {
        const wfHistory = await fetchWalkForwardHistory(strategyId);
        setWalkForwardHistory(wfHistory);
      } catch {
        // ウォークフォワード履歴取得失敗は無視
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : "データの取得に失敗しました";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [strategyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ============================================
  // イベントハンドラ
  // ============================================

  /** パラメータ変更 */
  const handleParamChange = (key: keyof BacktestParams, value: string | number | boolean) => {
    setBacktestParams((prev) => ({ ...prev, [key]: value }));
  };

  /** 
   * バックテスト実行前にデータカバレッジをチェック
   * 95%未満の場合のみダイアログで確認を求める
   */
  const handleRunBacktestWithCoverageCheck = async () => {
    if (!strategy) return;

    try {
      setCheckingCoverage(true);
      setError(null);

      // カバレッジチェック実行
      const coverage = await checkBacktestDataCoverage(
        strategy.symbol,
        backtestParams.stage1Timeframe,
        backtestParams.startDate,
        backtestParams.endDate
      );

      setCoverageCheckResult(coverage);

      // 95%以上のカバレッジがあれば警告なしで直接実行
      if (coverage.hasEnoughData) {
        await executeBacktest();
      } else {
        // 95%未満の場合はダイアログ表示
        setShowCoverageDialog(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "カバレッジチェックに失敗しました";
      setError(message);
    } finally {
      setCheckingCoverage(false);
    }
  };

  /** バックテスト実行（実際の処理） */
  const executeBacktest = async () => {
    try {
      setRunning(true);
      setError(null);
      setShowCoverageDialog(false);

      const resultData = await runStrategyBacktest(strategyId, {
        startDate: backtestParams.startDate,
        endDate: backtestParams.endDate,
        stage1Timeframe: backtestParams.stage1Timeframe,
        enableStage2: backtestParams.enableStage2,
        initialCapital: backtestParams.initialCapital,
        lotSize: backtestParams.lotSize,
        leverage: backtestParams.leverage,
      });

      setResult(resultData);
      setActiveTab("summary");

      // 履歴を再取得
      const historyData = await fetchStrategyBacktestHistory(strategyId);
      setHistory(historyData);

    } catch (err) {
      const message = err instanceof Error ? err.message : "バックテストの実行に失敗しました";
      setError(message);
    } finally {
      setRunning(false);
    }
  };

  /** 履歴から結果を選択 */
  const handleSelectHistory = async (historyId: string) => {
    try {
      setError(null);
      // 選択した履歴の結果を取得
      const resultData = await fetchStrategyBacktestResult(strategyId, historyId);
      setResult(resultData);
      setActiveTab("summary");
      // フィルター分析結果をリセット（新しい結果に切り替わったため）
      setFilterAnalysis(null);
      setFilterVerifyResult(null);
      setSelectedFilters([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "結果の取得に失敗しました";
      setError(message);
    }
  };

  /** ウォークフォワードテストを実行 */
  const handleRunWalkForward = async () => {
    try {
      setRunningWalkForward(true);
      setError(null);

      // バックテストパラメータの時間足をウォークフォワードにも適用
      const result = await runWalkForwardTest(strategyId, {
        splitCount: walkForwardParams.splitCount,
        startDate: walkForwardParams.startDate,
        endDate: walkForwardParams.endDate,
        timeframe: backtestParams.stage1Timeframe, // 時間足を追加
        initialCapital: backtestParams.initialCapital,
        positionSize: backtestParams.lotSize,
      });

      setWalkForwardResult(result);

      // 履歴を再取得
      const wfHistory = await fetchWalkForwardHistory(strategyId);
      setWalkForwardHistory(wfHistory);
    } catch (err) {
      const message = err instanceof Error ? err.message : "ウォークフォワードテストの実行に失敗しました";
      setError(message);
    } finally {
      setRunningWalkForward(false);
    }
  };

  /** 勝ちトレードからノートを作成 */
  const handleCreateNotesFromWins = async () => {
    // バックテスト結果がない、またはバックテストランIDがない場合は何もしない
    if (!result?.id) {
      setError("バックテスト結果IDがありません");
      return;
    }

    // 勝ちトレードが存在するか確認
    const winningTrades = result.trades.filter(
      (t) => t.pnl > 0 || t.exitReason === "take_profit"
    );
    if (winningTrades.length === 0) {
      setError("勝ちトレードがありません");
      return;
    }

    try {
      setCreatingNotes(true);
      setNoteCreationResult(null);
      setError(null);

      // バックテスト結果からノートを作成（勝ちトレードのみ）
      const response = await createNotesFromBacktest(
        strategyId,
        result.id,
        true // winningOnly: 勝ちトレードのみ
      );

      setNoteCreationResult({
        success: true,
        message: `${response.createdCount}件のノートを作成しました`,
        createdCount: response.createdCount,
      });
    } catch (err) {
      const message = err instanceof Error 
        ? err.message 
        : "ノートの作成に失敗しました";
      setNoteCreationResult({
        success: false,
        message,
      });
    } finally {
      setCreatingNotes(false);
    }
  };

  /** ノート一覧ページへ遷移 */
  const handleGoToNotes = () => {
    router.push(`/strategies/${strategyId}/notes`);
  };

  // ============================================
  // レンダリング
  // ============================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="text-center py-12">
        <div className="text-red-400 mb-4">ストラテジーが見つかりません</div>
        <Link
          href="/strategies"
          className="text-blue-400 hover:underline"
        >
          ストラテジー一覧に戻る
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* データカバレッジ不足ダイアログ */}
      {showCoverageDialog && coverageCheckResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              ⚠️ データ不足の警告
            </h3>
            <div className="text-gray-300 mb-4 space-y-2">
              <p>
                選択した期間のヒストリカルデータが不足しています（カバレッジ率95%未満）。
              </p>
              <div className="bg-slate-700 rounded p-3 text-sm">
                <p>カバレッジ率: <span className="font-bold text-yellow-400">{(coverageCheckResult.coverageRatio * 100).toFixed(1)}%</span></p>
                <p>期待バー数: {coverageCheckResult.expectedBars}</p>
                <p>実際のバー数: {coverageCheckResult.actualBars}</p>
                <p>不足バー数: <span className="text-red-400">{coverageCheckResult.missingBars}</span></p>
              </div>
              <p className="text-sm text-gray-400">
                既存データのみでバックテストを実行しますか？
                より正確な結果を得るには、プリセット管理画面から
                ヒストリカルデータをインポートしてください。
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCoverageDialog(false)}
                className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={executeBacktest}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                既存データのみでテスト
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3 sm:space-y-4">
          {/* エラー表示 */}
          {error && (
            <div className="bg-red-600/20 border border-red-500/50 text-red-400 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
            {/* 左カラム: 実行パラメータ */}
            <div className="lg:col-span-1">
              <div className="card-surface p-3 sm:p-4">
                <h2 className="text-sm sm:text-base font-semibold text-white mb-3">
                  実行パラメータ
                </h2>

                {/* 期間設定 */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      開始日
                    </label>
                    <input
                      type="date"
                      value={backtestParams.startDate}
                      onChange={(e) => handleParamChange("startDate", e.target.value)}
                      className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      終了日
                    </label>
                    <input
                      type="date"
                      value={backtestParams.endDate}
                      onChange={(e) => handleParamChange("endDate", e.target.value)}
                      className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    />
                  </div>
                </div>

                {/* Stage1 時間足 */}
                <div className="mb-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-400">時間足</label>
                    <select
                      value={backtestParams.stage1Timeframe}
                      onChange={(e) => handleParamChange("stage1Timeframe", e.target.value)}
                      className="bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    >
                      <option value="15m">15分</option>
                      <option value="30m">30分</option>
                      <option value="1h">1時間</option>
                      <option value="4h">4時間</option>
                      <option value="1d">日足</option>
                    </select>
                  </div>
                </div>

                {/* Stage2 有効化 */}
                <div className="mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={backtestParams.enableStage2}
                      onChange={(e) => handleParamChange("enableStage2", e.target.checked)}
                      className="w-3.5 h-3.5 bg-slate-700 border-slate-600 rounded focus:ring-1 focus:ring-cyan-500/50"
                    />
                    <span className="text-xs text-gray-300">
                      Stage2 精密検証
                    </span>
                  </label>
                </div>

                {/* 資金・ロット設定 */}
                <div className="space-y-2 mb-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-400">初期資金</label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={backtestParams.initialCapital}
                        onChange={(e) => handleParamChange("initialCapital", parseInt(e.target.value) || 0)}
                        className="w-24 bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      />
                      <span className="text-xs text-gray-500 self-center">JPY</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-400">ロット数</label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        step="1000"
                        min="1000"
                        value={backtestParams.lotSize}
                        onChange={(e) => handleParamChange("lotSize", parseInt(e.target.value) || 1000)}
                        className="w-24 bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      />
                      <span className="text-xs text-gray-500 self-center">通貨</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-400">レバレッジ</label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="1000"
                        value={backtestParams.leverage}
                        onChange={(e) => handleParamChange("leverage", parseInt(e.target.value) || 1)}
                        className="w-16 bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      />
                      <span className="text-xs text-gray-500 self-center">倍</span>
                    </div>
                  </div>
                </div>

                {/* 実行ボタン */}
                <button
                  onClick={handleRunBacktestWithCoverageCheck}
                  disabled={running || checkingCoverage}
                  className={`w-full py-2 rounded text-sm font-medium transition-all ${
                    running || checkingCoverage
                      ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                      : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30"
                  }`}
                >
                  {checkingCoverage ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      チェック中...
                    </span>
                  ) : running ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      実行中...
                    </span>
                  ) : (
                    "バックテスト実行"
                  )}
                </button>
              </div>

              {/* バックテスト履歴 */}
              <div className="card-surface p-3 sm:p-4 mt-3">
                <h2 className="text-xs sm:text-sm font-semibold text-white mb-2">
                  実行履歴
                </h2>
                <BacktestHistoryList
                  history={history}
                  onSelect={handleSelectHistory}
                />
              </div>
            </div>

            {/* 右カラム: 結果表示 */}
            <div className="lg:col-span-2">
              {result ? (
                <div className="card-surface">
                  {/* タブ */}
                  <div className="border-b border-slate-700/50">
                    <div className="flex overflow-x-auto">
                      <button
                        onClick={() => setActiveTab("summary")}
                        className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                          activeTab === "summary"
                            ? "text-cyan-400 border-b-2 border-cyan-400"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        サマリー
                      </button>
                      <button
                        onClick={() => setActiveTab("trades")}
                        className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                          activeTab === "trades"
                            ? "text-cyan-400 border-b-2 border-cyan-400"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        トレード ({result.trades.length})
                      </button>
                      <button
                        onClick={() => setActiveTab("filter")}
                        className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                          activeTab === "filter"
                            ? "text-cyan-400 border-b-2 border-cyan-400"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        フィルター
                      </button>
                      <button
                        onClick={() => setActiveTab("walkforward")}
                        className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                          activeTab === "walkforward"
                            ? "text-cyan-400 border-b-2 border-cyan-400"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        ウォークフォワード
                      </button>
                      <button
                        onClick={() => setActiveTab("montecarlo")}
                        className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                          activeTab === "montecarlo"
                            ? "text-cyan-400 border-b-2 border-cyan-400"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        モンテカルロ
                      </button>
                    </div>
                  </div>

                  {/* コンテンツ */}
                  <div className="p-3 sm:p-4">
                    {activeTab === "summary" && (
                      <div>
                        {/* ステータス */}
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            result.summary.stoppedReason === "bankruptcy"
                              ? "bg-red-600/30 text-red-400"
                              : result.status === "completed"
                              ? "bg-green-600/30 text-green-400"
                              : result.status === "failed"
                              ? "bg-red-600/30 text-red-400"
                              : "bg-yellow-600/30 text-yellow-400"
                          }`}>
                            {result.summary.stoppedReason === "bankruptcy" 
                              ? "破産" 
                              : result.status === "completed" ? "完了" 
                              : result.status === "failed" ? "失敗" 
                              : "実行中"}
                          </span>
                          <span className="text-xs text-gray-500">
                            {result.startDate} 〜 {result.endDate}
                          </span>
                          <span className="text-xs text-gray-500">
                            {result.timeframe}
                          </span>
                        </div>

                        {/* メトリクスグリッド */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-2 mb-2">
                          <MetricCard
                            label="トレード数"
                            value={result.summary.totalTrades}
                          />
                          <MetricCard
                            label="勝率"
                            value={(result.summary.winRate * 100).toFixed(1)}
                            unit="%"
                            color={result.summary.winRate >= 0.5 ? "text-green-400" : "text-red-400"}
                          />
                          <MetricCard
                            label="PF"
                            value={result.summary.profitFactor.toFixed(2)}
                            color={result.summary.profitFactor >= 1 ? "text-green-400" : "text-red-400"}
                          />
                          <MetricCard
                            label="最大DD"
                            value={(result.summary.maxDrawdownRate * 100).toFixed(1)}
                            unit="%"
                            color="text-red-400"
                          />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-2 mb-2">
                          <MetricCard
                            label="純利益"
                            value={result.summary.netProfit.toLocaleString()}
                            unit="円"
                            color={result.summary.netProfit >= 0 ? "text-green-400" : "text-red-400"}
                          />
                          <MetricCard
                            label="利益率"
                            value={(result.summary.netProfitRate * 100).toFixed(2)}
                            unit="%"
                            color={result.summary.netProfitRate >= 0 ? "text-green-400" : "text-red-400"}
                          />
                          <MetricCard
                            label="平均勝ち"
                            value={result.summary.averageWin.toLocaleString()}
                            unit="円"
                            color="text-green-400"
                          />
                          <MetricCard
                            label="平均負け"
                            value={Math.abs(result.summary.averageLoss).toLocaleString()}
                            unit="円"
                            color="text-red-400"
                          />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-2 mb-2">
                          <MetricCard
                            label="勝ち"
                            value={result.summary.winningTrades}
                            color="text-green-400"
                          />
                          <MetricCard
                            label="負け"
                            value={result.summary.losingTrades}
                            color="text-red-400"
                          />
                          <MetricCard
                            label="RR比"
                            value={result.summary.riskRewardRatio.toFixed(2)}
                          />
                          <MetricCard
                            label="連勝/連敗"
                            value={`${result.summary.maxConsecutiveWins}/${result.summary.maxConsecutiveLosses}`}
                          />
                        </div>

                        {/* 統計的指標セクション（Phase 15） */}
                        <div className="mt-3 pt-3 border-t border-slate-700">
                          <h4 className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-2">
                            📊 統計的指標
                            {result.summary.confidenceLevel && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-normal ${
                                result.summary.confidenceLevel === 'high'
                                  ? 'bg-green-500/20 text-green-400'
                                  : result.summary.confidenceLevel === 'medium'
                                  ? 'bg-yellow-500/20 text-yellow-400'
                                  : 'bg-red-500/20 text-red-400'
                              }`}>
                                信頼度: {result.summary.confidenceLevel === 'high' ? '高' : result.summary.confidenceLevel === 'medium' ? '中' : '低'}
                              </span>
                            )}
                          </h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-2">
                            <MetricCard
                              label="シャープレシオ"
                              value={result.summary.sharpeRatio?.toFixed(2) || "-"}
                              color={
                                result.summary.sharpeRatio !== undefined
                                  ? result.summary.sharpeRatio >= 1 ? "text-green-400"
                                    : result.summary.sharpeRatio >= 0.5 ? "text-yellow-400"
                                    : "text-red-400"
                                  : "text-gray-400"
                              }
                            />
                            <MetricCard
                              label="ソルティノレシオ"
                              value={result.summary.sortinoRatio?.toFixed(2) || "-"}
                              color={
                                result.summary.sortinoRatio !== undefined
                                  ? result.summary.sortinoRatio >= 1.5 ? "text-green-400"
                                    : result.summary.sortinoRatio >= 0.5 ? "text-yellow-400"
                                    : "text-red-400"
                                  : "text-gray-400"
                              }
                            />
                            <MetricCard
                              label="p値"
                              value={result.summary.pValue !== undefined ? result.summary.pValue.toFixed(3) : "-"}
                              color={
                                result.summary.pValue !== undefined
                                  ? result.summary.pValue < 0.05 ? "text-green-400"
                                    : result.summary.pValue < 0.1 ? "text-yellow-400"
                                    : "text-red-400"
                                  : "text-gray-400"
                              }
                            />
                            <MetricCard
                              label="統計的有意性"
                              value={
                                result.summary.isStatisticallySignificant === undefined ? "-"
                                  : result.summary.isStatisticallySignificant ? "有意 ✓" : "なし"
                              }
                              color={
                                result.summary.isStatisticallySignificant
                                  ? "text-green-400"
                                  : "text-gray-400"
                              }
                            />
                          </div>
                          {result.summary.confidenceLevel === 'low' && (
                            <p className="mt-2 text-[10px] text-orange-400">
                              ⚠️ トレード数が少ないため、統計的信頼性が低い可能性があります（推奨: 30件以上）
                            </p>
                          )}
                        </div>

                        {/* ノート作成セクション */}
                        {result.summary.winningTrades > 0 && (
                          <div className="mt-4 pt-3 border-t border-slate-700">
                            <h4 className="text-sm font-semibold text-cyan-400 mb-1">
                              勝ちパターンの記録
                            </h4>
                            <p className="text-xs text-gray-400 mb-2">
                              勝ち{result.summary.winningTrades}件をStrategyNoteとして保存
                            </p>
                            
                            {/* ノート作成結果の表示 */}
                            {noteCreationResult && (
                              <div className={`mb-2 px-2 py-1.5 rounded text-xs ${
                                noteCreationResult.success
                                  ? "bg-green-600/20 border border-green-600 text-green-400"
                                  : "bg-red-600/20 border border-red-600 text-red-400"
                              }`}>
                                <div className="flex items-center justify-between">
                                  <span>{noteCreationResult.message}</span>
                                  {noteCreationResult.success && noteCreationResult.createdCount && noteCreationResult.createdCount > 0 && (
                                    <button
                                      onClick={handleGoToNotes}
                                      className="text-sm underline hover:no-underline"
                                    >
                                      ノート一覧を見る →
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            <div className="flex items-center gap-3">
                              <button
                                onClick={handleCreateNotesFromWins}
                                disabled={creatingNotes}
                                className={`px-3 py-1.5 rounded font-medium text-xs transition-colors flex items-center gap-1.5 ${
                                  creatingNotes
                                    ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                                    : "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white shadow-lg shadow-green-500/20"
                                }`}
                              >
                                {creatingNotes ? (
                                  <>
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                      <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                        fill="none"
                                      />
                                      <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                      />
                                    </svg>
                                    作成中...
                                  </>
                                ) : (
                                  <>
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    勝ちパターンをノート化
                                  </>
                                )}
                              </button>
                              
                              <Link
                                href={`/strategies/${strategyId}/notes`}
                                className="text-xs text-cyan-400 hover:underline"
                              >
                                ノート一覧 →
                              </Link>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === "trades" && (
                      <TradeResultTable trades={result.trades} />
                    )}

                    {activeTab === "filter" && (
                      <div>
                        <h4 className="text-sm font-semibold text-cyan-400 mb-2">
                          フィルター分析
                        </h4>
                        <p className="text-xs text-gray-400 mb-3">
                          勝率改善フィルター条件を探索（最大5つまで）
                        </p>

                        {/* 分析実行ボタン */}
                        {!filterAnalysis && (
                          <button
                            onClick={async () => {
                              if (!result.id) return;
                              setLoadingFilter(true);
                              try {
                                const analysis = await fetchFilterAnalysis(strategyId, result.id);
                                setFilterAnalysis(analysis);
                              } catch (err) {
                                setError(err instanceof Error ? err.message : '分析に失敗しました');
                              } finally {
                                setLoadingFilter(false);
                              }
                            }}
                            disabled={loadingFilter}
                            className={`px-3 py-1.5 rounded font-medium text-xs ${
                              loadingFilter
                                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20'
                            }`}
                          >
                            {loadingFilter ? '分析中...' : 'インジケーター傾向分析'}
                          </button>
                        )}

                        {/* 分析結果 */}
                        {filterAnalysis && (
                          <div className="space-y-3">
                            {/* 概要 */}
                            <div className="bg-slate-700/50 rounded px-3 py-2">
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-400">総<span className="ml-1 text-white font-medium">{filterAnalysis.totalTrades}</span></span>
                                <span className="text-gray-400">勝<span className="ml-1 text-green-400 font-medium">{filterAnalysis.winTrades}</span></span>
                                <span className="text-gray-400">負<span className="ml-1 text-red-400 font-medium">{filterAnalysis.loseTrades}</span></span>
                              </div>
                            </div>

                            {/* インジケーター傾向 */}
                            <div>
                              <h5 className="text-xs font-medium text-gray-300 mb-2">
                                インジケーター傾向（有効度順）
                              </h5>
                              <div className="space-y-1">
                                {filterAnalysis.indicators.slice(0, 10).map((ind) => (
                                  <div
                                    key={ind.indicator}
                                    className={`bg-slate-700/50 rounded px-2 py-1.5 cursor-pointer transition-colors text-xs ${
                                      selectedFilters.some(f => f.indicator === ind.indicator)
                                        ? 'ring-1 ring-cyan-500'
                                        : 'hover:bg-slate-600'
                                    }`}
                                    onClick={() => {
                                      const exists = selectedFilters.find(f => f.indicator === ind.indicator);
                                      if (exists) {
                                        setSelectedFilters(prev => prev.filter(f => f.indicator !== ind.indicator));
                                      } else if (selectedFilters.length < 5) {
                                        // 推奨条件から operator と value を推測
                                        const threshold = (ind.winAverage + ind.loseAverage) / 2;
                                        const operator = ind.difference > 0 ? '>' : '<';
                                        setSelectedFilters(prev => [...prev, {
                                          indicator: ind.indicator,
                                          operator: operator as '<' | '>',
                                          value: parseFloat(threshold.toFixed(4)),
                                        }]);
                                      }
                                    }}
                                  >
                                    <div className="flex justify-between items-center">
                                      <span className="font-medium text-white">{ind.displayName}</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-green-400">{ind.winAverage.toFixed(2)}</span>
                                        <span className="text-gray-500">/</span>
                                        <span className="text-red-400">{ind.loseAverage.toFixed(2)}</span>
                                        <span className="text-gray-500 text-[10px]">{ind.significanceScore.toFixed(0)}%</span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* 選択したフィルター */}
                            {selectedFilters.length > 0 && (
                              <div className="bg-slate-700/50 rounded px-2 py-2">
                                <h5 className="text-xs font-medium text-gray-300 mb-2">
                                  選択中（{selectedFilters.length}/5）
                                </h5>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {selectedFilters.map((filter, idx) => (
                                    <div
                                      key={idx}
                                      className="bg-cyan-600/30 text-cyan-300 px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1"
                                    >
                                      <span>{filter.indicator} {filter.operator} {filter.value}</span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedFilters(prev => prev.filter((_, i) => i !== idx));
                                        }}
                                        className="hover:text-white"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  onClick={async () => {
                                    if (!result.id || selectedFilters.length === 0) return;
                                    setVerifyingFilter(true);
                                    try {
                                      const verifyResult = await verifyFilters(strategyId, result.id, selectedFilters);
                                      setFilterVerifyResult(verifyResult);
                                    } catch (err) {
                                      setError(err instanceof Error ? err.message : '検証に失敗しました');
                                    } finally {
                                      setVerifyingFilter(false);
                                    }
                                  }}
                                  disabled={verifyingFilter}
                                  className={`px-3 py-1.5 rounded font-medium text-xs ${
                                    verifyingFilter
                                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                      : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white shadow-lg shadow-green-500/20'
                                  }`}
                                >
                                  {verifyingFilter ? '検証中...' : '効果検証'}
                                </button>
                              </div>
                            )}

                            {/* 検証結果 */}
                            {filterVerifyResult && (
                              <div className="bg-slate-700/50 rounded px-2 py-2">
                                <h5 className="text-xs font-medium text-gray-300 mb-2">
                                  適用効果
                                </h5>
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                  {/* 適用前 */}
                                  <div>
                                    <div className="text-[10px] text-gray-400 mb-1">適用前</div>
                                    <div className="space-y-1">
                                      <div className="flex justify-between">
                                        <span className="text-gray-300">トレード</span>
                                        <span className="text-white">{filterVerifyResult.before.totalTrades}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-300">勝率</span>
                                        <span className="text-white">{(filterVerifyResult.before.winRate * 100).toFixed(1)}%</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-300">PF</span>
                                        <span className="text-white">{filterVerifyResult.before.profitFactor.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-300">純利益</span>
                                        <span className={filterVerifyResult.before.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
                                          {filterVerifyResult.before.netProfit.toLocaleString()}円
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* 適用後 */}
                                  <div>
                                    <div className="text-[10px] text-gray-400 mb-1">適用後</div>
                                    <div className="space-y-1">
                                      <div className="flex justify-between">
                                        <span className="text-gray-300">トレード</span>
                                        <span className="text-white">
                                          {filterVerifyResult.after.totalTrades}
                                          <span className="text-[10px] text-gray-400 ml-0.5">
                                            -{filterVerifyResult.after.filteredOutTrades}
                                          </span>
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-300">勝率</span>
                                        <span className={filterVerifyResult.improvement.winRateChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                                          {(filterVerifyResult.after.winRate * 100).toFixed(1)}%
                                          <span className="text-[10px] ml-0.5">
                                            {filterVerifyResult.improvement.winRateChange >= 0 ? '+' : ''}{(filterVerifyResult.improvement.winRateChange * 100).toFixed(1)}%
                                          </span>
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-300">PF</span>
                                        <span className={filterVerifyResult.improvement.pfChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                                          {filterVerifyResult.after.profitFactor.toFixed(2)}
                                          <span className="text-[10px] ml-0.5">
                                            {filterVerifyResult.improvement.pfChange >= 0 ? '+' : ''}{filterVerifyResult.improvement.pfChange.toFixed(2)}
                                          </span>
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-300">純利益</span>
                                        <span className={filterVerifyResult.after.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
                                          {filterVerifyResult.after.netProfit.toLocaleString()}円
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* 判定 */}
                                <div className={`mt-2 px-2 py-1.5 rounded text-[10px] ${
                                  filterVerifyResult.after.profitFactor >= 1.0
                                    ? 'bg-green-600/20 border border-green-500'
                                    : 'bg-yellow-600/20 border border-yellow-500'
                                }`}>
                                  {filterVerifyResult.after.profitFactor >= 1.0 ? (
                                    <span className="text-green-400">
                                      ✅ PF1.0以上！フィルター有効
                                    </span>
                                  ) : (
                                    <span className="text-yellow-400">
                                      ⚠️ PF{filterVerifyResult.after.profitFactor.toFixed(2)} - 優位性不足
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* 再分析ボタン */}
                            <button
                              onClick={() => {
                                setFilterAnalysis(null);
                                setFilterVerifyResult(null);
                                setSelectedFilters([]);
                              }}
                              className="text-[10px] text-gray-400 hover:text-cyan-400"
                            >
                              クリア
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === "walkforward" && (
                      <div>
                        <h4 className="text-sm font-semibold text-cyan-400 mb-2">
                          ウォークフォワードテスト
                        </h4>
                        <p className="text-xs text-gray-400 mb-3">
                          IS/OOSで過学習リスクを検出
                        </p>

                        {/* ウォークフォワードパラメータ */}
                        <div className="bg-slate-700/50 rounded px-3 py-2 mb-3">
                          <div className="flex items-center gap-3">
                            <div>
                              <label className="block text-[10px] text-gray-400">
                                分割
                              </label>
                              <select
                                value={walkForwardParams.splitCount}
                                onChange={(e) => setWalkForwardParams(prev => ({
                                  ...prev,
                                  splitCount: parseInt(e.target.value)
                                }))}
                                className="bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-white w-16"
                              >
                                <option value={3}>3</option>
                                <option value={4}>4</option>
                                <option value={5}>5</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-400">
                                開始
                              </label>
                              <input
                                type="date"
                                value={walkForwardParams.startDate}
                                onChange={(e) => setWalkForwardParams(prev => ({
                                  ...prev,
                                  startDate: e.target.value
                                }))}
                                className="bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-400">
                                終了
                              </label>
                              <input
                                type="date"
                                value={walkForwardParams.endDate}
                                onChange={(e) => setWalkForwardParams(prev => ({
                                  ...prev,
                                  endDate: e.target.value
                                }))}
                                className="bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-white"
                              />
                            </div>
                            <button
                              onClick={handleRunWalkForward}
                              disabled={runningWalkForward}
                              className={`px-3 py-1.5 rounded font-medium text-xs transition-colors ${
                                runningWalkForward
                                  ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                                  : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20"
                              }`}
                            >
                              {runningWalkForward ? "実行中..." : "WF実行"}
                            </button>
                          </div>
                          <div className="text-[10px] text-gray-500 mt-1">
                            IS: 70% / OOS: 30%
                          </div>
                        </div>

                        {/* ウォークフォワード結果 */}
                        {walkForwardResult && (
                          <div className="space-y-2">
                            {/* オーバーフィットスコア */}
                            <div className="bg-slate-700/50 rounded px-3 py-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-400">オーバーフィット</span>
                                <span className={`text-sm font-bold ${
                                  walkForwardResult.overfitScore <= 0.2 ? "text-green-400" :
                                  walkForwardResult.overfitScore <= 0.4 ? "text-yellow-400" :
                                  "text-red-400"
                                }`}>
                                  {(walkForwardResult.overfitScore * 100).toFixed(1)}%
                                </span>
                              </div>
                              <div className="w-full bg-slate-600 rounded-full h-1.5 mt-1">
                                <div
                                  className={`h-1.5 rounded-full ${
                                    walkForwardResult.overfitScore <= 0.2 ? "bg-green-500" :
                                    walkForwardResult.overfitScore <= 0.4 ? "bg-yellow-500" :
                                    "bg-red-500"
                                  }`}
                                  style={{ width: `${Math.min(walkForwardResult.overfitScore * 100, 100)}%` }}
                                />
                              </div>
                              <div className="flex justify-between mt-0.5 text-[10px] text-gray-500">
                                <span>良好</span>
                                <span>要注意</span>
                                <span>過学習</span>
                              </div>
                            </div>

                            {/* スプリット詳細 */}
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-700/50 text-gray-300">
                                  <tr>
                                    <th className="px-2 py-1.5 text-left">#</th>
                                    <th className="px-2 py-1.5 text-center">IS勝</th>
                                    <th className="px-2 py-1.5 text-center">OOS勝</th>
                                    <th className="px-2 py-1.5 text-center">乖離</th>
                                    <th className="px-2 py-1.5 text-center">IS PF</th>
                                    <th className="px-2 py-1.5 text-center">OOS PF</th>
                                    <th className="px-2 py-1.5 text-center">数</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700">
                                  {walkForwardResult.splits.map((split, idx) => {
                                    const divergence = Math.abs(
                                      split.inSample.winRate - split.outOfSample.winRate
                                    );
                                    return (
                                      <tr key={split.splitNumber} className="hover:bg-slate-700/50">
                                        <td className="px-3 py-2">
                                          <div className="text-gray-200">Split {idx + 1}</div>
                                          <div className="text-xs text-gray-500">
                                            {new Date(split.inSamplePeriod.start).toLocaleDateString("ja-JP")}
                                            〜
                                            {new Date(split.outOfSamplePeriod.end).toLocaleDateString("ja-JP")}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-center text-green-400">
                                          {(split.inSample.winRate * 100).toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-center text-blue-400">
                                          {(split.outOfSample.winRate * 100).toFixed(1)}%
                                        </td>
                                        <td className={`px-3 py-2 text-center ${
                                          divergence > 0.1 ? "text-red-400" : "text-gray-400"
                                        }`}>
                                          {(divergence * 100).toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {split.inSample.profitFactor?.toFixed(2) || "-"}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {split.outOfSample.profitFactor?.toFixed(2) || "-"}
                                        </td>
                                        <td className="px-3 py-2 text-center text-gray-400">
                                          {split.inSample.tradeCount}/{split.outOfSample.tradeCount}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            <div className="mt-1 text-[10px] text-gray-500">
                              IS=In-Sample / OOS=Out-of-Sample
                            </div>
                          </div>
                        )}

                        {/* ウォークフォワード履歴 */}
                        {walkForwardHistory.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-slate-700">
                            <h5 className="text-xs font-medium text-gray-400 mb-1">履歴</h5>
                            <div className="space-y-1">
                              {walkForwardHistory.slice(0, 3).map((wf) => (
                                <div
                                  key={wf.id}
                                  className="bg-slate-700/50 rounded px-2 py-1.5 cursor-pointer hover:bg-slate-600 text-xs flex items-center justify-between"
                                  onClick={() => setWalkForwardResult(wf)}
                                >
                                  <span className="text-gray-300">
                                    {wf.type === 'fixed_split' ? '固定' : 'ローリング'} {wf.splitCount}分割
                                  </span>
                                  <span className={`font-medium ${
                                    wf.overfitScore <= 0.2 ? "text-green-400" :
                                    wf.overfitScore <= 0.4 ? "text-yellow-400" :
                                    "text-red-400"
                                  }`}>
                                    {(wf.overfitScore * 100).toFixed(0)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* モンテカルロシミュレーションタブ */}
                    {activeTab === "montecarlo" && (
                      <MonteCarloTab
                        strategyId={params.id as string}
                        defaultParams={{
                          startDate: backtestParams.startDate,
                          endDate: backtestParams.endDate,
                          timeframe: backtestParams.stage1Timeframe,
                          takeProfit: strategy?.currentVersion?.exitSettings?.takeProfit?.value || 2.0,
                          stopLoss: strategy?.currentVersion?.exitSettings?.stopLoss?.value || 1.0,
                          maxHoldingMinutes: strategy?.currentVersion?.exitSettings?.maxHoldingMinutes || 1440,
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-800/50 rounded px-4 py-8 text-center">
                  <p className="text-sm text-gray-400">バックテストを実行して結果を確認</p>
                  <p className="text-xs text-gray-500 mt-1">左パネルで設定→実行</p>
                </div>
              )}
            </div>
          </div>
      </div>
    </>
  );
}
