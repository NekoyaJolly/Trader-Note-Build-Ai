"use client";

/**
 * バックテストページ
 * 
 * 目的: 承認済みノートを選択してバックテストを実行
 * 
 * 機能:
 * - ノート一覧から選択
 * - バックテストパラメータ設定
 * - 結果の可視化
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import BacktestPanel from "@/components/BacktestPanel";
import { fetchNotes, type NoteSummary } from "@/lib/api";

/**
 * バックテストページコンポーネント
 */
export default function BacktestPage() {
  // ノート一覧の状態
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 選択されたノート
  const [selectedNote, setSelectedNote] = useState<NoteSummary | null>(null);
  
  // フィルター状態（承認済みノートのみ表示するかどうか）
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  /**
   * ノート一覧を取得
   */
  const loadNotes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 全ノートを取得（statusでフィルターする場合はAPIパラメータを追加）
      const response = await fetchNotes({ 
        limit: 100,
        // 承認済みのみの場合
        ...(showActiveOnly && { status: 'active' }),
      });
      setNotes(response.notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ノートの取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }, [showActiveOnly]);

  // 初回ロード
  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  /**
   * ノート選択ハンドラ
   */
  const handleSelectNote = (note: NoteSummary) => {
    setSelectedNote(note);
  };

  /**
   * ノート選択解除
   */
  const handleClearSelection = () => {
    setSelectedNote(null);
  };

  /**
   * サイドの色を取得
   */
  const getSideColor = (side: string) => {
    return side.toLowerCase() === 'buy' 
      ? 'text-green-400' 
      : 'text-red-400';
  };

  /**
   * ステータスバッジのスタイルを取得
   */
  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-600/20 text-green-400 border-green-500/30';
      case 'draft':
        return 'bg-yellow-600/20 text-yellow-400 border-yellow-500/30';
      case 'archived':
        return 'bg-red-600/20 text-red-400 border-red-500/30';
      default:
        return 'bg-slate-600/20 text-gray-400 border-slate-500/30';
    }
  };

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold neon-text">バックテスト</h1>
          <p className="text-sm text-gray-400 mt-1">
            ノートの優位性を過去データで検証
          </p>
        </div>
        {selectedNote && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearSelection}
          >
            ← ノート選択に戻る
          </Button>
        )}
      </div>

      {/* 選択されたノートがある場合: バックテストパネルを表示 */}
      {selectedNote ? (
        <div className="space-y-4">
          {/* 選択中ノート情報 */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Badge className={getStatusBadgeStyle(selectedNote.status)}>
                    {selectedNote.status === 'active' ? '承認済' : 
                     selectedNote.status === 'draft' ? '下書き' : 'アーカイブ'}
                  </Badge>
                  <span className="font-medium text-white">{selectedNote.symbol}</span>
                  <span className={`text-sm ${getSideColor(selectedNote.side)}`}>
                    {selectedNote.side.toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-400">
                    @ {selectedNote.entryPrice.toLocaleString()}
                  </span>
                </div>
                <Link
                  href={`/notes/${selectedNote.id}`}
                  className="text-xs text-cyan-400 hover:text-cyan-300"
                >
                  ノート詳細 →
                </Link>
              </div>
              {selectedNote.aiSummary && (
                <p className="mt-2 text-sm text-gray-400 line-clamp-2">
                  {selectedNote.aiSummary}
                </p>
              )}
            </CardContent>
          </Card>

          {/* バックテストパネル */}
          <BacktestPanel 
            noteId={selectedNote.id} 
            symbol={selectedNote.symbol} 
          />
        </div>
      ) : (
        /* ノート選択UI */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>テスト対象ノートを選択</CardTitle>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showActiveOnly}
                    onChange={(e) => setShowActiveOnly(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                  />
                  承認済みのみ
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadNotes}
                  disabled={isLoading}
                >
                  更新
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* ローディング */}
            {isLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            )}

            {/* エラー */}
            {error && (
              <div className="p-4 rounded-lg bg-red-900/30 border border-red-700 text-red-400">
                {error}
              </div>
            )}

            {/* ノート一覧 */}
            {!isLoading && !error && (
              <>
                {notes.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-400 mb-4">
                      {showActiveOnly 
                        ? "承認済みノートがありません" 
                        : "ノートがありません"}
                    </p>
                    <Link href="/import">
                      <Button variant="outline">
                        CSVインポートへ
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notes.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => handleSelectNote(note)}
                        className="w-full text-left p-4 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 hover:border-cyan-500/50 transition-all duration-200"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Badge className={getStatusBadgeStyle(note.status)}>
                              {note.status === 'active' ? '承認' : 
                               note.status === 'draft' ? '下書' : 'アーカイブ'}
                            </Badge>
                            <span className="font-medium text-white">{note.symbol}</span>
                            <span className={`text-sm ${getSideColor(note.side)}`}>
                              {note.side.toUpperCase()}
                            </span>
                            <span className="text-sm text-gray-400">
                              @ {note.entryPrice.toLocaleString()}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(note.createdAt).toLocaleDateString('ja-JP')}
                          </span>
                        </div>
                        {note.aiSummary && (
                          <p className="mt-2 text-sm text-gray-400 line-clamp-1">
                            {note.aiSummary}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 使い方ガイド */}
      {!selectedNote && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">💡 バックテストの使い方</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-400 space-y-2">
            <p>
              <strong className="text-white">1. ノートを選択:</strong>{" "}
              承認済みのトレードノートを選択します。
            </p>
            <p>
              <strong className="text-white">2. パラメータ設定:</strong>{" "}
              期間、時間足、利確/損切り幅などを設定します。
            </p>
            <p>
              <strong className="text-white">3. 実行:</strong>{" "}
              過去データに対してノートの条件がどれだけ一致したかを検証します。
            </p>
            <p className="text-xs text-gray-500 mt-4">
              ※ バックテストは過去データに基づくシミュレーションであり、将来の結果を保証するものではありません。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
