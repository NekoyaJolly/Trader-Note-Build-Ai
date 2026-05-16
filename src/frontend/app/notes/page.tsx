"use client";

/**
 * ノート一覧画面（Neon Dark テーマ対応）
 * /notes
 *
 * Phase 2 要件:
 * - ステータスフィルタ（全件 / 下書き / 承認済み / 非承認）
 * - クリックで詳細遷移
 *
 * 注: 当初要件にあった「ステータス件数表示」は UI から既に外されていたため、
 * 件数取得 API 呼び出し (fetchNoteStatusCounts) も合わせて削除した (PR #215 lint 整理)。
 * 件数バッジを復活させたい場合は両方を戻すこと。
 *
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import { useCallback, useEffect, useState } from "react";
import { fetchNotes } from "@/lib/api";
import type { NoteStatus, NoteSummary } from "@/types/note";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { NeonButton } from "@/components/ui/NeonButton";
import { Badge } from "@/components/ui/Badge";
import EmptyState from "@/components/EmptyState";

/**
 * ステータスフィルタの選択肢
 */
type StatusFilter = "all" | NoteStatus;

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const data = statusFilter === "all"
        ? await fetchNotes()
        : await fetchNotes(statusFilter);

      setNotes(data.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ノート一覧の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
      {/* ヘッダー + フィルタタブ（1行） */}
      <div className="flex items-center justify-between gap-2 pb-1">
        <h1 className="text-base sm:text-lg font-bold text-white whitespace-nowrap flex items-center gap-1.5">
          <span>📊</span>
          <span>トレードノート</span>
        </h1>
        <div className="flex gap-2">
          <NeonButton
            onClick={() => setStatusFilter("all")}
            color="blue"
            size="sm"
            variant={statusFilter === "all" ? "outline" : "ghost"}
            className="w-16 sm:w-[72px] justify-center text-xs"
          >
            All
          </NeonButton>
          <NeonButton
            onClick={() => setStatusFilter("draft")}
            color="orange"
            size="sm"
            variant={statusFilter === "draft" ? "outline" : "ghost"}
            className="w-16 sm:w-[72px] justify-center text-xs"
          >
            Draft
          </NeonButton>
          <NeonButton
            onClick={() => setStatusFilter("active")}
            color="green"
            size="sm"
            variant={statusFilter === "active" ? "outline" : "ghost"}
            className="w-16 sm:w-[72px] justify-center text-xs"
          >
            Active
          </NeonButton>
          <NeonButton
            onClick={() => setStatusFilter("archived")}
            color="slate"
            size="sm"
            variant={statusFilter === "archived" ? "outline" : "ghost"}
            className="w-16 sm:w-[72px] justify-center text-xs"
          >
            Archive
          </NeonButton>
        </div>
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
          actionLink={{ label: "CSVをインポート", href: "/import" }}
        />
      ) : (
        // 一覧表示（テーブル）
        <div className="glass-surface overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-800/80 border-b border-slate-600">
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
                  <tr key={note.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
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
                      <NeonButton href={`/notes/${note.id}`} color="blue" size="sm">
                        詳細
                      </NeonButton>
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
