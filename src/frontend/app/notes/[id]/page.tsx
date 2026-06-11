"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { NoteDetail, NoteStatus } from "@/types/note";
import {
  fetchNoteDetail,
  approveNote,
  rejectNote,
  revertNoteToDraft,
  updateNote,
  updateNotePriority,
  setNoteEnabled,
  pauseNote,
} from "@/lib/api";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
// 直接インポートに変更（index.ts経由でのモジュール解決問題を回避）
import PerformancePanel from "@/components/PerformancePanel";
import NoteNotificationPreference from "@/components/NoteNotificationPreference";

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

  // 運用設定（優先度・一時停止）の入力状態
  const [priorityInput, setPriorityInput] = useState(5);
  const [pauseInput, setPauseInput] = useState("");

  const loadNote = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNoteDetail(id);
      setNote(data);
      setEditedSummary(data.aiSummary);
      setEditedUserNotes(data.userNotes ?? "");
      setEditedTags(data.tags?.join(", ") ?? "");
      setPriorityInput(data.priority ?? 5);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ノート詳細の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void loadNote();
  }, [id, loadNote]);

  /**
   * ステータスに応じたバッジのスタイルを返す
   */
  function getStatusBadge(status: NoteStatus) {
    switch (status) {
      case "active":
        return <Badge variant="secondary" className="bg-green-600/20 text-green-400 border-green-600/30">承認済み</Badge>;
      case "archived":
        return <Badge variant="destructive" className="bg-red-600/20 text-red-400 border-red-600/30">アーカイブ</Badge>;
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
    } catch (_e) {
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
    } catch (_e) {
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
    } catch (_e) {
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
    } catch (_e) {
      alert("保存に失敗しました。時間をおいて再試行してください。");
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 有効/無効を切り替え
   */
  async function handleToggleEnabled() {
    if (!note || actionLoading) return;
    try {
      setActionLoading(true);
      await setNoteEnabled(id, !(note.enabled ?? true));
      await loadNote();
    } catch (_e) {
      alert("有効/無効の切り替えに失敗しました。時間をおいて再試行してください。");
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 優先度を保存
   */
  async function handleSavePriority() {
    if (!note || actionLoading) return;
    try {
      setActionLoading(true);
      await updateNotePriority(id, priorityInput);
      await loadNote();
    } catch (_e) {
      alert("優先度の更新に失敗しました。時間をおいて再試行してください。");
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 一時停止を設定（指定日時まで監視を止める）
   */
  async function handlePause() {
    if (!note || actionLoading) return;
    if (!pauseInput) {
      alert("停止する日時を指定してください。");
      return;
    }
    // datetime-local はローカル時刻。ISO 文字列に変換して送る。
    const iso = new Date(pauseInput).toISOString();
    try {
      setActionLoading(true);
      await pauseNote(id, iso);
      setPauseInput("");
      await loadNote();
    } catch (_e) {
      alert("一時停止の設定に失敗しました。時間をおいて再試行してください。");
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 一時停止を解除
   */
  async function handleClearPause() {
    if (!note || actionLoading) return;
    try {
      setActionLoading(true);
      await pauseNote(id, null);
      await loadNote();
    } catch (_e) {
      alert("一時停止の解除に失敗しました。時間をおいて再試行してください。");
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
  const isEnabled = note.enabled ?? true;
  const isPaused = !!note.pausedUntil && new Date(note.pausedUntil).getTime() > Date.now();
  // 運用設定が実際に効くのは承認済み(active)のみ。それ以外では操作 UI を無効化し、
  // 説明文（「効くのは承認済み」）と挙動を一致させる（無駄な API 呼び出し/失敗アラート防止）。
  const opsDisabled = currentStatus !== "active";

  // 監視状態を非エンジニア向けの一言で表す
  function getMonitoringLabel(): { text: string; className: string } {
    if (currentStatus !== "active") {
      return {
        text: currentStatus === "draft" ? "監視対象外（下書き）" : "監視対象外（アーカイブ）",
        className: "bg-slate-600/20 text-slate-300 border-slate-500/30",
      };
    }
    if (!isEnabled) {
      return { text: "無効（監視から外しています）", className: "bg-orange-600/20 text-orange-400 border-orange-600/30" };
    }
    if (isPaused) {
      return { text: "一時停止中", className: "bg-yellow-600/20 text-yellow-400 border-yellow-600/30" };
    }
    return { text: "監視中", className: "bg-green-600/20 text-green-400 border-green-600/30" };
  }
  const monitoring = getMonitoringLabel();

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          <div>
            <div className="text-sm font-semibold text-gray-400">時間足</div>
            <div className="text-base font-medium text-gray-200">{note.marketContext.timeframe}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-400">トレンド</div>
            <div className="text-base font-medium text-gray-200">{note.marketContext.trend}</div>
          </div>
        </div>
        
        {/* ユーザー設定インジケーター */}
        {note.marketContext.calculatedIndicators && Object.keys(note.marketContext.calculatedIndicators).length > 0 ? (
          <div>
            <div className="text-sm font-semibold text-gray-400 mb-2">インジケーター</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(note.marketContext.calculatedIndicators).map(([key, value]) => (
                <div key={key} className="bg-gray-800 rounded-lg p-3">
                  <div className="text-xs text-gray-500">{key}</div>
                  <div className="text-sm font-medium text-gray-200">
                    {value !== null ? (typeof value === 'number' ? value.toFixed(2) : value) : '-'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-semibold text-gray-400">インジケーター</div>
            <div className="text-base font-medium text-gray-200">
              RSI: {note.marketContext.indicators?.rsi ?? "-"}, MACD: {note.marketContext.indicators?.macd ?? "-"}, VOL: {note.marketContext.indicators?.volume ?? "-"}
            </div>
          </div>
        )}
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
              {currentStatus === "active" && (
                <>
                  このノートは<span className="text-green-400 font-semibold">承認済み</span>です。
                  市場一致の照合対象になっています。
                </>
              )}
              {currentStatus === "archived" && (
                <>
                  このノートは<span className="text-red-400 font-semibold">アーカイブ</span>状態です。
                  マッチング対象外として扱われます。
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
                    {actionLoading ? "処理中..." : "アーカイブにする"}
                  </Button>
                </>
              )}
              {currentStatus === "active" && (
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
                    {actionLoading ? "処理中..." : "アーカイブにする"}
                  </Button>
                </>
              )}
              {currentStatus === "archived" && (
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
              {note.activatedAt && (
                <div>承認日時: {new Date(note.activatedAt).toLocaleString("ja-JP")}</div>
              )}
              {note.archivedAt && (
                <div>アーカイブ日時: {new Date(note.archivedAt).toLocaleString("ja-JP")}</div>
              )}
              {note.lastEditedAt && (
                <div>最終編集: {new Date(note.lastEditedAt).toLocaleString("ja-JP")}</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 監視設定（運用） */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>監視設定</CardTitle>
            <Badge variant="outline" className={monitoring.className}>{monitoring.text}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <p className="text-sm text-gray-400">
              承認済み（監視中）のノートは、現在の市場と条件が一致すると通知されます。ここでは「一時的に監視から外す」「指定日時まで止める」「同時にヒットしたときの優先度」を設定できます。
              {currentStatus !== "active" && (
                <span className="block mt-1 text-gray-500">
                  ※ これらの設定が効くのは<span className="text-green-400">承認済み</span>のノートです。まず承認してください。
                </span>
              )}
            </p>

            {/* 有効/無効 */}
            <div className="flex items-center justify-between gap-4 border-t border-slate-700 pt-4">
              <div>
                <div className="text-sm font-semibold text-gray-300">有効 / 無効</div>
                <div className="text-xs text-gray-500">
                  無効にすると、承認済みでも一時的に監視・通知の対象から外れます。
                </div>
              </div>
              <Button
                variant={isEnabled ? "destructive" : "secondary"}
                size="sm"
                onClick={handleToggleEnabled}
                disabled={actionLoading || opsDisabled}
              >
                {actionLoading ? "処理中..." : isEnabled ? "無効にする" : "有効にする"}
              </Button>
            </div>

            {/* 一時停止 */}
            <div className="border-t border-slate-700 pt-4">
              <div className="text-sm font-semibold text-gray-300">一時停止</div>
              <div className="text-xs text-gray-500 mb-2">
                指定した日時まで通知を止めます。期限が過ぎると自動で監視に戻ります。
              </div>
              {isPaused ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-yellow-400">
                    {note.pausedUntil ? new Date(note.pausedUntil).toLocaleString("ja-JP") : ""} まで停止中
                  </span>
                  <Button variant="outline" size="sm" onClick={handleClearPause} disabled={actionLoading || opsDisabled}>
                    {actionLoading ? "処理中..." : "停止を解除"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="datetime-local"
                    className="p-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm disabled:opacity-50"
                    value={pauseInput}
                    onChange={(e) => setPauseInput(e.target.value)}
                    disabled={actionLoading || opsDisabled}
                  />
                  <Button variant="outline" size="sm" onClick={handlePause} disabled={actionLoading || opsDisabled || !pauseInput}>
                    {actionLoading ? "処理中..." : "この日時まで停止"}
                  </Button>
                </div>
              )}
            </div>

            {/* 優先度 */}
            <div className="border-t border-slate-700 pt-4">
              <div className="text-sm font-semibold text-gray-300">優先度</div>
              <div className="text-xs text-gray-500 mb-2">
                同じタイミングで複数のノートがヒットしたとき、どれを優先して通知するかに使われます（1〜10、大きいほど優先）。
              </div>
              <div className="flex items-center gap-3">
                <select
                  className="p-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm disabled:opacity-50"
                  value={priorityInput}
                  onChange={(e) => setPriorityInput(Number(e.target.value))}
                  disabled={actionLoading || opsDisabled}
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSavePriority}
                  disabled={actionLoading || opsDisabled || priorityInput === (note.priority ?? 5)}
                >
                  {actionLoading ? "処理中..." : "優先度を保存"}
                </Button>
              </div>
            </div>

            {/* 通知粒度の上書き (Phase β-2b) */}
            <div className="border-t border-slate-700 pt-4">
              <div className="text-sm font-semibold text-gray-300 mb-2">通知粒度 (このノートのみ)</div>
              <NoteNotificationPreference noteId={id} />
            </div>

            {/* 通知条件の説明 */}
            <div className="border-t border-slate-700 pt-4 text-xs text-gray-500 space-y-1">
              <div className="font-semibold text-gray-400">通知されない主な理由</div>
              <div>・一致度がしきい値に届かない</div>
              <div>・同じノートの通知が短時間に続かないよう制限中（クールダウン）</div>
              <div>・1日の通知件数が上限に達している</div>
              <div>・このノートが無効、または一時停止中</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* パフォーマンスパネル（承認済みノートのみ表示） */}
      {currentStatus === "active" && (
        <PerformancePanel noteId={id} />
      )}
    </div>
  );
}
