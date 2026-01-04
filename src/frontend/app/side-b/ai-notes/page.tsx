/**
 * AIトレードノート一覧画面（Phase C）
 * 
 * - AIが自動生成したトレードノート一覧
 * - 勝敗・学びの確認
 * - サマリー生成
 * 
 * @see docs/side-b/phase-c-ai-trade-note.md
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ===== 型定義 =====

// トレード結果
type TradeOutcome = "win" | "loss" | "breakeven";

// タイミング評価
type TimingEvaluation = "good" | "fair" | "poor";

// 決済タイミング評価
type ExitTimingEvaluation = "optimal" | "early" | "late";

// 精度評価
type AccuracyEvaluation = "accurate" | "partial" | "inaccurate";

// 決済タイプ
type ExitType = "take_profit" | "stop_loss" | "manual" | "trailing_stop" | "time_expiry" | "other";

// サマリー期間
type SummaryPeriod = "daily" | "weekly" | "monthly";

// トレード結果詳細
interface TradeResult {
  outcome: TradeOutcome;
  pnlPips: number;
  pnlPercentage: number;
  riskRewardActual: number;
  holdingDuration: number;
}

// エントリー分析
interface EntryAnalysis {
  timing: TimingEvaluation;
  priceVsPlan: number;
  marketConditionAtEntry: string;
  evaluation: string;
}

// 決済分析
interface ExitAnalysis {
  type: ExitType;
  timing: ExitTimingEvaluation;
  missedPotential?: number;
  evaluation: string;
}

// プラン評価
interface PlanEvaluation {
  scenarioAccuracy: AccuracyEvaluation;
  levelAccuracy: AccuracyEvaluation;
  directionCorrect: boolean;
  evaluation: string;
}

// 市場振り返り
interface MarketReview {
  regimeActual: string;
  regimePredicted: string;
  keyEventsImpact: string[];
  volatilityNote: string;
}

// 学び
interface Learnings {
  whatWorked: string[];
  whatDidntWork: string[];
  keyInsight: string;
  actionItems: string[];
}

// AIトレードノート
interface AITradeNote {
  id: string;
  virtualTradeId: string;
  planId: string;
  date: string;
  symbol: string;
  direction: "long" | "short";
  result: TradeResult;
  entryAnalysis: EntryAnalysis;
  exitAnalysis: ExitAnalysis;
  planEvaluation: PlanEvaluation;
  marketReview: MarketReview;
  learnings: Learnings;
  aiModel: string;
  createdAt: string;
}

// サマリー統計
interface SummaryStatistics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  totalPnl: number;
}

// AIノートサマリー
interface AINoteSummary {
  id: string;
  period: SummaryPeriod;
  startDate: string;
  endDate: string;
  statistics: SummaryStatistics;
  createdAt: string;
}

// ===== ユーティリティ =====

// 結果を日本語に変換
const outcomeToJapanese = (outcome: TradeOutcome): string => {
  const map: Record<TradeOutcome, string> = {
    win: "勝ち",
    loss: "負け",
    breakeven: "同値撤退",
  };
  return map[outcome];
};

// 結果に応じた色クラスを返す
const getOutcomeColor = (outcome: TradeOutcome): string => {
  const colors: Record<TradeOutcome, string> = {
    win: "bg-green-500/20 text-green-400 border-green-500/30",
    loss: "bg-red-500/20 text-red-400 border-red-500/30",
    breakeven: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };
  return colors[outcome];
};

// タイミング評価を日本語に変換
const timingToJapanese = (timing: TimingEvaluation): string => {
  const map: Record<TimingEvaluation, string> = {
    good: "良好",
    fair: "普通",
    poor: "不良",
  };
  return map[timing];
};

// 決済タイミング評価を日本語に変換
const exitTimingToJapanese = (timing: ExitTimingEvaluation): string => {
  const map: Record<ExitTimingEvaluation, string> = {
    optimal: "最適",
    early: "早すぎ",
    late: "遅すぎ",
  };
  return map[timing];
};

// 決済タイプを日本語に変換
const exitTypeToJapanese = (type: ExitType): string => {
  const map: Record<ExitType, string> = {
    take_profit: "利確",
    stop_loss: "損切り",
    manual: "手動決済",
    trailing_stop: "トレーリング",
    time_expiry: "期限切れ",
    other: "その他",
  };
  return map[type];
};

// 期間を日本語に変換
const periodToJapanese = (period: SummaryPeriod): string => {
  const map: Record<SummaryPeriod, string> = {
    daily: "日次",
    weekly: "週次",
    monthly: "月次",
  };
  return map[period];
};

// 精度評価を日本語に変換
const accuracyToJapanese = (accuracy: AccuracyEvaluation): string => {
  const map: Record<AccuracyEvaluation, string> = {
    accurate: "正確",
    partial: "部分的",
    inaccurate: "不正確",
  };
  return map[accuracy];
};

// 方向を日本語に変換
const directionToJapanese = (direction: "long" | "short"): string => {
  return direction === "long" ? "ロング" : "ショート";
};

// 数値をフォーマット
const formatNumber = (value: number, decimals: number = 2): string => {
  return value.toLocaleString("ja-JP", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

// 日付をフォーマット
const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

// 保有時間をフォーマット（分→時間:分）
const formatDuration = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes}分`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}時間${mins > 0 ? mins + "分" : ""}`;
};

// ===== コンポーネント =====

export default function AINotesPage() {
  // 状態管理
  const [notes, setNotes] = useState<AITradeNote[]>([]);
  const [summaries, setSummaries] = useState<AINoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<AITradeNote | null>(null);
  const [activeTab, setActiveTab] = useState<"notes" | "summaries">("notes");
  const [generatingSummary, setGeneratingSummary] = useState(false);

  // API ベース URL
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3100/api";

  // データ取得
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ノートとサマリーを並行取得
      const [notesRes, summariesRes] = await Promise.all([
        fetch(`${API_BASE}/side-b/ai-notes`),
        fetch(`${API_BASE}/side-b/ai-notes/summaries`),
      ]);

      if (!notesRes.ok) {
        throw new Error(`ノート取得エラー: ${notesRes.status}`);
      }
      if (!summariesRes.ok) {
        throw new Error(`サマリー取得エラー: ${summariesRes.status}`);
      }

      const notesData = await notesRes.json();
      const summariesData = await summariesRes.json();

      setNotes(notesData);
      setSummaries(summariesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  // 初回ロード
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // サマリー生成
  const handleGenerateSummary = async (period: SummaryPeriod) => {
    try {
      setGeneratingSummary(true);
      setError(null);

      const res = await fetch(`${API_BASE}/side-b/ai-notes/summaries/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });

      if (!res.ok) {
        throw new Error(`サマリー生成エラー: ${res.status}`);
      }

      // リフレッシュ
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "サマリー生成に失敗しました");
    } finally {
      setGeneratingSummary(false);
    }
  };

  // 統計サマリー（現在のノートから計算）
  const calculateCurrentStats = (): SummaryStatistics => {
    if (notes.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        averageWin: 0,
        averageLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        totalPnl: 0,
      };
    }

    const wins = notes.filter(n => n.result.outcome === "win");
    const losses = notes.filter(n => n.result.outcome === "loss");

    const winPnls = wins.map(n => n.result.pnlPips);
    const lossPnls = losses.map(n => Math.abs(n.result.pnlPips));

    const totalWinPips = winPnls.reduce((sum, p) => sum + p, 0);
    const totalLossPips = lossPnls.reduce((sum, p) => sum + p, 0);

    return {
      totalTrades: notes.length,
      winRate: notes.length > 0 ? (wins.length / notes.length) * 100 : 0,
      profitFactor: totalLossPips > 0 ? totalWinPips / totalLossPips : 0,
      averageWin: wins.length > 0 ? totalWinPips / wins.length : 0,
      averageLoss: losses.length > 0 ? totalLossPips / losses.length : 0,
      largestWin: winPnls.length > 0 ? Math.max(...winPnls) : 0,
      largestLoss: lossPnls.length > 0 ? Math.max(...lossPnls) : 0,
      totalPnl: notes.reduce((sum, n) => sum + n.result.pnlPips, 0),
    };
  };

  const currentStats = calculateCurrentStats();

  // ローディング表示
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900 text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900 text-white">
      {/* ヘッダー */}
      <header className="bg-slate-800/50 border-b border-slate-700 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/side-b"
                className="text-slate-400 hover:text-white transition-colors"
              >
                ← Side-B
              </Link>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <span>📝</span>
                <span>AI Trade Notes</span>
              </h1>
            </div>
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-sm"
            >
              🔄 更新
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* エラー表示 */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* 統計カード */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-400 text-sm">総トレード数</div>
            <div className="text-2xl font-bold text-white">
              {currentStats.totalTrades}
            </div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-400 text-sm">勝率</div>
            <div className={`text-2xl font-bold ${currentStats.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
              {formatNumber(currentStats.winRate, 1)}%
            </div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-400 text-sm">プロフィットファクター</div>
            <div className={`text-2xl font-bold ${currentStats.profitFactor >= 1 ? "text-green-400" : "text-red-400"}`}>
              {formatNumber(currentStats.profitFactor, 2)}
            </div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-400 text-sm">累計損益 (pips)</div>
            <div className={`text-2xl font-bold ${currentStats.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {currentStats.totalPnl >= 0 ? "+" : ""}{formatNumber(currentStats.totalPnl, 1)}
            </div>
          </div>
        </section>

        {/* タブ切り替え */}
        <div className="flex border-b border-slate-700">
          <button
            onClick={() => setActiveTab("notes")}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === "notes"
                ? "text-cyan-400 border-b-2 border-cyan-400"
                : "text-slate-400 hover:text-white"
            }`}
          >
            📝 ノート一覧 ({notes.length})
          </button>
          <button
            onClick={() => setActiveTab("summaries")}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === "summaries"
                ? "text-cyan-400 border-b-2 border-cyan-400"
                : "text-slate-400 hover:text-white"
            }`}
          >
            📊 サマリー ({summaries.length})
          </button>
        </div>

        {/* ノート一覧タブ */}
        {activeTab === "notes" && (
          <section className="space-y-4">
            {notes.length === 0 ? (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <div className="text-4xl mb-4">📝</div>
                <div className="text-slate-400">
                  AIノートがありません。
                  <br />
                  仮想トレードを決済するとAIが自動でノートを生成します。
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className={`bg-slate-800/50 border border-slate-700 rounded-xl p-4 cursor-pointer hover:border-cyan-500/50 transition-colors ${
                      selectedNote?.id === note.id ? "border-cyan-500" : ""
                    }`}
                    onClick={() => setSelectedNote(selectedNote?.id === note.id ? null : note)}
                  >
                    {/* ノートヘッダー */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${getOutcomeColor(note.result.outcome)}`}>
                          {outcomeToJapanese(note.result.outcome)}
                        </span>
                        <span className="font-bold">{note.symbol}</span>
                        <span className={`text-sm ${note.direction === "long" ? "text-green-400" : "text-red-400"}`}>
                          {directionToJapanese(note.direction)}
                        </span>
                      </div>
                      <div className="text-slate-400 text-sm">
                        {formatDate(note.date)}
                      </div>
                    </div>

                    {/* ノートサマリー */}
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <div className="text-slate-400">PnL (pips)</div>
                        <div className={`font-medium ${note.result.pnlPips >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {note.result.pnlPips >= 0 ? "+" : ""}{formatNumber(note.result.pnlPips, 1)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">RR実績</div>
                        <div className="font-medium text-white">
                          {formatNumber(note.result.riskRewardActual, 2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">保有時間</div>
                        <div className="font-medium text-white">
                          {formatDuration(note.result.holdingDuration)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">エントリー</div>
                        <div className="font-medium text-white">
                          {timingToJapanese(note.entryAnalysis.timing)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">決済</div>
                        <div className="font-medium text-white">
                          {exitTypeToJapanese(note.exitAnalysis.type)}
                        </div>
                      </div>
                    </div>

                    {/* 展開時の詳細 */}
                    {selectedNote?.id === note.id && (
                      <div className="mt-4 pt-4 border-t border-slate-700 space-y-4">
                        {/* エントリー分析 */}
                        <div>
                          <h3 className="text-sm font-bold text-cyan-400 mb-2">📥 エントリー分析</h3>
                          <div className="bg-slate-900/50 rounded-lg p-3 text-sm">
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div>
                                <span className="text-slate-400">タイミング: </span>
                                <span className="text-white">{timingToJapanese(note.entryAnalysis.timing)}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">計画との乖離: </span>
                                <span className="text-white">{formatNumber(note.entryAnalysis.priceVsPlan, 1)} pips</span>
                              </div>
                            </div>
                            <div className="text-slate-300">{note.entryAnalysis.evaluation}</div>
                          </div>
                        </div>

                        {/* 決済分析 */}
                        <div>
                          <h3 className="text-sm font-bold text-purple-400 mb-2">📤 決済分析</h3>
                          <div className="bg-slate-900/50 rounded-lg p-3 text-sm">
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div>
                                <span className="text-slate-400">タイプ: </span>
                                <span className="text-white">{exitTypeToJapanese(note.exitAnalysis.type)}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">タイミング: </span>
                                <span className="text-white">{exitTimingToJapanese(note.exitAnalysis.timing)}</span>
                              </div>
                            </div>
                            <div className="text-slate-300">{note.exitAnalysis.evaluation}</div>
                          </div>
                        </div>

                        {/* プラン評価 */}
                        <div>
                          <h3 className="text-sm font-bold text-indigo-400 mb-2">📋 プラン評価</h3>
                          <div className="bg-slate-900/50 rounded-lg p-3 text-sm">
                            <div className="grid grid-cols-3 gap-2 mb-2">
                              <div>
                                <span className="text-slate-400">シナリオ: </span>
                                <span className="text-white">{accuracyToJapanese(note.planEvaluation.scenarioAccuracy)}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">レベル: </span>
                                <span className="text-white">{accuracyToJapanese(note.planEvaluation.levelAccuracy)}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">方向: </span>
                                <span className={note.planEvaluation.directionCorrect ? "text-green-400" : "text-red-400"}>
                                  {note.planEvaluation.directionCorrect ? "正解" : "不正解"}
                                </span>
                              </div>
                            </div>
                            <div className="text-slate-300">{note.planEvaluation.evaluation}</div>
                          </div>
                        </div>

                        {/* 学び */}
                        <div>
                          <h3 className="text-sm font-bold text-yellow-400 mb-2">💡 学び</h3>
                          <div className="bg-slate-900/50 rounded-lg p-3 text-sm space-y-2">
                            {note.learnings.whatWorked.length > 0 && (
                              <div>
                                <div className="text-green-400 text-xs font-medium mb-1">うまくいったこと:</div>
                                <ul className="list-disc list-inside text-slate-300">
                                  {note.learnings.whatWorked.map((item, i) => (
                                    <li key={i}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {note.learnings.whatDidntWork.length > 0 && (
                              <div>
                                <div className="text-red-400 text-xs font-medium mb-1">改善点:</div>
                                <ul className="list-disc list-inside text-slate-300">
                                  {note.learnings.whatDidntWork.map((item, i) => (
                                    <li key={i}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {note.learnings.keyInsight && (
                              <div className="pt-2 border-t border-slate-700">
                                <div className="text-cyan-400 text-xs font-medium mb-1">キーインサイト:</div>
                                <div className="text-white font-medium">{note.learnings.keyInsight}</div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 市場レビュー */}
                        <div>
                          <h3 className="text-sm font-bold text-blue-400 mb-2">🌍 市場振り返り</h3>
                          <div className="bg-slate-900/50 rounded-lg p-3 text-sm">
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div>
                                <span className="text-slate-400">実際のレジーム: </span>
                                <span className="text-white">{note.marketReview.regimeActual}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">予測レジーム: </span>
                                <span className="text-white">{note.marketReview.regimePredicted}</span>
                              </div>
                            </div>
                            {note.marketReview.keyEventsImpact.length > 0 && (
                              <div className="text-slate-300">
                                <span className="text-slate-400">影響イベント: </span>
                                {note.marketReview.keyEventsImpact.join(", ")}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* サマリータブ */}
        {activeTab === "summaries" && (
          <section className="space-y-4">
            {/* サマリー生成ボタン */}
            <div className="flex gap-4">
              <button
                onClick={() => handleGenerateSummary("daily")}
                disabled={generatingSummary}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-600 rounded-lg transition-colors text-sm"
              >
                {generatingSummary ? "生成中..." : "📊 日次サマリー生成"}
              </button>
              <button
                onClick={() => handleGenerateSummary("weekly")}
                disabled={generatingSummary}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-600 rounded-lg transition-colors text-sm"
              >
                {generatingSummary ? "生成中..." : "📈 週次サマリー生成"}
              </button>
              <button
                onClick={() => handleGenerateSummary("monthly")}
                disabled={generatingSummary}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 rounded-lg transition-colors text-sm"
              >
                {generatingSummary ? "生成中..." : "📉 月次サマリー生成"}
              </button>
            </div>

            {summaries.length === 0 ? (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <div className="text-4xl mb-4">📊</div>
                <div className="text-slate-400">
                  サマリーがありません。
                  <br />
                  上のボタンからサマリーを生成してください。
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {summaries.map((summary) => (
                  <div
                    key={summary.id}
                    className="bg-slate-800/50 border border-slate-700 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-1 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-xs font-medium">
                          {periodToJapanese(summary.period)}
                        </span>
                        <span className="text-white font-medium">
                          {formatDate(summary.startDate)} - {formatDate(summary.endDate)}
                        </span>
                      </div>
                      <div className="text-slate-400 text-sm">
                        作成: {formatDate(summary.createdAt)}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-slate-400">総トレード</div>
                        <div className="text-xl font-bold text-white">
                          {summary.statistics.totalTrades}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">勝率</div>
                        <div className={`text-xl font-bold ${summary.statistics.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                          {formatNumber(summary.statistics.winRate, 1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">PF</div>
                        <div className={`text-xl font-bold ${summary.statistics.profitFactor >= 1 ? "text-green-400" : "text-red-400"}`}>
                          {formatNumber(summary.statistics.profitFactor, 2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">累計PnL</div>
                        <div className={`text-xl font-bold ${summary.statistics.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {summary.statistics.totalPnl >= 0 ? "+" : ""}{formatNumber(summary.statistics.totalPnl, 1)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-slate-400">平均勝ち</div>
                        <div className="text-green-400">+{formatNumber(summary.statistics.averageWin, 1)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400">平均負け</div>
                        <div className="text-red-400">-{formatNumber(summary.statistics.averageLoss, 1)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400">最大勝ち</div>
                        <div className="text-green-400">+{formatNumber(summary.statistics.largestWin, 1)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400">最大負け</div>
                        <div className="text-red-400">-{formatNumber(summary.statistics.largestLoss, 1)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
