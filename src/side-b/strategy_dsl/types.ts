/**
 * 戦略 DSL の補助型（Phase 6.7b）
 *
 * Zod スキーマ（schema.ts）の union を TypeScript 側で絞り込むための型ガードを提供する。
 *
 * @see docs/design/phase_6_7b_bt_layer.md
 */

import type { ConditionGroup, ParameterField, StrategyDSL } from './schema';

// Re-export 供与（schema と二重定義しない）
export type { ParameterField };

/**
 * 即時エントリー従来形（Phase 5）
 * トリガー満了バーでエントリー（シミュレーション内は同バー終値基準）
 */
export type ImmediateEntry = {
  direction: 'long' | 'short';
  trigger: ConditionGroup;
  orderType: 'market' | 'limit' | 'stop';
  type?: 'immediate';
};

/**
 * 条件成立まで待機し、次バー始値で約定
 */
export type WaitForTriggerEntry = {
  type: 'wait_for_trigger';
  direction: 'long' | 'short';
  triggerConditions: ConditionGroup;
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

function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * 旧 ParameterDef 形式。
 * Critical-4 4a-parameters: 緩いスキーマで simple object も parameters に入りうるため、
 * 数値型まで実値レベルで検証する (`{ range: ['1','3'], default: '2', type: 'int' }`
 * のような raw 値を structured と誤判定しない)。
 */
export function isLegacyParameterDef(
  v: ParameterField,
): v is { range: [number, number]; default: number; type: 'int' | 'float' } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const obj = v as { range?: unknown; default?: unknown; type?: unknown };
  if (!Array.isArray(obj.range) || obj.range.length !== 2) return false;
  if (!isFiniteNum(obj.range[0]) || !isFiniteNum(obj.range[1])) return false;
  if (!isFiniteNum(obj.default)) return false;
  return obj.type === 'int' || obj.type === 'float';
}

/**
 * Phase 6.7b の範囲スイープ定義。
 * Critical-4 4a-parameters: `kind: 'range'` だけでなく min/max/step/default が
 * **finite number** であることまで検証する (= 文字列 "1" 等が混じった偽 V2 を弾く)。
 */
export function isParameterRangeV2(
  v: ParameterField,
): v is { kind: 'range'; min: number; max: number; step: number; default: number } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const obj = v as { kind?: unknown; min?: unknown; max?: unknown; step?: unknown; default?: unknown };
  if (obj.kind !== 'range') return false;
  return (
    isFiniteNum(obj.min) &&
    isFiniteNum(obj.max) &&
    isFiniteNum(obj.step) &&
    obj.step > 0 &&
    isFiniteNum(obj.default)
  );
}

/**
 * Critical-4 4a-parameters: LLM が出した raw scalar (number / string / boolean / null)
 * structured 定義ではないが、`number` であれば surrogate fitness の単一値として扱える。
 */
export function isRawParameterValue(v: ParameterField): v is number | string | boolean | null {
  return v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
}

/**
 * raw scalar でも structured 定義でもない、自由形のオブジェクト。
 * 例: `{ min: 0.5, max: 1.0 }` (= range 候補だが kind:'range' タグが無い)。
 * consumer 側では warning + 単一既定値扱いにする (= grid 展開しない)。
 *
 * Critical-4 4a-parameters: 戻り型を `Record<string, raw scalar>` で narrow するため、
 * 全 value が raw scalar (number / string / boolean / null) であることを実値レベルで
 * 検証する。Zod の SimpleParameterObjectSchema が同条件を強制しているので通常パスでは
 * 必ず通るが、`as never` 等の型回避経由で値が混入したケースに対して honest なガードを
 * 提供するため。
 */
export function isSimpleParameterObject(
  v: ParameterField,
): v is Record<string, number | string | boolean | null> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  if (isLegacyParameterDef(v) || isParameterRangeV2(v)) return false;
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (
      value !== null &&
      typeof value !== 'number' &&
      typeof value !== 'string' &&
      typeof value !== 'boolean'
    ) {
      return false;
    }
  }
  return true;
}
