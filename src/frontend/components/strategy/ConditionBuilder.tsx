/**
 * 条件ビルダーコンポーネント
 * 
 * 目的:
 * - インジケーター条件をフォーム入力式で設定
 * - AND/OR/NOT の論理演算子で条件を組み合わせ
 * - 再帰的な条件グループ構造をサポート
 */

"use client";

import React, { useState, useCallback, useEffect } from "react";
import type {
  IndicatorCondition,
  ConditionGroup,
  LogicalOperator,
  ComparisonOperator,
  IndicatorField,
  CompareTarget,
  isIndicatorCondition,
  isConditionGroup,
  generateConditionId,
  generateGroupId,
  createDefaultCondition,
  INDICATOR_FIELDS,
  FIELD_LABELS,
  COMPARISON_OPERATOR_INFO,
  LOGICAL_OPERATOR_INFO,
} from "@/types/strategy";
import type { IndicatorId, IndicatorParams, IndicatorMetadata } from "@/types/indicator";

// ============================================
// 型定義
// ============================================

interface ConditionBuilderProps {
  /** 現在の条件グループ */
  value: ConditionGroup;
  /** 条件変更時のコールバック */
  onChange: (value: ConditionGroup) => void;
  /** インジケーターメタデータ（利用可能なインジケーター一覧） */
  indicatorMetadata: IndicatorMetadata[];
  /** 読み取り専用モード */
  readOnly?: boolean;
}

interface SingleConditionProps {
  /** 単一条件 */
  condition: IndicatorCondition;
  /** 条件変更時のコールバック */
  onChange: (condition: IndicatorCondition) => void;
  /** 削除コールバック */
  onRemove: () => void;
  /** インジケーターメタデータ */
  indicatorMetadata: IndicatorMetadata[];
  /** 読み取り専用モード */
  readOnly?: boolean;
  /** 削除可能かどうか */
  canRemove?: boolean;
}

// ============================================
// ユーティリティ関数（型ファイルからインポートできない場合のフォールバック）
// ============================================

