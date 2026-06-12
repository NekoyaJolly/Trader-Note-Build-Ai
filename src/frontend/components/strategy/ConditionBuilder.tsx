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
  buildLensId,
  COMPARISON_OPERATOR_INFO,
  createDefaultCondition,
  createDefaultLensCondition,
  DAY_OF_WEEK_LABELS,
  FIELD_LABELS,
  flattenConditionGroup,
  generateConditionId,
  generateGroupId,
  getLensFeatureInfo,
  hhmmToMinutes,
  INDICATOR_FIELDS,
  isConditionGroup,
  isFlattenableGroup,
  isIndicatorCondition,
  isLensCondition,
  isPatternCondition,
  isTimeCondition,
  LENS_CONDITION_KIND_INFO,
  LENS_FEATURE_INFO,
  LENS_OPERATOR_INFO,
  lensOperatorsForValueKind,
  LOGICAL_OPERATOR_INFO,
  minutesToHHMM,
  normalizeFlatConditions,
  parseLensIdForEdit,
  SESSION_PRESETS_JST,
} from "@/types/strategy";
import type {
  IndicatorCondition,
  PatternCondition,
  TimeCondition,
  TimeConditionKind,
  SessionId,
  ConditionGroup,
  ConditionChild,
  LensCondition,
  LensConditionKind,
  LensConditionOperator,
  LensIdParams,
  LensMaType,
  LogicalOperator,
  ComparisonOperator,
  IndicatorField,
  CompareTarget,
  CandlePatternId,
  PatternOperator,
} from "@/types/strategy";

