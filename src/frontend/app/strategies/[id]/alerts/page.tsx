/**
 * ストラテジーアラート設定画面
 * 
 * 目的:
 * - アラート設定の表示・編集
 * - 通知チャネルの選択
 * - アラート発火履歴の確認
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchStrategy,
  fetchStrategyAlert,
  createStrategyAlert,
  updateStrategyAlert,
  deleteStrategyAlert,
  fetchAlertLogs,
  pauseAlert,
  resumeAlert,
  fetchNotificationPreferences,
  upsertNotificationPreference,
  deleteNotificationPreference,
  type StrategyAlert,
  type AlertLog,
  type AlertChannel,
  type NotificationPreference,
  type UpsertNotificationPreferenceInput,
} from "@/lib/api";
import {
  validateNotificationPreferenceCooldownMinutes,
  validateNotificationPreferenceMaxPerDay,
} from "../../../../../shared/notificationPreferenceValidation";
import type { Strategy } from "@/types/strategy";

export default function StrategyAlertsPage() {
  const params = useParams();
  const strategyId = params.id as string;

  // ストラテジー情報
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  
  // アラート設定
  const [alert, setAlert] = useState<StrategyAlert | null>(null);
  const [strategyPreference, setStrategyPreference] = useState<NotificationPreference | null>(null);
  
  // フォーム状態
  const [formData, setFormData] = useState({
    enabled: true,
    cooldownMinutes: 60,
    minMatchScore: 0.7,
    channels: ['in_app'] as AlertChannel[],
  });
  // 空欄は StrategyAlert 本体 / 全体設定 / システム既定を使う。strategy scope はサービス側で適用済み。
  const [preferenceCooldownMinutes, setPreferenceCooldownMinutes] = useState("");
  const [preferenceMaxPerDay, setPreferenceMaxPerDay] = useState("");
  
  // アラート履歴
  const [logs, setLogs] = useState<AlertLog[]>([]);
  
  // UIステート
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ============================================
  // データ取得
  // ============================================

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ストラテジーを取得
      const strategyData = await fetchStrategy(strategyId);
      setStrategy(strategyData);

      // アラート設定を取得
      const alertData = await fetchStrategyAlert(strategyId);
      setAlert(alertData);

      try {
        // 条件アラート用の通知粒度上書き (strategy scope) を取得
        const preferences = await fetchNotificationPreferences();
        const strategyScopedPreference =
          preferences.find((pref) => pref.scope === "strategy" && pref.strategyId === strategyId) ?? null;
        setStrategyPreference(strategyScopedPreference);
        setPreferenceCooldownMinutes(
          strategyScopedPreference?.cooldownMinutes !== null &&
            strategyScopedPreference?.cooldownMinutes !== undefined
            ? String(strategyScopedPreference.cooldownMinutes)
            : ""
        );
        setPreferenceMaxPerDay(
          strategyScopedPreference?.maxPerDay !== null && strategyScopedPreference?.maxPerDay !== undefined
            ? String(strategyScopedPreference.maxPerDay)
            : ""
        );
      } catch (preferenceError) {
        // 通知粒度の取得失敗だけでアラート設定編集を止めない
        console.warn("通知粒度上書きの読み込みに失敗:", preferenceError);
        setStrategyPreference(null);
        setPreferenceCooldownMinutes("");
        setPreferenceMaxPerDay("");
      }

      if (alertData) {
        setFormData({
          enabled: alertData.enabled,
          cooldownMinutes: alertData.cooldownMinutes,
          minMatchScore: alertData.minMatchScore,
          channels: alertData.channels,
        });

        // アラート履歴を取得
        const logsData = await fetchAlertLogs(strategyId, 20);
        setLogs(logsData);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "データの取得に失敗しました";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [strategyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ============================================
  // イベントハンドラ
  // ============================================

  /** チャネル選択の切り替え */
  const handleChannelToggle = (channel: AlertChannel) => {
    setFormData((prev) => {
      const newChannels = prev.channels.includes(channel)
        ? prev.channels.filter((c) => c !== channel)
        : [...prev.channels, channel];
      // 最低1つは選択必須
      if (newChannels.length === 0) {
        return prev;
      }
      return { ...prev, channels: newChannels };
    });
  };

  /** strategy scope の通知粒度上書きを保存 */
  const handlePreferenceSave = async () => {
    const cooldownValue =
      preferenceCooldownMinutes === "" ? null : Number(preferenceCooldownMinutes);
    const maxPerDayValue = preferenceMaxPerDay === "" ? null : Number(preferenceMaxPerDay);

    // 未作成かつ空欄の場合は、保存する上書きが無いので API を呼ばない
    if (cooldownValue === null && maxPerDayValue === null && strategyPreference === null) {
      setError(null);
      setSuccess("通知粒度はアラート設定値を使用します");
      return;
    }

    const preferencePayload: UpsertNotificationPreferenceInput = {
      scope: "strategy",
      strategyId,
      cooldownMinutes: cooldownValue,
      maxPerDay: maxPerDayValue,
    };
    const validationMessage =
      validateNotificationPreferenceCooldownMinutes(preferencePayload.cooldownMinutes ?? null) ??
      validateNotificationPreferenceMaxPerDay(preferencePayload.maxPerDay ?? null);
    if (validationMessage !== null) {
      setSuccess(null);
      setError(validationMessage);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const savedPreference = await upsertNotificationPreference(preferencePayload);
      setStrategyPreference(savedPreference);
      setSuccess("通知粒度の上書きを保存しました");
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "通知粒度の保存に失敗しました";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  /** strategy scope の通知粒度上書きを削除 */
  const handlePreferenceReset = async () => {
    if (!strategyPreference) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await deleteNotificationPreference(strategyPreference.id);
      setStrategyPreference(null);
      setPreferenceCooldownMinutes("");
      setPreferenceMaxPerDay("");
      setSuccess("通知粒度の上書きを解除しました");
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "通知粒度の解除に失敗しました";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  /** アラート設定を保存 */
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      if (alert) {
        // 更新
        const updated = await updateStrategyAlert(strategyId, formData);
        setAlert(updated);
        setSuccess("アラート設定を更新しました");
      } else {
        // 新規作成
        const created = await createStrategyAlert(strategyId, formData);
        setAlert(created);
        setSuccess("アラート設定を作成しました");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存に失敗しました";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  /** アラート設定を削除 */
  const handleDelete = async () => {
    if (!confirm("アラート設定を削除してもよろしいですか？")) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await deleteStrategyAlert(strategyId);
      setAlert(null);
      setLogs([]);
      setSuccess("アラート設定を削除しました");
    } catch (err) {
      const message = err instanceof Error ? err.message : "削除に失敗しました";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  /** アラートを一時停止 */
  const handlePause = async () => {
    try {
      setSaving(true);
      const updated = await pauseAlert(strategyId);
      setAlert(updated);
      setSuccess("アラートを一時停止しました");
    } catch (err) {
      const message = err instanceof Error ? err.message : "一時停止に失敗しました";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  /** アラートを再開 */
  const handleResume = async () => {
    try {
      setSaving(true);
      const updated = await resumeAlert(strategyId);
      setAlert(updated);
      setSuccess("アラートを再開しました");
    } catch (err) {
      const message = err instanceof Error ? err.message : "再開に失敗しました";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // レンダリング
  // ============================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="text-center py-12">
        <div className="text-red-400 mb-4">ストラテジーが見つかりません</div>
        <Link href="/strategies" className="text-blue-400 hover:underline">
          ストラテジー一覧に戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
          {/* 成功メッセージ */}
          {success && (
            <div className="bg-green-600/20 border border-green-600 text-green-400 px-4 py-3 rounded mb-6">
              {success}
            </div>
          )}

          {/* エラーメッセージ */}
          {error && (
            <div className="bg-red-600/20 border border-red-600 text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左カラム: 設定フォーム */}
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                アラート設定
              </h2>

              {/* ステータス表示 */}
              {alert && (
                <div className="mb-6 p-4 bg-slate-700 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">ステータス:</span>
                    <span className={`px-3 py-1 rounded text-sm font-medium ${
                      alert.status === 'enabled'
                        ? 'bg-green-600/30 text-green-400'
                        : alert.status === 'paused'
                        ? 'bg-yellow-600/30 text-yellow-400'
                        : 'bg-gray-600/30 text-gray-400'
                    }`}>
                      {alert.status === 'enabled' ? '有効' 
                        : alert.status === 'paused' ? '一時停止中' 
                        : '無効'}
                    </span>
                  </div>
                  {alert.lastTriggeredAt && (
                    <div className="mt-2 text-sm text-gray-400">
                      最終発火: {new Date(alert.lastTriggeredAt).toLocaleString('ja-JP')}
                    </div>
                  )}
                </div>
              )}

              {/* 有効/無効 */}
              <div className="mb-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) => setFormData((prev) => ({ ...prev, enabled: e.target.checked }))}
                    className="w-5 h-5 rounded bg-slate-700 border-slate-600"
                  />
                  <span className="text-gray-200">アラートを有効にする</span>
                </label>
              </div>

              {/* クールダウン時間 */}
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-1">
                  クールダウン時間（分）
                </label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={formData.cooldownMinutes}
                  onChange={(e) => setFormData((prev) => ({ 
                    ...prev, 
                    cooldownMinutes: parseInt(e.target.value) || 60 
                  }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
                />
                <p className="text-xs text-gray-500 mt-1">
                  同じストラテジーからの連続通知を抑制する時間
                </p>
              </div>

              {/* 最小一致スコア */}
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-1">
                  最小一致スコア（%）
                </label>
                <input
                  type="number"
                  min="50"
                  max="100"
                  step="5"
                  value={Math.round(formData.minMatchScore * 100)}
                  onChange={(e) => setFormData((prev) => ({ 
                    ...prev, 
                    minMatchScore: (parseInt(e.target.value) || 70) / 100 
                  }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
                />
                <p className="text-xs text-gray-500 mt-1">
                  このスコア以上で通知を発火（推奨: 70%）
                </p>
              </div>

              {/* 通知チャネル */}
              <div className="mb-6">
                <label className="block text-sm text-gray-400 mb-2">
                  通知チャネル
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.channels.includes('in_app')}
                      onChange={() => handleChannelToggle('in_app')}
                      className="w-5 h-5 rounded bg-slate-700 border-slate-600"
                    />
                    <span className="text-gray-200">アプリ内通知</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.channels.includes('web_push')}
                      onChange={() => handleChannelToggle('web_push')}
                      className="w-5 h-5 rounded bg-slate-700 border-slate-600"
                    />
                    <span className="text-gray-200">Web Push通知</span>
                  </label>
                </div>
              </div>

              {/* 通知粒度上書き */}
              <div className="mb-6 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
                <div className="mb-3">
                  <div className="text-sm font-medium text-gray-200">
                    通知粒度上書き
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    空欄の場合はアラート設定値 / 全体設定 / システム既定を使います
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-gray-400">
                    上書きクールダウン（分）
                    <input
                      type="number"
                      min="1"
                      max="10080"
                      value={preferenceCooldownMinutes}
                      onChange={(e) => setPreferenceCooldownMinutes(e.target.value)}
                      placeholder={`${formData.cooldownMinutes}`}
                      aria-label="ストラテジー通知粒度クールダウン"
                      className="mt-1 w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
                    />
                  </label>
                  <label className="block text-sm text-gray-400">
                    24h 通知上限（件）
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={preferenceMaxPerDay}
                      onChange={(e) => setPreferenceMaxPerDay(e.target.value)}
                      placeholder="全体/既定"
                      aria-label="ストラテジー24h通知上限"
                      className="mt-1 w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    onClick={handlePreferenceSave}
                    disabled={saving}
                    className={`px-4 py-2 rounded font-medium transition-colors ${
                      saving
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-slate-600 hover:bg-slate-500 text-white'
                    }`}
                  >
                    通知粒度を保存
                  </button>
                  {strategyPreference && (
                    <button
                      onClick={handlePreferenceReset}
                      disabled={saving}
                      className={`px-4 py-2 rounded font-medium transition-colors ${
                        saving
                          ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                          : 'bg-slate-800 hover:bg-slate-700 text-gray-300'
                      }`}
                    >
                      上書きを解除
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  現在のクールダウン: {preferenceCooldownMinutes === "" ? formData.cooldownMinutes : preferenceCooldownMinutes}分
                  / 24h上限: {preferenceMaxPerDay === "" ? "全体設定または既定" : `${preferenceMaxPerDay}件`}
                </p>
              </div>

              {/* アクションボタン */}
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={`flex-1 py-2 rounded font-medium transition-colors ${
                    saving
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {saving ? '保存中...' : alert ? '設定を更新' : '設定を作成'}
                </button>

                {alert && (
                  <>
                    {alert.status === 'enabled' ? (
                      <button
                        onClick={handlePause}
                        disabled={saving}
                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded font-medium"
                      >
                        一時停止
                      </button>
                    ) : alert.status === 'paused' && (
                      <button
                        onClick={handleResume}
                        disabled={saving}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium"
                      >
                        再開
                      </button>
                    )}
                    <button
                      onClick={handleDelete}
                      disabled={saving}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium"
                    >
                      削除
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 右カラム: アラート履歴 */}
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                発火履歴
              </h2>

              {logs.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  まだアラートが発火されていません
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-3 rounded-lg ${
                        log.success
                          ? 'bg-green-600/10 border border-green-600/30'
                          : 'bg-red-600/10 border border-red-600/30'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium ${
                          log.success ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {log.success ? '✓ 送信成功' : '✗ 送信失敗'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(log.triggeredAt).toLocaleString('ja-JP')}
                        </span>
                      </div>
                      <div className="text-sm text-gray-300">
                        チャネル: {log.channel === 'in_app' ? 'アプリ内' : 'Web Push'}
                      </div>
                      <div className="text-sm text-gray-300">
                        一致スコア: {(log.matchScore * 100).toFixed(1)}%
                      </div>
                      {log.errorMessage && (
                        <div className="text-xs text-red-400 mt-1">
                          {log.errorMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
    </div>
  );
}
