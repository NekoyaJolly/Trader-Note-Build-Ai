/**
 * モンテカルロシミュレーション結果パネル
 * 
 * 目的:
 * - ランダム戦略との比較結果を可視化
 * - 勝率・PF・最大DDの分布をヒストグラムで表示
 * - 実際の戦略のパーセンタイル順位を表示
 * - 過去の実行履歴を表示
 */
"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type {
  MonteCarloResult,
  MonteCarloParams,
  DistributionStats,
  MonteCarloHistoryEntry,
} from "@/lib/api";
import { runMonteCarloSimulation, fetchMonteCarloHistory } from "@/lib/api";

interface MonteCarloTabProps {
  /** ストラテジーID */
  strategyId: string;
  /** 選択中のバックテストRunID（比較対象として使用） */
  backtestRunId?: string;
  /** バックテストパラメータのデフォルト値 */
  defaultParams?: {
    startDate?: string;
    endDate?: string;
    timeframe?: string;
    takeProfit?: number;
    stopLoss?: number;
    maxHoldingMinutes?: number;
  };
}

/**
 * 評価に応じた色を返す
 */
function getAssessmentColor(
  assessment?: 'excellent' | 'good' | 'average' | 'poor' | 'very_poor'
): string {
  switch (assessment) {
    case 'excellent': return 'text-green-400';
    case 'good': return 'text-cyan-400';
    case 'average': return 'text-yellow-400';
    case 'poor': return 'text-orange-400';
    case 'very_poor': return 'text-red-400';
    default: return 'text-gray-400';
  }
}

/**
 * パーセンタイルに応じた色を返す
 */
function getPercentileColor(percentile: number): string {
  if (percentile >= 90) return '#22C55E'; // green-500
  if (percentile >= 75) return '#06B6D4'; // cyan-500
  if (percentile >= 50) return '#EAB308'; // yellow-500
  if (percentile >= 25) return '#F97316'; // orange-500
  return '#EF4444'; // red-500
}

/**
 * ヒストグラムコンポーネント
 */
function DistributionHistogram({
  stats,
  title,
  actualValue,
  formatValue = (v: number) => v.toFixed(2),
}: {
  stats: DistributionStats;
  title: string;
  actualValue?: number;
  formatValue?: (v: number) => string;
  highlightHigh?: boolean;
}) {
  // ヒストグラムデータを変換
  const data = stats.histogram.map((bin) => ({
    name: formatValue((bin.min + bin.max) / 2),
    value: bin.percentage,
    min: bin.min,
    max: bin.max,
    // 実際の値が含まれるビンをハイライト
    isActual: actualValue !== undefined && actualValue >= bin.min && actualValue < bin.max,
  }));

  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <h4 className="text-sm font-semibold text-gray-300 mb-3">{title}</h4>
      
      {/* 統計サマリー */}
      <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
        <div className="text-center">
          <div className="text-gray-500">平均</div>
          <div className="text-white font-mono">{formatValue(stats.mean)}</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500">中央値</div>
          <div className="text-white font-mono">{formatValue(stats.median)}</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500">標準偏差</div>
          <div className="text-white font-mono">{formatValue(stats.stdDev)}</div>
        </div>
      </div>
      
      {/* ヒストグラム */}
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="name"
              tick={{ fill: '#6B7280', fontSize: 10 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#6B7280', fontSize: 10 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                borderRadius: '8px',
              }}
              formatter={(value) => [`${typeof value === 'number' ? value.toFixed(1) : value}%`, '頻度']}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isActual ? '#EC4899' : '#3B82F6'}
                  fillOpacity={entry.isActual ? 1 : 0.7}
                />
              ))}
            </Bar>
            {/* 実際の値の参照線 */}
            {actualValue !== undefined && (
              <ReferenceLine
                x={formatValue(actualValue)}
                stroke="#EC4899"
                strokeWidth={2}
                strokeDasharray="5 5"
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      {/* パーセンタイル */}
      <div className="mt-3 flex justify-between text-xs text-gray-500">
        <span>5%: {formatValue(stats.percentiles.p5)}</span>
        <span>50%: {formatValue(stats.percentiles.p50)}</span>
        <span>95%: {formatValue(stats.percentiles.p95)}</span>
      </div>
    </div>
  );
}

