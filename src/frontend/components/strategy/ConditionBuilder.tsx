/**
 * 条件ビルダーコンポーネント
 * 
 * 目的:
 * - インジケーター条件をフォーム入力式で設定
 * - AND/OR/NOT の論理演算子で条件を組み合わせ
 * - 再帰的な条件グループ構造をサポート
 */

"use client";

import React, { useMemo } from "react";
import {
  COMPARISON_OPERATOR_INFO,
  createDefaultCondition,
  FIELD_LABELS,
  generateConditionId,
  generateGroupId,
  INDICATOR_FIELDS,
  isIndicatorCondition,
  isPatternCondition,
  LOGICAL_OPERATOR_INFO,
} from "@/types/strategy";
import type {
  IndicatorCondition,
  PatternCondition,
  ConditionGroup,
  LogicalOperator,
  ComparisonOperator,
  IndicatorField,
  CompareTarget,
  CandlePatternId,
  PatternOperator,
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
  /** コンパクト表示モード（モバイル向け） */
  compact?: boolean;
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
  /** コンパクト表示モード */
  compact?: boolean;
}

interface PatternConditionProps {
  /** パターン条件 */
  condition: PatternCondition;
  /** 条件変更時のコールバック */
  onChange: (condition: PatternCondition) => void;
  /** 削除コールバック */
  onRemove: () => void;
  /** 読み取り専用モード */
  readOnly?: boolean;
  /** 削除可能かどうか */
  canRemove?: boolean;
  /** コンパクト表示モード */
  compact?: boolean;
}

// ============================================
// 表示用ラベル
// ============================================

const _PARAM_LABELS: Partial<Record<keyof IndicatorParams, string>> = {
  period: '期間',
  fastPeriod: '短期',
  slowPeriod: '長期',
  signalPeriod: 'シグナル',
  kPeriod: '%K期間',
  dPeriod: '%D期間',
  step: 'ステップ',
  maxStep: '最大ステップ',
  conversionPeriod: '転換',
  basePeriod: '基準',
  spanBPeriod: 'スパンB',
  displacement: '遅行',
};

const _PRICE_TYPE_INFO: Record<'open' | 'high' | 'low' | 'close', string> = {
  open: '始値',
  high: '高値',
  low: '安値',
  close: '終値',
};

const _CANDLE_PATTERN_INFO: Record<CandlePatternId, string> = {
  pinbar: 'ピンバー（上下どちらでも）',
  pinbar_bull: 'ピンバー（下ヒゲ）',
  pinbar_bear: 'ピンバー（上ヒゲ）',
  hammer: 'カラカサ/トンカチ（ハンマー系）',
  hammer_bull: 'トンカチ寄り（陽線ハンマー）',
  hammer_bear: 'カラカサ寄り（陰線ハンマー）',
  shooting_star: 'シューティングスター（上ヒゲ）',
  engulfing_bull: '包み足（強気）',
  engulfing_bear: '包み足（弱気）',
  doji: 'ドージ（迷い）',
  thrust_bull: 'スラスト（強い陽線）',
  thrust_bear: 'スラスト（強い陰線）',
};

