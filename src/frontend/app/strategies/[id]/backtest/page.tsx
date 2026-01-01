/**
 * ストラテジーバックテスト画面
 * 
 * 目的:
 * - バックテストの実行パラメータを設定
 * - バックテスト結果の表示（サマリー、トレード一覧）
 * - バックテスト履歴の閲覧
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchStrategy,
  runStrategyBacktest,
  fetchStrategyBacktestHistory,
  BacktestHistoryItem,
} from "@/lib/api";
import type { Strategy, BacktestResult, BacktestResultSummary, BacktestTradeEvent } from "@/types/strategy";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

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
  positionSize: number;
}

// BacktestHistoryItemはlib/api.tsからインポート

// ============================================
// サブコンポーネント
// ============================================

/** パフォーマンスメトリクスカード */
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
    <div className="bg-slate-700 rounded-lg p-4">
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
        {unit && <span className="text-sm ml-1 text-gray-400">{unit}</span>}
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

/** バックテスト履歴リスト */
function BacktestHistoryList({ 
  history, 
  onSelect 
}: { 
  history: BacktestHistoryItem[]; 
  onSelect: (id: string) => void;
}) {
  if (!history || history.length === 0) {
    return (
      <div className="text-center text-gray-400 py-4">
        バックテスト履歴がありません
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {history.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className="w-full text-left bg-slate-700 hover:bg-slate-600 rounded-lg p-3 transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-400">
              {new Date(item.executedAt).toLocaleString("ja-JP")}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${
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
          <div className="text-sm text-gray-200">
            {item.startDate} 〜 {item.endDate}
          </div>
          {item.summary && (
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-gray-400">
                勝率: <span className="text-white">{(item.summary.winRate * 100).toFixed(1)}%</span>
              </span>
              <span className="text-gray-400">
                PF: <span className="text-white">{item.summary.profitFactor.toFixed(2)}</span>
              </span>
              <span className="text-gray-400">
                トレード数: <span className="text-white">{item.summary.totalTrades}</span>
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
    enableStage2: true,
    initialCapital: 1000000,
    positionSize: 0.1,
  });

  // バックテスト結果
  const [result, setResult] = useState<BacktestResult | null>(null);
  
  // バックテスト履歴
  const [history, setHistory] = useState<BacktestHistoryItem[]>([]);
  
  // UIステート
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "trades" | "history">("summary");

  // ============================================
  // ヘルパー関数
  // ============================================

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

  /** バックテスト実行 */
  const handleRunBacktest = async () => {
    try {
      setRunning(true);
      setError(null);

      const resultData = await runStrategyBacktest(strategyId, {
        startDate: backtestParams.startDate,
        endDate: backtestParams.endDate,
        stage1Timeframe: backtestParams.stage1Timeframe,
        enableStage2: backtestParams.enableStage2,
        initialCapital: backtestParams.initialCapital,
        positionSize: backtestParams.positionSize,
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
    // TODO: fetchBacktestResult(strategyId, historyId) を実装
    console.log("選択された履歴:", historyId);
  };

  // ============================================
  // レンダリング
  // ============================================

  if (loading) {
    return (
      <div className="flex min-h-screen bg-slate-900">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Header />
          <main className="flex-1 p-6">
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-400">読み込み中...</div>
            </div>
          </main>
          <Footer />
        </div>
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="flex min-h-screen bg-slate-900">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Header />
          <main className="flex-1 p-6">
            <div className="text-center py-12">
              <div className="text-red-400 mb-4">ストラテジーが見つかりません</div>
              <Link
                href="/strategies"
                className="text-blue-400 hover:underline"
              >
                ストラテジー一覧に戻る
              </Link>
            </div>
          </main>
          <Footer />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          {/* ヘッダー部 */}
          <div className="mb-6">
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
              <Link href="/strategies" className="hover:text-gray-200">
                ストラテジー
              </Link>
              <span>/</span>
              <Link href={`/strategies/${strategyId}`} className="hover:text-gray-200">
                {strategy.name}
              </Link>
              <span>/</span>
              <span className="text-gray-200">バックテスト</span>
            </div>
            <h1 className="text-2xl font-bold text-white">
              バックテスト - {strategy.name}
            </h1>
          </div>

          {/* エラー表示 */}
          {error && (
            <div className="bg-red-600/20 border border-red-600 text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 左カラム: 実行パラメータ */}
            <div className="lg:col-span-1">
              <div className="bg-slate-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  実行パラメータ
                </h2>

                {/* 期間設定 */}
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      開始日
                    </label>
                    <input
                      type="date"
                      value={backtestParams.startDate}
                      onChange={(e) => handleParamChange("startDate", e.target.value)}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      終了日
                    </label>
                    <input
                      type="date"
                      value={backtestParams.endDate}
                      onChange={(e) => handleParamChange("endDate", e.target.value)}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Stage1 時間足 */}
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">
                    Stage1 時間足
                  </label>
                  <select
                    value={backtestParams.stage1Timeframe}
                    onChange={(e) => handleParamChange("stage1Timeframe", e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="15m">15分足</option>
                    <option value="30m">30分足</option>
                    <option value="1h">1時間足</option>
                    <option value="4h">4時間足</option>
                    <option value="1d">日足</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    高速スキャン用の時間足
                  </p>
                </div>

                {/* Stage2 有効化 */}
                <div className="mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={backtestParams.enableStage2}
                      onChange={(e) => handleParamChange("enableStage2", e.target.checked)}
                      className="w-4 h-4 bg-slate-700 border-slate-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-200">
                      Stage2 精密検証を有効化
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    1分足でエントリータイミングを精密検証（処理時間増加）
                  </p>
                </div>

                {/* 資金設定 */}
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      初期資金
                    </label>
                    <input
                      type="number"
                      value={backtestParams.initialCapital}
                      onChange={(e) => handleParamChange("initialCapital", parseInt(e.target.value) || 0)}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      ポジションサイズ（%）
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="1"
                      value={backtestParams.positionSize * 100}
                      onChange={(e) => handleParamChange("positionSize", (parseFloat(e.target.value) || 0) / 100)}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* 実行ボタン */}
                <button
                  onClick={handleRunBacktest}
                  disabled={running}
                  className={`w-full py-3 rounded-lg font-medium transition-colors ${
                    running
                      ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }`}
                >
                  {running ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
              <div className="bg-slate-800 rounded-lg p-6 mt-6">
                <h2 className="text-lg font-semibold text-white mb-4">
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
                <div className="bg-slate-800 rounded-lg">
                  {/* タブ */}
                  <div className="border-b border-slate-700">
                    <div className="flex">
                      <button
                        onClick={() => setActiveTab("summary")}
                        className={`px-6 py-3 text-sm font-medium transition-colors ${
                          activeTab === "summary"
                            ? "text-blue-400 border-b-2 border-blue-400"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        サマリー
                      </button>
                      <button
                        onClick={() => setActiveTab("trades")}
                        className={`px-6 py-3 text-sm font-medium transition-colors ${
                          activeTab === "trades"
                            ? "text-blue-400 border-b-2 border-blue-400"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        トレード一覧 ({result.trades.length})
                      </button>
                    </div>
                  </div>

                  {/* コンテンツ */}
                  <div className="p-6">
                    {activeTab === "summary" && (
                      <div>
                        {/* ステータス */}
                        <div className="flex items-center gap-4 mb-6">
                          <span className={`px-3 py-1 rounded text-sm font-medium ${
                            result.status === "completed"
                              ? "bg-green-600/30 text-green-400"
                              : result.status === "failed"
                              ? "bg-red-600/30 text-red-400"
                              : "bg-yellow-600/30 text-yellow-400"
                          }`}>
                            {result.status === "completed" ? "完了" 
                              : result.status === "failed" ? "失敗" 
                              : "実行中"}
                          </span>
                          <span className="text-sm text-gray-400">
                            {result.startDate} 〜 {result.endDate}
                          </span>
                          <span className="text-sm text-gray-400">
                            時間足: {result.timeframe}
                          </span>
                        </div>

                        {/* メトリクスグリッド */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                          <MetricCard
                            label="総トレード数"
                            value={result.summary.totalTrades}
                          />
                          <MetricCard
                            label="勝率"
                            value={(result.summary.winRate * 100).toFixed(1)}
                            unit="%"
                            color={result.summary.winRate >= 0.5 ? "text-green-400" : "text-red-400"}
                          />
                          <MetricCard
                            label="プロフィットファクター"
                            value={result.summary.profitFactor.toFixed(2)}
                            color={result.summary.profitFactor >= 1 ? "text-green-400" : "text-red-400"}
                          />
                          <MetricCard
                            label="最大ドローダウン"
                            value={(result.summary.maxDrawdownRate * 100).toFixed(1)}
                            unit="%"
                            color="text-red-400"
                          />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                          <MetricCard
                            label="純利益"
                            value={result.summary.netProfit.toLocaleString()}
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
                            color="text-green-400"
                          />
                          <MetricCard
                            label="平均負け"
                            value={Math.abs(result.summary.averageLoss).toLocaleString()}
                            color="text-red-400"
                          />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <MetricCard
                            label="勝ちトレード"
                            value={result.summary.winningTrades}
                            color="text-green-400"
                          />
                          <MetricCard
                            label="負けトレード"
                            value={result.summary.losingTrades}
                            color="text-red-400"
                          />
                          <MetricCard
                            label="リスクリワード比"
                            value={result.summary.riskRewardRatio.toFixed(2)}
                          />
                          <MetricCard
                            label="最大連勝/連敗"
                            value={`${result.summary.maxConsecutiveWins} / ${result.summary.maxConsecutiveLosses}`}
                          />
                        </div>
                      </div>
                    )}

                    {activeTab === "trades" && (
                      <TradeResultTable trades={result.trades} />
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-800 rounded-lg p-12 text-center">
                  <div className="text-gray-400 mb-4">
                    バックテストを実行して結果を確認してください
                  </div>
                  <div className="text-sm text-gray-500">
                    左のパネルで期間とパラメータを設定し、「バックテスト実行」ボタンを押してください
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
