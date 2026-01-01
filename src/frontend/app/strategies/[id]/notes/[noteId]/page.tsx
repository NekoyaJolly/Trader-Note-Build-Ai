'use client';

/**
 * ストラテジーノート詳細ページ
 * 
 * 目的:
 * - ノートの詳細情報表示
 * - インジケーター値の可視化
 * - 類似ノート検索
 * - ステータス変更・編集
 * 
 * Phase C: 勝ちパターンノート機能
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  fetchStrategyNoteDetail,
  updateStrategyNoteStatus,
  deleteStrategyNote,
  searchSimilarNotes,
  StrategyNoteDetail,
  StrategyNoteStatus,
  SimilarNoteResult,
} from '@/lib/api';

/**
 * ステータスのラベルと色
 */
const STATUS_CONFIG: Record<StrategyNoteStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: '下書き', color: 'text-gray-800', bgColor: 'bg-gray-100' },
  active: { label: 'アクティブ', color: 'text-green-800', bgColor: 'bg-green-100' },
  archived: { label: 'アーカイブ', color: 'text-yellow-800', bgColor: 'bg-yellow-100' },
};

/**
 * アウトカムのラベルと色
 */
const OUTCOME_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  win: { label: '勝ち', color: 'text-blue-800', bgColor: 'bg-blue-100' },
  loss: { label: '負け', color: 'text-red-800', bgColor: 'bg-red-100' },
  timeout: { label: 'タイムアウト', color: 'text-orange-800', bgColor: 'bg-orange-100' },
};

