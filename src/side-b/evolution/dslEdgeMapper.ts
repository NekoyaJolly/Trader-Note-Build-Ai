/**
 * StrategyDSL から EdgeHypothesis 用の MachineReadableCondition への単純マッピング
 *
 * PR ①-B (post-Phase 5A): DSL OpSchema は cross / Touch / is_* を含むが、
 * `MachineReadableCondition.op` (= conditionMatcher が解釈できる ConditionOp) は
 * 従来 8 op に限定。台帳の代表 leaf は **legacy op を持つ leaf** から選ぶ
 * (新 op leaf は skip)。新 op leaf しか無い DSL では default の常時 true 条件を
 * 返すが、これは「台帳の代表サンプル」用途なので運用上の汚染源にはならない
 * (mutation 経路は OpSchema 全体を扱うため、新 op が消える訳ではない)。
 */

import type { ConditionOp, MachineReadableCondition } from '../models/edgeHypothesis';
import type { Condition, ConditionGroup, StrategyDSL } from '../strategy_dsl/schema';
import { isWaitForTriggerEntry } from '../strategy_dsl/types';

const LEGACY_OPS: readonly ConditionOp[] = [
  '<',
  '<=',
  '>',
  '>=',
  '==',
  '!=',
  'between',
  'in',
];

function isLegacyConditionOp(op: string): op is ConditionOp {
  return (LEGACY_OPS as readonly string[]).includes(op);
}

/** 再帰グループから最初の葉条件を取得 */
export function firstLeafCondition(group: ConditionGroup): Condition | null {
  for (const c of group.conditions) {
    if (c && typeof c === 'object' && 'logic' in c) {
      const inner = firstLeafCondition(c);
      if (inner) return inner;
    } else if (c && typeof c === 'object' && 'lens' in c) {
      return c;
    }
  }
  return null;
}

/** legacy op (ConditionOp 互換) を持つ最初の leaf を再帰的に取得 */
function firstLegacyLeafCondition(group: ConditionGroup): Condition | null {
  for (const c of group.conditions) {
    if (c && typeof c === 'object' && 'logic' in c) {
      const inner = firstLegacyLeafCondition(c);
      if (inner) return inner;
    } else if (c && typeof c === 'object' && 'lens' in c && isLegacyConditionOp(c.op)) {
      return c;
    }
  }
  return null;
}

/** 代表条件 1 本に落とす（台帳保存用の最小セット） */
export function dslToMachineConditions(dsl: StrategyDSL): MachineReadableCondition[] {
  const g = isWaitForTriggerEntry(dsl.entry) ? dsl.entry.triggerConditions : dsl.entry.trigger;
  const leaf = firstLegacyLeafCondition(g);
  if (!leaf) {
    return [
      {
        lensName: 'ohlcv',
        featureKey: 'close',
        op: '>',
        value: 0,
      },
    ];
  }
  let value: MachineReadableCondition['value'];
  if (typeof leaf.value === 'number' || typeof leaf.value === 'boolean') {
    value = leaf.value;
  } else if (Array.isArray(leaf.value) && leaf.value.length === 2 && typeof leaf.value[0] === 'number') {
    value = leaf.value as [number, number];
  } else if (Array.isArray(leaf.value)) {
    value = leaf.value.map(String);
  } else if (typeof leaf.value === 'string' && !leaf.value.startsWith('$')) {
    value = leaf.value;
  } else {
    value = 0;
  }

  return [
    {
      lensName: leaf.lens,
      featureKey: leaf.feature,
      // 上の firstLegacyLeafCondition で legacy op に絞り込み済みなので as-cast 安全
      op: leaf.op as ConditionOp,
      value,
    },
  ];
}
