/**
 * 通知粒度設定ページ (Phase β-2b)
 * /settings/notifications
 *
 * 機能:
 * - ユーザー全体 (scope=user) の通知粒度設定: しきい値 / 一致レベル / クールダウン / 24h 上限
 * - プロファイル単位上書き (scope=profile) の作成・一覧・削除
 * - ノート単位上書き (scope=note) の一覧と削除 (作成はノート詳細ページから)
 * - ストラテジー単位上書き (scope=strategy) の一覧と削除 (作成はストラテジーアラート画面から)
 *
 * 設定が無い項目はシステム既定で動作する (null = 既定に戻す)。
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  fetchNotificationPreferences,
  fetchProfiles,
  upsertNotificationPreference,
  deleteNotificationPreference,
  type IndicatorProfile,
  type NotificationPreference,
  type NotificationWeightPreset,
} from "@/lib/api";
import {
  validateNotificationPreferenceCooldownMinutes,
  validateNotificationPreferenceMaxPerDay,
} from "../../../../shared/notificationPreferenceValidation";

/** 一致レベルの表示ラベル (システム既定 = weak 帯から通知) */
const LEVEL_LABELS: Record<string, string> = {
  strong: "Strong のみ (類似度 0.9 以上)",
  medium: "Medium 以上 (類似度 0.8 以上)",
  weak: "Weak 以上 (類似度 0.7 以上・既定)",
};

/** レンズ層の重みプリセット表示 */
const WEIGHT_PRESET_LABELS: Record<NotificationWeightPreset, string> = {
  indicator_focused: "指標重視",
  balanced: "バランス",
  state_focused: "状態重視",
};

/** プリセットが何を重視するかを UI で短く示す */
const WEIGHT_PRESET_DESCRIPTIONS: Record<NotificationWeightPreset, string> = {
  indicator_focused: "RSI / MACD / MA / BB などを重めに見る",
  balanced: "状態レンズと指標レンズを同じ重さで見る",
  state_focused: "相場状態・パターン側を重めに見る",
};

/** 設定行の有効な上書き内容を一覧表示用の短い文言にする */
function formatPreferenceParts(pref: NotificationPreference): string {
  const parts: string[] = [];
  if (pref.threshold !== null) {
    parts.push(`しきい値 ${pref.threshold}`);
  }
  if (pref.minMatchLevel !== null) {
    parts.push(`${pref.minMatchLevel} 以上`);
  }
  if (pref.weightPreset !== null) {
    parts.push(WEIGHT_PRESET_LABELS[pref.weightPreset]);
  }
  if (pref.cooldownMinutes !== null) {
    parts.push(`クールダウン ${pref.cooldownMinutes}分`);
  }
  if (pref.maxPerDay !== null) {
    parts.push(`24h上限 ${pref.maxPerDay}件`);
  }
  return parts.length > 0 ? parts.join(" / ") : "すべて既定";
}

/**
 * ユーザー全体設定フォーム
 */
