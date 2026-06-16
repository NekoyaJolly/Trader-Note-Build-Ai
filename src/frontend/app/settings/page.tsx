/**
 * 設定画面
 * /settings
 *
 * 機能:
 * - 通知設定（閾値、頻度）
 * - 時間足選択
 * - 表示設定
 * - データ管理
 */
"use client";

import { useState, useEffect } from "react";
import { Bell, BellOff, RefreshCw, Send } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import TimeframePicker, { Timeframe } from "@/components/TimeframePicker";
import { usePushNotification, type PushPermissionState, type PushServerStatus } from "@/lib/usePushNotification";
import {
  fetchUserSettings,
  saveUserSettings,
  resetUserSettings,
  SettingsTimeframe,
} from "@/lib/api";

// 設定データの型定義（API型とUI型の橋渡し）
interface Settings {
  // 通知設定
  notification: {
    enabled: boolean;
    scoreThreshold: number;
    maxPerDay: number;
  };
  // 時間足設定
  timeframes: {
    primary: Timeframe;
    secondary: Timeframe;
  };
  // 表示設定
  display: {
    darkMode: boolean;
    compactView: boolean;
    showAiSuggestions: boolean;
  };
}

/**
 * トグルスイッチコンポーネント
 */
function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-gradient-to-r from-pink-500 to-violet-500" : "bg-slate-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * スライダーコンポーネント
 */
function Slider({
  value,
  onChange,
  min,
  max,
  step,
  label,
  description,
  unit,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  description?: string;
  unit?: string;
}) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-medium text-white">{label}</div>
          {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
        </div>
        <span className="text-sm font-mono text-violet-400">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step || 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-4
                   [&::-webkit-slider-thumb]:h-4
                   [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-gradient-to-r
                   [&::-webkit-slider-thumb]:from-pink-500
                   [&::-webkit-slider-thumb]:to-violet-500
                   [&::-webkit-slider-thumb]:cursor-pointer
                   [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(236,72,153,0.5)]"
      />
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

type StatusTone = "success" | "warning" | "danger" | "muted";

/**
 * 設定画面内の小さな状態表示
 */
function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StatusTone;
}) {
  const toneClass = {
    success: "border-green-500/40 bg-green-500/10 text-green-300",
    warning: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
    danger: "border-red-500/40 bg-red-500/10 text-red-300",
    muted: "border-slate-600 bg-slate-900/60 text-gray-300",
  }[tone];

  return (
    <div className={`flex min-w-0 items-center justify-between rounded-lg border px-3 py-2 ${toneClass}`}>
      <span className="text-xs text-gray-400">{label}</span>
      <span className="ml-3 truncate text-sm font-semibold">{value}</span>
    </div>
  );
}

function permissionLabel(permission: PushPermissionState): string {
  switch (permission) {
    case "granted":
      return "許可済み";
    case "denied":
      return "ブロック";
    case "unsupported":
      return "非対応";
    case "default":
      return "未許可";
  }
}

function permissionTone(permission: PushPermissionState): StatusTone {
  switch (permission) {
    case "granted":
      return "success";
    case "denied":
    case "unsupported":
      return "danger";
    case "default":
      return "warning";
  }
}

function serverStatusLabel(
  serverStatus: PushServerStatus | null,
  isCheckingStatus: boolean
): string {
  if (isCheckingStatus) return "確認中";
  if (!serverStatus) return "未確認";
  if (!serverStatus.enabled) return "無効";
  return "有効";
}

function serverStatusTone(
  serverStatus: PushServerStatus | null,
  isCheckingStatus: boolean
): StatusTone {
  if (isCheckingStatus) return "muted";
  if (!serverStatus) return "warning";
  return serverStatus.enabled ? "success" : "danger";
}

/**
 * Web Push の購読状態をユーザーが確認・操作するパネル
 */
