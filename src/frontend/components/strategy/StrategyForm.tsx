/**
 * ストラテジーフォームコンポーネント
 * 
 * 目的:
 * - ストラテジーの作成・編集フォーム
 * - 条件ビルダー、イグジット設定、基本情報を統合
 */

"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ConditionBuilder from "./ConditionBuilder";
import type {
  Strategy,
  CreateStrategyRequest,
  UpdateStrategyRequest,
  ConditionGroup,
  ExitSettings,
  TradeSide,
  SupportedSymbol,
  EntryTiming,
  SUPPORTED_SYMBOLS,
  SYMBOL_INFO,
} from "@/types/strategy";
import type { IndicatorMetadata } from "@/types/indicator";
import {
  createStrategy,
  updateStrategy,
  fetchIndicatorMetadata,
} from "@/lib/api";

// ============================================
// 定数
// ============================================

const _SUPPORTED_SYMBOLS: SupportedSymbol[] = [
  'USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY',
  'EURUSD', 'GBPUSD', 'AUDUSD', 'XAUUSD',
];

const _SYMBOL_INFO: Record<SupportedSymbol, { label: string; category: string }> = {
  USDJPY: { label: 'USD/JPY', category: 'JPYペア' },
  EURJPY: { label: 'EUR/JPY', category: 'JPYペア' },
  GBPJPY: { label: 'GBP/JPY', category: 'JPYペア' },
  AUDJPY: { label: 'AUD/JPY', category: 'JPYペア' },
  EURUSD: { label: 'EUR/USD', category: 'USDペア' },
  GBPUSD: { label: 'GBP/USD', category: 'USDペア' },
  AUDUSD: { label: 'AUD/USD', category: 'USDペア' },
  XAUUSD: { label: 'XAU/USD (GOLD)', category: '貴金属' },
};

// ============================================
// Props
// ============================================

interface StrategyFormProps {
  /** 編集対象のストラテジー（新規作成時はundefined） */
  strategy?: Strategy;
  /** 保存成功時のコールバック */
  onSaved?: (strategy: Strategy) => void;
  /** キャンセル時のコールバック */
  onCancel?: () => void;
}

// ============================================
// デフォルト値
// ============================================

