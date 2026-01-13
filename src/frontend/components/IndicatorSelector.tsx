'use client';

/**
 * インジケーター選択コンポーネント
 * 
 * チャートヘッダーに配置し、ユーザーがインジケーターを選択できるUIを提供
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  INDICATOR_DEFINITIONS,
  getAllCategories,
  CATEGORY_LABELS,
  getIndicatorsByCategory,
  type IndicatorDefinition,
  type IndicatorCategory,
} from '@/lib/indicatorDefinitions';
import { IndicatorSettingsModal } from './IndicatorSettingsModal';

/**
 * インジケーター表示設定
 */
export interface IndicatorDisplaySettings {
  /** 線の色（HEX形式） */
  color: string;
  /** 線の太さ（1-5） */
  lineWidth: number;
  /** 表示ラベル（空の場合はデフォルト名を使用） */
  label?: string;
}

/**
 * 選択されたインジケーター設定
 */
export interface SelectedIndicator {
  id: string;
  params: Record<string, number>;
  /** 表示設定（オプション、未指定の場合は定義のデフォルト値を使用） */
  displaySettings?: IndicatorDisplaySettings;
}

interface IndicatorSelectorProps {
  /** 選択されたインジケーター一覧 */
  selectedIndicators: SelectedIndicator[];
  /** 選択変更時のコールバック */
  onSelectionChange: (indicators: SelectedIndicator[]) => void;
  /** コンパクト表示モード */
  compact?: boolean;
}

export function IndicatorSelector({
  selectedIndicators,
  onSelectionChange,
  compact = false,
}: IndicatorSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingIndicatorId, setEditingIndicatorId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // 画面サイズを監視
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  /**
   * インジケーターの選択/解除
   */
  const toggleIndicator = useCallback(
    (indicatorId: string) => {
      const isSelected = selectedIndicators.some((ind) => ind.id === indicatorId);
      const definition = INDICATOR_DEFINITIONS.find((ind) => ind.id === indicatorId);
      
      if (!definition) {
        return;
      }

      if (isSelected) {
        // 選択解除
        onSelectionChange(selectedIndicators.filter((ind) => ind.id !== indicatorId));
      } else {
        // 選択追加（デフォルトパラメータと表示設定で）
        onSelectionChange([
          ...selectedIndicators,
          {
            id: indicatorId,
            params: { ...definition.defaultParams },
            displaySettings: {
              color: definition.defaultDisplay.color,
              lineWidth: definition.defaultDisplay.lineWidth,
            },
          },
        ]);
      }
    },
    [selectedIndicators, onSelectionChange]
  );

  /**
   * パラメータ更新
   */
  const updateParams = useCallback(
    (indicatorId: string, params: Record<string, number>) => {
      onSelectionChange(
        selectedIndicators.map((ind) =>
          ind.id === indicatorId ? { ...ind, params } : ind
        )
      );
    },
    [selectedIndicators, onSelectionChange]
  );

  /**
   * 表示設定更新
   */
  const updateDisplaySettings = useCallback(
    (indicatorId: string, displaySettings: IndicatorDisplaySettings) => {
      onSelectionChange(
        selectedIndicators.map((ind) =>
          ind.id === indicatorId ? { ...ind, displaySettings } : ind
        )
      );
    },
    [selectedIndicators, onSelectionChange]
  );

  /**
   * インジケーター削除
   */
  const removeIndicator = useCallback(
    (indicatorId: string) => {
      onSelectionChange(selectedIndicators.filter((ind) => ind.id !== indicatorId));
      setEditingIndicatorId(null);
    },
    [selectedIndicators, onSelectionChange]
  );

  /**
   * インジケーター設定保存
   */
  const handleSaveSettings = useCallback(
    (indicatorId: string, params: Record<string, number>, displaySettings: IndicatorDisplaySettings) => {
      onSelectionChange(
        selectedIndicators.map((ind) =>
          ind.id === indicatorId
            ? { ...ind, params, displaySettings }
            : ind
        )
      );
      setEditingIndicatorId(null);
    },
    [selectedIndicators, onSelectionChange]
  );

  if (compact) {
    // コンパクト表示：ドロップダウンボタンのみ
    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded border border-gray-600 hover:border-gray-500 font-semibold flex items-center gap-2"
        >
          <span>📈 インジケーター</span>
          {selectedIndicators.length > 0 && (
            <span className="bg-cyan-500 text-white text-xs px-1.5 py-0.5 rounded">
              {selectedIndicators.length}
            </span>
          )}
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            />
            <div className={`${isMobile ? 'fixed bottom-16 left-0 right-0 mb-2 mx-2' : 'absolute top-full left-0 mt-1'} bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 max-h-[600px] overflow-y-auto min-w-[300px] ${isMobile ? 'w-auto' : 'w-[90vw] max-w-[500px]'} ${isMobile ? '' : 'resize'} ${isMobile ? '' : 'overflow-auto'}`}>
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white">インジケーター設定</h3>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="text-gray-400 hover:text-white text-lg"
                  >
                    ×
                  </button>
                </div>
                {getAllCategories().map((category) => (
                  <CategorySection
                    key={category}
                    category={category}
                    indicators={getIndicatorsByCategory(category)}
                    selectedIndicators={selectedIndicators}
                    onToggle={toggleIndicator}
                    onEdit={setEditingIndicatorId}
                    editingId={editingIndicatorId}
                    onRemove={removeIndicator}
                  />
                ))}
              </div>
            </div>
            
            {/* 設定モーダル */}
            {editingIndicatorId && (() => {
              const indicator = INDICATOR_DEFINITIONS.find((ind) => ind.id === editingIndicatorId);
              const selected = selectedIndicators.find((sel) => sel.id === editingIndicatorId);
              if (!indicator) return null;
              
              return (
                <IndicatorSettingsModal
                  indicator={indicator}
                  params={selected?.params || indicator.defaultParams}
                  displaySettings={selected?.displaySettings || indicator.defaultDisplay}
                  onSave={(params, displaySettings) => handleSaveSettings(editingIndicatorId, params, displaySettings)}
                  onClose={() => setEditingIndicatorId(null)}
                />
              );
            })()}
          </>
        )}
      </div>
    );
  }

  // フル表示：常に表示
  return (
    <>
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-3 max-h-[400px] overflow-y-auto">
        {getAllCategories().map((category) => (
          <CategorySection
            key={category}
            category={category}
            indicators={getIndicatorsByCategory(category)}
            selectedIndicators={selectedIndicators}
            onToggle={toggleIndicator}
            onEdit={setEditingIndicatorId}
            editingId={editingIndicatorId}
            onRemove={removeIndicator}
          />
        ))}
      </div>
      
      {/* 設定モーダル */}
      {editingIndicatorId && (() => {
        const indicator = INDICATOR_DEFINITIONS.find((ind) => ind.id === editingIndicatorId);
        const selected = selectedIndicators.find((sel) => sel.id === editingIndicatorId);
        if (!indicator) return null;
        
        return (
          <IndicatorSettingsModal
            indicator={indicator}
            params={selected?.params || indicator.defaultParams}
            displaySettings={selected?.displaySettings || indicator.defaultDisplay}
            onSave={(params, displaySettings) => handleSaveSettings(editingIndicatorId, params, displaySettings)}
            onClose={() => setEditingIndicatorId(null)}
          />
        );
      })()}
    </>
  );
}

