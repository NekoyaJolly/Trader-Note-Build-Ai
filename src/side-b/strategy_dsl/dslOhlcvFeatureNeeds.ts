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
import {
  type CanonicalTimeframe,
  isHigherTimeframe,
  normalizeTimeframe,
} from '../../shared/timeframes';
import type { Condition, ConditionGroup, ConditionParams } from './schema';
import type { StrategyDSL } from './schema';
import { buildSnapshotKeyWithPrimary } from './snapshotKey';
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
 * PR #116b + PR ⑤: TS surrogate が事前計算すべき indicator (params 付き /
 * compareTarget / 上位足) の集計エントリ。`buildBarFeatureTable` / 世代スコープ
 * cache 取得が必要な series のみ取り扱うために使う。
 */
export interface DslIndicatorNeed {
  /** indicator feature 名 (ema, sma, rsi, atr, macd, bb 等) */
  feature: string;
  /** 動的パラメータ。空なら指標のデフォルト値 */
  params: ConditionParams;
  /**
   * snapshot key。`buildSnapshotKeyWithPrimary` の戻り値:
   *   - 主 timeframe + params なし: `ohlcv.rsi`
   *   - 主 timeframe + params あり: `ohlcv.ema(period=20)`
   *   - 上位足 + params なし: `ohlcv@1h.rsi`
   *   - 上位足 + params あり: `ohlcv@1h.ema(period=20)`
   */
  snapshotKey: string;
  /**
   * PR ⑤: 評価する canonical timeframe。主 timeframe と一致するなら
   * `StrategyDSL.timeframe` の canonical 化。上位足なら `'1h'` 等。
   * 世代スコープ HTTP 取得時に「どの timeframe で series を取得するか」を
   * 知るために必要。
   */
  timeframe: CanonicalTimeframe;
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
  const primaryTf = normalizeTimeframe(dsl.timeframe);
  if (primaryTf === null) {
    // 主 timeframe が canonical でないなら collect 対象なし (= 既存戦略は全て
    // canonical 表記で渡る前提、未知 timeframe は schema 上は string として通すが
    // surrogate / analysis-engine 側で別途 reject される)。
    return [];
  }
  const visit = (
    lens: string,
    feature: string,
    params: ConditionParams | undefined,
    conditionTimeframe: string | undefined,
  ) => {
    if (lens !== 'ohlcv') return;
    if (!isPythonSupportedIndicatorId(feature)) return;
    // PR ⑤: timeframe 解決。未指定なら主 timeframe、指定ありなら canonical 化。
    // 主より下位足の指定は不正 → collect しない (= 上流で未対応扱い)。
    let tf: CanonicalTimeframe = primaryTf;
    if (conditionTimeframe) {
      const ct = normalizeTimeframe(conditionTimeframe);
      if (ct === null) return; // 未知 timeframe は collect しない
      // 下位足は不正 (= 主 timeframe より細かい時間足を上位足として使うのは設計上不可)
      const isPrimary = ct === primaryTf;
      const isHigher = isHigherTimeframe(ct, primaryTf);
      if (!isPrimary && !isHigher) return;
      tf = ct;
    }
    // **既知の例外** (PR #116b Copilot review #2+#3):
    // 主 timeframe + params なしの ohlcv.rsi / ohlcv.atr は legacy TS 計算経路
    // (`surrogateFitnessSimulation` 内 `computeRsi` / `computeAtr` で SMA / TR ベース
    // 計算) を使う。HTTP 経由の pandas_ta (Wilder smoothing) と式が違うため、ここで
    // HTTP 取得 series に置き換えると **既存戦略の挙動が変わる**。
    // PR ④F の主旨「TS 計算経路を撤廃して analysis-engine 一本化」に対する **唯一の
    // 例外**。後追い PR で `BarFeatureTable.rsi / atr` 自体を HTTP 経由に置き換える
    // 際に解消予定。**上位足の場合は除外しない** (= 上位足は legacy 経路がそもそも
    // 無く、HTTP 取得が必要)。params 付きも除外しない。
    const isPrimaryDefaultRsiOrAtr =
      tf === primaryTf &&
      (feature === 'rsi' || feature === 'atr') &&
      (!params || Object.keys(params).length === 0);
    if (isPrimaryDefaultRsiOrAtr) return;
    const key = buildSnapshotKeyWithPrimary(lens, feature, params, tf, dsl.timeframe);
    if (!map.has(key)) {
      map.set(key, { feature, params: params ?? {}, snapshotKey: key, timeframe: tf });
    }
  };

  const onLeaf = (c: Condition) => {
    visit(c.lens, c.feature, c.params, c.timeframe);
    if (c.compareTarget) {
      visit(
        c.compareTarget.lens,
        c.compareTarget.feature,
        c.compareTarget.params,
        c.compareTarget.timeframe ?? c.timeframe, // operand 未指定なら親 condition の timeframe を継承
      );
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
 * PR ②-1 + PR ⑤ (MTF): DSL が pattern lens を参照する **timeframe 集合** を返す。
 *
 * 戻り値は canonical timeframe の集合。空集合なら pattern 不要。pattern lens は
 * OHLCV のみで完結し計算コストが軽いので、各 timeframe で 12 種フラグを一括
 * 計算する (= indicator のように params で variation が発生しない)。
 *
 * 主 timeframe (= 戦略の主時間足) と 上位足が両方使われる場合、両方が集合に入る。
 * 主 timeframe より下位足の pattern 指定は除外。
 */
export function collectDslPatternNeeds(dsl: StrategyDSL): Set<CanonicalTimeframe> {
  const needed = new Set<CanonicalTimeframe>();
  const primaryTf = normalizeTimeframe(dsl.timeframe);
  if (primaryTf === null) return needed;
  const visit = (lens: string, conditionTimeframe: string | undefined) => {
    if (lens !== 'pattern') return;
    let tf: CanonicalTimeframe = primaryTf;
    if (conditionTimeframe) {
      const ct = normalizeTimeframe(conditionTimeframe);
      if (ct === null) return;
      if (ct !== primaryTf && !isHigherTimeframe(ct, primaryTf)) return; // 下位足不可
      tf = ct;
    }
    needed.add(tf);
  };
  const onLeaf = (c: Condition) => {
    visit(c.lens, c.timeframe);
    if (c.compareTarget) visit(c.compareTarget.lens, c.compareTarget.timeframe ?? c.timeframe);
  };
  const e = dsl.entry;
  if (isWaitForTriggerEntry(e)) {
    walkGroup(e.triggerConditions, onLeaf);
  } else if ('trigger' in e) {
    walkGroup(e.trigger, onLeaf);
  }
  return needed;
}

/**
 * 後方互換: 旧 `collectDslPatternNeed(dsl): boolean` 呼び出しを維持するため
 * の薄いラッパー (= 戻り値が「主 timeframe での pattern 利用有無」)。
 *
 * MTF 対応版は `collectDslPatternNeeds` を使う。本関数は将来削除予定。
 *
 * @deprecated PR ⑤: `collectDslPatternNeeds` を直接使うこと。
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
