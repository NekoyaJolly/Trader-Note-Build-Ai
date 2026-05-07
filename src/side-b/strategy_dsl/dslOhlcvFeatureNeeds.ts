/**
 * DSL シミュ用に ohlcv 上で前計算すべき特徴量（rsi / atr）の判定
 *
 * 条件式・SL/TP 型に応じ、不要な配列（例: 条件に RSI 未使用なのに全バー計算）を作らない。
 *
 * PR #116b: TS surrogate が新たに対応した indicator (ema/sma/rsi/atr/macd/bb) +
 * `Condition.params` / `compareTarget` を扱うため、`collectDslIndicatorNeeds` を追加。
 * 既存 `collectDslOhlcvFeatureNeeds` (rsi/atr の bool のみ) は後方互換のため残す。
 */

import { isTsSurrogateIndicatorFeature } from './indicatorSurrogate';
import type { Condition, ConditionGroup, ConditionParams } from './schema';
import type { StrategyDSL } from './schema';
import { buildSnapshotKey } from './snapshotKey';
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
      onLeaf(c);
    }
  }
}

/**
 * 当該 DSL でシミュ中に ohlcv.rsi / ohlcv.atr を要するかを列挙する。
 *
 * PR #120 Copilot review #9: leaf の `compareTarget` も走査して、operand が
 * static rsi/atr (params なし、例: `compareTarget=rsi`) を参照する場合に
 * mark する。これがないと `close > rsi (compareTarget)` が rsi 未計算で
 * 常に false 評価になる。params 付き compareTarget は
 * `collectDslIndicatorNeeds` 経路で別途処理されるため重複しない。
 */
export function collectDslOhlcvFeatureNeeds(dsl: StrategyDSL): DslOhlcvFeatureNeeds {
  const out: DslOhlcvFeatureNeeds = { rsi: false, atr: false };
  const markFeature = (lens: string, feature: string, params?: ConditionParams) => {
    if (lens !== 'ohlcv') return;
    // params 付きは dynamic 経路 (collectDslIndicatorNeeds) で処理する
    if (params && Object.keys(params).length > 0) return;
    if (feature === 'rsi') out.rsi = true;
    if (feature === 'atr') out.atr = true;
  };
  const mark = (c: Condition) => {
    markFeature(c.lens, c.feature, c.params);
    if (c.compareTarget) {
      markFeature(c.compareTarget.lens, c.compareTarget.feature, c.compareTarget.params);
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

/**
 * PR #116b: TS surrogate が新たに対応する indicator (params 付き / compareTarget) の
 * 集計エントリ。`buildBarFeatureTable` が必要な series のみ計算するために使う。
 */
export interface DslIndicatorNeed {
  /** indicator feature 名 (ema, sma, rsi, atr, macd, bb のいずれか) */
  feature: string;
  /** 動的パラメータ。空なら指標のデフォルト値 */
  params: ConditionParams;
  /**
   * snapshot key。`buildSnapshotKey(lens, feature, params)` の戻り値で、
   * - params なしの場合: `${lens}.${feature}`              (例: `ohlcv.rsi`)
   * - params ありの場合: `${lens}.${feature}(stable_params)` (例: `ohlcv.ema(period=20)`)
   */
  snapshotKey: string;
}

/**
 * DSL を walk して、TS surrogate が事前計算すべき indicator series 一覧を抽出する。
 *
 * 対象:
 *   - leaf condition の `lens.feature(params)` (params なしの ohlcv.rsi/atr 等も含む、後方互換)
 *   - `compareTarget` の `lens.feature(params)`
 *
 * `lens === 'ohlcv'` かつ `feature` が `isTsSurrogateIndicatorFeature` を満たすものだけ
 * 拾う。それ以外 (= 別 lens / 未対応 feature) は `null` 扱いとして evaluator 側で
 * false 評価される (= Phase 6.7b の方針)。
 *
 * 同じ snapshot key が複数 condition から参照された場合は重複排除。
 */
export function collectDslIndicatorNeeds(dsl: StrategyDSL): DslIndicatorNeed[] {
  const map = new Map<string, DslIndicatorNeed>();
  const visit = (lens: string, feature: string, params?: ConditionParams) => {
    if (lens !== 'ohlcv') return;
    if (!isTsSurrogateIndicatorFeature(feature)) return;
    // PR #116b Copilot review #2+#3:
    // params なしの ohlcv.rsi / ohlcv.atr は legacy 経路 (BarFeatureTable.rsi / atr,
    // surrogateFitnessSimulation 内の SMA / TR ベース計算) で既に扱われている。
    // ここで indicatorService 由来 (Wilder ベース) の series を need に積むと、
    // snapshotAt で legacy 計算結果を上書きして数値が変わる = 既存戦略の挙動が変わる。
    // params 指定があるケースのみ TS surrogate adapter 経由で別 key に詰める。
    if ((feature === 'rsi' || feature === 'atr') && (!params || Object.keys(params).length === 0)) {
      return;
    }
    const key = buildSnapshotKey(lens, feature, params);
    if (!map.has(key)) {
      map.set(key, { feature, params: params ?? {}, snapshotKey: key });
    }
  };

  const onLeaf = (c: Condition) => {
    visit(c.lens, c.feature, c.params);
    if (c.compareTarget) {
      visit(c.compareTarget.lens, c.compareTarget.feature, c.compareTarget.params);
    }
  };

  const e = dsl.entry;
  if (isWaitForTriggerEntry(e)) {
    walkGroup(e.triggerConditions, onLeaf);
  } else if ('trigger' in e) {
    walkGroup(e.trigger, onLeaf);
  }

  return Array.from(map.values());
}

/**
 * PR ②-1: DSL が pattern lens (= 12 種ローソク足パターン) を参照しているか。
 *
 * 参照していれば surrogate 側で `computeAllPatternFlags` を 1 回呼んで
 * 全バー分の boolean 配列を pre-compute する。pattern lens は OHLCV のみで
 * 完結し計算コストが軽いので、参照判定だけで足りる (= indicator のように
 * params で series が変わることはない)。
 */
export function collectDslPatternNeed(dsl: StrategyDSL): boolean {
  let needed = false;
  const onLeaf = (c: Condition) => {
    if (c.lens === 'pattern') needed = true;
    if (c.compareTarget && c.compareTarget.lens === 'pattern') needed = true;
  };
  const e = dsl.entry;
  if (isWaitForTriggerEntry(e)) {
    walkGroup(e.triggerConditions, onLeaf);
  } else if ('trigger' in e) {
    walkGroup(e.trigger, onLeaf);
  }
  return needed;
}