/** 時間条件の初期値（セッション=東京）。追加ボタンと種別切替で使う。 */
function createDefaultTimeCondition(): TimeCondition {
  return {
    conditionId: generateConditionId(),
    type: 'time',
    kind: 'session',
    session: 'tokyo',
  };
}
import type { IndicatorId, IndicatorParams, IndicatorMetadata } from "@/types/indicator";
import { MTF_TIMEFRAME_OPTIONS, type MtfTimeframeApi } from "@/lib/marketConstants";

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
  pinbar: 'スパイク（上下どちらでも）',
  pinbar_bear: 'スパイクハイ（上ヒゲ）',
  pinbar_bull: 'スパイクロー（下ヒゲ）',
  hammer: 'ハンマー（下ヒゲ）',
  hammer_bull: 'ハンマー（陽線）',
  hammer_bear: 'ハンマー（陰線）',
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

  // 範囲（between / not_between）かどうか
  const isBetween = condition.operator === 'between' || condition.operator === 'not_between';

  // 演算子変更。範囲に切り替えるときは下限・上限を固定値で初期化する（v1 は固定値のみ）
  const handleOperatorChange = (op: ComparisonOperator) => {
    if (op === 'between' || op === 'not_between') {
      const lower = condition.compareTarget.type === 'fixed' ? condition.compareTarget.value : 0;
      const upper = condition.compareTargetUpper?.type === 'fixed' ? condition.compareTargetUpper.value : 100;
      onChange({
        ...condition,
        operator: op,
        compareTarget: { type: 'fixed', value: lower },
        compareTargetUpper: { type: 'fixed', value: upper },
      });
      return;
    }
    onChange({ ...condition, operator: op });
  };

  // 範囲の下限・上限（固定値）変更
  const handleBetweenBoundChange = (which: 'lower' | 'upper', value: number) => {
    if (which === 'lower') {
      onChange({ ...condition, compareTarget: { type: 'fixed', value } });
    } else {
      onChange({ ...condition, compareTargetUpper: { type: 'fixed', value } });
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
    <div className={`flex flex-wrap items-center ${compact ? 'gap-1' : 'gap-2'} ${compact ? 'p-2' : 'p-3'} bg-slate-800 rounded-lg border border-slate-700`}>
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

      {/* 範囲（between / not_between）: 下限〜上限の固定値2つ */}
      {isBetween && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            className={`${compact ? 'w-14' : 'w-20'} ${baseInputClass}`}
            value={condition.compareTarget.type === 'fixed' ? condition.compareTarget.value : 0}
            onChange={(e) => handleBetweenBoundChange('lower', Number(e.target.value) || 0)}
            step="any"
            disabled={readOnly}
            title="下限"
          />
          <span className="text-xs text-gray-500">〜</span>
          <input
            type="number"
            className={`${compact ? 'w-14' : 'w-20'} ${baseInputClass}`}
            value={condition.compareTargetUpper?.type === 'fixed' ? condition.compareTargetUpper.value : 0}
            onChange={(e) => handleBetweenBoundChange('upper', Number(e.target.value) || 0)}
            step="any"
            disabled={readOnly}
            title="上限"
          />
        </div>
      )}

      {!isBetween && (
        <>
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
        </>
      )}

      {/* 比較演算子 */}
      <select
        className={baseSelectClass}
        value={condition.operator}
        onChange={(e) => handleOperatorChange(e.target.value as ComparisonOperator)}
        disabled={readOnly}
      >
        {Object.entries(COMPARISON_OPERATOR_INFO).map(([op, info]) => (
          <option key={op} value={op}>
            {info.label}
          </option>
        ))}
      </select>

      {/* 直近ルックバック */}
      {(!readOnly || (condition.lookbackBars ?? 0) > 1) && (
        <LookbackControl
          value={condition.lookbackBars}
          onChange={(bars) => onChange({ ...condition, lookbackBars: bars })}
          readOnly={readOnly}
          compact={compact}
        />
      )}

      {/* マルチタイムフレーム (この条件だけ別の足で評価。Phase γ) */}
      {(!readOnly || condition.timeframeOverride !== undefined) && (
        <TimeframeOverrideControl
          value={condition.timeframeOverride}
          onChange={(tf) => onChange({ ...condition, timeframeOverride: tf })}
          readOnly={readOnly}
          compact={compact}
        />
      )}

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

    if (id === 'pinbar') {
      return '基準: 長いヒゲ ≥ 3×実体 かつ 反対ヒゲ ≤ 0.5×実体（実体0は除外）';
    }
    if (id === 'pinbar_bear') {
      return '基準: 上ヒゲ ≥ 3×実体 かつ 下ヒゲ ≤ 0.5×実体（実体0は除外）';
    }
    if (id === 'pinbar_bull') {
      return '基準: 下ヒゲ ≥ 3×実体 かつ 上ヒゲ ≤ 0.5×実体（実体0は除外）';
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

  type PatternGroup = 'pinbar' | 'hammer' | 'other';

  const groupOf = (id: CandlePatternId): PatternGroup => {
    if (id === 'pinbar' || id === 'pinbar_bull' || id === 'pinbar_bear') return 'pinbar';
    if (id === 'hammer' || id === 'hammer_bull' || id === 'hammer_bear') return 'hammer';
    return 'other';
  };

  const currentGroup = groupOf(condition.patternId);

  const setGroup = (group: PatternGroup) => {
    // 意味ベースの選択に合わせて、内部のpatternIdをデフォルトに寄せる
    if (group === 'pinbar') {
      // まずは「上下どちらでも」で開始（詳細でスパイクハイ/ローを選べる）
      onChange({ ...condition, patternId: 'pinbar' });
      return;
    }
    if (group === 'hammer') {
      onChange({ ...condition, patternId: 'hammer' });
      return;
    }
    if (group === 'other') {
      // other を選んだのに詳細が出ないのはUXが悪いので、other系の代表に切り替える
      onChange({ ...condition, patternId: 'shooting_star' });
    }
  };

  const pinbarDetailOptions: Array<{ id: CandlePatternId; label: string }> = [
    { id: 'pinbar', label: '上下どちらでも' },
    { id: 'pinbar_bear', label: 'スパイクハイ（上ヒゲ）' },
    { id: 'pinbar_bull', label: 'スパイクロー（下ヒゲ）' },
  ];

  const hammerDetailOptions: Array<{ id: CandlePatternId; label: string }> = [
    { id: 'hammer', label: 'どちらでも' },
    { id: 'hammer_bull', label: '陽線' },
    { id: 'hammer_bear', label: '陰線' },
  ];

  return (
    <div className={`flex flex-wrap items-center ${compact ? 'gap-1' : 'gap-2'} ${compact ? 'p-2' : 'p-3'} bg-slate-800 rounded-lg border border-slate-700`}>
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-400`}>パターン</span>

      <select
        className={`${baseSelectClass} ${compact ? 'min-w-[120px]' : 'min-w-[220px]'}`}
        value={currentGroup}
        onChange={(e) => setGroup(e.target.value as PatternGroup)}
        disabled={readOnly}
      >
        <option value="pinbar">ピンバー</option>
        <option value="hammer">ハンマー</option>
        <option value="other">その他（詳細）</option>
      </select>

      {currentGroup === 'pinbar' && (
        <select
          className={baseSelectClass}
          value={condition.patternId}
          onChange={(e) => onChange({ ...condition, patternId: e.target.value as CandlePatternId })}
          disabled={readOnly}
        >
          {pinbarDetailOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {currentGroup === 'hammer' && (
        <select
          className={baseSelectClass}
          value={condition.patternId}
          onChange={(e) => onChange({ ...condition, patternId: e.target.value as CandlePatternId })}
          disabled={readOnly}
        >
          {hammerDetailOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {currentGroup === 'other' && (
        <select
          className={baseSelectClass}
          value={condition.patternId}
          onChange={(e) => onChange({ ...condition, patternId: e.target.value as CandlePatternId })}
          disabled={readOnly}
        >
          {Object.entries(_CANDLE_PATTERN_INFO)
            .filter(([id]) => groupOf(id as CandlePatternId) === 'other')
            .map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
        </select>
      )}

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

      {/* 直近ルックバック */}
      {(!readOnly || (condition.lookbackBars ?? 0) > 1) && (
        <LookbackControl
          value={condition.lookbackBars}
          onChange={(bars) => onChange({ ...condition, lookbackBars: bars })}
          readOnly={readOnly}
          compact={compact}
        />
      )}

      {/* マルチタイムフレーム (この条件だけ別の足で評価。Phase γ) */}
      {(!readOnly || condition.timeframeOverride !== undefined) && (
        <TimeframeOverrideControl
          value={condition.timeframeOverride}
          onChange={(tf) => onChange({ ...condition, timeframeOverride: tf })}
          readOnly={readOnly}
          compact={compact}
        />
      )}

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
// 直近ルックバック（直近N本以内に成立）モディファイア
// ============================================

interface LookbackControlProps {
  /** 現在の本数（undefined / 1 なら無効） */
  value: number | undefined;
  /** 変更コールバック（無効化は undefined） */
  onChange: (bars: number | undefined) => void;
  readOnly?: boolean;
  compact?: boolean;
}

/**
 * 条件に「直近 N 本以内のどこかで成立すれば OK」を付与する小さなコントロール。
 * チェックで有効化（既定 3 本）、数値で本数指定（最小 2）。
 */
function LookbackControl({ value, onChange, readOnly = false, compact = false }: LookbackControlProps) {
  const active = !!value && value > 1;
  const inputClass = compact ? 'w-10 px-1 py-0.5 text-xs' : 'w-12 px-1.5 py-0.5 text-sm';
  return (
    <div className="flex items-center gap-1" title="直近 N 本以内のどこかで成立すれば成立とみなす">
      <input
        type="checkbox"
        checked={active}
        onChange={(e) => onChange(e.target.checked ? 3 : undefined)}
        disabled={readOnly}
        className="accent-amber-500"
      />
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-400`}>直近</span>
      <input
        type="number"
        min={2}
        className={`${inputClass} rounded bg-slate-700 text-gray-200 border border-slate-600 disabled:opacity-40`}
        value={active ? value : ''}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) ? Math.max(2, n) : 2);
        }}
        disabled={readOnly || !active}
      />
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-400`}>本以内</span>
    </div>
  );
}

interface TimeframeOverrideControlProps {
  /** 現在の上書き時間足（undefined = ストラテジーの基準足） */
  value: MtfTimeframeApi | undefined;
  onChange: (timeframe: MtfTimeframeApi | undefined) => void;
  readOnly?: boolean;
  compact?: boolean;
}

/**
 * 条件単位で選べる時間足。MTF は「上位足を見る」用途のため基準足(1m〜4h)に加え
 * 1d/1w を含む単一ソース MTF_TIMEFRAME_OPTIONS から api 値を生成する
 * (重複定義を避け、TF 追加/削除に追従。Copilot レビュー対応)。
 */
const OVERRIDE_TIMEFRAMES: readonly MtfTimeframeApi[] = MTF_TIMEFRAME_OPTIONS.map((tf) => tf.api);

/**
 * マルチタイムフレーム条件 (Phase γ): この条件だけ別の時間足で評価する小さなセレクタ。
 * 「基準足」(= 未指定) が既定。上位足を選んだ場合、評価は確定バーのみ参照される。
 */
function TimeframeOverrideControl({ value, onChange, readOnly = false, compact = false }: TimeframeOverrideControlProps) {
  return (
    <div
      className="flex items-center gap-1"
      title="この条件だけ別の時間足で評価します（未指定はストラテジーの基準足）"
    >
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-400`}>足</span>
      <select
        className={`${compact ? 'px-1 py-0.5 text-xs' : 'px-1.5 py-0.5 text-sm'} rounded bg-slate-700 text-gray-200 border border-slate-600 disabled:opacity-40`}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : (e.target.value as MtfTimeframeApi))}
        disabled={readOnly}
        aria-label="条件の時間足"
      >
        <option value="">基準足</option>
        {OVERRIDE_TIMEFRAMES.map((tf) => (
          <option key={tf} value={tf}>{tf}</option>
        ))}
      </select>
    </div>
  );
}

