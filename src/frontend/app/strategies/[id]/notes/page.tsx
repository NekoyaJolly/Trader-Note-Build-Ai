'use client';

/**
 * ストラテジーノート一覧ページ
 * 
 * 目的:
 * - バックテストで検出された勝ちパターンノートの一覧表示
 * - ステータス/アウトカムによるフィルタリング
 * - ノート詳細へのナビゲーション
 * 
 * Phase C: 勝ちパターンノート機能
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  fetchStrategyNotes,
  fetchStrategyNoteStats,
  StrategyNoteSummary,
  StrategyNoteStats,
  StrategyNoteStatus,
  BacktestOutcome,
  ListStrategyNotesParams,
} from '@/lib/api';

/**
 * ステータスのラベルと色
 */
const STATUS_CONFIG: Record<StrategyNoteStatus, { label: string; color: string }> = {
  draft: { label: '下書き', color: 'bg-gray-100 text-gray-800' },
  active: { label: 'アクティブ', color: 'bg-green-100 text-green-800' },
  archived: { label: 'アーカイブ', color: 'bg-yellow-100 text-yellow-800' },
};

/**
 * アウトカムのラベルと色
 */
const OUTCOME_CONFIG: Record<BacktestOutcome, { label: string; color: string }> = {
  win: { label: '勝ち', color: 'bg-blue-100 text-blue-800' },
  loss: { label: '負け', color: 'bg-red-100 text-red-800' },
  timeout: { label: 'タイムアウト', color: 'bg-orange-100 text-orange-800' },
};

export default function StrategyNotesPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = params.id as string;

  // 状態管理
  const [notes, setNotes] = useState<StrategyNoteSummary[]>([]);
  const [stats, setStats] = useState<StrategyNoteStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // フィルタ状態
  const [statusFilter, setStatusFilter] = useState<StrategyNoteStatus | 'all'>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<BacktestOutcome | 'all'>('all');

  /**
   * ノート一覧と統計を取得
   */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const listParams: ListStrategyNotesParams = {};
      if (statusFilter !== 'all') listParams.status = statusFilter;
      if (outcomeFilter !== 'all') listParams.outcome = outcomeFilter;

      const [notesData, statsData] = await Promise.all([
        fetchStrategyNotes(strategyId, listParams),
        fetchStrategyNoteStats(strategyId),
      ]);

      setNotes(notesData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [strategyId, statusFilter, outcomeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * 日付フォーマット
   */
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /**
   * 価格フォーマット
   */
  const formatPrice = (price: number) => {
    return price.toLocaleString('ja-JP', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 5,
    });
  };

  /**
   * PnL フォーマット
   */
  const formatPnL = (pnl: number | null) => {
    if (pnl === null) return '-';
    const formatted = pnl.toLocaleString('ja-JP', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return pnl >= 0 ? `+${formatted}` : formatted;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={`/strategies/${strategyId}`}
                className="text-gray-500 hover:text-gray-700"
              >
                ← 戻る
              </Link>
              <h1 className="text-xl font-semibold text-gray-900">
                ストラテジーノート
              </h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 統計カード */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">合計</div>
              <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">アクティブ</div>
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">勝ち</div>
              <div className="text-2xl font-bold text-blue-600">{stats.byOutcome.win}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">勝率</div>
              <div className="text-2xl font-bold text-gray-900">
                {stats.total > 0
                  ? `${((stats.byOutcome.win / stats.total) * 100).toFixed(1)}%`
                  : '-'}
              </div>
            </div>
          </div>
        )}

        {/* フィルタ */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ステータス
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StrategyNoteStatus | 'all')}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">すべて</option>
                <option value="draft">下書き</option>
                <option value="active">アクティブ</option>
                <option value="archived">アーカイブ</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                アウトカム
              </label>
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value as BacktestOutcome | 'all')}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">すべて</option>
                <option value="win">勝ち</option>
                <option value="loss">負け</option>
                <option value="timeout">タイムアウト</option>
              </select>
            </div>
          </div>
        </div>

        {/* ローディング */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-500">読み込み中...</p>
          </div>
        )}

        {/* エラー */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchData}
              className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
            >
              再試行
            </button>
          </div>
        )}

        {/* ノート一覧 */}
        {!loading && !error && (
          <>
            {notes.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <p className="text-gray-500 mb-4">
                  ノートがありません
                </p>
                <p className="text-sm text-gray-400">
                  バックテストを実行して勝ちパターンをノートに保存しましょう
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        エントリー時刻
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        価格
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        結果
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        損益
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        ステータス
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        タグ
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {notes.map((note) => (
                      <tr
                        key={note.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => router.push(`/strategies/${strategyId}/notes/${note.id}`)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(note.entryTime)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                          {formatPrice(note.entryPrice)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              OUTCOME_CONFIG[note.outcome].color
                            }`}
                          >
                            {OUTCOME_CONFIG[note.outcome].label}
                          </span>
                        </td>
                        <td
                          className={`px-6 py-4 whitespace-nowrap text-sm font-mono ${
                            note.pnl !== null
                              ? note.pnl >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                              : 'text-gray-400'
                          }`}
                        >
                          {formatPnL(note.pnl)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              STATUS_CONFIG[note.status].color
                            }`}
                          >
                            {STATUS_CONFIG[note.status].label}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-wrap gap-1">
                            {note.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                            {note.tags.length > 3 && (
                              <span className="text-xs text-gray-400">
                                +{note.tags.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/strategies/${strategyId}/notes/${note.id}`);
                            }}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            詳細
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
