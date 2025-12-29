"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { NoteDetail } from "@/types/note";
import { fetchNoteDetail, approveNote } from "@/lib/api";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/**
 * ノート詳細画面
 * /notes/:id
 *
 * 要件:
 * - エントリー/エグジット情報
 * - 使用インジケーター一覧
 * - AI 推定内容（Draft 明示）
 * - ユーザー承認 UI（ボタンのみ、Phase1ではローカル）
 */
export default function NoteDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadNote();
  }, [id]);

  /**
   * ノート詳細を API から取得
   * APIから取得した承認状態を反映する
   */
  async function loadNote() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNoteDetail(id);
      setNote(data);
      // APIから取得した承認状態を反映
      setApproved(data.status === "approved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ノート詳細の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }

  // ローディング表示
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

  // エラー表示（404 等）
  if (error || !note) {
    return (
      <Alert variant="destructive">
        <AlertTitle>読み込みエラー</AlertTitle>
        <AlertDescription>
          {error || "ノートが見つかりませんでした（Phase1: 未生成）"}
          <div className="mt-3">
            <Link href="/notes" className="underline">一覧に戻る</Link>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">ノート詳細</h1>
        <Link
          href="/notes"
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-slate-700/50 hover:text-white transition-all duration-300"
        >
          ← 一覧に戻る
        </Link>
      </div>

      <Card>
        <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-400">通貨ペア</div>
            <div className="text-lg font-bold text-white">{note.symbol}</div>

            <div className="text-sm font-semibold text-gray-400">方向</div>
            <Badge variant={note.side === "buy" ? "secondary" : "destructive"}>{note.side}</Badge>

            <div className="text-sm font-semibold text-gray-400">エントリー時間</div>
            <div className="text-base font-medium text-gray-200">{new Date(note.timestamp).toLocaleString("ja-JP")}</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-400">数量</div>
            <div className="text-base font-medium text-gray-200">{note.quantity}</div>

            <div className="text-sm font-semibold text-gray-400">エントリー価格</div>
            <div className="text-base font-medium text-gray-200">{note.entryPrice}</div>

            {typeof note.exitPrice === "number" ? (
              <>
                <div className="text-sm font-semibold text-gray-400">エグジット価格</div>
                <div className="text-base font-medium text-gray-200">{note.exitPrice}</div>
              </>
            ) : null}
          </div>
        </div>
        </CardContent>
      </Card>

      {/* 市場コンテキスト */}
      <Card>
        <CardHeader>
          <CardTitle>市場コンテキスト</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-sm font-semibold text-gray-400">時間足</div>
            <div className="text-base font-medium text-gray-200">{note.marketContext.timeframe}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-400">トレンド</div>
            <div className="text-base font-medium text-gray-200">{note.marketContext.trend}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-400">インジケーター</div>
            <div className="text-base font-medium text-gray-200">
              RSI: {note.marketContext.indicators?.rsi ?? "-"}, MACD: {note.marketContext.indicators?.macd ?? "-"}, VOL: {note.marketContext.indicators?.volume ?? "-"}
            </div>
          </div>
        </div>
        </CardContent>
      </Card>

      {/* AI 推定内容（Draft 明示） */}
      <Card>
        <CardHeader>
          <CardTitle>AI 要約（Draft）</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-base text-gray-200 leading-relaxed whitespace-pre-wrap font-medium">{note.aiSummary}</p>
          <div className="mt-3 text-sm text-gray-400">※ 過去データから推定して作成されています。内容を確認して承認してください。</div>
        </CardContent>
      </Card>

      {/* ユーザー承認 UI */}
      <Card>
        <CardHeader>
          <CardTitle>承認</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="flex items-center gap-3">
          <Button
            onClick={async () => {
              try {
                await approveNote(id);
                setApproved(true);
                // 承認成功後、少し待ってから一覧ページへ遷移
                setTimeout(() => {
                  window.location.href = '/notes';
                }, 500);
              } catch (e) {
                alert("承認に失敗しました。時間をおいて再試行してください。");
              }
            }}
            variant={approved ? "secondary" : "default"}
            disabled={approved}
          >
            {approved ? "承認済み" : "承認する"}
          </Button>
          <span className="text-sm text-gray-400">
            ※ 承認するとノート一覧に戻ります。
          </span>
        </div>
        </CardContent>
      </Card>
    </div>
  );
}