function UserPreferenceForm({
  preference,
  onSaved,
}: {
  preference: NotificationPreference | null;
  onSaved: () => Promise<void>;
}) {
  // 入力は「空 = 既定」を表現するため文字列で保持し、保存時に number | null へ変換する
  const [threshold, setThreshold] = useState<string>(
    preference?.threshold !== null && preference?.threshold !== undefined
      ? String(preference.threshold)
      : ""
  );
  const [minMatchLevel, setMinMatchLevel] = useState<string>(preference?.minMatchLevel ?? "");
  const [weightPreset, setWeightPreset] = useState<"" | NotificationWeightPreset>(
    preference?.weightPreset ?? ""
  );
  const [cooldownMinutes, setCooldownMinutes] = useState<string>(
    preference?.cooldownMinutes !== null && preference?.cooldownMinutes !== undefined
      ? String(preference.cooldownMinutes)
      : ""
  );
  const [maxPerDay, setMaxPerDay] = useState<string>(
    preference?.maxPerDay !== null && preference?.maxPerDay !== undefined
      ? String(preference.maxPerDay)
      : ""
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    // 入力値の検証 (空 = 既定に戻す)
    const thresholdValue = threshold === "" ? null : Number(threshold);
    if (thresholdValue !== null && (Number.isNaN(thresholdValue) || thresholdValue < 0 || thresholdValue > 1)) {
      setError("しきい値は 0〜1 の数値で指定してください");
      return;
    }
    const cooldownValue = cooldownMinutes === "" ? null : Number(cooldownMinutes);
    const cooldownMessage = validateNotificationPreferenceCooldownMinutes(cooldownValue);
    if (cooldownMessage !== null) {
      setError(cooldownMessage);
      return;
    }
    const maxPerDayValue = maxPerDay === "" ? null : Number(maxPerDay);
    const maxPerDayMessage = validateNotificationPreferenceMaxPerDay(maxPerDayValue);
    if (maxPerDayMessage !== null) {
      setError(maxPerDayMessage);
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      await upsertNotificationPreference({
        scope: "user",
        threshold: thresholdValue,
        minMatchLevel: minMatchLevel === "" ? null : (minMatchLevel as "strong" | "medium" | "weak"),
        weightPreset: weightPreset === "" ? null : weightPreset,
        cooldownMinutes: cooldownValue,
        maxPerDay: maxPerDayValue,
      });
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>全体設定</CardTitle>
        <CardDescription>
          全ノート共通の通知粒度。ノート単位の上書きがあるノートはそちらが優先されます
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
        {saved && !error && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm">
            保存しました
          </div>
        )}

        {/* しきい値 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="pref-threshold">
            類似度しきい値 (0〜1)
          </label>
          <input
            id="pref-threshold"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="既定 (0.75)"
            className="w-40 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            このスコア以上で通知候補になります。空欄 = システム既定
          </p>
        </div>

        {/* 一致レベル */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="pref-level">
            通知する一致レベル
          </label>
          <select
            id="pref-level"
            value={minMatchLevel}
            onChange={(e) => setMinMatchLevel(e.target.value)}
            className="w-72 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
          >
            <option value="">既定 (Weak 以上)</option>
            <option value="strong">{LEVEL_LABELS.strong}</option>
            <option value="medium">{LEVEL_LABELS.medium}</option>
            <option value="weak">{LEVEL_LABELS.weak}</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            レベルの下限としきい値の高い方が実際の発火条件になります
          </p>
        </div>

        {/* レンズ層の重みプリセット */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="pref-weight-preset">
            重みプリセット
          </label>
          <select
            id="pref-weight-preset"
            value={weightPreset}
            onChange={(e) => setWeightPreset(e.target.value as "" | NotificationWeightPreset)}
            className="w-72 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
          >
            <option value="">既定 (指標重視)</option>
            <option value="indicator_focused">{WEIGHT_PRESET_LABELS.indicator_focused}</option>
            <option value="balanced">{WEIGHT_PRESET_LABELS.balanced}</option>
            <option value="state_focused">{WEIGHT_PRESET_LABELS.state_focused}</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {weightPreset === ""
              ? WEIGHT_PRESET_DESCRIPTIONS.indicator_focused
              : WEIGHT_PRESET_DESCRIPTIONS[weightPreset]}
          </p>
        </div>

        {/* クールダウン */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="pref-cooldown">
            再通知クールダウン (分)
          </label>
          <input
            id="pref-cooldown"
            type="number"
            min={1}
            max={10080}
            step={1}
            value={cooldownMinutes}
            onChange={(e) => setCooldownMinutes(e.target.value)}
            placeholder="既定 (60)"
            className="w-40 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            同じノートの通知後、この時間は再通知しません。空欄 = システム既定
          </p>
        </div>

        {/* 24h 通知上限 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="pref-max-per-day">
            24h 通知上限 (件)
          </label>
          <input
            id="pref-max-per-day"
            type="number"
            min={1}
            max={1000}
            step={1}
            value={maxPerDay}
            onChange={(e) => setMaxPerDay(e.target.value)}
            placeholder="既定"
            className="w-40 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            1ユーザーあたりの24時間通知上限です。空欄 = システム既定
          </p>
        </div>

        <div className="pt-2">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "保存中..." : "保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * プロファイル単位上書きの作成・一覧
 */
function ProfileOverridePanel({
  profiles,
  preferences,
  onSaved,
  onDeleted,
}: {
  profiles: IndicatorProfile[];
  preferences: NotificationPreference[];
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>(profiles[0]?.id ?? "");
  const selectedPreference = preferences.find((pref) => pref.profileId === selectedProfileId) ?? null;
  const [threshold, setThreshold] = useState("");
  const [minMatchLevel, setMinMatchLevel] = useState("");
  const [weightPreset, setWeightPreset] = useState<"" | NotificationWeightPreset>("");
  const [cooldownMinutes, setCooldownMinutes] = useState("");
  const [maxPerDay, setMaxPerDay] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setThreshold(
      selectedPreference?.threshold !== null && selectedPreference?.threshold !== undefined
        ? String(selectedPreference.threshold)
        : ""
    );
    setMinMatchLevel(selectedPreference?.minMatchLevel ?? "");
    setWeightPreset(selectedPreference?.weightPreset ?? "");
    setCooldownMinutes(
      selectedPreference?.cooldownMinutes !== null && selectedPreference?.cooldownMinutes !== undefined
        ? String(selectedPreference.cooldownMinutes)
        : ""
    );
    setMaxPerDay(
      selectedPreference?.maxPerDay !== null && selectedPreference?.maxPerDay !== undefined
        ? String(selectedPreference.maxPerDay)
        : ""
    );
    setError(null);
    setSaved(false);
  }, [selectedProfileId, selectedPreference]);

  const handleSave = async () => {
    if (selectedProfileId === "") {
      setError("プロファイルを選択してください");
      return;
    }
    const thresholdValue = threshold === "" ? null : Number(threshold);
    if (thresholdValue !== null && (Number.isNaN(thresholdValue) || thresholdValue < 0 || thresholdValue > 1)) {
      setError("しきい値は 0〜1 の数値で指定してください");
      return;
    }
    const cooldownValue = cooldownMinutes === "" ? null : Number(cooldownMinutes);
    const cooldownMessage = validateNotificationPreferenceCooldownMinutes(cooldownValue);
    if (cooldownMessage !== null) {
      setError(cooldownMessage);
      return;
    }
    const maxPerDayValue = maxPerDay === "" ? null : Number(maxPerDay);
    const maxPerDayMessage = validateNotificationPreferenceMaxPerDay(maxPerDayValue);
    if (maxPerDayMessage !== null) {
      setError(maxPerDayMessage);
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      await upsertNotificationPreference({
        scope: "profile",
        profileId: selectedProfileId,
        threshold: thresholdValue,
        minMatchLevel: minMatchLevel === "" ? null : (minMatchLevel as "strong" | "medium" | "weak"),
        weightPreset: weightPreset === "" ? null : weightPreset,
        cooldownMinutes: cooldownValue,
        maxPerDay: maxPerDayValue,
      });
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteNotificationPreference(id);
      await onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  const profileNameById = new Map(profiles.map((profile) => [profile.id, profile.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>プロファイル単位の上書き</CardTitle>
        <CardDescription>
          CSV取込時に選んだインジケータープロファイル単位で、ノートマッチ通知の粒度を変えます
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
        {saved && !error && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm">
            保存しました
          </div>
        )}

        {profiles.length === 0 ? (
          <p className="text-gray-500 text-sm">プロファイルがまだありません</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="profile-pref-target">
                  対象プロファイル
                </label>
                <select
                  id="profile-pref-target"
                  value={selectedProfileId}
                  onChange={(event) => setSelectedProfileId(event.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="profile-pref-threshold">
                  類似度しきい値 (0〜1)
                </label>
                <input
                  id="profile-pref-threshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                  placeholder="上位設定を使用"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="profile-pref-level">
                  通知する一致レベル
                </label>
                <select
                  id="profile-pref-level"
                  value={minMatchLevel}
                  onChange={(event) => setMinMatchLevel(event.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
                >
                  <option value="">上位設定を使用</option>
                  <option value="strong">{LEVEL_LABELS.strong}</option>
                  <option value="medium">{LEVEL_LABELS.medium}</option>
                  <option value="weak">{LEVEL_LABELS.weak}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="profile-pref-weight">
                  重みプリセット
                </label>
                <select
                  id="profile-pref-weight"
                  value={weightPreset}
                  onChange={(event) => setWeightPreset(event.target.value as "" | NotificationWeightPreset)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
                >
                  <option value="">上位設定を使用</option>
                  <option value="indicator_focused">{WEIGHT_PRESET_LABELS.indicator_focused}</option>
                  <option value="balanced">{WEIGHT_PRESET_LABELS.balanced}</option>
                  <option value="state_focused">{WEIGHT_PRESET_LABELS.state_focused}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="profile-pref-cooldown">
                  再通知クールダウン (分)
                </label>
                <input
                  id="profile-pref-cooldown"
                  type="number"
                  min={1}
                  max={10080}
                  step={1}
                  value={cooldownMinutes}
                  onChange={(event) => setCooldownMinutes(event.target.value)}
                  placeholder="上位設定を使用"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="profile-pref-max-per-day">
                  24h 通知上限 (件)
                </label>
                <input
                  id="profile-pref-max-per-day"
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={maxPerDay}
                  onChange={(event) => setMaxPerDay(event.target.value)}
                  placeholder="上位設定を使用"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
                />
              </div>
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "保存中..." : "プロファイル上書きを保存"}
            </Button>
          </>
        )}

        <div className="border-t border-slate-700/50 pt-4">
          {preferences.length === 0 ? (
            <p className="text-gray-500 text-sm">プロファイル単位の上書きはありません</p>
          ) : (
            <div className="space-y-2">
              {preferences.map((pref) => {
                const profileLabel =
                  pref.profileId !== null
                    ? profileNameById.get(pref.profileId) ?? `プロファイル ${pref.profileId.slice(0, 8)}…`
                    : "プロファイル未紐付け";
                return (
                  <div
                    key={pref.id}
                    className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg"
                  >
                    <div className="text-sm">
                      <span className="text-violet-400">{profileLabel}</span>
                      <span className="text-gray-400 ml-3">{formatPreferenceParts(pref)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(pref.id)}
                      disabled={deletingId === pref.id}
                      aria-label={`${profileLabel} の通知粒度上書きを削除`}
                      className="text-gray-400 hover:text-red-400"
                    >
                      {deletingId === pref.id ? "..." : "削除"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * ノート単位上書きの一覧
 */
function NoteOverrideList({
  preferences,
  onDeleted,
}: {
  preferences: NotificationPreference[];
  onDeleted: () => Promise<void>;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteNotificationPreference(id);
      await onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ノート単位の上書き</CardTitle>
        <CardDescription>
          特定のノートだけ通知粒度を変えている設定。追加はノート詳細ページから行えます
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
        {preferences.length === 0 ? (
          <p className="text-gray-500 text-sm">ノート単位の上書きはありません</p>
        ) : (
          <div className="space-y-2">
            {preferences.map((pref) => (
              <div
                key={pref.id}
                className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg"
              >
                <div className="text-sm">
                  <a
                    href={`/notes/${pref.noteId}`}
                    className="text-violet-400 hover:underline"
                  >
                    ノート {pref.noteId?.slice(0, 8)}…
                  </a>
                  <span className="text-gray-400 ml-3">
                    {pref.threshold !== null && `しきい値 ${pref.threshold} `}
                    {pref.minMatchLevel !== null && `/ ${pref.minMatchLevel} 以上 `}
                    {pref.weightPreset !== null && `/ ${WEIGHT_PRESET_LABELS[pref.weightPreset]} `}
                    {pref.cooldownMinutes !== null && `/ クールダウン ${pref.cooldownMinutes}分`}
                    {pref.maxPerDay !== null && `/ 24h上限 ${pref.maxPerDay}件`}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(pref.id)}
                  disabled={deletingId === pref.id}
                  aria-label={
                    pref.noteId
                      ? `ノート ${pref.noteId.slice(0, 8)} の通知粒度上書きを削除`
                      : "未紐付けノートの通知粒度上書きを削除"
                  }
                  className="text-gray-400 hover:text-red-400"
                >
                  {deletingId === pref.id ? "..." : "削除"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * ストラテジー単位上書きの一覧
 */
function StrategyOverrideList({
  preferences,
  onDeleted,
}: {
  preferences: NotificationPreference[];
  onDeleted: () => Promise<void>;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteNotificationPreference(id);
      await onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ストラテジー単位の上書き</CardTitle>
        <CardDescription>
          条件アラートのクールダウンをストラテジーごとに変えている設定。追加はアラート設定画面から行えます
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
        {preferences.length === 0 ? (
          <p className="text-gray-500 text-sm">ストラテジー単位の上書きはありません</p>
        ) : (
          <div className="space-y-2">
            {preferences.map((pref) => (
              <div
                key={pref.id}
                className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg"
              >
                <div className="text-sm">
                  {pref.strategyId ? (
                    <a
                      href={`/strategies/${pref.strategyId}/alerts`}
                      className="text-violet-400 hover:underline"
                    >
                      ストラテジー {pref.strategyId.slice(0, 8)}…
                    </a>
                  ) : (
                    <span className="text-gray-500">ストラテジー未紐付け</span>
                  )}
                  <span className="text-gray-400 ml-3">
                    {formatPreferenceParts(pref)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(pref.id)}
                  disabled={deletingId === pref.id}
                  aria-label={
                    pref.strategyId
                      ? `ストラテジー ${pref.strategyId.slice(0, 8)} の通知粒度上書きを削除`
                      : "未紐付けストラテジーの通知粒度上書きを削除"
                  }
                  className="text-gray-400 hover:text-red-400"
                >
                  {deletingId === pref.id ? "..." : "削除"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 通知粒度設定ページ
 */
export default function NotificationPreferencesPage() {
  const router = useRouter();
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [profiles, setProfiles] = useState<IndicatorProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [preferenceData, profileData] = await Promise.all([
        fetchNotificationPreferences(),
        fetchProfiles(),
      ]);
      setPreferences(preferenceData);
      setProfiles(profileData);
    } catch (err) {
      console.error("通知設定の読み込みに失敗:", err);
      setError(err instanceof Error ? err.message : "通知設定の読み込みに失敗しました");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const userPreference = preferences.find((p) => p.scope === "user") ?? null;
  const profileOverrides = preferences.filter((p) => p.scope === "profile");
  const noteOverrides = preferences.filter((p) => p.scope === "note");
  const strategyOverrides = preferences.filter((p) => p.scope === "strategy");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400">読み込み中...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* ヘッダー */}
        <div>
          <button
            onClick={() => router.push("/settings")}
            className="text-gray-400 hover:text-white text-sm mb-2 flex items-center gap-1"
          >
            ← 設定に戻る
          </button>
          <h1 className="text-2xl font-bold text-white">通知粒度設定</h1>
          <p className="text-gray-400 text-sm mt-1">
            ノートマッチ通知のしきい値・一致レベル・頻度を調整します
          </p>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
            {error}
          </div>
        )}

        <UserPreferenceForm
          // key で保存後の再取得値をフォーム初期値に反映する
          key={userPreference?.updatedAt ?? "empty"}
          preference={userPreference}
          onSaved={loadData}
        />
        <ProfileOverridePanel
          profiles={profiles}
          preferences={profileOverrides}
          onSaved={loadData}
          onDeleted={loadData}
        />
        <NoteOverrideList preferences={noteOverrides} onDeleted={loadData} />
        <StrategyOverrideList preferences={strategyOverrides} onDeleted={loadData} />
      </div>
    </div>
  );
}