function PushSubscriptionControl() {
  const {
    permission,
    isSubscribed,
    isLoading,
    error,
    serverStatus,
    serverStatusError,
    isCheckingStatus,
    testMessage,
    isSupported,
    subscribe,
    unsubscribe,
    sendTestNotification,
    refreshStatus,
  } = usePushNotification();

  const canSubscribe =
    isSupported &&
    permission !== "denied" &&
    !isSubscribed &&
    serverStatus?.enabled !== false &&
    !isLoading;
  const canUnsubscribe = isSupported && isSubscribed && !isLoading;
  const canSendTest =
    isSupported &&
    isSubscribed &&
    serverStatus?.enabled !== false &&
    !isLoading;

  function handleSubscribe() {
    subscribe().catch((err) => {
      console.error("Push通知の購読開始に失敗しました:", err);
    });
  }

  function handleUnsubscribe() {
    unsubscribe().catch((err) => {
      console.error("Push通知の購読解除に失敗しました:", err);
    });
  }

  function handleSendTest() {
    sendTestNotification().catch((err) => {
      console.error("Push通知のテスト送信に失敗しました:", err);
    });
  }

  function handleRefreshStatus() {
    refreshStatus().catch((err) => {
      console.error("Push通知状態の再確認に失敗しました:", err);
    });
  }

  return (
    <div className="space-y-4 py-4">
      <div>
        <div className="text-sm font-medium text-white">Web Push 購読状態</div>
        <div className="text-xs text-gray-500 mt-0.5">
          この端末でブラウザ通知を受け取るかを管理します
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <StatusPill
          label="ブラウザ"
          value={permissionLabel(permission)}
          tone={permissionTone(permission)}
        />
        <StatusPill
          label="サーバー"
          value={serverStatusLabel(serverStatus, isCheckingStatus)}
          tone={serverStatusTone(serverStatus, isCheckingStatus)}
        />
        <StatusPill
          label="購読"
          value={isSubscribed ? "購読中" : "未購読"}
          tone={isSubscribed ? "success" : "muted"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {isSubscribed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUnsubscribe}
            disabled={!canUnsubscribe}
          >
            <BellOff />
            購読を解除
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handleSubscribe}
            disabled={!canSubscribe}
          >
            <Bell />
            購読する
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSendTest}
          disabled={!canSendTest}
        >
          <Send />
          テスト通知
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRefreshStatus}
          disabled={isCheckingStatus}
        >
          <RefreshCw className={isCheckingStatus ? "animate-spin" : ""} />
          状態更新
        </Button>
      </div>

      <div aria-live="polite" className="min-h-5 text-xs">
        {serverStatusError && (
          <span className="text-yellow-300">{serverStatusError}</span>
        )}
        {error && <span className="text-red-300">{error}</span>}
        {testMessage && <span className="text-green-300">{testMessage}</span>}
      </div>
    </div>
  );
}

/**
 * 設定ページコンポーネント
 */