/**
 * カテゴリ別セクション
 */
interface CategorySectionProps {
  category: IndicatorCategory;
  indicators: IndicatorDefinition[];
  selectedIndicators: SelectedIndicator[];
  onToggle: (id: string) => void;
  onEdit: (id: string | null) => void;
  editingId: string | null;
  onRemove: (id: string) => void;
}

function CategorySection({
  category,
  indicators,
  selectedIndicators,
  onToggle,
  onEdit,
  editingId,
  onRemove,
}: CategorySectionProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        {CATEGORY_LABELS[category]}
      </h3>
      <div className="space-y-1">
        {indicators.map((indicator) => {
          const isSelected = selectedIndicators.some((sel) => sel.id === indicator.id);

          return (
            <div key={indicator.id} className="group/item hover:bg-gray-700/30 rounded px-1 py-0.5 transition-colors">
              <div className="flex items-center gap-2 w-full overflow-hidden">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(indicator.id)}
                  className="w-4 h-4 text-cyan-500 bg-gray-700 border-gray-600 rounded focus:ring-cyan-500 flex-shrink-0"
                />
                <label
                  className="text-sm text-gray-300 cursor-pointer truncate min-w-0"
                  onClick={() => onToggle(indicator.id)}
                >
                  {indicator.name}
                </label>
                {isSelected && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onEdit(indicator.id);
                      }}
                      className="text-lg text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded hover:bg-cyan-500/20 transition-all flex-shrink-0"
                      title="設定"
                      type="button"
                    >
                      ⚙️
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onRemove(indicator.id);
                      }}
                      className="text-sm text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/20 transition-all flex-shrink-0"
                      title="削除"
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

