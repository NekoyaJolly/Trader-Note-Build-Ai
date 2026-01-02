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
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import TimeframePicker, { Timeframe } from "@/components/TimeframePicker";
import {
  fetchUserSettings,
  saveUserSettings,
  resetUserSettings,
  UserSettings,
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
    secondary: Timeframe[];
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
      secondary: ["4h", "1d"],
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
            secondary: data.timeframes.secondary as Timeframe[],
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
          secondary: settings.timeframes.secondary as SettingsTimeframe[],
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
          secondary: data.timeframes.secondary as Timeframe[],
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
          <CardDescription>一致通知の条件を設定します</CardDescription>
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
            min={50}
            max={95}
            step={5}
            label="スコア閾値"
            description="この値以上の一致度で通知"
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
              サブ時間足（複数選択可）
            </label>
            <TimeframePicker
              timeframes={["15m", "30m", "1h", "4h", "1d", "1w"]}
              value={settings.timeframes.secondary[0] || "4h"}
              onChange={(tf) => {
                const current = settings.timeframes.secondary;
                const updated = current.includes(tf)
                  ? current.filter((t) => t !== tf)
                  : [...current, tf];
                updateSettings("timeframes", { secondary: updated });
              }}
              variant="pills"
            />
            <p className="text-xs text-gray-500 mt-2">
              選択中: {settings.timeframes.secondary.join(", ") || "なし"}
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