// ============================================
// レンズ条件コンポーネント（レンズ条件タイプ #3）
// ============================================

interface LensConditionProps {
  condition: LensCondition;
  onChange: (condition: LensCondition) => void;
  onRemove: () => void;
  readOnly?: boolean;
  canRemove?: boolean;
  compact?: boolean;
}

/** MA 種別セレクタの選択肢（表示は大文字） */
const LENS_MA_TYPE_OPTIONS: Array<{ value: LensMaType; label: string }> = [
  { value: 'ema', label: 'EMA' },
  { value: 'sma', label: 'SMA' },
];

/**
 * レンズ条件の入力 UI（設計書 §12.4-5）。
 * レンズ種別 → パラメータ → featureKey → 演算子 → 値 の順に選ぶ。
 * featureKey の値種別（enum/event/bool/number）に応じて演算子と値入力を制限する（§12.4-6）。
 */
function SingleLensCondition({
  condition,
  onChange,
  onRemove,
  readOnly = false,
  canRemove = true,
  compact = false,
}: LensConditionProps) {
  const baseSelectClass = compact
    ? "px-1 py-0.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-xs"
    : "px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm";
  const numberInputClass = compact
    ? "w-16 px-1 py-0.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-xs"
    : "w-20 px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm";

  const parsed = useMemo(() => parseLensIdForEdit(condition.lensId), [condition.lensId]);

  // 不正な lensId（手動編集 JSON 等）は編集 UI を出せないため、警告 + 削除のみ提供する
  if (!parsed) {
    return (
      <div className={`flex flex-wrap items-center ${compact ? 'gap-1 p-2' : 'gap-2 p-3'} bg-slate-800 rounded-lg border border-red-800`}>
        <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-red-400`}>
          不正なレンズ ID のため編集できません: {condition.lensId}
        </span>
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

  const { kind, params } = parsed;
  const featureInfos = LENS_FEATURE_INFO[kind];
  const featureInfo = getLensFeatureInfo(kind, condition.featureKey) ?? featureInfos[0];
  const allowedOperators = lensOperatorsForValueKind(featureInfo.valueKind);

  // レンズ種別の切替: lensId を既定パラメータで再構築し、featureKey / 演算子 / 値を先頭既定へ
  const handleKindChange = (nextKind: LensConditionKind) => {
    const firstFeature = LENS_FEATURE_INFO[nextKind][0];
    onChange({
      ...condition,
      lensId: buildLensId(nextKind, {}),
      featureKey: firstFeature.key,
      operator: lensOperatorsForValueKind(firstFeature.valueKind)[0],
      value: firstFeature.defaultValue,
    });
  };

  // パラメータ変更: lensId のみ再構築（featureKey 等は維持）
  const handleParamsChange = (nextParams: LensIdParams) => {
    onChange({ ...condition, lensId: buildLensId(kind, { ...params, ...nextParams }) });
  };

  const handleFeatureChange = (featureKey: string) => {
    const info = getLensFeatureInfo(kind, featureKey);
    if (!info) return;
    onChange({
      ...condition,
      featureKey,
      operator: lensOperatorsForValueKind(info.valueKind)[0],
      value: info.defaultValue,
    });
  };

  const handleNumberValueChange = (raw: string) => {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return;
    const lo = featureInfo.min ?? Number.NEGATIVE_INFINITY;
    const hi = featureInfo.max ?? Number.POSITIVE_INFINITY;
    onChange({ ...condition, value: Math.min(hi, Math.max(lo, n)) });
  };

  const periodInput = (
    value: number | undefined,
    fallback: number,
    onChangePeriod: (period: number) => void,
    label: string,
  ) => (
    <div className="flex items-center gap-1">
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-400`}>{label}</span>
      <input
        type="number"
        min={1}
        className={numberInputClass}
        value={value ?? fallback}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n) && n >= 1) onChangePeriod(n);
        }}
        disabled={readOnly}
      />
    </div>
  );

  return (
    <div className={`flex flex-wrap items-center ${compact ? 'gap-1' : 'gap-2'} ${compact ? 'p-2' : 'p-3'} bg-slate-800 rounded-lg border border-slate-700`}>
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-emerald-400`}>レンズ</span>

      {/* レンズ種別 */}
      <select
        className={baseSelectClass}
        value={kind}
        onChange={(e) => handleKindChange(e.target.value as LensConditionKind)}
        disabled={readOnly}
      >
        {Object.entries(LENS_CONDITION_KIND_INFO).map(([id, info]) => (
          <option key={id} value={id}>
            {info.label}
          </option>
        ))}
      </select>

      {/* パラメータ（種別ごと） */}
      {(kind === 'rsi' || kind === 'bb') &&
        periodInput(params.period, kind === 'rsi' ? 14 : 20, (period) => handleParamsChange({ period }), '期間')}
      {kind === 'macd' && (
        <>
          {periodInput(params.fastPeriod, 12, (fastPeriod) => handleParamsChange({ fastPeriod }), '短期')}
          {periodInput(params.slowPeriod, 26, (slowPeriod) => handleParamsChange({ slowPeriod }), '長期')}
          {periodInput(params.signalPeriod, 9, (signalPeriod) => handleParamsChange({ signalPeriod }), 'シグナル')}
        </>
      )}
      {kind === 'ma' && (
        <>
          <select
            className={baseSelectClass}
            value={params.maType ?? 'ema'}
            onChange={(e) => handleParamsChange({ maType: e.target.value as LensMaType })}
            disabled={readOnly}
            aria-label="MA 種別"
          >
            {LENS_MA_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {periodInput(params.period, 20, (period) => handleParamsChange({ period }), '期間')}
        </>
      )}
      {kind === 'ma_cross' && (
        <>
          <select
            className={baseSelectClass}
            value={params.fastMaType ?? 'ema'}
            onChange={(e) => handleParamsChange({ fastMaType: e.target.value as LensMaType })}
            disabled={readOnly}
            aria-label="短期 MA 種別"
          >
            {LENS_MA_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {periodInput(params.fastMaPeriod, 20, (fastMaPeriod) => handleParamsChange({ fastMaPeriod }), '短期')}
          <select
            className={baseSelectClass}
            value={params.slowMaType ?? 'ema'}
            onChange={(e) => handleParamsChange({ slowMaType: e.target.value as LensMaType })}
            disabled={readOnly}
            aria-label="長期 MA 種別"
          >
            {LENS_MA_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {periodInput(params.slowMaPeriod, 75, (slowMaPeriod) => handleParamsChange({ slowMaPeriod }), '長期')}
        </>
      )}

      {/* featureKey */}
      <select
        className={`${baseSelectClass} ${compact ? 'min-w-[110px]' : 'min-w-[180px]'}`}
        value={featureInfo.key}
        onChange={(e) => handleFeatureChange(e.target.value)}
        disabled={readOnly}
        aria-label="レンズ特徴"
      >
        {featureInfos.map((info) => (
          <option key={info.key} value={info.key}>
            {info.label}
          </option>
        ))}
      </select>

      {/* 演算子（値種別に応じて制限）。保存値が不正な場合(手動 JSON 編集等)は
          先頭の演算子へ見た目だけ差し替えず、実際の値を「無効」と明示して
          ユーザーが正しい値へ直せるようにする(Copilot レビュー対応 PR #399) */}
      <select
        className={`${baseSelectClass} ${allowedOperators.includes(condition.operator) ? '' : 'border-red-600 text-red-300'}`}
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as LensConditionOperator })}
        disabled={readOnly}
        aria-label="比較演算子"
      >
        {!allowedOperators.includes(condition.operator) && (
          <option value={condition.operator} disabled>
            {`${condition.operator}（無効な演算子）`}
          </option>
        )}
        {allowedOperators.map((op) => (
          <option key={op} value={op}>
            {LENS_OPERATOR_INFO[op]}
          </option>
        ))}
      </select>

      {/* 値（値種別に応じた入力） */}
      {(featureInfo.valueKind === 'enum' || featureInfo.valueKind === 'event') && (
        <select
          className={baseSelectClass}
          value={typeof condition.value === 'string' ? condition.value : String(featureInfo.defaultValue)}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          disabled={readOnly}
          aria-label="比較値"
        >
          {(featureInfo.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {featureInfo.valueKind === 'bool' && (
        <select
          className={baseSelectClass}
          value={condition.value === true ? 'true' : 'false'}
          onChange={(e) => onChange({ ...condition, value: e.target.value === 'true' })}
          disabled={readOnly}
          aria-label="比較値"
        >
          <option value="true">はい</option>
          <option value="false">いいえ</option>
        </select>
      )}
      {featureInfo.valueKind === 'number' && (
        <input
          type="number"
          className={numberInputClass}
          value={typeof condition.value === 'number' ? condition.value : Number(featureInfo.defaultValue)}
          min={featureInfo.min}
          max={featureInfo.max}
          step={featureInfo.step}
          onChange={(e) => handleNumberValueChange(e.target.value)}
          disabled={readOnly}
          aria-label="比較値"
        />
      )}

      {/* 直近ルックバック */}
      {(!readOnly || (condition.lookbackBars ?? 0) > 1) && (
        <LookbackControl
          value={condition.lookbackBars}
          onChange={(bars) => onChange({ ...condition, lookbackBars: bars })}
          readOnly={readOnly}
          compact={compact}
        />
      )}

      {/* マルチタイムフレーム (この条件だけ別の足で評価) */}
      {(!readOnly || condition.timeframeOverride !== undefined) && (
        <TimeframeOverrideControl
          value={condition.timeframeOverride}
          onChange={(tf) => onChange({ ...condition, timeframeOverride: tf })}
          readOnly={readOnly}
          compact={compact}
        />
      )}

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

      <div className="w-full mt-1 text-[11px] text-gray-400">
        {featureInfo.description && <span>{featureInfo.description}　</span>}
        <span className="text-gray-500">
          ※ エントリープレビューはレンズ条件未対応（不成立扱い）。バックテスト・ライブ評価では有効
        </span>
      </div>
    </div>
  );
}

// ============================================
// 時間条件コンポーネント
// ============================================

interface TimeConditionProps {
  condition: TimeCondition;
  onChange: (condition: TimeCondition) => void;
  onRemove: () => void;
  readOnly?: boolean;
  canRemove?: boolean;
  compact?: boolean;
}

/**
 * 時間条件（時間帯 / 曜日 / セッション）の入力 UI。すべて JST 基準。
 * 「に成立 / 以外で成立」で時間内・時間外を切り替える（negate）。
 */
function SingleTimeCondition({
  condition,
  onChange,
  onRemove,
  readOnly = false,
  canRemove = true,
  compact = false,
}: TimeConditionProps) {
  const baseSelectClass = compact
    ? "px-1 py-0.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-xs"
    : "px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm";
  const baseInputClass = compact
    ? "px-1 py-0.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-xs"
    : "px-2 py-1.5 rounded bg-slate-700 text-gray-200 border border-slate-600 text-sm";

  // 種別を切り替える（種別ごとのデフォルト値で作り直す。negate は引き継ぐ）
  const handleKindChange = (kind: TimeConditionKind) => {
    const negate = condition.negate;
    if (kind === 'time_range') {
      // 既定 09:00〜15:00
      onChange({ conditionId: condition.conditionId, type: 'time', kind: 'time_range', startMinutes: 9 * 60, endMinutes: 15 * 60, negate });
      return;
    }
    if (kind === 'day_of_week') {
      // 既定 月〜金
      onChange({ conditionId: condition.conditionId, type: 'time', kind: 'day_of_week', days: [1, 2, 3, 4, 5], negate });
      return;
    }
    onChange({ conditionId: condition.conditionId, type: 'time', kind: 'session', session: 'tokyo', negate });
  };

  const toggleDay = (day: number) => {
    if (condition.kind !== 'day_of_week') return;
    const set = new Set(condition.days);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    onChange({ ...condition, days: Array.from(set).sort((a, b) => a - b) });
  };

  return (
    <div className={`flex flex-wrap items-center ${compact ? 'gap-1' : 'gap-2'} ${compact ? 'p-2' : 'p-3'} bg-slate-800 rounded-lg border border-slate-700`}>
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-amber-300/80`}>時間</span>

      {/* 種別 */}
      <select
        className={baseSelectClass}
        value={condition.kind}
        onChange={(e) => handleKindChange(e.target.value as TimeConditionKind)}
        disabled={readOnly}
      >
        <option value="session">セッション</option>
        <option value="time_range">時間帯</option>
        <option value="day_of_week">曜日</option>
      </select>

      {/* セッション */}
      {condition.kind === 'session' && (
        <select
          className={`${baseSelectClass} ${compact ? 'min-w-[120px]' : 'min-w-[180px]'}`}
          value={condition.session}
          onChange={(e) => onChange({ ...condition, session: e.target.value as SessionId })}
          disabled={readOnly}
        >
          {Object.entries(SESSION_PRESETS_JST).map(([id, preset]) => (
            <option key={id} value={id}>
              {preset.label}（{minutesToHHMM(preset.startMinutes)}–{minutesToHHMM(preset.endMinutes)} JST）
            </option>
          ))}
        </select>
      )}

      {/* 時間帯 */}
      {condition.kind === 'time_range' && (
        <div className="flex items-center gap-1">
          <input
            type="time"
            className={`${compact ? 'w-20' : 'w-24'} ${baseInputClass}`}
            value={minutesToHHMM(condition.startMinutes)}
            onChange={(e) => {
              const m = hhmmToMinutes(e.target.value);
              if (m !== null) onChange({ ...condition, startMinutes: m });
            }}
            disabled={readOnly}
          />
          <span className="text-xs text-gray-500">〜</span>
          <input
            type="time"
            className={`${compact ? 'w-20' : 'w-24'} ${baseInputClass}`}
            value={minutesToHHMM(condition.endMinutes)}
            onChange={(e) => {
              const m = hhmmToMinutes(e.target.value);
              if (m !== null) onChange({ ...condition, endMinutes: m });
            }}
            disabled={readOnly}
          />
          <span className="text-[10px] text-gray-500">JST</span>
        </div>
      )}

      {/* 曜日 */}
      {condition.kind === 'day_of_week' && (
        <div className="flex items-center gap-0.5">
          {DAY_OF_WEEK_LABELS.map((label, day) => {
            const selected = condition.days.includes(day);
            return (
              <button
                type="button"
                key={day}
                onClick={() => toggleDay(day)}
                disabled={readOnly}
                className={`${compact ? 'w-5 h-5 text-[10px]' : 'w-7 h-7 text-xs'} rounded border transition-colors ${
                  selected
                    ? 'bg-amber-600 border-amber-500 text-white'
                    : 'bg-slate-700 border-slate-600 text-gray-400 hover:border-amber-500'
                }`}
              >
                {label}
              </button>
            );
          })}
          <span className="ml-1 text-[10px] text-gray-500">JST</span>
        </div>
      )}

      {/* 時間内 / 時間外 */}
      <select
        className={baseSelectClass}
        value={condition.negate ? 'outside' : 'inside'}
        onChange={(e) => onChange({ ...condition, negate: e.target.value === 'outside' })}
        disabled={readOnly}
        title="この時間に成立させるか、この時間以外で成立させるか"
      >
        <option value="inside">に成立</option>
        <option value="outside">以外で成立</option>
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
    </div>
  );
}

