/**
 * StrategyDSL から EdgeHypothesis 用の MachineReadableCondition への単純マッピング
 */

import type { MachineReadableCondition } from '../models/edgeHypothesis';
import type { Condition, ConditionGroup } from '../strategy_dsl/schema';
import { isWaitForTriggerEntry } from '../strategy_dsl/types';

/** 再帰グループから最初の葉条件を取得 */
export function firstLeafCondition(group: ConditionGroup): Condition | null {
  for (const c of group.conditions) {
    if (c && typeof c === 'object' && 'logic' in c) {
      const inner = firstLeafCondition(c as ConditionGroup);
      if (inner) return inner;
    } else if (c && typeof c === 'object' && 'lens' in c) {
      return c as Condition;
    }
  }
  return null;
}

/** 代表条件 1 本に落とす（台帳保存用の最小セット） */
export function dslToMachineConditions(dsl: import('../strategy_dsl/schema').StrategyDSL): MachineReadableCondition[] {
  const g = isWaitForTriggerEntry(dsl.entry) ? dsl.entry.triggerConditions : dsl.entry.trigger;
  const leaf = firstLeafCondition(g);
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
      op: leaf.op,
      value,
    },
  ];
}