const _generateConditionId = (): string => {
  return `cond_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

const _generateGroupId = (): string => {
  return `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

const _createDefaultCondition = (): IndicatorCondition => ({
  conditionId: _generateConditionId(),
  indicatorId: 'rsi',
  params: { period: 14 },
  field: 'value',
  operator: '<',
  compareTarget: { type: 'fixed', value: 30 },
});

const _isIndicatorCondition = (
  condition: IndicatorCondition | ConditionGroup
): condition is IndicatorCondition => {
  return 'indicatorId' in condition;
};

const _isConditionGroup = (
  condition: IndicatorCondition | ConditionGroup
): condition is ConditionGroup => {
  return 'conditions' in condition;
};

// インジケーターごとの利用可能フィールド
const _INDICATOR_FIELDS: Record<IndicatorId, IndicatorField[]> = {
  rsi: ['value'],
  sma: ['value'],
  ema: ['value'],
  macd: ['macd', 'signal', 'histogram'],
  bb: ['upper', 'middle', 'lower'],
  atr: ['value'],
  stochastic: ['k', 'd'],
  obv: ['value'],
  vwap: ['value'],
  williamsR: ['value'],
  cci: ['value'],
  aroon: ['value'],
  roc: ['value'],
  mfi: ['value'],
  cmf: ['value'],
  dema: ['value'],
  tema: ['value'],
  kc: ['upper', 'middle', 'lower'],
  psar: ['value'],
  ichimoku: ['tenkan', 'kijun', 'senkouA', 'senkouB', 'chikou'],
};

const _FIELD_LABELS: Record<IndicatorField, string> = {
  value: '値',
  macd: 'MACD線',
  signal: 'シグナル線',
  histogram: 'ヒストグラム',
  upper: '上バンド',
  middle: '中央線',
  lower: '下バンド',
  k: '%K',
  d: '%D',
  tenkan: '転換線',
  kijun: '基準線',
  senkouA: '先行スパンA',
  senkouB: '先行スパンB',
  chikou: '遅行スパン',
};

const _COMPARISON_OPERATOR_INFO: Record<ComparisonOperator, { label: string; description: string }> = {
  '<': { label: '<', description: 'より小さい' },
  '<=': { label: '≤', description: '以下' },
  '=': { label: '=', description: '等しい' },
  '>=': { label: '≥', description: '以上' },
  '>': { label: '>', description: 'より大きい' },
  'cross_above': { label: '↑クロス', description: '上抜け' },
  'cross_below': { label: '↓クロス', description: '下抜け' },
};

const _LOGICAL_OPERATOR_INFO: Record<LogicalOperator, { label: string; description: string }> = {
  AND: { label: 'かつ', description: 'すべての条件を満たす' },
  OR: { label: 'または', description: 'いずれかの条件を満たす' },
  NOT: { label: '〜でない', description: '条件を満たさない' },
  IF_THEN: { label: 'IF→THEN', description: 'IF条件成立後にTHEN条件を評価' },
  SEQUENCE: { label: '順序', description: '条件が順番に成立する' },
};

// ============================================
// 単一条件コンポーネント
// ============================================

function SingleCondition({
  condition,
  onChange,
  onRemove,
  indicatorMetadata,
  readOnly = false,
  canRemove = true,
}: SingleConditionProps) {
  // 選択中のインジケーターで利用可能なフィールドを取得
  const availableFields = _INDICATOR_FIELDS[condition.indicatorId] || ['value'];
  const selectedIndicator = indicatorMetadata.find(m => m.id === condition.indicatorId);

  // インジケーター変更時
  const handleIndicatorChange = (indicatorId: IndicatorId) => {
    const meta = indicatorMetadata.find(m => m.id === indicatorId);
    const fields = _INDICATOR_FIELDS[indicatorId] || ['value'];
    onChange({
      ...condition,
      indicatorId,
      params: meta?.defaultParams || { period: 14 },
      field: fields[0], // 最初のフィールドをデフォルト選択
    });
  };

  // パラメータ変更時
  const handleParamChange = (key: keyof IndicatorParams, value: number) => {
    onChange({
      ...condition,
      params: { ...condition.params, [key]: value },
    });
  };

  // 比較対象の値変更時
  const handleCompareValueChange = (value: number) => {
    if (condition.compareTarget.type === 'fixed') {
      onChange({
        ...condition,
        compareTarget: { type: 'fixed', value },
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-800 rounded-lg border border-slate-700">
      {/* インジケーター選択 */}
      <select
        className="px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm min-w-[120px]"
        value={condition.indicatorId}
        onChange={(e) => handleIndicatorChange(e.target.value as IndicatorId)}
        disabled={readOnly}
      >
        {indicatorMetadata.map((meta) => (
          <option key={meta.id} value={meta.id}>
            {meta.displayName}
          </option>
        ))}
      </select>

      {/* 期間パラメータ（該当する場合） */}
      {selectedIndicator?.defaultParams?.period !== undefined && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400">期間</span>
          <input
            type="number"
            className="w-16 px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
            value={condition.params.period || 14}
            onChange={(e) => handleParamChange('period', parseInt(e.target.value, 10))}
            min={1}
            max={500}
            disabled={readOnly}
          />
        </div>
      )}

      {/* フィールド選択（複数出力があるインジケーターの場合） */}
      {availableFields.length > 1 && (
        <select
          className="px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
          value={condition.field}
          onChange={(e) => onChange({ ...condition, field: e.target.value as IndicatorField })}
          disabled={readOnly}
        >
          {availableFields.map((field) => (
            <option key={field} value={field}>
              {_FIELD_LABELS[field]}
            </option>
          ))}
        </select>
      )}

      {/* 比較演算子 */}
      <select
        className="px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as ComparisonOperator })}
        disabled={readOnly}
      >
        {Object.entries(_COMPARISON_OPERATOR_INFO).map(([op, info]) => (
          <option key={op} value={op}>
            {info.label}
          </option>
        ))}
      </select>

      {/* 比較対象の値 */}
      {condition.compareTarget.type === 'fixed' && (
        <input
          type="number"
          className="w-20 px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm"
          value={condition.compareTarget.value}
          onChange={(e) => handleCompareValueChange(parseFloat(e.target.value))}
          step="any"
          disabled={readOnly}
        />
      )}

      {/* 削除ボタン */}
      {!readOnly && canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
          title="条件を削除"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ============================================
// 条件グループコンポーネント（再帰的）
// ============================================

interface ConditionGroupComponentProps {
  group: ConditionGroup;
  onChange: (group: ConditionGroup) => void;
  onRemove?: () => void;
  indicatorMetadata: IndicatorMetadata[];
  readOnly?: boolean;
  depth?: number;
}

function ConditionGroupComponent({
  group,
  onChange,
  onRemove,
  indicatorMetadata,
  readOnly = false,
  depth = 0,
}: ConditionGroupComponentProps) {
  // 条件を追加
  const handleAddCondition = () => {
    onChange({
      ...group,
      conditions: [...group.conditions, _createDefaultCondition()],
    });
  };

  // サブグループを追加
  const handleAddSubGroup = () => {
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        {
          groupId: _generateGroupId(),
          operator: 'AND' as LogicalOperator,
          conditions: [_createDefaultCondition()],
        },
      ],
    });
  };

  // 条件を更新
  const handleConditionChange = (index: number, updated: IndicatorCondition | ConditionGroup) => {
    const newConditions = [...group.conditions];
    newConditions[index] = updated;
    onChange({ ...group, conditions: newConditions });
  };

  // 条件を削除
  const handleRemoveCondition = (index: number) => {
    if (group.conditions.length <= 1) return; // 最低1つは残す
    const newConditions = group.conditions.filter((_, i) => i !== index);
    onChange({ ...group, conditions: newConditions });
  };

  // 論理演算子を変更
  const handleOperatorChange = (operator: LogicalOperator) => {
    onChange({ ...group, operator });
  };

  const bgColors = ['bg-slate-900', 'bg-slate-800/50', 'bg-slate-700/30'];
  const borderColors = ['border-slate-700', 'border-slate-600', 'border-slate-500'];

  return (
    <div className={`p-4 rounded-lg border ${bgColors[Math.min(depth, 2)]} ${borderColors[Math.min(depth, 2)]}`}>
      {/* グループヘッダー */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <select
            className="px-3 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm font-medium"
            value={group.operator}
            onChange={(e) => handleOperatorChange(e.target.value as LogicalOperator)}
            disabled={readOnly}
          >
            {Object.entries(_LOGICAL_OPERATOR_INFO).map(([op, info]) => (
              <option key={op} value={op}>
                {info.label}（{info.description}）
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">
            {depth === 0 ? 'エントリー条件' : `グループ ${depth}`}
          </span>
        </div>

        {/* グループ削除ボタン（ルート以外） */}
        {!readOnly && onRemove && depth > 0 && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
            title="グループを削除"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* 条件一覧 */}
      <div className="space-y-2">
        {group.conditions.map((condition, index) => (
          <React.Fragment key={_isIndicatorCondition(condition) ? condition.conditionId : (condition as ConditionGroup).groupId}>
            {/* 論理演算子の区切り */}
            {index > 0 && (
              <div className="flex items-center justify-center py-1">
                <span className={`px-3 py-0.5 text-xs font-medium rounded-full ${
                  group.operator === 'AND' ? 'bg-blue-900/50 text-blue-300' :
                  group.operator === 'OR' ? 'bg-green-900/50 text-green-300' :
                  'bg-orange-900/50 text-orange-300'
                }`}>
                  {_LOGICAL_OPERATOR_INFO[group.operator].label}
                </span>
              </div>
            )}

            {/* 単一条件またはサブグループ */}
            {_isIndicatorCondition(condition) ? (
              <SingleCondition
                condition={condition}
                onChange={(updated) => handleConditionChange(index, updated)}
                onRemove={() => handleRemoveCondition(index)}
                indicatorMetadata={indicatorMetadata}
                readOnly={readOnly}
                canRemove={group.conditions.length > 1}
              />
            ) : (
              <ConditionGroupComponent
                group={condition as ConditionGroup}
                onChange={(updated) => handleConditionChange(index, updated)}
                onRemove={() => handleRemoveCondition(index)}
                indicatorMetadata={indicatorMetadata}
                readOnly={readOnly}
                depth={depth + 1}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* 追加ボタン */}
      {!readOnly && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-700">
          <button
            type="button"
            onClick={handleAddCondition}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            条件を追加
          </button>
          {depth < 2 && ( // ネストは2階層まで
            <button
              type="button"
              onClick={handleAddSubGroup}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z" />
              </svg>
              グループを追加
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export default function ConditionBuilder({
  value,
  onChange,
  indicatorMetadata,
  readOnly = false,
}: ConditionBuilderProps) {
  return (
    <div className="condition-builder">
      <ConditionGroupComponent
        group={value}
        onChange={onChange}
        indicatorMetadata={indicatorMetadata}
        readOnly={readOnly}
        depth={0}
      />
    </div>
  );
}

// 名前付きエクスポート
export { SingleCondition, ConditionGroupComponent };