export default function StrategyNoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = params.id as string;
  const noteId = params.noteId as string;

  // 状態管理
  const [note, setNote] = useState<StrategyNoteDetail | null>(null);
  const [similarNotes, setSimilarNotes] = useState<SimilarNoteResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  /**
   * ノート詳細を取得
   */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchStrategyNoteDetail(strategyId, noteId);
      setNote(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [strategyId, noteId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * 類似ノートを検索
   */
  const handleSearchSimilar = async () => {
    if (!note) return;

    setSimilarLoading(true);
    try {
      const results = await searchSimilarNotes(strategyId, noteId, 0.5, 10);
      setSimilarNotes(results);
    } catch (err) {
      console.error('類似検索エラー:', err);
    } finally {
      setSimilarLoading(false);
    }
  };

  /**
   * ステータス変更
   */
  const handleStatusChange = async (newStatus: StrategyNoteStatus) => {
    if (!note) return;

    try {
      const updated = await updateStrategyNoteStatus(strategyId, noteId, newStatus);
      setNote(updated);
    } catch (err) {
      console.error('ステータス更新エラー:', err);
      alert('ステータスの更新に失敗しました');
    }
  };

  /**
   * ノート削除
   */
  const handleDelete = async () => {
    try {
      await deleteStrategyNote(strategyId, noteId);
      router.push(`/strategies/${strategyId}/notes`);
    } catch (err) {
      console.error('削除エラー:', err);
      alert('削除に失敗しました');
    }
  };

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
      second: '2-digit',
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'ノートが見つかりません'}</p>
          <Link
            href={`/strategies/${strategyId}/notes`}
            className="text-blue-600 hover:text-blue-800"
          >
            ← ノート一覧に戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={`/strategies/${strategyId}/notes`}
                className="text-gray-500 hover:text-gray-700"
              >
                ← ノート一覧
              </Link>
              <h1 className="text-xl font-semibold text-gray-900">
                ノート詳細
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {/* ステータス変更ボタン */}
              {note.status === 'draft' && (
                <button
                  onClick={() => handleStatusChange('active')}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                >
                  アクティブにする
                </button>
              )}
              {note.status === 'active' && (
                <button
                  onClick={() => handleStatusChange('archived')}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 text-sm"
                >
                  アーカイブ
                </button>
              )}
              {note.status === 'archived' && (
                <button
                  onClick={() => handleStatusChange('active')}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                >
                  再アクティブ化
                </button>
              )}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左側: 基本情報 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 基本情報カード */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">基本情報</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-500">ストラテジー</div>
                  <div className="font-medium text-gray-900">{note.strategyName}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">ステータス</div>
                  <span
                    className={`inline-flex px-2 py-1 text-sm font-semibold rounded-full ${
                      STATUS_CONFIG[note.status].bgColor
                    } ${STATUS_CONFIG[note.status].color}`}
                  >
                    {STATUS_CONFIG[note.status].label}
                  </span>
                </div>
                <div>
                  <div className="text-sm text-gray-500">エントリー時刻</div>
                  <div className="font-mono text-gray-900">{formatDate(note.entryTime)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">エントリー価格</div>
                  <div className="font-mono text-gray-900">{formatPrice(note.entryPrice)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">結果</div>
                  <span
                    className={`inline-flex px-2 py-1 text-sm font-semibold rounded-full ${
                      OUTCOME_CONFIG[note.outcome].bgColor
                    } ${OUTCOME_CONFIG[note.outcome].color}`}
                  >
                    {OUTCOME_CONFIG[note.outcome].label}
                  </span>
                </div>
                <div>
                  <div className="text-sm text-gray-500">損益</div>
                  <div
                    className={`font-mono ${
                      note.pnl !== null
                        ? note.pnl >= 0
                          ? 'text-green-600'
                          : 'text-red-600'
                        : 'text-gray-400'
                    }`}
                  >
                    {note.pnl !== null
                      ? `${note.pnl >= 0 ? '+' : ''}${note.pnl.toFixed(2)}`
                      : '-'}
                  </div>
                </div>
              </div>

              {/* タグ */}
              <div className="mt-4">
                <div className="text-sm text-gray-500 mb-2">タグ</div>
                <div className="flex flex-wrap gap-2">
                  {note.tags.length > 0 ? (
                    note.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-gray-400 text-sm">タグなし</span>
                  )}
                </div>
              </div>

              {/* メモ */}
              {note.notes && (
                <div className="mt-4">
                  <div className="text-sm text-gray-500 mb-2">メモ</div>
                  <div className="text-gray-900 bg-gray-50 rounded-md p-3">
                    {note.notes}
                  </div>
                </div>
              )}
            </div>

            {/* インジケーター値カード */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">インジケーター値</h2>
              <div className="space-y-4">
                {/* RSI */}
                {note.indicatorValues.rsi && (
                  <div className="border rounded-lg p-4">
                    <div className="font-medium text-gray-900 mb-2">RSI</div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">値: </span>
                        <span className="font-mono">{note.indicatorValues.rsi.value.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">方向: </span>
                        <span>{note.indicatorValues.rsi.direction}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">ゾーン: </span>
                        <span>{note.indicatorValues.rsi.zone}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* MACD */}
                {note.indicatorValues.macd && (
                  <div className="border rounded-lg p-4">
                    <div className="font-medium text-gray-900 mb-2">MACD</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">ヒストグラム符号: </span>
                        <span>{note.indicatorValues.macd.histogramSign}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">傾き: </span>
                        <span>{note.indicatorValues.macd.histogramSlope}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">0ライン: </span>
                        <span>{note.indicatorValues.macd.zeroLinePosition}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">MACD傾き: </span>
                        <span>{note.indicatorValues.macd.macdSlope}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* BB */}
                {note.indicatorValues.bb && (
                  <div className="border rounded-lg p-4">
                    <div className="font-medium text-gray-900 mb-2">ボリンジャーバンド</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">%B: </span>
                        <span className="font-mono">{note.indicatorValues.bb.percentB.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">バンド幅傾向: </span>
                        <span>{note.indicatorValues.bb.bandWidthTrend}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">ゾーン: </span>
                        <span>{note.indicatorValues.bb.zone}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* SMA */}
                {note.indicatorValues.sma && (
                  <div className="border rounded-lg p-4">
                    <div className="font-medium text-gray-900 mb-2">SMA</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">乖離率: </span>
                        <span className="font-mono">{note.indicatorValues.sma.deviationRate.toFixed(2)}%</span>
                      </div>
                      <div>
                        <span className="text-gray-500">傾き: </span>
                        <span>{note.indicatorValues.sma.slopeDirection}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">トレンド強度: </span>
                        <span className="font-mono">{note.indicatorValues.sma.trendStrength.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">価格位置: </span>
                        <span>{note.indicatorValues.sma.pricePosition}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* EMA */}
                {note.indicatorValues.ema && (
                  <div className="border rounded-lg p-4">
                    <div className="font-medium text-gray-900 mb-2">EMA</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">乖離率: </span>
                        <span className="font-mono">{note.indicatorValues.ema.deviationRate.toFixed(2)}%</span>
                      </div>
                      <div>
                        <span className="text-gray-500">傾き: </span>
                        <span>{note.indicatorValues.ema.slopeDirection}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">EMA vs SMA: </span>
                        <span>{note.indicatorValues.ema.emaVsSmaPosition}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右側: 類似ノート */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">類似ノート</h2>
                <button
                  onClick={handleSearchSimilar}
                  disabled={similarLoading}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {similarLoading ? '検索中...' : '検索'}
                </button>
              </div>

              {similarNotes.length === 0 ? (
                <p className="text-gray-500 text-sm">
                  「検索」ボタンをクリックして類似ノートを検索してください
                </p>
              ) : (
                <div className="space-y-3">
                  {similarNotes.map((similar) => (
                    <Link
                      key={similar.noteId}
                      href={`/strategies/${similar.strategyId}/notes/${similar.noteId}`}
                      className="block border rounded-lg p-3 hover:bg-gray-50"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            OUTCOME_CONFIG[similar.outcome]?.bgColor ?? 'bg-gray-100'
                          } ${OUTCOME_CONFIG[similar.outcome]?.color ?? 'text-gray-600'}`}
                        >
                          {OUTCOME_CONFIG[similar.outcome]?.label ?? similar.outcome}
                        </span>
                        <span className="text-sm font-mono text-blue-600">
                          {(similar.similarity * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {similar.strategyName}
                      </div>
                      <div className="text-xs text-gray-400">
                        {new Date(similar.entryTime).toLocaleDateString('ja-JP')}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* 特徴量ベクトル（デバッグ用） */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">特徴量ベクトル</h2>
              <div className="font-mono text-xs text-gray-600 break-all">
                [{note.featureVector.map((v) => v.toFixed(3)).join(', ')}]
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 削除確認ダイアログ */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              ノートを削除しますか？
            </h3>
            <p className="text-gray-600 mb-6">
              この操作は取り消せません。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
