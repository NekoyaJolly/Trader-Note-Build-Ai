"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchNotes } from "@/lib/api";
import type { NoteListItem } from "@/types/note";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/**
 * ノート一覧画面
 * /notes
 *
 * 要件:
 * - ペア / エントリー時間 / 判断モード（AI推定） / 状態
 * - Loading / Empty / Error 状態
 * - クリックで詳細遷移
 */
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
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
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
        <h1 className="text-3xl font-bold text-gray-800">トレードノート</h1>
      </div>

      {/* Empty 状態 */}
      {notes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <span className="text-2xl">📄</span>
              ノートはまだありません
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base text-gray-700 leading-relaxed">トレードデータをインポートすると、ここにノートが表示されます。</p>
          </CardContent>
        </Card>
      ) : (
        // 一覧表示（テーブル）
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-bold text-gray-900">通貨ペア</th>
                  <th className="px-4 py-3 text-left text-sm font-bold text-gray-900">エントリー時間</th>
                  <th className="px-4 py-3 text-left text-sm font-bold text-gray-900">AI 推定</th>
                  <th className="px-4 py-3 text-left text-sm font-bold text-gray-900">状態</th>
                  <th className="px-4 py-3 text-center text-sm font-bold text-gray-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr key={note.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-bold text-gray-900">{note.symbol}</td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      {new Date(note.timestamp).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      {note.modeEstimated ?? "未推定"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={note.status === "approved" ? "secondary" : "outline"}>
                        {note.status ?? "draft"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button size="sm" asChild>
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