const _PATTERN_OPERATOR_INFO: Record<PatternOperator, string> = {
  is_true: '出現した',
  is_false: '出現していない',
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
  compact = false,
}: SingleConditionProps) {
  // 選択中のインジケーターで利用可能なフィールドを取得
  const availableFields = INDICATOR_FIELDS[condition.indicatorId] || ['value'];
  const selectedIndicator = indicatorMetadata.find(m => m.id === condition.indicatorId);
  const leftParamKeys = Object.keys(selectedIndicator?.defaultParams ?? {}) as Array<keyof IndicatorParams>;
  const indicatorTarget = condition.compareTarget.type === 'indicator' ? condition.compareTarget : null;
  const indicatorTargetMeta = indicatorTarget
    ? indicatorMetadata.find(m => m.id === indicatorTarget.indicatorId)
    : undefined;
  const indicatorTargetParamKeys = Object.keys(indicatorTargetMeta?.defaultParams ?? {}) as Array<keyof IndicatorParams>;
  const indicatorTargetFields: IndicatorField[] = indicatorTarget
    ? (INDICATOR_FIELDS[indicatorTarget.indicatorId] || ['value'])
    : ['value'];

  // コンパクトモードのスタイル
  const baseSelectClass = compact
    ? "px-1 py-0.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-xs"
    : "px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm";
  const baseInputClass = compact
    ? "px-1 py-0.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-xs"
    : "px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm";

  // インジケーター変更時
  const handleIndicatorChange = (indicatorId: IndicatorId) => {
    const meta = indicatorMetadata.find(m => m.id === indicatorId);
    const fields = INDICATOR_FIELDS[indicatorId] || ['value'];
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

  const handleCompareTargetTypeChange = (type: CompareTarget['type']) => {
    if (type === 'fixed') {
      onChange({
        ...condition,
        compareTarget: { type: 'fixed', value: 0 },
      });
      return;
    }

    if (type === 'price') {
      onChange({
        ...condition,
        compareTarget: { type: 'price', priceType: 'close' },
      });
      return;
    }

    const fallbackIndicatorId = indicatorMetadata[0]?.id ?? condition.indicatorId;
    const meta = indicatorMetadata.find(m => m.id === fallbackIndicatorId);
    const fields = INDICATOR_FIELDS[fallbackIndicatorId] || ['value'];

    onChange({
      ...condition,
      compareTarget: {
        type: 'indicator',
        indicatorId: fallbackIndicatorId,
        params: meta?.defaultParams || { period: 14 },
        field: fields[0],
      },
    });
  };

  const handleCompareTargetIndicatorChange = (indicatorId: IndicatorId) => {
    if (condition.compareTarget.type !== 'indicator') return;
    const meta = indicatorMetadata.find(m => m.id === indicatorId);
    const fields = INDICATOR_FIELDS[indicatorId] || ['value'];

    onChange({
      ...condition,
      compareTarget: {
        ...condition.compareTarget,
        indicatorId,
        params: meta?.defaultParams || { period: 14 },
        field: fields[0],
      },
    });
  };

  const handleCompareTargetParamChange = (key: keyof IndicatorParams, value: number) => {
    if (condition.compareTarget.type !== 'indicator') return;
    onChange({
      ...condition,
      compareTarget: {
        ...condition.compareTarget,
        params: { ...condition.compareTarget.params, [key]: value },
      },
    });
  };

  return (
    <div className={`flex flex-wrap items-center gap-${compact ? '1' : '2'} ${compact ? 'p-2' : 'p-3'} bg-slate-800 rounded-lg border border-slate-700`}>
      {/* インジケーター選択 */}
      <select
        className={`${baseSelectClass} ${compact ? 'min-w-[80px]' : 'min-w-[120px]'}`}
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

      {/* パラメータ（インジケーター計算用。比較演算子の対象ではない） */}
      {leftParamKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {leftParamKeys.map((key) => (
            <div key={String(key)} className="flex items-center gap-0.5">
              {!compact && (
                <span className="text-xs text-gray-400">
                  {_PARAM_LABELS[key] ?? String(key)}
                </span>
              )}
              <input
                type="number"
                className={`${compact ? 'w-10' : 'w-16'} ${baseInputClass}`}
                value={(condition.params[key] ?? selectedIndicator?.defaultParams?.[key] ?? 0) as number}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  handleParamChange(key, Number.isFinite(next) ? next : 0);
                }}
                step="any"
                disabled={readOnly}
              />
            </div>
          ))}
        </div>
      )}

      {/* 「〜の」 */}
      <span className="text-xs text-gray-500">の</span>

      {/* フィールド選択（複数出力があるインジケーターの場合） */}
      {availableFields.length > 1 && (
        <select
          className={baseSelectClass}
          value={condition.field}
          onChange={(e) => onChange({ ...condition, field: e.target.value as IndicatorField })}
          disabled={readOnly}
        >
          {availableFields.map((field) => (
            <option key={field} value={field}>
              {FIELD_LABELS[field]}
            </option>
          ))}
        </select>
      )}

      {availableFields.length <= 1 && (
        <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-300`}>
          {FIELD_LABELS[condition.field] ?? '値'}
        </span>
      )}

      <span className="text-xs text-gray-500">が</span>

      {/* 比較対象タイプ */}
      <select
        className={baseSelectClass}
        value={condition.compareTarget.type}
        onChange={(e) => handleCompareTargetTypeChange(e.target.value as CompareTarget['type'])}
        disabled={readOnly}
        title="比較対象"
      >
        <option value="fixed">定数</option>
        <option value="price">価格</option>
        <option value="indicator">別指標</option>
      </select>

      {/* 比較対象: 固定値 */}
      {condition.compareTarget.type === 'fixed' && (
        <input
          type="number"
          className={`${compact ? 'w-14' : 'w-20'} ${baseInputClass}`}
          value={condition.compareTarget.value}
          onChange={(e) => handleCompareValueChange(Number(e.target.value))}
          step="any"
          disabled={readOnly}
        />
      )}

      {/* 比較対象: 価格 */}
      {condition.compareTarget.type === 'price' && (
        <select
          className={baseSelectClass}
          value={condition.compareTarget.priceType}
          onChange={(e) =>
            onChange({
              ...condition,
              compareTarget: { type: 'price', priceType: e.target.value as 'open' | 'high' | 'low' | 'close' },
            })
          }
          disabled={readOnly}
        >
          {Object.entries(_PRICE_TYPE_INFO).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}

      {/* 比較対象: 別インジケーター */}
      {indicatorTarget && (
        <>
          <select
            className={`${baseSelectClass} ${compact ? 'min-w-[70px]' : 'min-w-[110px]'}`}
            value={indicatorTarget.indicatorId}
            onChange={(e) => handleCompareTargetIndicatorChange(e.target.value as IndicatorId)}
            disabled={readOnly}
          >
            {indicatorMetadata.map((meta) => (
              <option key={meta.id} value={meta.id}>
                {meta.displayName}
              </option>
            ))}
          </select>

          {indicatorTargetParamKeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {indicatorTargetParamKeys.map((key) => (
                <div key={String(key)} className="flex items-center gap-0.5">
                  {!compact && (
                    <span className="text-xs text-gray-400">
                      {_PARAM_LABELS[key] ?? String(key)}
                    </span>
                  )}
                  <input
                    type="number"
                    className={`${compact ? 'w-10' : 'w-16'} ${baseInputClass}`}
                    value={(indicatorTarget.params[key] ?? indicatorTargetMeta?.defaultParams?.[key] ?? 0) as number}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      handleCompareTargetParamChange(key, Number.isFinite(next) ? next : 0);
                    }}
                    step="any"
                    disabled={readOnly}
                  />
                </div>
              ))}
            </div>
          )}

          {indicatorTargetFields.length > 1 && (
            <select
              className={baseSelectClass}
              value={indicatorTarget.field}
              onChange={(e) =>
                onChange({
                  ...condition,
                  compareTarget: {
                    ...indicatorTarget,
                    field: e.target.value as IndicatorField,
                  },
                })
              }
              disabled={readOnly}
            >
              {indicatorTargetFields.map((field) => (
                <option key={field} value={field}>
                  {FIELD_LABELS[field]}
                </option>
              ))}
            </select>
          )}

          {indicatorTargetFields.length <= 1 && (
            <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-300`}>
              {FIELD_LABELS[indicatorTarget.field] ?? '値'}
            </span>
          )}
        </>
      )}

      {/* 比較演算子 */}
      <select
        className={baseSelectClass}
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as ComparisonOperator })}
        disabled={readOnly}
      >
        {Object.entries(COMPARISON_OPERATOR_INFO).map(([op, info]) => (
          <option key={op} value={op}>
            {info.label}
          </option>
        ))}
      </select>

      {/* 削除ボタン */}
      {!readOnly && canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className={`${compact ? 'p-0.5' : 'p-1.5'} text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors`}
          title="条件を削除"
        >
          <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SinglePatternCondition({
  condition,
  onChange,
  onRemove,
  readOnly = false,
  canRemove = true,
  compact = false,
}: PatternConditionProps) {
  const baseSelectClass = compact
    ? "px-1 py-0.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-xs"
    : "px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm";

  const criteriaText = useMemo(() => {
    // 実装（analysis-engine / プレビュー）と同一の基準を表示して、条件作成時の違和感を減らす
    // 注意: トレンド文脈（上昇/下降）までは現状見ない
    const id = condition.patternId;

    if (id === 'pinbar' || id === 'pinbar_bull' || id === 'pinbar_bear') {
      return '基準: 長いヒゲ ≥ 3×実体 かつ 反対ヒゲ ≤ 0.5×実体（実体0は除外）';
    }
    if (id === 'hammer' || id === 'hammer_bull' || id === 'hammer_bear') {
      return '基準: 下ヒゲ ≥ 2×実体 かつ 上ヒゲ ≤ 0.5×実体（文脈トレンドは未考慮）';
    }
    if (id === 'shooting_star') {
      return '基準: 上ヒゲ ≥ 2×実体 かつ 下ヒゲ ≤ 0.5×実体（文脈トレンドは未考慮）';
    }
    if (id === 'doji') {
      return '基準: 実体 ≤ レンジの10%（レンジ=high-low）';
    }
    if (id === 'thrust_bull' || id === 'thrust_bear') {
      return '基準: 実体 ≥ レンジの70%（実体が大きい足）';
    }
    if (id === 'engulfing_bull' || id === 'engulfing_bear') {
      return '基準: 前足の実体を現足の実体が包む（簡易）';
    }
    return null;
  }, [condition.patternId]);

  return (
    <div className={`flex flex-wrap items-center gap-${compact ? '1' : '2'} ${compact ? 'p-2' : 'p-3'} bg-slate-800 rounded-lg border border-slate-700`}>
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-400`}>パターン</span>

      <select
        className={`${baseSelectClass} ${compact ? 'min-w-[120px]' : 'min-w-[220px]'}`}
        value={condition.patternId}
        onChange={(e) => onChange({ ...condition, patternId: e.target.value as CandlePatternId })}
        disabled={readOnly}
      >
        {Object.entries(_CANDLE_PATTERN_INFO).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>

      <select
        className={baseSelectClass}
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as PatternOperator })}
        disabled={readOnly}
      >
        {Object.entries(_PATTERN_OPERATOR_INFO).map(([op, label]) => (
          <option key={op} value={op}>
            {label}
          </option>
        ))}
      </select>

      {!readOnly && canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className={`${compact ? 'p-0.5' : 'p-1.5'} text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors`}
          title="条件を削除"
        >
          <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {criteriaText && (
        <div className="w-full mt-1 text-[11px] text-gray-400">
          {criteriaText}
        </div>
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
  compact?: boolean;
}

function ConditionGroupComponent({
  group,
  onChange,
  onRemove,
  indicatorMetadata,
  readOnly = false,
  depth = 0,
  compact = false,
}: ConditionGroupComponentProps) {
  // 条件を追加
  const handleAddCondition = () => {
    onChange({
      ...group,
      conditions: [...group.conditions, createDefaultCondition()],
    });
  };

  // パターン条件を追加
  const handleAddPatternCondition = () => {
    const cond: PatternCondition = {
      conditionId: generateConditionId(),
      type: 'pattern',
      patternId: 'pinbar',
      operator: 'is_true',
    };

    onChange({
      ...group,
      conditions: [...group.conditions, cond],
    });
  };

  // サブグループを追加
  const handleAddSubGroup = () => {
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        {
          groupId: generateGroupId(),
          operator: 'AND' as LogicalOperator,
          conditions: [createDefaultCondition()],
        },
      ],
    });
  };

  // 条件を更新
  const handleConditionChange = (index: number, updated: IndicatorCondition | PatternCondition | ConditionGroup) => {
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


  const handleMaxBarsBetweenStepsChange = (value: number) => {
    const next = Number.isFinite(value) ? Math.max(1, Math.min(value, 500)) : 10;
    onChange({ ...group, maxBarsBetweenSteps: next });
  };

  const bgColors = ['bg-slate-900', 'bg-slate-800/50', 'bg-slate-700/30'];
  const borderColors = ['border-slate-700', 'border-slate-600', 'border-slate-500'];

  return (
    <div className={`${compact ? 'p-2' : 'p-4'} rounded-lg border ${bgColors[Math.min(depth, 2)]} ${borderColors[Math.min(depth, 2)]}`}>
      {/* グループヘッダー */}
      <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-3'}`}>
        <div className="flex items-center gap-2">
          <select
            className={`${compact ? 'px-1.5 py-0.5 text-xs' : 'px-3 py-1.5 text-sm'} rounded bg-slate-700 text-gray-200 border border-slate-600 font-medium`}
            value={group.operator}
            onChange={(e) => handleOperatorChange(e.target.value as LogicalOperator)}
            disabled={readOnly}
          >
            {Object.entries(LOGICAL_OPERATOR_INFO).map(([op, info]) => (
              <option key={op} value={op}>
                {compact ? info.label : `${info.label}（${info.description}）`}
              </option>
            ))}
          </select>
          {!compact && (
            <span className="text-xs text-gray-500">
              {depth === 0 ? 'エントリー条件' : `グループ ${depth}`}
            </span>
          )}

          {group.operator === 'SEQUENCE' && (
            <div className="flex items-center gap-1">
              {!compact && <span className="text-xs text-gray-400">最大間隔</span>}
              <input
                type="number"
                className={`${compact ? 'w-12 px-1 py-0.5' : 'w-16 px-2 py-1.5'} rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm`}
                value={group.maxBarsBetweenSteps ?? 10}
                onChange={(e) => handleMaxBarsBetweenStepsChange(parseInt(e.target.value, 10))}
                min={1}
                max={500}
                disabled={readOnly}
              />
              {!compact && <span className="text-xs text-gray-500">バー</span>}
            </div>
          )}
        </div>

        {/* グループ削除ボタン（ルート以外） */}
        {!readOnly && onRemove && depth > 0 && (
          <button
            type="button"
            onClick={onRemove}
            className={`${compact ? 'p-0.5' : 'p-1.5'} text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors`}
            title="グループを削除"
          >
            <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* 条件一覧 */}
      <div className={`space-y-${compact ? '1' : '2'}`}>
        {group.conditions.map((condition, index) => (
          <React.Fragment key={isIndicatorCondition(condition) || isPatternCondition(condition) ? (condition as { conditionId: string }).conditionId : (condition as ConditionGroup).groupId}>
            {/* 論理演算子の区切り */}
            {index > 0 && (
              <div className={`flex items-center justify-center ${compact ? 'py-0.5' : 'py-1'}`}>
                <span className={`${compact ? 'px-2 text-[10px]' : 'px-3 text-xs'} py-0.5 font-medium rounded-full ${
                  group.operator === 'AND' ? 'bg-blue-900/50 text-blue-300' :
                  group.operator === 'OR' ? 'bg-green-900/50 text-green-300' :
                  'bg-orange-900/50 text-orange-300'
                }`}>
                  {LOGICAL_OPERATOR_INFO[group.operator].label}
                </span>
              </div>
            )}

            {/* 単一条件またはサブグループ */}
            {isIndicatorCondition(condition) ? (
              <SingleCondition
                condition={condition}
                onChange={(updated) => handleConditionChange(index, updated)}
                onRemove={() => handleRemoveCondition(index)}
                indicatorMetadata={indicatorMetadata}
                readOnly={readOnly}
                canRemove={group.conditions.length > 1}
                compact={compact}
              />
            ) : isPatternCondition(condition) ? (
              <SinglePatternCondition
                condition={condition}
                onChange={(updated) => handleConditionChange(index, updated)}
                onRemove={() => handleRemoveCondition(index)}
                readOnly={readOnly}
                canRemove={group.conditions.length > 1}
                compact={compact}
              />
            ) : (
              <ConditionGroupComponent
                group={condition as ConditionGroup}
                onChange={(updated) => handleConditionChange(index, updated)}
                onRemove={() => handleRemoveCondition(index)}
                indicatorMetadata={indicatorMetadata}
                readOnly={readOnly}
                depth={depth + 1}
                compact={compact}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* 追加ボタン */}
      {!readOnly && (
        <div className={`flex gap-2 ${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'} border-t border-slate-700`}>
          <button
            type="button"
            onClick={handleAddCondition}
            className={`flex items-center gap-1 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors`}
          >
            <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {compact ? '+条件' : '条件を追加'}
          </button>

          <button
            type="button"
            onClick={handleAddPatternCondition}
            className={`flex items-center gap-1 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors`}
          >
            <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {compact ? '+パターン' : 'パターンを追加'}
          </button>

          {depth < 2 && ( // ネストは2階層まで
            <button
              type="button"
              onClick={handleAddSubGroup}
              className={`flex items-center gap-1 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors`}
            >
              <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z" />
              </svg>
              {compact ? '+グループ' : 'グループを追加'}
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
  compact = false,
}: ConditionBuilderProps) {
  return (
    <div className="condition-builder">
      <ConditionGroupComponent
        group={value}
        onChange={onChange}
        indicatorMetadata={indicatorMetadata}
        readOnly={readOnly}
        depth={0}
        compact={compact}
      />
    </div>
  );
}

// 名前付きエクスポート
export { SingleCondition, ConditionGroupComponent };
