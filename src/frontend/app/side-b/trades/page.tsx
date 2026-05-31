/**
 * 仮想トレード管理画面（Phase B）
 * 
 * - オープンポジション表示
 * - ポートフォリオ統計
 * - トレード履歴
 * 
 * @see docs/side-b/phase-b-virtual-trading.md
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { sideBApi, SideBApiError } from "@/lib/sideBApi";
import { StrategyBacktestSummary } from "@/components/side-b/StrategyBacktestSummary";
import { toast } from "sonner";
import type { GeneratePlanResponse } from "@/types/sideB";

// ===== 型定義 =====

// 仮想トレードのステータス
type TradeStatus =
  | "pending"
  | "open"
  | "closed"
  | "expired"
  | "cancelled"
  | "invalidated";

// トレード方向
type TradeDirection = "long" | "short";

// イグジット理由
type ExitReason =
  | "take_profit"
  | "stop_loss"
  | "trailing_stop"
  | "time_expiry"
  | "manual"
  | "signal_invalidation";

// 仮想トレード
interface VirtualTrade {
  id: string;
  planId: string;
  scenarioIndex: number;
  symbol: string;
  direction: TradeDirection;
  plannedEntry: number;
  actualEntry: number | null;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number | null;
  positionSize: number;
  status: TradeStatus;
  entryTime: string | null;
  exitTime: string | null;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  pnlPips: number | null;
  pnlAmount: number | null;
  pnlPercentage: number | null;
  expiresAt?: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ポートフォリオサマリー（APIレスポンス形式に合わせる）
interface PortfolioSummary {
  portfolio: {
    id: string;
    name: string;
    initialBalance: number;
    currentBalance: number;
  };
  stats: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    totalPnlPips: number;
  };
  openPositions: VirtualTrade[];
}

// ===== ユーティリティ =====

// ステータスを日本語に変換
const statusToJapanese = (status: TradeStatus): string => {
  const map: Record<TradeStatus, string> = {
    pending: "待機中",
    open: "オープン",
    closed: "決済済",
    expired: "期限切れ",
    cancelled: "キャンセル",
    invalidated: "無効化",
  };
  return map[status];
};

// ステータスに応じた色クラスを返す
const getStatusColor = (status: TradeStatus): string => {
  const colors: Record<TradeStatus, string> = {
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    open: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    closed: "bg-green-500/20 text-green-400 border-green-500/30",
    expired: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    cancelled: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    invalidated: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return colors[status];
};

// 方向を日本語に変換
const directionToJapanese = (direction: TradeDirection): string => {
  return direction === "long" ? "ロング" : "ショート";
};

// イグジット理由を日本語に変換
const exitReasonToJapanese = (reason: ExitReason | null): string => {
  if (!reason) return "-";
  const map: Record<ExitReason, string> = {
    take_profit: "利確",
    stop_loss: "損切り",
    trailing_stop: "トレーリング",
    time_expiry: "期限切れ",
    manual: "手動決済",
    signal_invalidation: "シグナル無効化",
  };
  return map[reason];
};

// 数値をフォーマット（null/undefined対応）
const formatNumber = (value: number | null | undefined, decimals: number = 2): string => {
  if (value == null || isNaN(value)) return "-";
  return value.toLocaleString("ja-JP", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

// 日時を「MM/DD HH:mm」(分まで) で整形する日時表示用ヘルパー。
// 未設定値のプレースホルダは本ファイル他箇所 (formatNumber 等) と同じ "-" に揃える。
const formatDateTimeMinute = (value?: string | null): string => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// PnLの色を返す
const getPnLColor = (pnl: number | null): string => {
  if (pnl === null) return "text-gray-400";
  if (pnl > 0) return "text-green-400";
  if (pnl < 0) return "text-red-400";
  return "text-gray-400";
};

// ===== APIクライアント =====

// APIベースURL（同一オリジン: 相対パス）
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "") + "/api/side-b";

async function fetchPortfolio(): Promise<PortfolioSummary> {
  const res = await fetch(`${API_BASE}/portfolio`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "ポートフォリオの取得に失敗しました");
  }
  return res.json();
}

async function fetchTrades(status?: TradeStatus): Promise<{ trades: VirtualTrade[] }> {
  const url = status
    ? `${API_BASE}/trades?status=${status}`
    : `${API_BASE}/trades`;
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "トレードの取得に失敗しました");
  }
  return res.json();
}

async function closeTrade(tradeId: string, exitPrice: number): Promise<VirtualTrade> {
  const res = await fetch(`${API_BASE}/trades/${tradeId}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exitPrice }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "トレードの決済に失敗しました");
  }
  const data = await res.json();
  return data.trade;
}

async function cancelTrade(tradeId: string): Promise<VirtualTrade> {
  const res = await fetch(`${API_BASE}/trades/${tradeId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "トレードのキャンセルに失敗しました");
  }
  const data = await res.json();
  return data.trade;
}

// ===== コンポーネント =====

export default function TradesPage() {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [allTrades, setAllTrades] = useState<VirtualTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"open" | "history">("open");
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState<string>("");
  // 即時BT付きプラン試行（Phase 6.7b 表示用）
  const [planTestSymbol, setPlanTestSymbol] = useState("XAUUSD");
  const [planTestForce, setPlanTestForce] = useState(true);
  const [planTestLoading, setPlanTestLoading] = useState(false);
  const [planTestError, setPlanTestError] = useState<string | null>(null);
  const [lastPlanResult, setLastPlanResult] = useState<GeneratePlanResponse | null>(null);

  // データ取得
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [portfolioData, tradesData] = await Promise.all([
        fetchPortfolio(),
        fetchTrades(),
      ]);
      setPortfolio(portfolioData);
      setAllTrades(tradesData.trades);
    } catch (err) {
      setError(err instanceof Error ? err.message : "データ取得エラー");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 手動決済ハンドラ
  const handleClose = async (tradeId: string) => {
    const price = parseFloat(closePrice);
    if (isNaN(price) || price <= 0) {
      alert("有効な決済価格を入力してください");
      return;
    }
    try {
      await closeTrade(tradeId, price);
      setClosingTradeId(null);
      setClosePrice("");
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "決済に失敗しました");
    }
  };

  // キャンセルハンドラ
  const handleCancel = async (tradeId: string) => {
    if (!confirm("このトレードをキャンセルしますか？")) return;
    try {
      await cancelTrade(tradeId);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "キャンセルに失敗しました");
    }
  };

  // 直近のプラン生成＋即時BT（仮想トレード用リサーチと同系統の導線）
  const runPlanWithBacktest = async () => {
    setPlanTestLoading(true);
    setPlanTestError(null);
    try {
      const res = await sideBApi.generatePlan({
        symbol: planTestSymbol.trim() || "XAUUSD",
        forceRefresh: planTestForce,
        timeframe: "15m",
      });
      setLastPlanResult(res);
      toast.success("プラン + 即時BT を生成しました");
    } catch (e) {
      setLastPlanResult(null);
      const msg =
        e instanceof SideBApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "プラン生成に失敗しました";
      setPlanTestError(msg);
      toast.error(msg);
    } finally {
      setPlanTestLoading(false);
    }
  };

  // フィルタリングされたトレード
  const openTrades = allTrades.filter(t => t.status === "pending" || t.status === "open");
  const closedTrades = allTrades.filter(t =>
    t.status === "closed" || t.status === "expired" || t.status === "cancelled" || t.status === "invalidated"
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl w-full mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8 md:py-12">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div>
            <Link
              href="/side-b"
              className="text-sm text-gray-400 hover:text-gray-300 transition-colors mb-2 inline-block"
            >
              ← Side-B ダッシュボード
            </Link>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                📊 トレード
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">
              仮想トレード管理・ポートフォリオ
            </p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            🔄 更新
          </button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <section
          className="mb-6 sm:mb-8 card-surface rounded-xl p-4 sm:p-5 border border-slate-700/50"
          aria-labelledby="plan-bt-heading"
        >
          <h2 id="plan-bt-heading" className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
            <span aria-hidden>📈</span>
            即時BT付きプラン（試行）
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            POST /api/side-b/plans。プラン行は従来どおり DB に保存され、
            <code className="text-cyan-400/90 mx-0.5">strategyBacktest</code>
           （DSL 即時BTの要約）は本レスポンス内のみ同梱され、GET で取得したプラン JSON には含まれません。
          </p>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center mb-3">
            <label className="text-xs text-slate-400 flex items-center gap-2">
              シンボル
              <input
                type="text"
                value={planTestSymbol}
                onChange={(e) => setPlanTestSymbol(e.target.value)}
                className="px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-sm w-32 font-mono"
                placeholder="XAUUSD"
              />
            </label>
            <label className="text-xs text-slate-400 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={planTestForce}
                onChange={(e) => setPlanTestForce(e.target.checked)}
                className="rounded border-slate-600"
              />
              同日キャッシュを上書き（即時BTを取りに行く推奨）
            </label>
            <button
              type="button"
              onClick={runPlanWithBacktest}
              disabled={planTestLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-violet-600 to-cyan-600 text-white disabled:opacity-50"
            >
              {planTestLoading ? "生成中…" : "プラン＋即時BTを取得"}
            </button>
          </div>
          {planTestError && (
            <p className="text-xs text-rose-400 mb-2">{planTestError}</p>
          )}
          {lastPlanResult && (
            <div className="mt-2 pt-2 border-t border-slate-700/50 text-xs text-slate-400 space-y-1">
              <p>
                プランID: <span className="text-slate-200 font-mono">{lastPlanResult.plan.id}</span>{" "}
                / {lastPlanResult.cached ? "キャッシュ" : "新規生成"}{" "}
                {typeof lastPlanResult.tokenUsage === "number" ? ` / tokens ${lastPlanResult.tokenUsage}` : ""}
              </p>
              <div className="mt-2">
                <p className="text-slate-500 mb-1">即時BT（3ツール併用）</p>
                <StrategyBacktestSummary
                  backtest={lastPlanResult.plan.strategyBacktest}
                  fromCachedPlan={!!lastPlanResult.cached}
                />
              </div>
            </div>
          )}
        </section>

        {/* ポートフォリオサマリー */}
        {portfolio && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
            {/* エクイティ（pips ベース）
                仮想トレードに金額（pnlAmount）モデルが無くドル残高は動かないため、
                pips ベースのエクイティ（初期 0 基準の累計 pips）で口座状況を表す。 */}
            <div className="card-surface rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">エクイティ (pips)</p>
              <p className={`text-lg sm:text-xl font-bold ${getPnLColor(portfolio.stats.totalPnlPips)}`}>
                {portfolio.stats.totalPnlPips > 0 ? "+" : ""}
                {formatNumber(portfolio.stats.totalPnlPips, 1)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {portfolio.stats.totalTrades > 0
                  ? `平均 ${formatNumber(portfolio.stats.totalPnlPips / portfolio.stats.totalTrades, 1)} pips/取引`
                  : "初期 0 基準"}
              </p>
            </div>

            {/* オープンポジション */}
            <div className="card-surface rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">オープン</p>
              <p className="text-lg sm:text-xl font-bold text-blue-400">
                {portfolio.openPositions.length}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                ポジション
              </p>
            </div>

            {/* 勝率 */}
            <div className="card-surface rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">勝率</p>
              <p className="text-lg sm:text-xl font-bold text-white">
                {formatNumber(portfolio.stats.winRate, 1)}%
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {portfolio.stats.totalTrades} トレード
              </p>
            </div>

            {/* 総PnL */}
            <div className="card-surface rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">総PnL</p>
              <p className={`text-lg sm:text-xl font-bold ${getPnLColor(portfolio.stats.totalPnlPips)}`}>
                {portfolio.stats.totalPnlPips > 0 ? "+" : ""}
                {formatNumber(portfolio.stats.totalPnlPips, 1)} pips
              </p>
              <p className="text-xs text-gray-500 mt-1">
                PF: {formatNumber(portfolio.stats.profitFactor, 2)}
              </p>
            </div>
          </div>
        )}

        {/* タブ */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab("open")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "open"
                ? "bg-blue-600 text-white"
                : "bg-slate-700 text-gray-300 hover:bg-slate-600"
              }`}
          >
            オープン ({openTrades.length})
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "history"
                ? "bg-blue-600 text-white"
                : "bg-slate-700 text-gray-300 hover:bg-slate-600"
              }`}
          >
            履歴 ({closedTrades.length})
          </button>
        </div>

        {/* トレードリスト */}
        <div className="card-surface rounded-xl overflow-hidden">
          {activeTab === "open" ? (
            openTrades.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-400 text-lg mb-2">📭</p>
                <p className="text-gray-400">オープンポジションはありません</p>
                <Link
                  href="/side-b"
                  className="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block"
                >
                  プランを作成 →
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {openTrades.map((trade) => (
                  <div key={trade.id} className="p-4 hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs border ${getStatusColor(trade.status)}`}>
                          {statusToJapanese(trade.status)}
                        </span>
                        <span className={`text-sm font-medium ${trade.direction === "long" ? "text-green-400" : "text-red-400"
                          }`}>
                          {directionToJapanese(trade.direction)}
                        </span>
                        <span className="text-white font-bold">{trade.symbol}</span>
                      </div>
                      <div className="flex gap-2">
                        {trade.status === "pending" && (
                          <button
                            onClick={() => handleCancel(trade.id)}
                            className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-gray-300 rounded text-xs transition-colors"
                          >
                            キャンセル
                          </button>
                        )}
                        {trade.status === "open" && (
                          closingTradeId === trade.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step="0.01"
                                value={closePrice}
                                onChange={(e) => setClosePrice(e.target.value)}
                                placeholder="決済価格"
                                className="w-28 px-2 py-1 bg-slate-700 text-white rounded text-xs border border-slate-600 focus:border-blue-500 focus:outline-none"
                              />
                              <button
                                onClick={() => handleClose(trade.id)}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs transition-colors"
                              >
                                決済
                              </button>
                              <button
                                onClick={() => {
                                  setClosingTradeId(null);
                                  setClosePrice("");
                                }}
                                className="px-2 py-1 text-gray-400 hover:text-gray-300 text-xs"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setClosingTradeId(trade.id)}
                              className="px-3 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded text-xs transition-colors"
                            >
                              手動決済
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">エントリー:</span>
                        <span className="text-white ml-1">
                          {trade.actualEntry
                            ? formatNumber(trade.actualEntry, 2)
                            : `${formatNumber(trade.plannedEntry, 2)} (予定)`
                          }
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">SL:</span>
                        <span className="text-red-400 ml-1">{formatNumber(trade.stopLoss, 2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">TP:</span>
                        <span className="text-green-400 ml-1">{formatNumber(trade.takeProfit, 2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">RR:</span>
                        <span className="text-white ml-1">1:{formatNumber(trade.riskRewardRatio, 1)}</span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                      {trade.status === "pending" ? (
                        <span>注文: {formatDateTimeMinute(trade.createdAt)}</span>
                      ) : (
                        <span>エントリー: {formatDateTimeMinute(trade.entryTime)}</span>
                      )}
                      {trade.expiresAt && <span>有効期限: {formatDateTimeMinute(trade.expiresAt)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            closedTrades.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-400 text-lg mb-2">📭</p>
                <p className="text-gray-400">取引履歴はありません</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {closedTrades.map((trade) => (
                  <div key={trade.id} className="p-4 hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs border ${getStatusColor(trade.status)}`}>
                          {statusToJapanese(trade.status)}
                        </span>
                        <span className={`text-sm font-medium ${trade.direction === "long" ? "text-green-400" : "text-red-400"
                          }`}>
                          {directionToJapanese(trade.direction)}
                        </span>
                        <span className="text-white font-bold">{trade.symbol}</span>
                      </div>
                      <div className={`text-lg font-bold ${getPnLColor(trade.pnlPips)}`}>
                        {trade.pnlPips !== null && (
                          <>
                            {trade.pnlPips > 0 ? "+" : ""}
                            {formatNumber(trade.pnlPips, 1)} pips
                          </>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">エントリー:</span>
                        <span className="text-white ml-1">
                          {trade.actualEntry ? formatNumber(trade.actualEntry, 2) : "-"}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">決済:</span>
                        <span className="text-white ml-1">
                          {trade.exitPrice ? formatNumber(trade.exitPrice, 2) : "-"}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">理由:</span>
                        <span className="text-gray-300 ml-1">{exitReasonToJapanese(trade.exitReason)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">RR:</span>
                        <span className="text-white ml-1">1:{formatNumber(trade.riskRewardRatio, 1)}</span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {trade.exitTime && (
                        <>決済: {new Date(trade.exitTime).toLocaleString("ja-JP")}</>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}
