/**
 * 比較ダッシュボード（Phase D）
 * 
 * 人間のTradeNoteとAIのAITradeNoteを並列比較
 * - 勝率/PF比較
 * - 時系列グラフ
 * - 最近のトレード比較
 * 
 * @see docs/side-b/phase-d-integration.md
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ===== 型定義 =====

type ComparisonPeriod = "week" | "month" | "quarter" | "year" | "all";

interface PerformanceStats {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number | null;
  totalPnL: number;
  averagePnL: number;
  averageWin: number;
  averageLoss: number;
  maxWin: number;
  maxLoss: number;
}

interface ComparisonResult {
  period: {
    start: string;
    end: string;
    label: string;
  };
  human: PerformanceStats;
  ai: PerformanceStats;
  comparison: {
    winRateDiff: number;
    profitFactorDiff: number | null;
    totalPnLDiff: number;
    winner: "human" | "ai" | "tie";
  };
  alignmentRate: number;
}

interface TimeSeriesData {
  date: string;
  humanWinRate: number;
  aiWinRate: number;
  humanPnL: number;
  aiPnL: number;
}

interface RecentTrade {
  id: string;
  date: string;
  symbol: string;
  side?: string;
  direction?: string;
  outcome: "win" | "loss" | "breakeven";
  pnlPips: number | null;
}

interface DashboardData {
  summary: ComparisonResult;
  timeSeries: TimeSeriesData[];
  recentTrades: {
    human: RecentTrade[];
    ai: RecentTrade[];
  };
}

// ===== ユーティリティ =====

const periodLabels: Record<ComparisonPeriod, string> = {
  week: "1週間",
  month: "1ヶ月",
  quarter: "3ヶ月",
  year: "1年",
  all: "全期間",
};

const outcomeColors: Record<string, string> = {
  win: "text-green-400",
  loss: "text-red-400",
  breakeven: "text-gray-400",
};

const outcomeLabels: Record<string, string> = {
  win: "勝ち",
  loss: "負け",
  breakeven: "同値",
};

// ===== APIクライアント =====

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3100") + "/api/side-b";

async function fetchDashboard(period: ComparisonPeriod, symbol?: string): Promise<DashboardData> {
  const params = new URLSearchParams({ period });
  if (symbol) params.append("symbol", symbol);

  const response = await fetch(`${API_BASE}/comparison/dashboard?${params}`);
  if (!response.ok) {
    throw new Error("比較データの取得に失敗しました");
  }
  const data = await response.json();
  return data;
}

// ===== コンポーネント =====

/** 統計カード */
function StatsCard({
  title,
  stats,
  colorClass,
  icon,
}: {
  title: string;
  stats: PerformanceStats;
  colorClass: string;
  icon: string;
}) {
  return (
    <div className="card-surface rounded-xl p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">{icon}</span>
        <h3 className={`text-lg font-bold ${colorClass}`}>{title}</h3>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500">トレード数</p>
          <p className="text-xl font-bold text-white">{stats.totalTrades}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">勝率</p>
          <p className={`text-xl font-bold ${stats.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
            {stats.winRate.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">PF</p>
          <p className={`text-xl font-bold ${(stats.profitFactor ?? 0) >= 1 ? "text-green-400" : "text-red-400"}`}>
            {stats.profitFactor?.toFixed(2) ?? "-"}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">総PnL</p>
          <p className={`text-xl font-bold ${stats.totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
            {stats.totalPnL >= 0 ? "+" : ""}{stats.totalPnL.toFixed(1)} pips
          </p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">平均勝ち</span>
            <span className="text-green-400">+{stats.averageWin.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">平均負け</span>
            <span className="text-red-400">{stats.averageLoss.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">最大勝ち</span>
            <span className="text-green-400">+{stats.maxWin.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">最大負け</span>
            <span className="text-red-400">{stats.maxLoss.toFixed(1)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 比較サマリーカード */
function ComparisonSummaryCard({ comparison, alignmentRate }: { 
  comparison: ComparisonResult["comparison"]; 
  alignmentRate: number;
}) {
  const winnerLabel = {
    human: "🧑 人間優位",
    ai: "🤖 AI優位",
    tie: "🤝 互角",
  }[comparison.winner];

  const winnerColor = {
    human: "text-purple-400",
    ai: "text-cyan-400",
    tie: "text-yellow-400",
  }[comparison.winner];

  return (
    <div className="card-surface rounded-xl p-4 sm:p-6">
      <h3 className="text-lg font-bold text-white mb-4">📊 比較サマリー</h3>

      <div className="text-center mb-4">
        <p className={`text-2xl font-bold ${winnerColor}`}>{winnerLabel}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500">勝率差</p>
          <p className={`text-lg font-bold ${comparison.winRateDiff > 0 ? "text-purple-400" : comparison.winRateDiff < 0 ? "text-cyan-400" : "text-gray-400"}`}>
            {comparison.winRateDiff > 0 ? "+" : ""}{comparison.winRateDiff.toFixed(1)}%
          </p>
          <p className="text-xs text-gray-600">
            {comparison.winRateDiff > 0 ? "人間 >" : comparison.winRateDiff < 0 ? "AI >" : "同等"}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">PF差</p>
          <p className={`text-lg font-bold ${(comparison.profitFactorDiff ?? 0) > 0 ? "text-purple-400" : (comparison.profitFactorDiff ?? 0) < 0 ? "text-cyan-400" : "text-gray-400"}`}>
            {comparison.profitFactorDiff !== null 
              ? `${comparison.profitFactorDiff > 0 ? "+" : ""}${comparison.profitFactorDiff.toFixed(2)}`
              : "-"}
          </p>
          <p className="text-xs text-gray-600">
            {(comparison.profitFactorDiff ?? 0) > 0 ? "人間 >" : (comparison.profitFactorDiff ?? 0) < 0 ? "AI >" : "同等"}
          </p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-700">
        <p className="text-xs text-gray-500 mb-1">判断一致率</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-slate-700 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-purple-500 to-cyan-500 h-2 rounded-full transition-all"
              style={{ width: `${alignmentRate}%` }}
            />
          </div>
          <span className="text-sm font-bold text-white">{alignmentRate}%</span>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          同日・同シンボルで同方向のトレード
        </p>
      </div>
    </div>
  );
}

/** 時系列グラフ（簡易版） */
function TimeSeriesChart({ data }: { data: TimeSeriesData[] }) {
  if (data.length === 0) {
    return (
      <div className="card-surface rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-bold text-white mb-4">📈 時系列パフォーマンス</h3>
        <p className="text-gray-500 text-center py-8">データがありません</p>
      </div>
    );
  }

  // 累計PnLを計算
  let humanCumulative = 0;
  let aiCumulative = 0;
  const cumulativeData = data.map(d => {
    humanCumulative += d.humanPnL;
    aiCumulative += d.aiPnL;
    return {
      ...d,
      humanCumulative,
      aiCumulative,
    };
  });

  const maxPnL = Math.max(
    ...cumulativeData.map(d => Math.max(d.humanCumulative, d.aiCumulative)),
    1
  );
  const minPnL = Math.min(
    ...cumulativeData.map(d => Math.min(d.humanCumulative, d.aiCumulative)),
    0
  );
  const range = maxPnL - minPnL || 1;

  return (
    <div className="card-surface rounded-xl p-4 sm:p-6">
      <h3 className="text-lg font-bold text-white mb-4">📈 累計PnL推移</h3>
      
      <div className="relative h-48">
        {/* Y軸 */}
        <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between text-xs text-gray-500">
          <span>{maxPnL.toFixed(0)}</span>
          <span>{((maxPnL + minPnL) / 2).toFixed(0)}</span>
          <span>{minPnL.toFixed(0)}</span>
        </div>
        
        {/* グラフエリア */}
        <div className="ml-14 h-full relative">
          {/* ゼロライン */}
          {minPnL < 0 && (
            <div 
              className="absolute left-0 right-0 border-t border-slate-600"
              style={{ top: `${((maxPnL - 0) / range) * 100}%` }}
            />
          )}
          
          {/* SVGライン */}
          <svg className="w-full h-full" viewBox={`0 0 ${cumulativeData.length * 20} 100`} preserveAspectRatio="none">
            {/* 人間ライン */}
            <polyline
              fill="none"
              stroke="rgb(192, 132, 252)"
              strokeWidth="2"
              points={cumulativeData.map((d, i) => 
                `${i * 20 + 10},${100 - ((d.humanCumulative - minPnL) / range) * 100}`
              ).join(' ')}
            />
            {/* AIライン */}
            <polyline
              fill="none"
              stroke="rgb(34, 211, 238)"
              strokeWidth="2"
              points={cumulativeData.map((d, i) => 
                `${i * 20 + 10},${100 - ((d.aiCumulative - minPnL) / range) * 100}`
              ).join(' ')}
            />
          </svg>
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex justify-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-purple-400 rounded-full" />
          <span className="text-sm text-gray-400">人間</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-cyan-400 rounded-full" />
          <span className="text-sm text-gray-400">AI</span>
        </div>
      </div>
    </div>
  );
}

/** 最近のトレード比較テーブル */
function RecentTradesTable({ human, ai }: { human: RecentTrade[]; ai: RecentTrade[] }) {
  return (
    <div className="card-surface rounded-xl p-4 sm:p-6">
      <h3 className="text-lg font-bold text-white mb-4">🔄 最近のトレード</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 人間のトレード */}
        <div>
          <h4 className="text-sm font-medium text-purple-400 mb-2 flex items-center gap-2">
            🧑 人間
          </h4>
          {human.length === 0 ? (
            <p className="text-gray-500 text-sm">データなし</p>
          ) : (
            <div className="space-y-2">
              {human.map(trade => (
                <div key={trade.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{trade.date}</span>
                    <span className="text-sm font-medium text-white">{trade.symbol}</span>
                    <span className="text-xs text-gray-400">{trade.side === "buy" ? "買い" : "売り"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${outcomeColors[trade.outcome]}`}>
                      {outcomeLabels[trade.outcome]}
                    </span>
                    {trade.pnlPips !== null && (
                      <span className={`text-sm font-medium ${trade.pnlPips >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {trade.pnlPips >= 0 ? "+" : ""}{trade.pnlPips.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AIのトレード */}
        <div>
          <h4 className="text-sm font-medium text-cyan-400 mb-2 flex items-center gap-2">
            🤖 AI
          </h4>
          {ai.length === 0 ? (
            <p className="text-gray-500 text-sm">データなし</p>
          ) : (
            <div className="space-y-2">
              {ai.map(trade => (
                <div key={trade.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{trade.date}</span>
                    <span className="text-sm font-medium text-white">{trade.symbol}</span>
                    <span className="text-xs text-gray-400">{trade.direction === "long" ? "ロング" : "ショート"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${outcomeColors[trade.outcome]}`}>
                      {outcomeLabels[trade.outcome]}
                    </span>
                    <span className={`text-sm font-medium ${(trade.pnlPips ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {(trade.pnlPips ?? 0) >= 0 ? "+" : ""}{(trade.pnlPips ?? 0).toFixed(1)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== メインページ =====

export default function ComparisonDashboardPage() {
  const [period, setPeriod] = useState<ComparisonPeriod>("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await fetchDashboard(period);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl w-full mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8 md:py-12">
        {/* ヘッダー */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
                🧑 vs 🤖 比較ダッシュボード
              </span>
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              人間のトレードノートとAIトレードノートのパフォーマンス比較
            </p>
          </div>

          <Link
            href="/side-b"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Side-B ダッシュボードへ戻る
          </Link>
        </div>

        {/* 期間フィルター */}
        <div className="flex flex-wrap gap-2 mb-6">
          {(Object.keys(periodLabels) as ComparisonPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                period === p
                  ? "bg-gradient-to-r from-purple-500 to-cyan-500 text-white"
                  : "bg-slate-700/50 text-gray-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>

        {/* ローディング */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full" />
          </div>
        )}

        {/* エラー */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
            {error}
          </div>
        )}

        {/* データ表示 */}
        {!isLoading && !error && data && (
          <div className="space-y-6">
            {/* 期間表示 */}
            <div className="text-center text-sm text-gray-500">
              {data.summary.period.label}（{data.summary.period.start} 〜 {data.summary.period.end}）
            </div>

            {/* 統計カード */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatsCard
                title="人間"
                stats={data.summary.human}
                colorClass="text-purple-400"
                icon="🧑"
              />
              <ComparisonSummaryCard
                comparison={data.summary.comparison}
                alignmentRate={data.summary.alignmentRate}
              />
              <StatsCard
                title="AI"
                stats={data.summary.ai}
                colorClass="text-cyan-400"
                icon="🤖"
              />
            </div>

            {/* 時系列グラフ */}
            <TimeSeriesChart data={data.timeSeries} />

            {/* 最近のトレード */}
            <RecentTradesTable
              human={data.recentTrades.human}
              ai={data.recentTrades.ai}
            />
          </div>
        )}

        {/* データなし */}
        {!isLoading && !error && data && 
          data.summary.human.totalTrades === 0 && 
          data.summary.ai.totalTrades === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-500 text-lg">比較データがありません</p>
            <p className="text-gray-600 text-sm mt-2">
              トレードノートを作成するか、AIトレードを実行してください
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
