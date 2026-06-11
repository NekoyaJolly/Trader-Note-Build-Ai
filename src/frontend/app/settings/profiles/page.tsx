/**
 * インジケータープロファイル管理ページ
 * /settings/profiles
 *
 * 機能:
 * - プロファイル一覧表示
 * - プロファイルの作成・編集・削除
 * - デフォルトプロファイルの設定
 * - インジケーター設定のコピー機能
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  fetchProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
  fetchIndicatorSettings,
  IndicatorProfile,
  ProfileIndicatorConfig,
} from "@/lib/api";
// インジケーター別のパラメータ定義はインジケーター設定モーダルと共有する (Phase α-4b)
import { getParamFields } from "@/lib/indicatorParamFields";

/**
 * プロファイルカードコンポーネント
 */
function ProfileCard({
  profile,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  profile: IndicatorProfile;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  // 削除確認ハンドラ
  const handleDelete = async () => {
    if (!confirm(`プロファイル「${profile.name}」を削除しますか？`)) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700/50 hover:border-violet-500/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">📁</span>
              <h3 className="text-white font-medium">{profile.name}</h3>
              {profile.isDefault && (
                <span className="px-2 py-0.5 bg-violet-500/20 text-violet-400 text-xs rounded-full">
                  デフォルト
                </span>
              )}
            </div>
            {profile.description && (
              <p className="text-gray-400 text-sm mt-1">{profile.description}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
              <span>インジケーター: {profile.indicators.length}個</span>
              <span>
                作成: {new Date(profile.createdAt).toLocaleDateString("ja-JP")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!profile.isDefault && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSetDefault}
                className="text-gray-400 hover:text-white"
                title="デフォルトに設定"
              >
                ⭐
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              className="text-gray-400 hover:text-white"
            >
              編集
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-gray-400 hover:text-red-400"
            >
              {isDeleting ? "..." : "削除"}
            </Button>
          </div>
        </div>

        {/* インジケーター一覧 */}
        {profile.indicators.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-700/50">
            <div className="flex flex-wrap gap-2">
              {profile.indicators.map((indicator) => (
                <span
                  key={indicator.configId}
                  className={`px-2 py-1 rounded text-xs ${
                    indicator.enabled
                      ? "bg-slate-700/50 text-white"
                      : "bg-slate-800/50 text-gray-500 line-through"
                  }`}
                >
                  {indicator.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * プロファイル編集モーダル
 */
function ProfileEditModal({
  profile,
  availableIndicators,
  onSave,
  onCancel,
}: {
  profile?: IndicatorProfile;
  availableIndicators: ProfileIndicatorConfig[];
  onSave: (data: { name: string; description: string; indicators: ProfileIndicatorConfig[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name || "");
  const [description, setDescription] = useState(profile?.description || "");
  const [selectedIndicators, setSelectedIndicators] = useState<ProfileIndicatorConfig[]>(
    profile?.indicators || []
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // インジケーターの選択/解除
  const toggleIndicator = (indicator: ProfileIndicatorConfig) => {
    const exists = selectedIndicators.find((i) => i.configId === indicator.configId);
    if (exists) {
      setSelectedIndicators((prev) =>
        prev.filter((i) => i.configId !== indicator.configId)
      );
    } else {
      setSelectedIndicators((prev) => [...prev, indicator]);
    }
  };

  // 選択中インジケーターのパラメータを更新する (Phase α-4b)。
  // プロファイルはインジケーター設定とは独立に params を持つため、
  // ここでの編集は元のインジケーター設定 (activeSet) には影響しない。
  const updateIndicatorParam = (
    configId: string,
    key: keyof ProfileIndicatorConfig["params"],
    value: number | undefined
  ) => {
    // NaN (数値として解釈できない入力) は state を更新しない。
    // 空入力は undefined として保持し、保存ペイロードからキーごと落とす
    // (parseFloat(...) || 0 だと入力クリアで 0 が保存され min 制約を破る。Copilot レビュー対応)
    if (value !== undefined && Number.isNaN(value)) return;
    setSelectedIndicators((prev) =>
      prev.map((i) =>
        i.configId === configId
          ? { ...i, params: { ...i.params, [key]: value } }
          : i
      )
    );
  };

  // 保存ハンドラ
  const handleSave = async () => {
    if (!name.trim()) {
      setError("プロファイル名を入力してください");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        indicators: selectedIndicators,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-white mb-4">
          {profile ? "プロファイルを編集" : "新規プロファイル"}
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* プロファイル名 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              プロファイル名 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: スイングトレード用"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none"
            />
          </div>

          {/* 説明 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              説明（任意）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="このプロファイルの用途を記入..."
              rows={2}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none resize-none"
            />
          </div>

          {/* インジケーター選択 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              インジケーター
            </label>
            {availableIndicators.length === 0 ? (
              <p className="text-gray-500 text-sm">
                設定されたインジケーターがありません。
                <a href="/onboarding" className="text-violet-400 hover:underline ml-1">
                  オンボーディング
                </a>
                で設定してください。
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availableIndicators.map((indicator) => {
                  const isSelected = selectedIndicators.some(
                    (i) => i.configId === indicator.configId
                  );
                  return (
                    <button
                      key={indicator.configId}
                      type="button"
                      onClick={() => toggleIndicator(indicator)}
                      className={`px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                        isSelected
                          ? "bg-violet-500/20 border border-violet-500 text-white"
                          : "bg-slate-700/50 border border-slate-600 text-gray-400 hover:border-slate-500"
                      }`}
                    >
                      <span className="block truncate">{indicator.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2">
              選択中: {selectedIndicators.length}個
            </p>
          </div>

          {/* 選択中インジケーターのパラメータ編集 (Phase α-4b) */}
          {selectedIndicators.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                パラメータ
              </label>
              <div className="space-y-2">
                {selectedIndicators.map((indicator) => {
                  const fields = getParamFields(indicator.indicatorId);
                  // OBV / VWAP 等のパラメータなしインジケーターは行を出さない
                  if (fields.length === 0) return null;
                  return (
                    <div
                      key={indicator.configId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg"
                    >
                      <span className="text-sm text-white w-32 flex-shrink-0 truncate">
                        {indicator.label}
                      </span>
                      {fields.map((field) => {
                        // index signature 由来で string | boolean も型上は混ざるため number に narrow する
                        const paramValue = indicator.params?.[field.key];
                        return (
                          <label
                            key={field.key}
                            className="flex items-center gap-2 text-xs text-gray-400"
                          >
                            {field.label}
                            <input
                              type="number"
                              value={typeof paramValue === "number" ? paramValue : ""}
                              onChange={(e) =>
                                updateIndicatorParam(
                                  indicator.configId,
                                  field.key,
                                  e.target.value === ""
                                    ? undefined
                                    : Number(e.target.value)
                                )
                              }
                              min={field.min}
                              max={field.max}
                              step={field.step || 1}
                              className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:border-violet-500 focus:outline-none"
                              aria-label={`${indicator.label} ${field.label}`}
                            />
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                ここでの変更はこのプロファイルにのみ保存されます（元のインジケーター設定は変わりません）
              </p>
            </div>
          )}
        </div>

        {/* ボタン */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-700">
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * プロファイル管理ページ
 */
export default function ProfilesPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<IndicatorProfile[]>([]);
  const [availableIndicators, setAvailableIndicators] = useState<ProfileIndicatorConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<IndicatorProfile | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // データ読み込み
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // プロファイル一覧とインジケーター設定を並列で取得
      const [profilesData, indicatorSettings] = await Promise.all([
        fetchProfiles(),
        fetchIndicatorSettings(),
      ]);

      setProfiles(profilesData);

      // インジケーター設定をProfileIndicatorConfig形式に変換
      // activeSet.configs から取得
      const indicators: ProfileIndicatorConfig[] = (
        indicatorSettings.activeSet?.configs || []
      ).map((config) => ({
        configId: config.configId,
        indicatorId: config.indicatorId,
        label: config.label || config.indicatorId,
        // paramsを安全にコピー（型の互換性のため）
        params: { ...config.params } as ProfileIndicatorConfig["params"],
        enabled: config.enabled,
      }));
      setAvailableIndicators(indicators);
    } catch (err) {
      console.error("データの読み込みに失敗:", err);
      setError(err instanceof Error ? err.message : "データの読み込みに失敗しました");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // プロファイル作成ハンドラ
  const handleCreate = async (data: {
    name: string;
    description: string;
    indicators: ProfileIndicatorConfig[];
  }) => {
    await createProfile({
      name: data.name,
      description: data.description,
      indicators: data.indicators,
    });
    setIsCreating(false);
    await loadData();
  };

  // プロファイル更新ハンドラ
  const handleUpdate = async (data: {
    name: string;
    description: string;
    indicators: ProfileIndicatorConfig[];
  }) => {
    if (!editingProfile) return;
    await updateProfile(editingProfile.id, {
      name: data.name,
      description: data.description,
      indicators: data.indicators,
    });
    setEditingProfile(null);
    await loadData();
  };

  // プロファイル削除ハンドラ
  const handleDelete = async (id: string) => {
    await deleteProfile(id);
    await loadData();
  };

  // デフォルト設定ハンドラ
  const handleSetDefault = async (id: string) => {
    await setDefaultProfile(id);
    await loadData();
  };

  // ローディング表示
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400">読み込み中...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => router.push("/settings")}
              className="text-gray-400 hover:text-white text-sm mb-2 flex items-center gap-1"
            >
              ← 設定に戻る
            </button>
            <h1 className="text-2xl font-bold text-white">
              インジケータープロファイル
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              インジケーターの組み合わせをプロファイルとして保存し、CSVインポート時に選択できます
            </p>
          </div>
          <Button onClick={() => setIsCreating(true)}>
            + 新規作成
          </Button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* 特殊オプション説明 */}
        <Card className="bg-slate-800/30 border-slate-700/30 mb-6">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">
              特殊オプション（CSVインポート時に自動で選択可能）
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 bg-slate-900/50 rounded-lg">
                <span className="text-xl">🤖</span>
                <div>
                  <h4 className="text-white font-medium">AIに任せる</h4>
                  <p className="text-gray-500 text-xs mt-1">
                    12次元特徴量ベクトルを自動計算。Side-Bと互換性あり。
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-slate-900/50 rounded-lg">
                <span className="text-xl">📊</span>
                <div>
                  <h4 className="text-white font-medium">プロファイルなし</h4>
                  <p className="text-gray-500 text-xs mt-1">
                    OHLCVデータのみ保存。インジケーター計算なし。
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* プロファイル一覧 */}
        <div className="space-y-4">
          {profiles.length === 0 ? (
            <Card className="bg-slate-800/30 border-slate-700/30">
              <CardContent className="p-8 text-center">
                <div className="text-4xl mb-4">📁</div>
                <h3 className="text-white font-medium mb-2">
                  プロファイルがありません
                </h3>
                <p className="text-gray-500 text-sm mb-4">
                  「新規作成」ボタンから最初のプロファイルを作成してください
                </p>
                <Button onClick={() => setIsCreating(true)}>
                  プロファイルを作成
                </Button>
              </CardContent>
            </Card>
          ) : (
            profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                onEdit={() => setEditingProfile(profile)}
                onDelete={() => handleDelete(profile.id)}
                onSetDefault={() => handleSetDefault(profile.id)}
              />
            ))
          )}
        </div>

        {/* 編集モーダル */}
        {(isCreating || editingProfile) && (
          <ProfileEditModal
            profile={editingProfile || undefined}
            availableIndicators={availableIndicators}
            onSave={editingProfile ? handleUpdate : handleCreate}
            onCancel={() => {
              setIsCreating(false);
              setEditingProfile(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
