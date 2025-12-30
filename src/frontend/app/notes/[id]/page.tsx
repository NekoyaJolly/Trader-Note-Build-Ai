"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { NoteDetail, NoteStatus } from "@/types/note";
import { fetchNoteDetail, approveNote, rejectNote, revertNoteToDraft, updateNote } from "@/lib/api";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/**
 * ノート詳細画面
 * /notes/:id
 *
 * Phase 2 要件:
 * - 承認 / 非承認 / 編集 の UI
 * - ステータスに応じた表示切り替え
 * - 「後戻りできる」設計（draft へ戻せる）
 */
export default function NoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  
  // 編集モード
  const [isEditing, setIsEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState("");
  const [editedUserNotes, setEditedUserNotes] = useState("");
  const [editedTags, setEditedTags] = useState("");

  useEffect(() => {
    if (!id) return;
    loadNote();
  }, [id]);

  /**
   * ノート詳細を API から取得
   */
  async function loadNote() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNoteDetail(id);
      setNote(data);
      // 編集用の初期値をセット
      setEditedSummary(data.aiSummary);
      setEditedUserNotes(data.userNotes ?? "");
      setEditedTags(data.tags?.join(", ") ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ノート詳細の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * ステータスに応じたバッジのスタイルを返す
   */
  function getStatusBadge(status: NoteStatus) {
    switch (status) {
      case "approved":
        return <Badge variant="secondary" className="bg-green-600/20 text-green-400 border-green-600/30">承認済み</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="bg-red-600/20 text-red-400 border-red-600/30">非承認</Badge>;
      default:
        return <Badge variant="outline" className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30">下書き</Badge>;
    }
  }

  /**
   * 承認アクション
   */
  async function handleApprove() {
    if (!note || actionLoading) return;
    try {
      setActionLoading(true);
      await approveNote(id);
      await loadNote(); // 最新状態を再取得
    } catch (e) {
      alert("承認に失敗しました。時間をおいて再試行してください。");
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 非承認アクション
   */
  async function handleReject() {
    if (!note || actionLoading) return;
    if (!confirm("このノートを非承認にしますか？\n非承認のノートはマッチング対象外になります。")) {
      return;
    }
    try {
      setActionLoading(true);
      await rejectNote(id);
      await loadNote();
    } catch (e) {
      alert("非承認に失敗しました。時間をおいて再試行してください。");
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 下書きに戻すアクション
   */
  async function handleRevertToDraft() {
    if (!note || actionLoading) return;
    try {
      setActionLoading(true);
      await revertNoteToDraft(id);
      await loadNote();
    } catch (e) {
      alert("状態変更に失敗しました。時間をおいて再試行してください。");
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 編集保存アクション
   */
  async function handleSaveEdit() {
    if (!note || actionLoading) return;
    try {
      setActionLoading(true);
      const tags = editedTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      await updateNote(id, {
        aiSummary: editedSummary,
        userNotes: editedUserNotes,
        tags,
      });
      setIsEditing(false);
      await loadNote();
    } catch (e) {
      alert("保存に失敗しました。時間をおいて再試行してください。");
    } finally {
      setActionLoading(false);
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
          {error || "ノートが見つかりませんでした"}
          <div className="mt-3">
            <Link href="/notes" className="underline">一覧に戻る</Link>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const currentStatus = note.status ?? "draft";

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-white">ノート詳細</h1>
          {getStatusBadge(currentStatus)}
        </div>
        <Link
          href="/notes"
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-slate-700/50 hover:text-white transition-all duration-300"
        >
          ← 一覧に戻る
        </Link>
      </div>

      {/* 基本情報カード */}
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

      {/* AI 要約 & ユーザーメモ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              AI 要約
              {currentStatus === "draft" && <span className="text-yellow-400 text-sm ml-2">（下書き）</span>}
            </CardTitle>
            {!isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                編集
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-400 mb-2">AI 要約</label>
                <textarea
                  className="w-full p-3 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  rows={5}
                  value={editedSummary}
                  onChange={(e) => setEditedSummary(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-400 mb-2">ユーザーメモ</label>
                <textarea
                  className="w-full p-3 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  rows={3}
                  value={editedUserNotes}
                  onChange={(e) => setEditedUserNotes(e.target.value)}
                  placeholder="自分用のメモを追加..."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-400 mb-2">タグ（カンマ区切り）</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  value={editedTags}
                  onChange={(e) => setEditedTags(e.target.value)}
                  placeholder="例: レンジ相場, RSI反転"
                />
              </div>
              <div className="flex gap-3">
                <Button onClick={handleSaveEdit} disabled={actionLoading}>
                  {actionLoading ? "保存中..." : "保存"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setEditedSummary(note.aiSummary);
                    setEditedUserNotes(note.userNotes ?? "");
                    setEditedTags(note.tags?.join(", ") ?? "");
                  }}
                >
                  キャンセル
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-base text-gray-200 leading-relaxed whitespace-pre-wrap font-medium">{note.aiSummary}</p>
              {note.userNotes && (
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <div className="text-sm font-semibold text-gray-400 mb-2">ユーザーメモ</div>
                  <p className="text-base text-gray-300 whitespace-pre-wrap">{note.userNotes}</p>
                </div>
              )}
              {note.tags && note.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {note.tags.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              )}
              <div className="mt-3 text-sm text-gray-400">※ 過去データから推定して作成されています。内容を確認して承認してください。</div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 承認アクション */}
      <Card>
        <CardHeader>
          <CardTitle>承認アクション</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* 現在のステータスに応じた説明 */}
            <div className="text-sm text-gray-400">
              {currentStatus === "draft" && (
                <>
                  このノートは<span className="text-yellow-400 font-semibold">下書き</span>状態です。
                  承認するとマッチング対象になります。
                </>
              )}
              {currentStatus === "approved" && (
                <>
                  このノートは<span className="text-green-400 font-semibold">承認済み</span>です。
                  市場一致の照合対象になっています。
                </>
              )}
              {currentStatus === "rejected" && (
                <>
                  このノートは<span className="text-red-400 font-semibold">非承認</span>状態です。
                  マッチング対象外（アーカイブ）として扱われます。
                </>
              )}
            </div>

            {/* アクションボタン */}
            <div className="flex flex-wrap items-center gap-3">
              {currentStatus === "draft" && (
                <>
                  <Button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {actionLoading ? "処理中..." : "承認する"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleReject}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "処理中..." : "非承認にする"}
                  </Button>
                </>
              )}
              {currentStatus === "approved" && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleRevertToDraft}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "処理中..." : "下書きに戻す"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleReject}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "処理中..." : "非承認にする"}
                  </Button>
                </>
              )}
              {currentStatus === "rejected" && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleRevertToDraft}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "処理中..." : "下書きに戻す"}
                  </Button>
                  <Button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {actionLoading ? "処理中..." : "承認する"}
                  </Button>
                </>
              )}
            </div>

            {/* 状態遷移のタイムスタンプ */}
            <div className="text-xs text-gray-500 space-y-1">
              {note.approvedAt && (
                <div>承認日時: {new Date(note.approvedAt).toLocaleString("ja-JP")}</div>
              )}
              {note.rejectedAt && (
                <div>非承認日時: {new Date(note.rejectedAt).toLocaleString("ja-JP")}</div>
              )}
              {note.lastEditedAt && (
                <div>最終編集: {new Date(note.lastEditedAt).toLocaleString("ja-JP")}</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