// ============================================
// 接合点セレクタ（かつ / または を接合点ごとに選ぶ）
// ============================================

interface JunctionSelectProps {
  /** 現在の結合子 */
  value: 'AND' | 'OR';
  /** この接合点のグローバル index（items[index] と items[index+1] の間） */
  junctionIndex: number;
  /** 変更コールバック */
  onChange: (junctionIndex: number, op: 'AND' | 'OR') => void;
  readOnly?: boolean;
  compact?: boolean;
}

/**
 * 接合点ごとの「かつ / または」を切り替える小さなセレクタ。
 * 値に応じて色を変え、AND（青）/ OR（緑）で視覚的に区別する。
 */
function JunctionSelect({ value, junctionIndex, onChange, readOnly = false, compact = false }: JunctionSelectProps) {
  const colorClass = value === 'AND'
    ? 'bg-blue-900/50 text-blue-200 border-blue-700'
    : 'bg-green-900/50 text-green-200 border-green-700';
  return (
    <div className={`flex items-center justify-center ${compact ? 'py-0.5' : 'py-1'}`}>
      <select
        className={`${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs'} rounded-full font-medium border ${colorClass} ${readOnly ? 'pointer-events-none opacity-80' : 'cursor-pointer'}`}
        value={value}
        onChange={(e) => onChange(junctionIndex, e.target.value as 'AND' | 'OR')}
        disabled={readOnly}
        title="この接合点の論理条件（かつ / または）"
      >
        <option value="AND">かつ (AND)</option>
        <option value="OR">または (OR)</option>
      </select>
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
  // AND/OR グループは「接合点ごとに AND/OR を選べる」フラット UI で表示する。
  // NOT / IF_THEN / SEQUENCE はグループ単位の意味を持つため、従来の単一演算子 UI にフォールバックする。
  const flattenable = isFlattenableGroup(group);
  const flat = flattenable ? flattenConditionGroup(group) : null;

  // フラット表現を標準形ツリー（OR 外・AND 内）に正規化して親へ通知する。
  // これにより評価器・DB・API は無改修のまま、UI だけ接合点モデルにできる。
  const emitFlat = (items: ConditionChild[], junctions: ('AND' | 'OR')[]) => {
    onChange(normalizeFlatConditions({ items, junctions }, group.groupId));
  };

  // --- 通常モード（AND/OR 個別指定）の編集ハンドラ ---
  const handleItemChange = (index: number, updated: ConditionChild) => {
    if (!flat) return;
    const items = [...flat.items];
    items[index] = updated;
    emitFlat(items, flat.junctions);
  };

  const handleItemRemove = (index: number) => {
    if (!flat) return;
    const items = flat.items.filter((_, i) => i !== index);
    // 削除した要素に隣接する接合点を 1 つ落とす（先頭なら後ろ側、それ以外は前側）
    const dropAt = index === 0 ? 0 : index - 1;
    const junctions = flat.junctions.filter((_, j) => j !== dropAt);
    emitFlat(items, junctions);
  };

  const handleJunctionChange = (junctionIndex: number, op: 'AND' | 'OR') => {
    if (!flat) return;
    const junctions = [...flat.junctions];
    junctions[junctionIndex] = op;
    emitFlat(flat.items, junctions);
  };

  // 末尾に要素を 1 つ足す（直前との接合点はデフォルト AND）
  const appendChild = (child: ConditionChild) => {
    if (!flat) {
      // 高度モード（NOT/IF_THEN/SEQUENCE）はツリーへ直接追加
      onChange({ ...group, conditions: [...group.conditions, child] });
      return;
    }
    const items = [...flat.items, child];
    const junctions = flat.items.length === 0 ? [] : [...flat.junctions, 'AND' as const];
    emitFlat(items, junctions);
  };

  const handleAddCondition = () => appendChild(createDefaultCondition());
  const handleAddPatternCondition = () =>
    appendChild({ conditionId: generateConditionId(), type: 'pattern', patternId: 'pinbar', operator: 'is_true' });
  const handleAddTimeCondition = () => appendChild(createDefaultTimeCondition());
  const handleAddLensCondition = () => appendChild(createDefaultLensCondition());
  const handleAddSubGroup = () =>
    appendChild({ groupId: generateGroupId(), operator: 'AND', conditions: [] });

  // --- 結合モード切替（通常 = AND/OR 個別 / 高度 = SEQUENCE・IF_THEN・NOT） ---
  const combineMode: 'MIXED' | LogicalOperator = flattenable ? 'MIXED' : group.operator;
  const handleCombineModeChange = (mode: 'MIXED' | LogicalOperator) => {
    // 通常へ戻すときは operator を AND に寄せて接合点モデルに復帰（conditions はそのまま）
    onChange({ ...group, operator: mode === 'MIXED' ? 'AND' : mode });
  };
  const handleMaxBarsBetweenStepsChange = (value: number) => {
    const next = Number.isFinite(value) ? Math.max(1, Math.min(value, 500)) : 10;
    onChange({ ...group, maxBarsBetweenSteps: next });
  };

  // --- 高度モード（NOT/IF_THEN/SEQUENCE）の編集ハンドラ（従来挙動を維持） ---
  const handleLegacyChange = (index: number, updated: ConditionChild) => {
    const newConditions = [...group.conditions];
    newConditions[index] = updated;
    onChange({ ...group, conditions: newConditions });
  };
  const handleLegacyRemove = (index: number) => {
    if (group.conditions.length <= 1) return; // 最低1つは残す
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) });
  };

  const bgColors = ['bg-slate-900', 'bg-slate-800/50', 'bg-slate-700/30'];
  const borderColors = ['border-slate-700', 'border-slate-600', 'border-slate-500'];

  // 子要素（条件 / パターン / サブグループ）の React key
  const childKey = (child: ConditionChild): string =>
    isConditionGroup(child) ? child.groupId : child.conditionId;

  // 子要素を描画する共通関数（通常モード・高度モードで共有）
  const renderChild = (
    child: ConditionChild,
    onChildChange: (updated: ConditionChild) => void,
    onChildRemove: () => void,
    canRemove: boolean,
  ) => {
    if (isIndicatorCondition(child)) {
      return (
        <SingleCondition
          condition={child}
          onChange={onChildChange}
          onRemove={onChildRemove}
          indicatorMetadata={indicatorMetadata}
          readOnly={readOnly}
          canRemove={canRemove}
          compact={compact}
        />
      );
    }
    if (isPatternCondition(child)) {
      return (
        <SinglePatternCondition
          condition={child}
          onChange={onChildChange}
          onRemove={onChildRemove}
          readOnly={readOnly}
          canRemove={canRemove}
          compact={compact}
        />
      );
    }
    if (isTimeCondition(child)) {
      return (
        <SingleTimeCondition
          condition={child}
          onChange={onChildChange}
          onRemove={onChildRemove}
          readOnly={readOnly}
          canRemove={canRemove}
          compact={compact}
        />
      );
    }
    if (isLensCondition(child)) {
      return (
        <SingleLensCondition
          condition={child}
          onChange={onChildChange}
          onRemove={onChildRemove}
          readOnly={readOnly}
          canRemove={canRemove}
          compact={compact}
        />
      );
    }
    return (
      <ConditionGroupComponent
        group={child}
        onChange={onChildChange}
        onRemove={onChildRemove}
        indicatorMetadata={indicatorMetadata}
        readOnly={readOnly}
        depth={depth + 1}
        compact={compact}
      />
    );
  };

  // 通常モードの AND ラン分割（枠で囲むための index グルーピング）
  const arms: number[][] = [];
  if (flat) {
    let current: number[] = [];
    flat.items.forEach((_, i) => {
      if (i > 0 && flat.junctions[i - 1] === 'OR') {
        arms.push(current);
        current = [];
      }
      current.push(i);
    });
    if (current.length > 0) arms.push(current);
  }

  return (
    <div className={`${compact ? 'p-2' : 'p-4'} rounded-lg border ${bgColors[Math.min(depth, 2)]} ${borderColors[Math.min(depth, 2)]}`}>
      {/* グループヘッダー */}
      <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-3'}`}>
        <div className="flex items-center gap-2">
          {!compact && (
            <span className="text-xs text-gray-500">
              {depth === 0 ? 'エントリー条件' : `グループ ${depth}`}
            </span>
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
      {flat ? (
        // 通常モード: 接合点ごとに AND/OR を選べる。AND ラン（かつ で繋がる塊）を枠で囲み、
        // 枠の境界が または（OR）になる = ブール優先順位（AND を内、OR を外）を視覚化する。
        <div className={compact ? 'space-y-1' : 'space-y-2'}>
          {flat.items.length === 0 && (
            <p className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 italic`}>
              条件がありません。下のボタンで追加してください。
            </p>
          )}
          {arms.map((arm, armIdx) => (
            <React.Fragment key={`arm-${armIdx}-${childKey(flat.items[arm[0]])}`}>
              {/* アーム間の境界 = または（OR、編集可能） */}
              {armIdx > 0 && (
                <JunctionSelect
                  value="OR"
                  junctionIndex={arm[0] - 1}
                  onChange={handleJunctionChange}
                  readOnly={readOnly}
                  compact={compact}
                />
              )}
              {/* AND ラン（2 件以上のときだけ枠で囲んで「ひと塊」を強調） */}
              <div
                className={
                  arm.length > 1
                    ? `rounded-lg border border-blue-800/60 bg-blue-950/20 ${compact ? 'p-1.5 space-y-1' : 'p-2 space-y-2'}`
                    : ''
                }
              >
                {arm.map((itemIndex, posInArm) => (
                  <React.Fragment key={childKey(flat.items[itemIndex])}>
                    {/* ラン内の接合点 = かつ（AND、編集可能） */}
                    {posInArm > 0 && (
                      <JunctionSelect
                        value="AND"
                        junctionIndex={itemIndex - 1}
                        onChange={handleJunctionChange}
                        readOnly={readOnly}
                        compact={compact}
                      />
                    )}
                    {renderChild(
                      flat.items[itemIndex],
                      (updated) => handleItemChange(itemIndex, updated),
                      () => handleItemRemove(itemIndex),
                      flat.items.length > 1,
                    )}
                  </React.Fragment>
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      ) : (
        // 高度モード（NOT / IF_THEN / SEQUENCE）: 従来の単一演算子表示
        <div className={compact ? 'space-y-1' : 'space-y-2'}>
          {group.conditions.map((condition, index) => (
            <React.Fragment key={childKey(condition)}>
              {index > 0 && (
                <div className={`flex items-center justify-center ${compact ? 'py-0.5' : 'py-1'}`}>
                  <span
                    className={`${compact ? 'px-2 text-[10px]' : 'px-3 text-xs'} py-0.5 font-medium rounded-full bg-orange-900/50 text-orange-300`}
                    title={`このグループ内の結合: ${LOGICAL_OPERATOR_INFO[group.operator].description}`}
                  >
                    {LOGICAL_OPERATOR_INFO[group.operator].label}
                  </span>
                </div>
              )}
              {renderChild(
                condition,
                (updated) => handleLegacyChange(index, updated),
                () => handleLegacyRemove(index),
                group.conditions.length > 1,
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* 追加ボタン + 結合モード */}
      {!readOnly && (
        <div className={`${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'} border-t border-slate-700`}>
          <div className={`flex flex-wrap items-center gap-2 ${compact ? 'mb-2' : 'mb-3'}`}>
            <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-400`}>結合モード</span>
            <select
              className={`${compact ? 'px-1.5 py-0.5 text-xs' : 'px-3 py-1.5 text-sm'} rounded bg-slate-700 text-gray-200 border border-slate-600 font-medium`}
              value={combineMode}
              onChange={(e) => handleCombineModeChange(e.target.value as 'MIXED' | LogicalOperator)}
            >
              <option value="MIXED">AND / OR を個別に指定（推奨）</option>
              <option value="SEQUENCE">順序（{LOGICAL_OPERATOR_INFO.SEQUENCE.description}）</option>
              <option value="IF_THEN">IF → THEN（{LOGICAL_OPERATOR_INFO.IF_THEN.description}）</option>
              <option value="NOT">〜でない（{LOGICAL_OPERATOR_INFO.NOT.description}）</option>
            </select>

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
                />
                {!compact && <span className="text-xs text-gray-500">バー</span>}
              </div>
            )}
          </div>

          <div className="flex gap-2">
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

          <button
            type="button"
            onClick={handleAddTimeCondition}
            className={`flex items-center gap-1 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors`}
          >
            <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {compact ? '+時間' : '時間条件を追加'}
          </button>

          <button
            type="button"
            onClick={handleAddLensCondition}
            className={`flex items-center gap-1 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors`}
            title="レンズ（正規化済みの市場特徴: RSI ゾーン / MA クロス等）を条件として使う"
          >
            <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {compact ? '+レンズ' : 'レンズ条件を追加'}
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
