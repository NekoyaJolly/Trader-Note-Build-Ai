/**
 * 戦略 DSL の補助型（Phase 6.7b）
 *
 * Zod スキーマ（schema.ts）の union を TypeScript 側で絞り込むための型ガードを提供する。
 *
 * @see docs/design/phase_6_7b_bt_layer.md
 */

import type { ParameterField, StrategyDSL } from './schema';

// Re-export 供与（schema と二重定義しない）
export type { ParameterField };

/**
 * 即時エントリー従来形（Phase 5）
 * トリガー満了バーでエントリー（シミュレーション内は同バー終値基準）
 */
export type ImmediateEntry = {
  direction: 'long' | 'short';
  trigger: import('./schema').ConditionGroup;
  orderType: 'market' | 'limit' | 'stop';
  type?: 'immediate';
};

/**
 * 条件成立まで待機し、次バー始値で約定
 */
export type WaitForTriggerEntry = {
  type: 'wait_for_trigger';
  direction: 'long' | 'short';
  triggerConditions: import('./schema').ConditionGroup;
  maxWaitBars: number;
  executionType: 'market' | 'limit';
  limitPrice?: number;
};

/**
 * レガシー ParameterDef か Phase 6.7b の range 指定か
 */
export function isWaitForTriggerEntry(
  e: StrategyDSL['entry'],
): e is WaitForTriggerEntry {
  return 'type' in e && (e as { type?: string }).type === 'wait_for_trigger';
}

/**
 * 旧 ParameterDef 形式
 */
export function isLegacyParameterDef(
  v: ParameterField,
): v is { range: [number, number]; default: number; type: 'int' | 'float' } {
  return 'range' in v && Array.isArray(v.range);
}

/**
 * Phase 6.7b の範囲スイープ定義
 */
export function isParameterRangeV2(
  v: ParameterField,
): v is { kind: 'range'; min: number; max: number; step: number; default: number } {
  return (v as { kind?: string }).kind === 'range';
}
