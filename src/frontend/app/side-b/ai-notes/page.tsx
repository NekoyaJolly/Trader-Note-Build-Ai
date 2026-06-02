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
import { getPublicApiBaseUrl } from "@/lib/publicApiBaseUrl";
import { apiFetch } from "@/lib/apiClient";

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
  /** エントリー(約定)日時 ISO。関連 VirtualTrade.enteredAt 由来。未約定/旧データは null。 */
  enteredAt?: string | null;
  /** クローズ(決済)日時 ISO。関連 VirtualTrade.exitedAt 由来。未決済/旧データは null。 */
  exitedAt?: string | null;
  symbol: string;
  direction: "long" | "short";
  result: TradeResult;
  entryAnalysis: EntryAnalysis;
  exitAnalysis: ExitAnalysis;
  planEvaluation: PlanEvaluation;
  marketReview: MarketReview;
  learnings: Learnings;
  /** 本番運用フラグ（手動選別）。true のノートだけが実行時のライブ照合の対象になる。 */
  usedForMatching: boolean;
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
const formatNumber = (value: number | undefined | null, decimals: number = 2): string => {
  if (value === undefined || value === null) return "0";
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

// 日時を「MM/DD HH:mm」(分まで) で整形する。エントリー/クローズ日時の表示用。
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

// ノート一覧 API が返す全ノート基準の統計（ページング・本番運用フィルタの影響を受けない）
interface NoteListStats {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnlPips: number;
}

const EMPTY_NOTE_STATS: NoteListStats = {
  totalTrades: 0,
  winRate: 0,
  profitFactor: 0,
  totalPnlPips: 0,
};

export default function AINotesPage() {
  // 状態管理
  const [notes, setNotes] = useState<AITradeNote[]>([]);
  // 本番運用タブ用: サーバー側で usedForMatching=true を絞って取得（メイン一覧のページングに依存しない）
  const [productionNotes, setProductionNotes] = useState<AITradeNote[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [productionTotal, setProductionTotal] = useState(0);
  // 統計カードは API の全ノート集計を表示（計算は全体）
  const [noteStats, setNoteStats] = useState<NoteListStats>(EMPTY_NOTE_STATS);
  const [summaries, setSummaries] = useState<AINoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<AITradeNote | null>(null);
  const [activeTab, setActiveTab] = useState<"notes" | "production" | "summaries">("notes");
  const [generatingSummary, setGeneratingSummary] = useState(false);
  // 本番運用トグルの更新中ノートID（連打防止 + スピナー表示用）
  const [togglingNoteId, setTogglingNoteId] = useState<string | null>(null);

  // API ベース URL
  const API_BASE = getPublicApiBaseUrl() + "/api";
  // データ取得
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 全ノート / 本番運用ノート / サマリーを並行取得。
      // 本番運用ノートはサーバー側で usedForMatching=true を絞って取得し、メイン一覧のページングに依存させない。
      const [notesRes, productionRes, summariesRes] = await Promise.all([
        apiFetch(`${API_BASE}/side-b/ai-notes`),
        apiFetch(`${API_BASE}/side-b/ai-notes?usedForMatching=true`),
        apiFetch(`${API_BASE}/side-b/ai-notes/summaries`),
      ]);

      if (!notesRes.ok) {
        throw new Error(`ノート取得エラー: ${notesRes.status}`);
      }
      if (!productionRes.ok) {
        throw new Error(`本番運用ノート取得エラー: ${productionRes.status}`);
      }
      if (!summariesRes.ok) {
        throw new Error(`サマリー取得エラー: ${summariesRes.status}`);
      }

      const notesData = await notesRes.json();
      const productionData = await productionRes.json();
      const summariesData = await summariesRes.json();

      // APIレスポンスからノート配列・統計・サマリー配列を抽出
      setNotes(notesData.notes || []);
      setAllTotal(notesData.total ?? (notesData.notes?.length ?? 0));
      // 統計カードは全ノート基準のサーバー集計を使う（計算は全体）
      setNoteStats(notesData.stats ? { ...EMPTY_NOTE_STATS, ...notesData.stats } : EMPTY_NOTE_STATS);
      setProductionNotes(productionData.notes || []);
      setProductionTotal(productionData.total ?? (productionData.notes?.length ?? 0));
      setSummaries(summariesData.summaries || []);
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

      const endDate = new Date();
      const startDate = new Date();
      if (period === "daily") {
        // Today
      } else if (period === "weekly") {
        startDate.setDate(endDate.getDate() - 7);
      } else if (period === "monthly") {
        startDate.setMonth(endDate.getMonth() - 1);
      }

      const res = await apiFetch(`${API_BASE}/side-b/ai-notes/summaries/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          period,
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0]
        }),
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

  // 本番運用フラグの手動トグル。
  // PATCH 成功後は一覧・本番運用件数・統計が連動して変わるため、全データを再取得して整合させる。
  const handleToggleMatching = async (note: AITradeNote) => {
    if (togglingNoteId) return;
    setTogglingNoteId(note.id);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/side-b/ai-notes/${note.id}/matching`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usedForMatching: !note.usedForMatching }),
      });
      if (!res.ok) {
        throw new Error(`本番運用フラグの更新に失敗しました: ${res.status}`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "本番運用フラグの更新に失敗しました");
    } finally {
      setTogglingNoteId(null);
    }
  };

  // 現在のタブで表示するノート集合（本番運用タブはサーバー取得済みの選別集合）
  const visibleNotes = activeTab === "production" ? productionNotes : notes;

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
                <span>ノート</span>
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
          <div className="glass-surface hover-glow transition-smooth rounded-xl p-4">
            <div className="text-slate-400 text-sm">総トレード数</div>
            <div className="text-2xl font-bold text-white">
              {noteStats.totalTrades}
            </div>
          </div>
          <div className="glass-surface hover-glow transition-smooth rounded-xl p-4">
            <div className="text-slate-400 text-sm">勝率</div>
            <div className={`text-2xl font-bold ${noteStats.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
              {formatNumber(noteStats.winRate, 1)}%
            </div>
          </div>
          <div className="glass-surface hover-glow transition-smooth rounded-xl p-4">
            <div className="text-slate-400 text-sm">プロフィットファクター</div>
            <div className={`text-2xl font-bold ${noteStats.profitFactor >= 1 ? "text-green-400" : "text-red-400"}`}>
              {formatNumber(noteStats.profitFactor, 2)}
            </div>
          </div>
          <div className="glass-surface hover-glow transition-smooth rounded-xl p-4">
            <div className="text-slate-400 text-sm">累計損益 (pips)</div>
            <div className={`text-2xl font-bold ${noteStats.totalPnlPips >= 0 ? "text-green-400" : "text-red-400"}`}>
              {noteStats.totalPnlPips >= 0 ? "+" : ""}{formatNumber(noteStats.totalPnlPips, 1)}
            </div>
          </div>
        </section>

        {/* タブ切り替え */}
        <div className="flex border-b border-slate-700">
          <button
            onClick={() => setActiveTab("notes")}
            className={`px-6 py-3 font-medium transition-colors ${activeTab === "notes"
                ? "text-cyan-400 border-b-2 border-cyan-400"
                : "text-slate-400 hover:text-white"
              }`}
          >
            📝 ノート一覧 ({allTotal})
          </button>
          <button
            onClick={() => setActiveTab("production")}
            className={`px-6 py-3 font-medium transition-colors ${activeTab === "production"
                ? "text-amber-400 border-b-2 border-amber-400"
                : "text-slate-400 hover:text-white"
              }`}
            title="ここに入れたノートだけが、ライブ市場入力との類似度判定の対象になります"
          >
            ⭐ 本番運用 ({productionTotal})
          </button>
          <button
            onClick={() => setActiveTab("summaries")}
            className={`px-6 py-3 font-medium transition-colors ${activeTab === "summaries"
                ? "text-cyan-400 border-b-2 border-cyan-400"
                : "text-slate-400 hover:text-white"
              }`}
          >
            📊 サマリー ({summaries.length})
          </button>
        </div>

        {/* ノート一覧タブ / 本番運用タブ（同じカード表示を共有） */}
        {(activeTab === "notes" || activeTab === "production") && (
          <section className="space-y-4">
            {activeTab === "production" && (
              <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200/90 px-4 py-3 rounded-lg text-sm">
                ⭐ ここに入れたノートだけが、ライブ市場入力との<strong>類似度判定の対象</strong>になります。
                各カードの「本番運用」トグルで選別してください（ノート一覧・上部の統計は全ノートのまま）。
              </div>
            )}
            {visibleNotes.length === 0 ? (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <div className="text-4xl mb-4">{activeTab === "production" ? "⭐" : "📝"}</div>
                <div className="text-slate-400">
                  {activeTab === "production" ? (
                    <>
                      本番運用に選別されたノートはまだありません。
                      <br />
                      「ノート一覧」で良いトレードのカードの「本番運用」トグルを ON にしてください。
                    </>
                  ) : (
                    <>
                      AIノートがありません。
                      <br />
                      仮想トレードを決済するとAIが自動でノートを生成します。
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {visibleNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`glass-surface hover-glow press-scale transition-smooth rounded-xl p-4 cursor-pointer ${selectedNote?.id === note.id ? "border-cyan-500" : ""
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
                        {/* 本番運用トグル（カード展開と独立させるため propagation を止める） */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleMatching(note);
                          }}
                          disabled={togglingNoteId === note.id}
                          aria-pressed={note.usedForMatching}
                          title={note.usedForMatching
                            ? "本番運用中（ライブ照合の対象）。クリックで外す"
                            : "クリックで本番運用に追加（ライブ照合の対象にする）"}
                          className={`px-2 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-50 ${note.usedForMatching
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                              : "bg-slate-700/40 text-slate-400 border-slate-600/50 hover:text-white hover:border-slate-500"
                            }`}
                        >
                          {togglingNoteId === note.id ? "…" : note.usedForMatching ? "⭐ 本番運用中" : "☆ 本番運用に追加"}
                        </button>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-400 text-sm">
                          {formatDate(note.date)}
                        </div>
                        {(note.enteredAt || note.exitedAt) && (
                          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-3 justify-end">
                            {note.enteredAt && <span>エントリー {formatDateTimeMinute(note.enteredAt)}</span>}
                            {note.exitedAt && <span>クローズ {formatDateTimeMinute(note.exitedAt)}</span>}
                          </div>
                        )}
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
                    className="glass-surface hover-glow transition-smooth rounded-xl p-4"
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
