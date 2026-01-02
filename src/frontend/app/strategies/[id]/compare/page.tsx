/**
 * ストラテジーバージョン比較ダッシュボード
 * 
 * 目的:
 * - 複数バージョンのパフォーマンス比較
 * - 最適バージョンの視覚化
 * - バージョン進化の確認
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchStrategy,
  fetchVersionComparison,
  VersionComparisonResult,
  VersionComparisonData,
} from "@/lib/api";
import type { Strategy } from "@/types/strategy";

/** メトリクス表示カード */
function MetricCard({
  label,
  value,
  unit = "",
  color = "text-white",
  isBest = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  isBest?: boolean;
}) {
  return (
    <div className={`bg-slate-700 rounded-lg p-3 ${isBest ? 'ring-2 ring-yellow-500' : ''}`}>
      <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
        {label}
        {isBest && <span className="text-yellow-500">★</span>}
      </div>
      <div className={`text-lg font-bold ${color}`}>
        {value}{unit}
      </div>
    </div>
  );
}

export default function StrategyComparePage() {
  const params = useParams();
  const strategyId = params.id as string;

  // ストラテジー情報
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  
  // 比較データ
  const [comparison, setComparison] = useState<VersionComparisonResult | null>(null);
  
  // 選択されたバージョン（空の場合は全バージョン）
  const [selectedVersions, setSelectedVersions] = useState<number[]>([]);
  
  // UIステート
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ============================================
  // データ取得
  // ============================================

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ストラテジーを取得
      const strategyData = await fetchStrategy(strategyId);
      setStrategy(strategyData);

      // 比較データを取得
      const comparisonData = await fetchVersionComparison(
        strategyId,
        selectedVersions.length > 0 ? selectedVersions : undefined
      );
      setComparison(comparisonData);
    } catch (err) {
      const message = err instanceof Error ? err.message : "データの取得に失敗しました";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [strategyId, selectedVersions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
              <Link href="/strategies" className="text-blue-400 hover:underline">
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
    <div className="space-y-6">
          {/* エラーメッセージ */}}
          {error && (
            <div className="bg-red-600/20 border border-red-600 text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* ベストパフォーマンスサマリー */}
          {comparison?.summary && (
            <div className="bg-slate-800 rounded-lg p-6 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                📊 ベストパフォーマンス
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">最高勝率</div>
                  <div className="text-2xl font-bold text-green-400">
                    {(comparison.summary.bestWinRate.value * 100).toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-400">
                    v{comparison.summary.bestWinRate.versionNumber}
                  </div>
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">最高PF</div>
                  <div className="text-2xl font-bold text-blue-400">
                    {comparison.summary.bestProfitFactor.value.toFixed(2)}
                  </div>
                  <div className="text-sm text-gray-400">
                    v{comparison.summary.bestProfitFactor.versionNumber}
                  </div>
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">最高期待値</div>
                  <div className="text-2xl font-bold text-purple-400">
                    {comparison.summary.bestExpectancy.value.toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-400">
                    v{comparison.summary.bestExpectancy.versionNumber}
                  </div>
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">最小DD</div>
                  <div className="text-2xl font-bold text-yellow-400">
                    {comparison.summary.lowestDrawdown.value !== Infinity
                      ? comparison.summary.lowestDrawdown.value.toLocaleString()
                      : '-'}
                  </div>
                  <div className="text-sm text-gray-400">
                    {comparison.summary.lowestDrawdown.value !== Infinity
                      ? `v${comparison.summary.lowestDrawdown.versionNumber}`
                      : '-'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* バージョン比較テーブル */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              バージョン別パフォーマンス
            </h2>

            {!comparison || comparison.versions.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                バージョンデータがありません
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="px-4 py-3 text-left text-gray-400">バージョン</th>
                      <th className="px-4 py-3 text-left text-gray-400">変更メモ</th>
                      <th className="px-4 py-3 text-right text-gray-400">期間</th>
                      <th className="px-4 py-3 text-right text-gray-400">トレード数</th>
                      <th className="px-4 py-3 text-right text-gray-400">勝率</th>
                      <th className="px-4 py-3 text-right text-gray-400">PF</th>
                      <th className="px-4 py-3 text-right text-gray-400">期待値</th>
                      <th className="px-4 py-3 text-right text-gray-400">最大DD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.versions.map((version) => {
                      const isBestWinRate = comparison.summary?.bestWinRate.versionNumber === version.versionNumber;
                      const isBestPF = comparison.summary?.bestProfitFactor.versionNumber === version.versionNumber;
                      const isBestExpectancy = comparison.summary?.bestExpectancy.versionNumber === version.versionNumber;
                      const isLowestDD = comparison.summary?.lowestDrawdown.versionNumber === version.versionNumber;

                      return (
                        <tr
                          key={version.versionId}
                          className="border-b border-slate-700/50 hover:bg-slate-700/30"
                        >
                          <td className="px-4 py-3">
                            <span className="font-medium text-white">
                              v{version.versionNumber}
                            </span>
                            <div className="text-xs text-gray-500">
                              {new Date(version.createdAt).toLocaleDateString('ja-JP')}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-300 max-w-[200px] truncate">
                            {version.changeNote || '-'}
                          </td>
                          {version.backtest ? (
                            <>
                              <td className="px-4 py-3 text-right text-gray-300 text-xs">
                                {version.backtest.startDate}
                                <br />
                                〜{version.backtest.endDate}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-300">
                                {version.backtest.metrics.setupCount}
                              </td>
                              <td className={`px-4 py-3 text-right font-medium ${
                                isBestWinRate ? 'text-green-400' : 'text-gray-200'
                              }`}>
                                {(version.backtest.metrics.winRate * 100).toFixed(1)}%
                                {isBestWinRate && <span className="ml-1 text-yellow-500">★</span>}
                              </td>
                              <td className={`px-4 py-3 text-right font-medium ${
                                isBestPF ? 'text-blue-400' : 'text-gray-200'
                              }`}>
                                {version.backtest.metrics.profitFactor?.toFixed(2) || '-'}
                                {isBestPF && <span className="ml-1 text-yellow-500">★</span>}
                              </td>
                              <td className={`px-4 py-3 text-right font-medium ${
                                isBestExpectancy ? 'text-purple-400' : 'text-gray-200'
                              }`}>
                                {version.backtest.metrics.expectancy.toLocaleString()}
                                {isBestExpectancy && <span className="ml-1 text-yellow-500">★</span>}
                              </td>
                              <td className={`px-4 py-3 text-right font-medium ${
                                isLowestDD ? 'text-yellow-400' : 'text-red-400'
                              }`}>
                                {version.backtest.metrics.maxDrawdown?.toLocaleString() || '-'}
                                {isLowestDD && version.backtest.metrics.maxDrawdown && (
                                  <span className="ml-1 text-yellow-500">★</span>
                                )}
                              </td>
                            </>
                          ) : (
                            <td colSpan={6} className="px-4 py-3 text-center text-gray-500">
                              バックテスト未実行
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 凡例 */}
          <div className="mt-4 text-sm text-gray-400 flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="text-yellow-500">★</span>
              ベストパフォーマンス
            </span>
            <span>
              PF = プロフィットファクター | DD = ドローダウン
            </span>
          </div>
    </div>
  );
}