const createDefaultConditionGroup = (): ConditionGroup => ({
  groupId: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
  operator: 'AND',
  conditions: [
    {
      conditionId: `cond_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      indicatorId: 'rsi',
      params: { period: 14 },
      field: 'value',
      operator: '<',
      compareTarget: { type: 'fixed', value: 30 },
    },
  ],
});

const createDefaultExitSettings = (): ExitSettings => ({
  takeProfit: { value: 1.0, unit: 'percent' },
  stopLoss: { value: 0.5, unit: 'percent' },
  maxHoldingMinutes: undefined,
});

// ============================================
// コンポーネント
// ============================================

export default function StrategyForm({
  strategy,
  onSaved,
  onCancel,
}: StrategyFormProps) {
  const router = useRouter();
  const isEditMode = !!strategy;

  // フォーム状態
  const [name, setName] = useState(strategy?.name || "");
  const [description, setDescription] = useState(strategy?.description || "");
  const [symbol, setSymbol] = useState<SupportedSymbol>(
    (strategy?.symbol as SupportedSymbol) || "USDJPY"
  );
  const [side, setSide] = useState<TradeSide>(strategy?.side || "buy");
  const [entryConditions, setEntryConditions] = useState<ConditionGroup>(
    (strategy?.currentVersion?.entryConditions as ConditionGroup) || createDefaultConditionGroup()
  );
  const [exitSettings, setExitSettings] = useState<ExitSettings>(
    (strategy?.currentVersion?.exitSettings as ExitSettings) || createDefaultExitSettings()
  );
  const [entryTiming, setEntryTiming] = useState<EntryTiming>(
    (strategy?.currentVersion?.entryTiming as EntryTiming) || "next_open"
  );
  const [tags, setTags] = useState<string[]>(strategy?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [changeNote, setChangeNote] = useState("");

  // UI状態
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indicatorMetadata, setIndicatorMetadata] = useState<IndicatorMetadata[]>([]);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);

  // インジケーターメタデータを取得
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        const data = await fetchIndicatorMetadata();
        setIndicatorMetadata(data.indicators);
      } catch (err) {
        console.error("インジケーターメタデータの取得に失敗:", err);
        setError("インジケーター情報の取得に失敗しました");
      } finally {
        setIsLoadingMetadata(false);
      }
    };
    loadMetadata();
  }, []);

  // タグ追加
  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  // タグ削除
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  // フォーム送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // バリデーション
    if (!name.trim()) {
      setError("ストラテジー名を入力してください");
      return;
    }

    setIsSubmitting(true);

    try {
      let savedStrategy: Strategy;

      if (isEditMode && strategy) {
        // 更新
        const request: UpdateStrategyRequest = {
          name: name.trim(),
          description: description.trim() || undefined,
          symbol,
          side,
          entryConditions,
          exitSettings,
          entryTiming,
          tags,
          changeNote: changeNote.trim() || undefined,
        };
        savedStrategy = await updateStrategy(strategy.id, request);
      } else {
        // 新規作成
        const request: CreateStrategyRequest = {
          name: name.trim(),
          description: description.trim() || undefined,
          symbol,
          side,
          entryConditions,
          exitSettings,
          entryTiming,
          tags,
        };
        savedStrategy = await createStrategy(request);
      }

      onSaved?.(savedStrategy);
      router.push(`/strategies/${savedStrategy.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存に失敗しました";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingMetadata) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-gray-400">読み込み中...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* エラー表示 */}
      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300">
          {error}
        </div>
      )}

      {/* 基本情報 */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-gray-200 mb-4">基本情報</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ストラテジー名 */}
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-400 mb-1">
              ストラテジー名 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              className="w-full px-4 py-2 rounded-lg bg-slate-700 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: RSI逆張り + MACD確認"
              required
            />
          </div>

          {/* シンボル */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              シンボル <span className="text-red-400">*</span>
            </label>
            <select
              className="w-full px-4 py-2 rounded-lg bg-slate-700 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value as SupportedSymbol)}
            >
              {_SUPPORTED_SYMBOLS.map((sym) => (
                <option key={sym} value={sym}>
                  {_SYMBOL_INFO[sym].label} ({_SYMBOL_INFO[sym].category})
                </option>
              ))}
            </select>
          </div>

          {/* 売買方向 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              売買方向 <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                  side === "buy"
                    ? "bg-green-600 border-green-500 text-white"
                    : "bg-slate-700 border-slate-600 text-gray-400 hover:border-green-500"
                }`}
                onClick={() => setSide("buy")}
              >
                買い (Long)
              </button>
              <button
                type="button"
                className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                  side === "sell"
                    ? "bg-red-600 border-red-500 text-white"
                    : "bg-slate-700 border-slate-600 text-gray-400 hover:border-red-500"
                }`}
                onClick={() => setSide("sell")}
              >
                売り (Short)
              </button>
            </div>
          </div>

          {/* 説明 */}
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-400 mb-1">説明</label>
            <textarea
              className="w-full px-4 py-2 rounded-lg bg-slate-700 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none resize-none"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ストラテジーの説明を入力（任意）"
            />
          </div>

          {/* タグ */}
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-400 mb-1">タグ</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-600 rounded text-sm text-gray-300"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="text-gray-400 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 px-3 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                placeholder="タグを入力してEnter"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-gray-200 rounded text-sm"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* エントリー条件 */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-gray-200 mb-4">エントリー条件</h3>
        <ConditionBuilder
          value={entryConditions}
          onChange={setEntryConditions}
          indicatorMetadata={indicatorMetadata}
        />
      </div>

      {/* イグジット設定 */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-gray-200 mb-4">イグジット設定</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 利確（Take Profit） */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">利確 (TP)</label>
            <div className="flex gap-2">
              <input
                type="number"
                className="flex-1 px-3 py-2 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
                value={exitSettings.takeProfit.value}
                onChange={(e) =>
                  setExitSettings({
                    ...exitSettings,
                    takeProfit: { ...exitSettings.takeProfit, value: parseFloat(e.target.value) || 0 },
                  })
                }
                step="0.1"
                min="0"
              />
              <select
                className="px-3 py-2 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
                value={exitSettings.takeProfit.unit}
                onChange={(e) =>
                  setExitSettings({
                    ...exitSettings,
                    takeProfit: { ...exitSettings.takeProfit, unit: e.target.value as "percent" | "pips" },
                  })
                }
              >
                <option value="percent">%</option>
                <option value="pips">Pips</option>
              </select>
            </div>
          </div>

          {/* 損切（Stop Loss） */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">損切 (SL)</label>
            <div className="flex gap-2">
              <input
                type="number"
                className="flex-1 px-3 py-2 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
                value={exitSettings.stopLoss.value}
                onChange={(e) =>
                  setExitSettings({
                    ...exitSettings,
                    stopLoss: { ...exitSettings.stopLoss, value: parseFloat(e.target.value) || 0 },
                  })
                }
                step="0.1"
                min="0"
              />
              <select
                className="px-3 py-2 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
                value={exitSettings.stopLoss.unit}
                onChange={(e) =>
                  setExitSettings({
                    ...exitSettings,
                    stopLoss: { ...exitSettings.stopLoss, unit: e.target.value as "percent" | "pips" },
                  })
                }
              >
                <option value="percent">%</option>
                <option value="pips">Pips</option>
              </select>
            </div>
          </div>

          {/* 最大保有時間 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">最大保有時間（分）</label>
            <input
              type="number"
              className="w-full px-3 py-2 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
              value={exitSettings.maxHoldingMinutes || ""}
              onChange={(e) =>
                setExitSettings({
                  ...exitSettings,
                  maxHoldingMinutes: e.target.value ? parseInt(e.target.value, 10) : undefined,
                })
              }
              placeholder="未設定（タイムアウトなし）"
              min="1"
            />
          </div>
        </div>

        {/* エントリータイミング */}
        <div className="mt-4">
          <label className="block text-sm text-gray-400 mb-1">エントリータイミング</label>
          <select
            className="px-4 py-2 rounded bg-slate-700 text-gray-200 border border-slate-600"
            value={entryTiming}
            onChange={(e) => setEntryTiming(e.target.value as EntryTiming)}
          >
            <option value="next_open">次足始値</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            条件成立後、次のローソク足の始値でエントリーします
          </p>
        </div>
      </div>

      {/* 編集時の変更メモ */}
      {isEditMode && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h3 className="text-lg font-semibold text-gray-200 mb-4">変更メモ</h3>
          <input
            type="text"
            className="w-full px-4 py-2 rounded-lg bg-slate-700 text-gray-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="変更内容のメモ（任意）"
          />
          <p className="text-xs text-gray-500 mt-1">
            保存すると新しいバージョンとして記録されます
          </p>
        </div>
      )}

      {/* アクションボタン */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => onCancel?.() || router.back()}
          className="px-6 py-2 bg-slate-600 hover:bg-slate-500 text-gray-200 rounded-lg transition-colors"
          disabled={isSubmitting}
        >
          キャンセル
        </button>
        <button
          type="submit"
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isSubmitting}
        >
          {isSubmitting ? "保存中..." : isEditMode ? "更新する" : "作成する"}
        </button>
      </div>
    </form>
  );
}
