/**
 * DSL シミュ用に ohlcv 上で前計算すべき特徴量（rsi / atr）の判定
 *
 * 条件式・SL/TP 型に応じ、不要な配列（例: 条件に RSI 未使用なのに全バー計算）を作らない。
 *
 * 注意: 現状スナップショットに載せるのは ohlcv レンズの rsi/atr のみ。他レンズは本シミュでは未展開。
 */

import type { Condition, ConditionGroup } from './schema';
import type { StrategyDSL } from './schema';
import { isWaitForTriggerEntry } from './types';

/** 前計算が必要な ohlcv 特徴（シミュの buildFeatureTable 用） */
export interface DslOhlcvFeatureNeeds {
  rsi: boolean;
  atr: boolean;
}

function walkGroup(group: ConditionGroup, onLeaf: (c: Condition) => void) {
  for (const c of group.conditions) {
    if ('logic' in c) {
      walkGroup(c, onLeaf);
    } else {
      onLeaf(c as Condition);
    }
  }
}

/**
 * 当該 DSL でシミュ中に ohlcv.rsi / ohlcv.atr を要するかを列挙する
 */
export function collectDslOhlcvFeatureNeeds(dsl: StrategyDSL): DslOhlcvFeatureNeeds {
  const out: DslOhlcvFeatureNeeds = { rsi: false, atr: false };
  const mark = (c: Condition) => {
    if (c.lens === 'ohlcv') {
      if (c.feature === 'rsi') out.rsi = true;
      if (c.feature === 'atr') out.atr = true;
    }
  };

  const e = dsl.entry;
  if (isWaitForTriggerEntry(e)) {
    walkGroup(e.triggerConditions, mark);
  } else if ('trigger' in e) {
    walkGroup(e.trigger, mark);
  }

  if (dsl.stopLoss.type === 'atr_multiple') {
    out.atr = true;
  }
  if (dsl.takeProfit.type === 'atr_multiple') {
    out.atr = true;
  }

  return out;
}
