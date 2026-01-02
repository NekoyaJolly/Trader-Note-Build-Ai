"use client";

/**
 * ノート一覧画面（Neon Dark テーマ対応）
 * /notes
 *
 * Phase 2 要件:
 * - ステータスフィルタ（全件 / 下書き / 承認済み / 非承認）
 * - ステータス件数表示
 * - クリックで詳細遷移
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchNotes, fetchNoteStatusCounts } from "@/lib/api";
import type { NoteListItem, NoteStatus, NoteStatusCounts, NoteSummary } from "@/types/note";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import EmptyState from "@/components/EmptyState";

/**
 * ステータスフィルタの選択肢
 */
type StatusFilter = "all" | NoteStatus;

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [statusCounts, setStatusCounts] = useState<NoteStatusCounts | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  /**
   * ノート一覧とステータス集計を取得
   */
  async function loadData() {
    try {
      setIsLoading(true);
      setError(null);
      
      // ステータス集計は常に取得
      const countsPromise = fetchNoteStatusCounts().catch(() => null);
      
      // フィルタに応じてノートを取得
      const notesPromise = statusFilter === "all"
        ? fetchNotes()
        : fetchNotes(statusFilter);
      
      const [counts, data] = await Promise.all([countsPromise, notesPromise]);
      
      setStatusCounts(counts);
      setNotes(data.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ノート一覧の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * ステータスに応じたバッジスタイル
   */
  function getStatusBadge(status: NoteStatus) {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-600/30">
            承認済み
          </Badge>
        );
      case "archived":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-600/30">
            アーカイブ
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-yellow-600/30 text-yellow-400">
            下書き
          </Badge>
        );
    }
  }

  // ローディング表示（Skeleton）
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 bg-slate-700" />
        <Skeleton className="h-12 w-full bg-slate-700" />
        <Skeleton className="h-20 w-full bg-slate-700" />
        <Skeleton className="h-20 w-full bg-slate-700" />
        <Skeleton className="h-20 w-full bg-slate-700" />
      </div>
    );
  }

  // エラー表示
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>読み込みエラー</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-white">📊 トレードノート</h1>
        <Button asChild size="sm" className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90 w-fit">
          <Link href="/import">+ インポート</Link>
        </Button>
      </div>

      {/* ステータスフィルタタブ */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        <button
          onClick={() => setStatusFilter("all")}
          className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
            statusFilter === "all"
              ? "bg-gradient-to-r from-pink-500 to-violet-500 text-white"
              : "bg-slate-700/50 text-gray-400 hover:text-white hover:bg-slate-700"
          }`}
        >
          全件 {statusCounts && <span className="ml-1 opacity-75">({statusCounts.total})</span>}
        </button>
        <button
          onClick={() => setStatusFilter("draft")}
          className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
            statusFilter === "draft"
              ? "bg-yellow-600/30 text-yellow-400 border border-yellow-600/50"
              : "bg-slate-700/50 text-gray-400 hover:text-yellow-400 hover:bg-slate-700"
          }`}
        >
          下書き {statusCounts && <span className="ml-1 opacity-75">({statusCounts.draft})</span>}
        </button>
        <button
          onClick={() => setStatusFilter("active")}
          className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
            statusFilter === "active"
              ? "bg-green-600/30 text-green-400 border border-green-600/50"
              : "bg-slate-700/50 text-gray-400 hover:text-green-400 hover:bg-slate-700"
          }`}
        >
          承認済 {statusCounts && <span className="ml-1 opacity-75">({statusCounts.active})</span>}
        </button>
        <button
          onClick={() => setStatusFilter("archived")}
          className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
            statusFilter === "archived"
              ? "bg-red-600/30 text-red-400 border border-red-600/50"
              : "bg-slate-700/50 text-gray-400 hover:text-red-400 hover:bg-slate-700"
          }`}
        >
          アーカイブ {statusCounts && <span className="ml-1 opacity-75">({statusCounts.archived})</span>}
        </button>
      </div>

      {/* Empty 状態 */}
      {notes.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          title={statusFilter === "all" ? "ノートはまだありません" : `${statusFilter === "draft" ? "下書き" : statusFilter === "active" ? "承認済み" : "アーカイブ"}のノートはありません`}
          description={statusFilter === "all" 
            ? "トレードデータをインポートすると、ここにノートが表示されます。"
            : "フィルタを変更するか、ノートの状態を変更してください。"
          }
          actionLink={statusFilter === "all" ? { label: "CSVをインポート", href: "/import" } : undefined}
        />
      ) : (
        // 一覧表示（テーブル）
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-700/50 border-b border-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">通貨ペア</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">方向</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">エントリー時間</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">状態</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">操作</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr key={note.id} className="border-b border-slate-700 hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-bold text-white">{note.symbol}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={note.side === "buy" ? "secondary" : "destructive"}>
                        {note.side === "buy" ? "買い" : "売り"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {new Date(note.timestamp).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {getStatusBadge(note.status ?? "draft")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button size="sm" asChild className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90">
                        <Link href={`/notes/${note.id}`}>詳細</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
