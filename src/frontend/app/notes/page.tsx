"use client";

/**
 * ノート一覧画面（Neon Dark テーマ対応）
 * /notes
 *
 * 要件:
 * - ペア / エントリー時間 / 状態
 * - Loading / Empty / Error 状態
 * - クリックで詳細遷移
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchNotes } from "@/lib/api";
import type { NoteListItem } from "@/types/note";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import EmptyState from "@/components/EmptyState";

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNotes();
  }, []);

  /**
   * ノート一覧を API から取得
   */
  async function loadNotes() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNotes();
      setNotes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ノート一覧の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }

  // ローディング表示（Skeleton）
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 bg-slate-700" />
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
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">📊 トレードノート</h1>
        <Button asChild size="sm" className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90">
          <Link href="/import">+ インポート</Link>
        </Button>
      </div>

      {/* Empty 状態 */}
      {notes.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          title="ノートはまだありません"
          description="トレードデータをインポートすると、ここにノートが表示されます。"
          actionLink={{ label: "CSVをインポート", href: "/import" }}
        />
      ) : (
        // 一覧表示（テーブル）
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-700/50 border-b border-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">通貨ペア</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">エントリー時間</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">状態</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">操作</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr key={note.id} className="border-b border-slate-700 hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-bold text-white">{note.symbol}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {new Date(note.timestamp).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Badge 
                        variant={note.status === "approved" ? "secondary" : "outline"}
                        className={note.status === "approved" 
                          ? "bg-green-500/20 text-green-400" 
                          : "border-gray-600 text-gray-400"
                        }
                      >
                        {note.status ?? "draft"}
                      </Badge>
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
