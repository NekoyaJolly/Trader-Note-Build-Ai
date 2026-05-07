/**
 * DSL シミュ用に ohlcv 上で前計算すべき特徴量（rsi / atr）の判定
 *
 * 条件式・SL/TP 型に応じ、不要な配列（例: 条件に RSI 未使用なのに全バー計算）を作らない。
 *
 * PR #116b: TS surrogate が新たに対応した indicator (ema/sma/rsi/atr/macd/bb) +
 * `Condition.params` / `compareTarget` を扱うため、`collectDslIndicatorNeeds` を追加。
 * 既存 `collectDslOhlcvFeatureNeeds` (rsi/atr の bool のみ) は後方互換のため残す。
 */

// PR ④F: TS surrogate 専用の `isTsSurrogateIndicatorFeature` (= 6 個限定) は撤廃。
// 全 indicator は analysis-engine 経由で取得可能 = registry の `pythonSeries=true`
// に該当する 20 個全部が candidate。collect 段階では `isPythonSupportedIndicatorId`
// で判定する。
import { isPythonSupportedIndicatorId } from '../../shared/indicators/registry';
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
 * `lens === 'ohlcv'` かつ `feature` が **registry の pythonSeries=true** に該当する
 * indicator のみ拾う (= analysis-engine が計算可能な 20 個)。それ以外 (= 別 lens /
 * 未対応 feature / pythonSeries=false の adx/supertrend/pivot) は **collect 対象外**
 * → seriesMap に積まれず leaf 評価で false に倒れる。
 *
 * 同じ snapshot key が複数 condition から参照された場合は重複排除。
 */
export function collectDslIndicatorNeeds(dsl: StrategyDSL): DslIndicatorNeed[] {
  const map = new Map<string, DslIndicatorNeed>();
  const visit = (lens: string, feature: string, params?: ConditionParams) => {
    if (lens !== 'ohlcv') return;
    if (!isPythonSupportedIndicatorId(feature)) return;
    // **既知の例外** (PR #116b Copilot review #2+#3):
    // params なしの ohlcv.rsi / ohlcv.atr は依然として legacy TS 計算経路
    // (`surrogateFitnessSimulation` 内 `computeRsi` / `computeAtr` で SMA / TR ベース
    // 計算) を使う。HTTP 経由の pandas_ta (Wilder smoothing) と式が違うため、ここで
    // HTTP 取得 series に置き換えると **既存戦略の挙動が変わる**。
    // PR ④F の主旨「TS 計算経路を撤廃して analysis-engine 一本化」に対する **唯一の
    // 例外**。後追い PR で `BarFeatureTable.rsi / atr` 自体を HTTP 経由に置き換える
    // 際に解消予定。params 付き (例: rsi(period=21)) は本除外の対象外で、HTTP 経由
    // で取得される。
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
