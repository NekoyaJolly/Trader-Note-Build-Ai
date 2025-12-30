/**
 * インジケーター設定モーダル
 * 
 * 目的:
 * - サイドバーから選択されたインジケーターのパラメータを入力・保存
 * - 極小モーダルでシンプルなUXを提供
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import type { IndicatorMetadata, IndicatorParams, IndicatorConfig } from "@/types/indicator";

interface IndicatorConfigModalProps {
  // 選択されたインジケーターのメタデータ
  indicator: IndicatorMetadata;
  // 既存の設定（編集時）
  existingConfig?: IndicatorConfig;
  // 保存時のコールバック
  onSave: (params: IndicatorParams, label?: string) => Promise<void>;
  // 閉じる時のコールバック
  onClose: () => void;
  // 削除時のコールバック（既存設定の場合）
  onDelete?: () => Promise<void>;
}

/**
 * パラメータ入力フィールドの設定
 */
interface ParamFieldConfig {
  key: keyof IndicatorParams;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * インジケーターIDからパラメータフィールド設定を取得
 */
function getParamFields(indicatorId: string): ParamFieldConfig[] {
  switch (indicatorId) {
    case 'rsi':
    case 'sma':
    case 'ema':
    case 'dema':
    case 'tema':
    case 'atr':
    case 'williamsR':
    case 'roc':
    case 'mfi':
    case 'cmf':
    case 'aroon':
    case 'cci':
      return [{ key: 'period', label: '期間', min: 1, max: 500 }];
    case 'macd':
      return [
        { key: 'fastPeriod', label: '短期EMA', min: 1, max: 100 },
        { key: 'slowPeriod', label: '長期EMA', min: 1, max: 100 },
        { key: 'signalPeriod', label: 'シグナル', min: 1, max: 100 },
      ];
    case 'stochastic':
      return [
        { key: 'kPeriod', label: '%K期間', min: 1, max: 100 },
        { key: 'dPeriod', label: '%D期間', min: 1, max: 100 },
      ];
    case 'bb':
    case 'kc':
      // BB/KCの標準偏差はindicatortsライブラリの制約により2固定
      return [
        { key: 'period', label: '期間', min: 1, max: 100 },
      ];
    case 'psar':
      return [
        { key: 'step', label: 'ステップ', min: 0.01, max: 0.5, step: 0.01 },
        { key: 'maxStep', label: '最大ステップ', min: 0.1, max: 1, step: 0.01 },
      ];
    case 'ichimoku':
      return [
        { key: 'conversionPeriod', label: '転換線', min: 1, max: 100 },
        { key: 'basePeriod', label: '基準線', min: 1, max: 100 },
        { key: 'spanBPeriod', label: '先行スパンB', min: 1, max: 200 },
        { key: 'displacement', label: '遅行スパン', min: 1, max: 100 },
      ];
    case 'obv':
    case 'vwap':
      return []; // パラメータなし
    default:
      return [{ key: 'period', label: '期間', min: 1, max: 500 }];
  }
}

export default function IndicatorConfigModal({
  indicator,
  existingConfig,
  onSave,
  onClose,
  onDelete,
}: IndicatorConfigModalProps) {
  // パラメータの状態
  const [params, setParams] = useState<IndicatorParams>(
    existingConfig?.params || indicator.defaultParams
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // パラメータフィールド設定
  const paramFields = getParamFields(indicator.id);

  // パラメータ変更ハンドラ
  const handleParamChange = (key: keyof IndicatorParams, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  // 保存ハンドラ
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(params);
    } finally {
      setIsSaving(false);
    }
  };

  // 削除ハンドラ
  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  // ESCキーで閉じる
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    // オーバーレイ
    <div 
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      {/* モーダル本体 - 極小 */}
      <div 
        className="bg-slate-800 border border-slate-700 rounded-xl p-4 w-72 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white truncate">
            {indicator.displayName}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* パラメータ入力 */}
        {paramFields.length > 0 ? (
          <div className="space-y-3 mb-4">
            {paramFields.map(field => (
              <div key={field.key} className="flex items-center gap-2">
                <label className="text-xs text-gray-400 w-20 flex-shrink-0">
                  {field.label}
                </label>
                <input
                  type="number"
                  value={params[field.key] ?? ''}
                  onChange={e => handleParamChange(field.key, parseFloat(e.target.value) || 0)}
                  min={field.min}
                  max={field.max}
                  step={field.step || 1}
                  className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:border-pink-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 mb-4">
            このインジケーターにはパラメータ設定がありません
          </p>
        )}

        {/* ボタン */}
        <div className="flex gap-2">
          {existingConfig && onDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex-1 text-red-400 border-red-500/50 hover:bg-red-500/10"
            >
              {isDeleting ? '削除中...' : '削除'}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600"
          >
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  );
}
