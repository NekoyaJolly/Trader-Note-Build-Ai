/**
 * ノート単位の通知粒度上書きセクション (Phase β-2b)
 *
 * 目的:
 * - ノート詳細ページに置き、このノートだけのしきい値 / 一致レベル / クールダウンを設定する
 * - 全体設定 (scope=user) よりこのノートの設定が優先される
 *
 * 新規コンポーネントの理由: ノート詳細ページ (app/notes/[id]/page.tsx) は既に大きく、
 * 通知設定は独立した責務のため分離する (恒久・/settings/notifications と対の機能)。
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import {
  fetchNotificationPreferences,
  upsertNotificationPreference,
  deleteNotificationPreference,
  NotificationPreference,
  NotificationPreferenceFormSchema,
} from "@/lib/api";

export default function NoteNotificationPreference({ noteId }: { noteId: string }) {
  const [preference, setPreference] = useState<NotificationPreference | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 入力は「空 = 既定」を表現するため文字列で保持する
  const [threshold, setThreshold] = useState("");
  const [minMatchLevel, setMinMatchLevel] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState("");

  const loadData = useCallback(async () => {
    try {
      const all = await fetchNotificationPreferences();
      const notePref = all.find((p) => p.scope === "note" && p.noteId === noteId) ?? null;
      setPreference(notePref);
      setThreshold(notePref?.threshold !== null && notePref?.threshold !== undefined ? String(notePref.threshold) : "");
      setMinMatchLevel(notePref?.minMatchLevel ?? "");
      setCooldownMinutes(
        notePref?.cooldownMinutes !== null && notePref?.cooldownMinutes !== undefined
          ? String(notePref.cooldownMinutes)
          : ""
      );
    } catch (err) {
      console.error("ノート通知設定の読み込みに失敗:", err);
      // 読み込み失敗時はセクション自体は出すが、未設定として扱う
    } finally {
      setIsLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    // 入力値のランタイム検証 (AGENTS §2: Zod で検証。空 = 既定に戻す)
    const parsed = NotificationPreferenceFormSchema.safeParse({
      threshold,
      minMatchLevel,
      cooldownMinutes,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "入力値が不正です");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      await upsertNotificationPreference({ scope: "note", noteId, ...parsed.data });
      setSaved(true);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!preference) return;
    setIsSaving(true);
    setError(null);
    try {
      await deleteNotificationPreference(preference.id);
      setSaved(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-gray-500 text-sm">通知設定を読み込み中...</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        このノートだけ通知粒度を変えられます。空欄の項目は全体設定 / システム既定が使われます
      </p>

      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs">
          {error}
        </div>
      )}
      {saved && !error && (
        <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded text-emerald-400 text-xs">
          保存しました
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-gray-400">
          しきい値 (0〜1)
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="既定"
            aria-label="ノートしきい値"
            className="mt-1 block w-28 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-white focus:border-violet-500 focus:outline-none"
          />
        </label>
        <label className="text-xs text-gray-400">
          一致レベル
          <select
            value={minMatchLevel}
            onChange={(e) => setMinMatchLevel(e.target.value)}
            aria-label="ノート一致レベル"
            className="mt-1 block w-40 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-white focus:border-violet-500 focus:outline-none"
          >
            <option value="">既定</option>
            <option value="strong">Strong のみ</option>
            <option value="medium">Medium 以上</option>
            <option value="weak">Weak 以上</option>
          </select>
        </label>
        <label className="text-xs text-gray-400">
          クールダウン (分)
          <input
            type="number"
            min={1}
            max={10080}
            step={1}
            value={cooldownMinutes}
            onChange={(e) => setCooldownMinutes(e.target.value)}
            placeholder="既定"
            aria-label="ノートクールダウン"
            className="mt-1 block w-28 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-white focus:border-violet-500 focus:outline-none"
          />
        </label>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "保存中..." : "保存"}
          </Button>
          {preference && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={isSaving}
              className="text-gray-400 hover:text-red-400"
            >
              上書きを解除
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
