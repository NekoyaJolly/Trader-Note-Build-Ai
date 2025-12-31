"use client";

/**
 * バックテストパネルコンポーネント
 * 
 * 目的: ノートの優位性を過去データで検証するUI
 * 
 * 機能:
 * - バックテストパラメータ入力
 * - 実行とポーリング
 * - 結果の可視化（勝率・PF・期待値など）
 */

import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  executeBacktest,
  fetchBacktestResult,
  fetchBacktestHistory,
  type BacktestExecuteParams,
  type BacktestSummary,
} from "@/lib/api";

interface BacktestPanelProps {
  /** ノートID */
  noteId: string;
  /** ノートのシンボル（表示用） */
  symbol: string;
}

/**
 * バックテストパネル
 */
export function BacktestPanel({ noteId, symbol }: BacktestPanelProps) {
  // パラメータ状態
  const [startDate, setStartDate] = useState(() => {
    // デフォルト: 30日前
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    // デフォルト: 今日
    return new Date().toISOString().split("T")[0];
  });
  const [timeframe, setTimeframe] = useState("1h");
  const [matchThreshold, setMatchThreshold] = useState(70);
  const [takeProfit, setTakeProfit] = useState(2.0);
  const [stopLoss, setStopLoss] = useState(1.0);
  const [maxHoldingMinutes, setMaxHoldingMinutes] = useState(1440); // 24時間
  const [tradingCost, setTradingCost] = useState(0.1);

  // 実行状態
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestSummary | null>(null);
  const [history, setHistory] = useState<BacktestSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  // タブ状態（現在の結果 / 履歴）
  const [activeTab, setActiveTab] = useState<"current" | "history">("current");

  /**
   * バックテストを実行
   */
  const handleExecute = useCallback(async () => {
    setError(null);
    setIsExecuting(true);
    setResult(null);

    try {
      // matchThreshold を 0-100 スケールから 0.0-1.0 スケールに変換
      // バックエンドは 0.0〜1.0 の範囲を期待するため
      const normalizedThreshold = matchThreshold / 100;
      
      const params: BacktestExecuteParams = {
        noteId,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        timeframe,
        matchThreshold: normalizedThreshold,
        takeProfit,
        stopLoss,
        maxHoldingMinutes,
        tradingCost,
      };

      const { runId } = await executeBacktest(params);
      setCurrentRunId(runId);

      // ポーリングで結果を待つ
      let attempts = 0;
      const maxAttempts = 60; // 最大60秒待機
      const pollInterval = 1000; // 1秒ごと

      const poll = async () => {
        const res = await fetchBacktestResult(runId);
        if (!res) {
          throw new Error("バックテスト結果が見つかりません");
        }

        if (res.status === "completed") {
          setResult(res);
          setIsExecuting(false);
          return;
        }

        if (res.status === "failed") {
          throw new Error("バックテストが失敗しました");
        }

        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error("バックテストがタイムアウトしました");
        }

        setTimeout(poll, pollInterval);
      };

      // 少し待ってからポーリング開始
      setTimeout(poll, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setIsExecuting(false);
    }
  }, [
    noteId,
    startDate,
    endDate,
    timeframe,
    matchThreshold,
    takeProfit,
    stopLoss,
    maxHoldingMinutes,
    tradingCost,
  ]);

  /**
   * 履歴を読み込み
   */
  const loadHistory = useCallback(async () => {
    try {
      const runs = await fetchBacktestHistory(noteId);
      setHistory(runs);
    } catch (e) {
      setError("履歴の取得に失敗しました");
    }
  }, [noteId]);

  /**
   * タブ切り替え
   */
  const handleTabChange = (tab: "current" | "history") => {
    setActiveTab(tab);
    if (tab === "history") {
      loadHistory();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            📊 バックテスト
            <Badge variant="outline" className="text-xs">
              {symbol}
            </Badge>
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant={activeTab === "current" ? "default" : "outline"}
              size="sm"
              onClick={() => handleTabChange("current")}
            >
              実行
            </Button>
            <Button
              variant={activeTab === "history" ? "default" : "outline"}
              size="sm"
              onClick={() => handleTabChange("history")}
            >
              履歴
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {activeTab === "current" ? (
          <div className="space-y-4">
            {/* パラメータ入力フォーム */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">開始日</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 text-sm"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={isExecuting}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">終了日</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 text-sm"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={isExecuting}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">時間足</label>
                <select
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 text-sm"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  disabled={isExecuting}
                >
                  <option value="5m">5分足</option>
                  <option value="15m">15分足</option>
                  <option value="30m">30分足</option>
                  <option value="1h">1時間足</option>
                  <option value="4h">4時間足</option>
                  <option value="1d">日足</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">一致閾値 (%)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 text-sm"
                  value={matchThreshold}
                  onChange={(e) => setMatchThreshold(Number(e.target.value))}
                  min={0}
                  max={100}
                  disabled={isExecuting}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">利確 (%)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 text-sm"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(Number(e.target.value))}
                  min={0}
                  step={0.1}
                  disabled={isExecuting}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">損切 (%)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 text-sm"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(Number(e.target.value))}
                  min={0}
                  step={0.1}
                  disabled={isExecuting}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">最大保有時間 (分)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 text-sm"
                  value={maxHoldingMinutes}
                  onChange={(e) => setMaxHoldingMinutes(Number(e.target.value))}
                  min={1}
                  disabled={isExecuting}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">取引コスト (%)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 text-sm"
                  value={tradingCost}
                  onChange={(e) => setTradingCost(Number(e.target.value))}
                  min={0}
                  step={0.01}
                  disabled={isExecuting}
                />
              </div>
            </div>

            {/* 実行ボタン */}
            <div className="flex justify-end">
              <Button
                onClick={handleExecute}
                disabled={isExecuting}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isExecuting ? "実行中..." : "バックテスト実行"}
              </Button>
            </div>

            {/* エラー表示 */}
            {error && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* 結果表示 */}
            {result && <BacktestResultView result={result} />}
          </div>
        ) : (
          <div className="space-y-4">
            {/* 履歴表示 */}
            {history.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-8">
                バックテスト履歴がありません
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((run) => (
                  <BacktestHistoryItem key={run.runId} run={run} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * バックテスト結果表示コンポーネント
 */
function BacktestResultView({ result }: { result: BacktestSummary }) {
  // 結果の色分け
  const getWinRateColor = (rate: number) => {
    if (rate >= 0.6) return "text-green-400";
    if (rate >= 0.4) return "text-yellow-400";
    return "text-red-400";
  };

  const getPfColor = (pf: number | null) => {
    if (pf === null) return "text-gray-400";
    if (pf >= 2) return "text-green-400";
    if (pf >= 1) return "text-yellow-400";
    return "text-red-400";
  };

  const getExpectancyColor = (exp: number) => {
    if (exp > 0) return "text-green-400";
    if (exp === 0) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="space-y-4">
      {/* サマリー統計 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-lg p-4">
          <div className="text-xs text-gray-400">セットアップ数</div>
          <div className="text-2xl font-bold text-white">{result.setupCount}</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <div className="text-xs text-gray-400">勝率</div>
          <div className={`text-2xl font-bold ${getWinRateColor(result.winRate)}`}>
            {(result.winRate * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500">
            {result.winCount}勝 / {result.lossCount}敗 / {result.timeoutCount}T/O
          </div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <div className="text-xs text-gray-400">プロフィットファクター</div>
          <div className={`text-2xl font-bold ${getPfColor(result.profitFactor)}`}>
            {result.profitFactor?.toFixed(2) ?? "-"}
          </div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <div className="text-xs text-gray-400">期待値</div>
          <div className={`text-2xl font-bold ${getExpectancyColor(result.expectancy)}`}>
            {result.expectancy >= 0 ? "+" : ""}
            {result.expectancy.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* 詳細統計 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">総利益</div>
          <div className="text-green-400 font-medium">
            +{result.totalProfit.toFixed(2)}%
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">総損失</div>
          <div className="text-red-400 font-medium">
            -{result.totalLoss.toFixed(2)}%
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">平均損益</div>
          <div className={result.averagePnL >= 0 ? "text-green-400" : "text-red-400"}>
            {result.averagePnL >= 0 ? "+" : ""}
            {result.averagePnL.toFixed(2)}%
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">最大ドローダウン</div>
          <div className="text-red-400 font-medium">
            {result.maxDrawdown?.toFixed(2) ?? "-"}%
          </div>
        </div>
      </div>

      {/* イベントリスト（最新5件） */}
      {result.events.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-gray-400 mb-2">
            直近トレード（{Math.min(5, result.events.length)}件）
          </div>
          <div className="space-y-2">
            {result.events.slice(0, 5).map((event, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <Badge
                    variant={
                      event.outcome === "win"
                        ? "secondary"
                        : event.outcome === "loss"
                        ? "destructive"
                        : "outline"
                    }
                    className={
                      event.outcome === "win"
                        ? "bg-green-600/20 text-green-400"
                        : event.outcome === "loss"
                        ? "bg-red-600/20 text-red-400"
                        : ""
                    }
                  >
                    {event.outcome === "win"
                      ? "利確"
                      : event.outcome === "loss"
                      ? "損切"
                      : "T/O"}
                  </Badge>
                  <span className="text-gray-400 text-xs">
                    {new Date(event.entryTime).toLocaleString("ja-JP")}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-gray-400 text-xs">
                    スコア: {event.matchScore.toFixed(0)}%
                  </span>
                  <span
                    className={
                      (event.pnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                    }
                  >
                    {(event.pnl ?? 0) >= 0 ? "+" : ""}
                    {event.pnl?.toFixed(2) ?? "-"}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 履歴アイテムコンポーネント
 */
function BacktestHistoryItem({ run }: { run: BacktestSummary }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-slate-800 rounded-lg overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-700/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Badge
            variant={
              run.status === "completed"
                ? "secondary"
                : run.status === "failed"
                ? "destructive"
                : "outline"
            }
            className={
              run.status === "completed"
                ? "bg-green-600/20 text-green-400"
                : run.status === "failed"
                ? "bg-red-600/20 text-red-400"
                : ""
            }
          >
            {run.status === "completed"
              ? "完了"
              : run.status === "failed"
              ? "失敗"
              : "実行中"}
          </Badge>
          <span className="text-sm text-gray-300">
            {run.setupCount}件のセットアップ
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm">
            勝率:{" "}
            <span
              className={
                run.winRate >= 0.5 ? "text-green-400" : "text-red-400"
              }
            >
              {(run.winRate * 100).toFixed(0)}%
            </span>
          </span>
          <span className="text-gray-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>
      {expanded && run.status === "completed" && (
        <div className="px-4 pb-4">
          <BacktestResultView result={run} />
        </div>
      )}
    </div>
  );
}

export default BacktestPanel;
