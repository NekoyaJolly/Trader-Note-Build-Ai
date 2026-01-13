'use client';

/**
 * インジケーター設定モーダル（IndicatorSelector用）
 * 
 * 目的:
 * - IndicatorSelectorから呼び出される設定モーダル
 * - パラメータ設定と表示設定（色、線の太さ、ラベル）を提供
 * - 「モーダルの中のモーダル」のような見た目を実現
 */

import React, { useState, useEffect } from 'react';
import type { IndicatorDefinition } from '@/lib/indicatorDefinitions';
import type { IndicatorDisplaySettings } from './IndicatorSelector';

interface IndicatorSettingsModalProps {
  /** インジケーター定義 */
  indicator: IndicatorDefinition;
  /** 現在のパラメータ */
  params: Record<string, number>;
  /** 現在の表示設定 */
  displaySettings?: IndicatorDisplaySettings;
  /** 保存時のコールバック */
  onSave: (params: Record<string, number>, displaySettings: IndicatorDisplaySettings) => void;
  /** 閉じる時のコールバック */
  onClose: () => void;
}

export function IndicatorSettingsModal({
  indicator,
  params: initialParams,
  displaySettings: initialDisplaySettings,
  onSave,
  onClose,
}: IndicatorSettingsModalProps) {
  const [params, setParams] = useState<Record<string, number>>(initialParams);
  const [displaySettings, setDisplaySettings] = useState<IndicatorDisplaySettings>(
    initialDisplaySettings || indicator.defaultDisplay
  );

  // パラメータ変更ハンドラ
  const handleParamChange = (key: string, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  // 表示設定変更ハンドラ
  const handleDisplaySettingChange = (key: keyof IndicatorDisplaySettings, value: string | number | undefined) => {
    setDisplaySettings(prev => ({ ...prev, [key]: value }));
  };

  // 保存ハンドラ
  const handleSave = () => {
    onSave(params, displaySettings);
    onClose();
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
    // オーバーレイ（親モーダル内に表示されるため、z-indexを高く設定）
    <div 
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
      onClick={onClose}
    >
      {/* モーダル本体 - 親モーダル内に表示されるため、サイズを調整 */}
      <div 
        className="bg-gray-800 border border-gray-600 rounded-lg p-4 w-[90vw] max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">
            {indicator.name} の設定
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg transition-colors"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {/* パラメータ設定 */}
          {Object.keys(indicator.defaultParams).length > 0 && (
            <div className="space-y-3 border-b border-gray-600 pb-4">
              <div className="text-xs font-semibold text-gray-300 mb-2">パラメータ</div>
              {Object.keys(indicator.defaultParams).map((paramKey) => (
                <div key={paramKey} className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 w-32 flex-shrink-0">
                    {indicator.paramDescriptions[paramKey] || paramKey}:
                  </label>
                  <input
                    type="number"
                    value={params[paramKey] ?? indicator.defaultParams[paramKey]}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      if (!isNaN(value)) {
                        handleParamChange(paramKey, value);
                      }
                    }}
                    className="flex-1 bg-gray-700 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:border-cyan-500 focus:outline-none"
                    step="any"
                  />
                </div>
              ))}
            </div>
          )}

          {/* 表示設定 */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-300 mb-2">表示設定</div>
            
            {/* 色設定 */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 w-32 flex-shrink-0">色:</label>
              <input
                type="color"
                value={displaySettings.color}
                onChange={(e) => handleDisplaySettingChange('color', e.target.value)}
                className="w-12 h-8 rounded border border-gray-600 bg-gray-700 cursor-pointer"
              />
              <input
                type="text"
                value={displaySettings.color}
                onChange={(e) => handleDisplaySettingChange('color', e.target.value)}
                className="flex-1 bg-gray-700 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:border-cyan-500 focus:outline-none font-mono"
                placeholder="#000000"
              />
            </div>
            
            {/* 線の太さ設定 */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 w-32 flex-shrink-0">線の太さ:</label>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={displaySettings.lineWidth}
                onChange={(e) => handleDisplaySettingChange('lineWidth', parseInt(e.target.value, 10))}
                className="flex-1 accent-cyan-500"
              />
              <span className="text-xs text-gray-400 w-12 text-right">
                {displaySettings.lineWidth}px
              </span>
            </div>
            
            {/* ラベル設定 */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 w-32 flex-shrink-0">ラベル:</label>
              <input
                type="text"
                value={displaySettings.label || ''}
                onChange={(e) => handleDisplaySettingChange('label', e.target.value || undefined)}
                className="flex-1 bg-gray-700 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:border-cyan-500 focus:outline-none"
                placeholder={indicator.name}
              />
            </div>
          </div>
        </div>

        {/* ボタン */}
        <div className="flex gap-2 mt-4 pt-4 border-t border-gray-600">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded border border-gray-600 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded border border-cyan-500 transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