export default function SettingsPage() {
  // 設定状態
  const [settings, setSettings] = useState<Settings>({
    notification: {
      enabled: true,
      scoreThreshold: 70,
      maxPerDay: 10,
    },
    timeframes: {
      primary: "1h",
      secondary: "4h",
    },
    display: {
      darkMode: true,
      compactView: false,
      showAiSuggestions: true,
    },
  });

  // 読み込み状態
  const [isLoading, setIsLoading] = useState(true);
  // 保存中状態
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // エラー状態
  const [error, setError] = useState<string | null>(null);

  /**
   * 初回読み込み時にAPIから設定を取得
   */
  useEffect(() => {
    async function loadSettings() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchUserSettings();
        // API型からUI型に変換
        setSettings({
          notification: data.notification,
          timeframes: {
            primary: data.timeframes.primary as Timeframe,
            secondary: data.timeframes.secondary as Timeframe,
          },
          display: data.display,
        });
      } catch (err) {
        console.error("設定の読み込みに失敗しました:", err);
        setError("設定の読み込みに失敗しました");
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  /**
   * 設定を更新
   */
  function updateSettings<K extends keyof Settings>(
    category: K,
    updates: Partial<Settings[K]>
  ) {
    setSettings((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        ...updates,
      },
    }));
    setSaveSuccess(false);
  }

  /**
   * 設定を保存
   */
  async function handleSave() {
    try {
      setIsSaving(true);
      setError(null);
      // API型に変換して送信
      await saveUserSettings({
        notification: settings.notification,
        timeframes: {
          primary: settings.timeframes.primary as SettingsTimeframe,
          secondary: settings.timeframes.secondary as SettingsTimeframe,
        },
        display: settings.display,
      });
      setSaveSuccess(true);
    } catch (err) {
      console.error("設定の保存に失敗しました:", err);
      setError("設定の保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 設定をリセット
   */
  async function handleReset() {
    if (!confirm("設定をデフォルトに戻しますか？")) {
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      const data = await resetUserSettings();
      // API型からUI型に変換
      setSettings({
        notification: data.notification,
        timeframes: {
          primary: data.timeframes.primary as Timeframe,
          secondary: data.timeframes.secondary as Timeframe,
        },
        display: data.display,
      });
      setSaveSuccess(true);
    } catch (err) {
      console.error("設定のリセットに失敗しました:", err);
      setError("設定のリセットに失敗しました");
    } finally {
      setIsSaving(false);
    }
  }

  // ローディング表示
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-400">設定を読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* ヘッダー */}
      <div>
        <h1 className="text-3xl font-bold text-white">設定</h1>
        <p className="text-gray-400 mt-1">アプリケーションの動作をカスタマイズ</p>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* 通知設定 */}
      <Card>
        <CardHeader>
          <CardTitle>通知設定</CardTitle>
          <CardDescription>
            主要な通知条件を保存します。詳細な上書きは通知粒度画面で管理します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 divide-y divide-slate-700">
          <Toggle
            checked={settings.notification.enabled}
            onChange={(checked) => updateSettings("notification", { enabled: checked })}
            label="通知を有効化"
            description="一致判定時にプッシュ通知を送信"
          />
          
          <Slider
            value={settings.notification.scoreThreshold}
            onChange={(value) => updateSettings("notification", { scoreThreshold: value })}
            min={70}
            max={95}
            step={5}
            label="スコア閾値"
            description="通知粒度基盤の実効下限は70%"
            unit="%"
          />
          
          <Slider
            value={settings.notification.maxPerDay}
            onChange={(value) => updateSettings("notification", { maxPerDay: value })}
            min={1}
            max={50}
            label="1日の最大通知数"
            description="過剰な通知を防止"
            unit="件"
          />

          <PushSubscriptionControl />
        </CardContent>
      </Card>

      {/* 時間足設定 */}
      <Card>
        <CardHeader>
          <CardTitle>時間足設定</CardTitle>
          <CardDescription>分析に使用する時間足を選択</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              メイン時間足
            </label>
            <TimeframePicker
              timeframes={["15m", "30m", "1h", "4h", "1d"]}
              value={settings.timeframes.primary}
              onChange={(tf) => updateSettings("timeframes", { primary: tf })}
              variant="tabs"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              サブ時間足
            </label>
            <TimeframePicker
              timeframes={["15m", "30m", "1h", "4h", "1d", "1w"]}
              value={settings.timeframes.secondary}
              onChange={(tf) => updateSettings("timeframes", { secondary: tf })}
              variant="pills"
            />
            <p className="text-xs text-gray-500 mt-2">
              選択中: {settings.timeframes.secondary || "なし"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 表示設定 */}
      <Card>
        <CardHeader>
          <CardTitle>表示設定</CardTitle>
          <CardDescription>UIの表示オプション</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 divide-y divide-slate-700">
          <Toggle
            checked={settings.display.darkMode}
            onChange={(checked) => updateSettings("display", { darkMode: checked })}
            label="ダークモード"
            description="目に優しいダークテーマ（推奨）"
          />
          
          <Toggle
            checked={settings.display.compactView}
            onChange={(checked) => updateSettings("display", { compactView: checked })}
            label="コンパクト表示"
            description="リストの表示密度を上げる"
          />
          
          <Toggle
            checked={settings.display.showAiSuggestions}
            onChange={(checked) => updateSettings("display", { showAiSuggestions: checked })}
            label="AI 提案を表示"
            description="トレードノートに AI の分析を表示"
          />
        </CardContent>
      </Card>

      {/* インジケータープロファイル */}
      <Card>
        <CardHeader>
          <CardTitle>インジケータープロファイル</CardTitle>
          <CardDescription>
            CSVインポート時に適用するインジケーターの組み合わせを管理
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-slate-900/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-white">プロファイル管理</h4>
                <p className="text-xs text-gray-500 mt-1">
                  複数のインジケーター設定を保存して、インポート時に選択できます
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = "/settings/profiles"}
              >
                管理画面へ →
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <span className="text-lg">🤖</span>
              <h5 className="text-white font-medium mt-1">AIに任せる</h5>
              <p className="text-gray-500 mt-0.5">12次元特徴量を自動計算</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <span className="text-lg">📊</span>
              <h5 className="text-white font-medium mt-1">プロファイルなし</h5>
              <p className="text-gray-500 mt-0.5">OHLCVデータのみ保存</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 通知粒度設定 (Phase β-2b) */}
      <Card>
        <CardHeader>
          <CardTitle>通知粒度</CardTitle>
          <CardDescription>
            ノートマッチ通知のしきい値・一致レベル・再通知頻度を調整
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-slate-900/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-white">通知粒度の管理</h4>
                <p className="text-xs text-gray-500 mt-1">
                  全体の既定と、ノート単位の上書きを管理できます
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = "/settings/notifications"}
              >
                管理画面へ →
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* cTrader アカウント管理 */}
      <Card>
        <CardHeader>
          <CardTitle>cTrader アカウント管理</CardTitle>
          <CardDescription>
            複数のcTraderアカウントを管理
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-slate-900/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-white">アカウント一覧</h4>
                <p className="text-xs text-gray-500 mt-1">
                  接続済みアカウントの確認・追加・削除ができます
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = "/settings/accounts"}
              >
                管理画面へ →
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* データ管理 */}
      <Card>
        <CardHeader>
          <CardTitle>データ管理</CardTitle>
          <CardDescription>インポート・エクスポート・削除</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline">
              データをエクスポート
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={isSaving}>
              設定をリセット
            </Button>
            <Button variant="destructive">
              全データを削除
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            ※ データ削除は取り消せません。事前にエクスポートすることをお勧めします。
          </p>
        </CardContent>
      </Card>

      {/* 保存ボタン */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-700">
        {saveSuccess && (
          <span className="text-sm text-green-400">✓ 設定を保存しました</span>
        )}
        <div className="flex-1" />
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="min-w-32"
        >
          {isSaving ? "保存中..." : "設定を保存"}
        </Button>
      </div>
    </div>
  );
}