/**
 * モンテカルロシミュレーションタブ
 */
export function MonteCarloTab({ strategyId, backtestRunId, defaultParams }: MonteCarloTabProps) {
  // 状態
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // 履歴
  const [history, setHistory] = useState<MonteCarloHistoryEntry[]>([]);
  
  // パラメータ
  const [iterations, setIterations] = useState<100 | 500 | 1000>(100);
  const [startDate, setStartDate] = useState(defaultParams?.startDate || '');
  const [endDate, setEndDate] = useState(defaultParams?.endDate || '');
  
  /**
   * 履歴を読み込む
   */
  const loadHistory = useCallback(async () => {
    try {
      const h = await fetchMonteCarloHistory(strategyId);
      setHistory(h);
    } catch (err) {
      console.warn('モンテカルロ履歴の取得に失敗:', err);
    }
  }, [strategyId]);

  // 初回読み込み
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  
  /**
   * シミュレーション実行
   */
  const handleRunSimulation = async () => {
    if (!startDate || !endDate) {
      setError('期間を指定してください');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const params: MonteCarloParams = {
        iterations,
        startDate,
        endDate,
        timeframe: defaultParams?.timeframe || '15m',
        takeProfit: defaultParams?.takeProfit || 2.0,
        stopLoss: defaultParams?.stopLoss || 1.0,
        maxHoldingMinutes: defaultParams?.maxHoldingMinutes || 1440,
        // 選択中のバックテストRunIDを渡す（比較対象として使用）
        backtestRunId,
      };
      
      const res = await runMonteCarloSimulation(strategyId, params);
      setResult(res);
      // 実行後に履歴を再読み込み
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'シミュレーションに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ヘッダー説明 */}
      <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-2">
          📊 モンテカルロシミュレーション
        </h3>
        <p className="text-sm text-gray-400">
          ランダムなエントリー戦略を複数回シミュレートし、実際の戦略パフォーマンスが
          「運」ではなく「優位性」によるものかを検証します。
          パーセンタイルが高いほど、ランダムより優れた戦略であることを示します。
        </p>
      </div>
      
      {/* パラメータ設定 */}
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
        <h4 className="text-sm font-semibold text-gray-300 mb-4">シミュレーション設定</h4>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          {/* 回数選択 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">シミュレーション回数</label>
            <div className="flex gap-2">
              {([100, 500, 1000] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setIterations(n)}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-all ${
                    iterations === n
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                      : 'bg-slate-700 border-slate-600 text-gray-400 hover:border-slate-500'
                  }`}
                >
                  {n}回
                </button>
              ))}
            </div>
          </div>
          
          {/* 開始日 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">開始日</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>
          
          {/* 終了日 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">終了日</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>
        
        {/* 実行ボタン */}
        <button
          onClick={handleRunSimulation}
          disabled={isLoading}
          className={`w-full px-4 py-3 rounded-lg font-medium transition-all ${
            isLoading
              ? 'bg-slate-600 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:opacity-90'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              シミュレーション実行中... ({iterations}回)
            </span>
          ) : (
            `シミュレーション実行 (${iterations}回)`
          )}
        </button>
      </div>
      
      {/* エラー表示 */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      
      {/* 結果表示 */}
      {result && (
        <>
          {/* 比較結果サマリー */}
          {result.comparison && (
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <h4 className="text-sm font-semibold text-gray-300 mb-4">📈 戦略評価</h4>
              
              {/* 総合評価 */}
              <div className="text-center mb-6">
                <div className={`text-2xl font-bold ${getAssessmentColor(result.comparison.overallAssessment)}`}>
                  {result.comparison.overallAssessment === 'excellent' && '🏆 優秀'}
                  {result.comparison.overallAssessment === 'good' && '✨ 良好'}
                  {result.comparison.overallAssessment === 'average' && '📊 平均的'}
                  {result.comparison.overallAssessment === 'poor' && '⚠️ 要改善'}
                  {result.comparison.overallAssessment === 'very_poor' && '❌ 見直し必要'}
                </div>
                <p className="text-sm text-gray-400 mt-2">{result.comparison.comment}</p>
              </div>
              
              {/* パーセンタイル表示 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-slate-700/50 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">勝率</div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: getPercentileColor(result.comparison.winRatePercentile) }}
                  >
                    {result.comparison.winRatePercentile.toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-500">上位</div>
                </div>
                
                <div className="text-center p-3 bg-slate-700/50 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">プロフィットファクター</div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: getPercentileColor(result.comparison.profitFactorPercentile) }}
                  >
                    {result.comparison.profitFactorPercentile.toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-500">上位</div>
                </div>
                
                <div className="text-center p-3 bg-slate-700/50 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">最大DD</div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: getPercentileColor(100 - result.comparison.maxDrawdownPercentile) }}
                  >
                    {(100 - result.comparison.maxDrawdownPercentile).toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-500">上位（低DD）</div>
                </div>
                
                <div className="text-center p-3 bg-slate-700/50 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">純損益率</div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: getPercentileColor(result.comparison.netProfitRatePercentile) }}
                  >
                    {result.comparison.netProfitRatePercentile.toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-500">上位</div>
                </div>
              </div>
            </div>
          )}
          
          {/* 分布ヒストグラム */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DistributionHistogram
              stats={result.statistics.winRate}
              title="勝率の分布"
              formatValue={(v) => `${(v * 100).toFixed(1)}%`}
            />
            
            <DistributionHistogram
              stats={result.statistics.profitFactor}
              title="プロフィットファクターの分布"
              formatValue={(v) => v.toFixed(2)}
            />
            
            <DistributionHistogram
              stats={result.statistics.maxDrawdownRate}
              title="最大ドローダウン率の分布"
              formatValue={(v) => `${(v * 100).toFixed(1)}%`}
              highlightHigh={false}
            />
            
            <DistributionHistogram
              stats={result.statistics.netProfitRate}
              title="純損益率の分布"
              formatValue={(v) => `${(v * 100).toFixed(1)}%`}
            />
          </div>
          
          {/* シミュレーション詳細 */}
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">シミュレーション概要</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500">実行回数:</span>
                <span className="text-white ml-2">{result.iterations}回</span>
              </div>
              <div>
                <span className="text-gray-500">平均トレード数:</span>
                <span className="text-white ml-2">
                  {(result.simulations.reduce((sum, s) => sum + s.totalTrades, 0) / result.simulations.length).toFixed(0)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">勝率平均:</span>
                <span className="text-white ml-2">
                  {(result.statistics.winRate.mean * 100).toFixed(1)}%
                </span>
              </div>
              <div>
                <span className="text-gray-500">PF平均:</span>
                <span className="text-white ml-2">
                  {result.statistics.profitFactor.mean.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
      
      {/* 実行履歴 */}
      {history.length > 0 && (
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">📜 実行履歴</h4>
          <div className="space-y-2">
            {history.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="bg-slate-700/50 rounded-lg p-3 border border-slate-600"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-500">
                    {new Date(entry.createdAt).toLocaleString('ja-JP', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="text-xs text-gray-400">
                    {entry.iterations}回 / {entry.timeframe}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="text-center">
                    <div className="text-gray-500">期待勝率</div>
                    <div className="text-white font-mono">
                      {(entry.expectedWinRate * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500">MC平均</div>
                    <div className="text-white font-mono">
                      {(entry.simulatedMeanWinRate * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500">勝率%ile</div>
                    <div className="font-mono" style={{ color: getPercentileColor(entry.percentiles.winRate) }}>
                      {entry.percentiles.winRate.toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500">PF%ile</div>
                    <div className="font-mono" style={{
                      color: entry.percentiles.profitFactor != null
                        ? getPercentileColor(entry.percentiles.profitFactor)
                        : '#9CA3AF'
                    }}>
                      {entry.percentiles.profitFactor != null
                        ? `${entry.percentiles.profitFactor.toFixed(0)}%`
                        : '-'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {history.length > 5 && (
            <p className="text-xs text-gray-500 mt-2 text-center">
              他 {history.length - 5} 件の履歴
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default MonteCarloTab;
