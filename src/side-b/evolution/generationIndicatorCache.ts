/**
 * 世代スコープ indicator/pattern キャッシュ構築 (PR ④F + PR ⑤B MTF 対応)。
 *
 * 役割:
 * - 1 世代で評価する全候補 DSL を walk して必要な
 *   `(indicator_id, params, timeframe)` の和集合 + pattern 集合 (timeframe ごと)
 *   を集める
 * - **主 timeframe + 上位足それぞれ** に analysis-engine `/v1/indicator-series`
 *   を呼んで indicator series + pattern flags を取得
 * - レスポンス cacheKey (`id_{json}_field`) を **DSL snapshot key**
 *   (`ohlcv.feature(stable)` / `ohlcv@<tf>.feature(stable)`) に変換
 * - **上位足の series は主 timeframe バー長に forward fill** (= バー
 *   アライメントで `alignment[i] = j` を引いて、`upperSeries[j]` を埋める)
 * - 結果は `DslSimulationOptions.indicatorSeriesCache` /
 *   `patternFlagsCache` として `SurrogateFitnessSimulator` に渡される
 *
 * 設計判断:
 * - **真実は analysis-engine** (= pandas_ta)。TS 側で再計算しない
 * - 主 + 上位足それぞれ HTTP × 1 回 (= timeframe 数だけ HTTP)。将来「複数
 *   timeframe を 1 HTTP で取得する API」が出たら本実装を差し替えるだけで済む
 *   (= 呼び出し側 surrogate / EvolutionLoop は無変更)
 * - 上位足は **主バー長に forward fill された配列** を cache に詰めるので、
 *   surrogate 側の `buildFeatureTable` は既存の `cached[i + offset]` lookup で
 *   そのまま動く
 */

import {
  fetchIndicatorSeries,
  makeIndicatorCacheKey,
} from '../../backend/services/analysisEngineClient';
import {
  buildBarAlignment,
  forwardFillSeriesToPrimary,
  type OhlcvBar,
  type OhlcvSource,
} from '../../shared/marketdata';
import { defaultHttpOhlcvSource } from '../../shared/marketdata/HttpOhlcvSource';
import {
  ALL_CANDLE_PATTERN_IDS,
  type CandlePatternId,
} from '../../shared/patterns';
import { type CanonicalTimeframe } from '../../shared/timeframes';
import {
  collectDslIndicatorNeeds,
  collectDslPatternNeeds,
  type DslIndicatorNeed,
} from '../strategy_dsl/dslOhlcvFeatureNeeds';
import type { StrategyDSL } from '../strategy_dsl/schema';

/** EvolutionLoop が `evaluateFitness` に渡す世代スコープキャッシュ。 */
export interface GenerationIndicatorCaches {
  /** DSL snapshot key (`ohlcv.ema(period=20)` 等) → 値配列 (warm-up は null) */
  indicatorSeriesCache: ReadonlyMap<string, ReadonlyArray<number | null>>;
  /** patternId → bool 配列 (= 主 timeframe のみ。上位足 pattern は別 cache) */
  patternFlagsCache: Readonly<Record<CandlePatternId, ReadonlyArray<boolean>>>;
}

/**
 * 世代スコープで全候補が必要とする indicator + pattern を取得する。
 *
 * - 主 timeframe: 1 HTTP で indicator + pattern を取得
 * - 上位足 (= 戦略の主時間足より長い時間足): timeframe ごとに OHLCV + indicator
 *   + pattern を取得し、`primaryBars` でアライメントを取って forward fill
 *
 * 候補が空 / 全候補が indicator も pattern も使わない場合は空キャッシュを返す
 * (= HTTP 呼び出し自体をスキップ)。HTTP エラーは投げ伝播 (= EvolutionLoop 側で
 * try/catch して個別候補のスコアを -1 に倒す既存経路に乗せる)。
 *
 * @param candidates 世代の評価対象 DSL リスト
 * @param symbol     シンボル (= 全候補で同一前提)
 * @param primaryTimeframe 主 timeframe (= 戦略の `timeframe`、canonical)
 * @param startDate  期間開始
 * @param endDate    期間終了
 * @param primaryBars 主 timeframe の OHLCV バー列 (= 上位足の forward fill に使う)
 * @param ohlcvSource 上位足の OHLCV 取得に使う source。デフォルトは `HttpOhlcvSource`
 */
export async function fetchGenerationIndicatorCaches(
  candidates: readonly StrategyDSL[],
  symbol: string,
  primaryTimeframe: CanonicalTimeframe,
  startDate: Date,
  endDate: Date,
  primaryBars: readonly OhlcvBar[],
  ohlcvSource: OhlcvSource = defaultHttpOhlcvSource,
): Promise<GenerationIndicatorCaches> {
  // 1. 全候補 walk して indicator/pattern 集合を集める (= timeframe ごとに分類)
  const indicatorByTf = new Map<CanonicalTimeframe, Map<string, DslIndicatorNeed>>();
  const patternByTf = new Set<CanonicalTimeframe>();
  for (const dsl of candidates) {
    for (const need of collectDslIndicatorNeeds(dsl)) {
      let tfMap = indicatorByTf.get(need.timeframe);
      if (!tfMap) {
        tfMap = new Map();
        indicatorByTf.set(need.timeframe, tfMap);
      }
      if (!tfMap.has(need.snapshotKey)) {
        tfMap.set(need.snapshotKey, need);
      }
    }
    for (const tf of collectDslPatternNeeds(dsl)) {
      patternByTf.add(tf);
    }
  }

  const indicatorSeriesCache = new Map<string, ReadonlyArray<number | null>>();
  const patternFlagsCache = emptyPatternFlagsCache();

  // 2. 主 timeframe の取得 (= 既存経路、primaryBars は呼び出し側で取得済)
  const primaryNeeds = indicatorByTf.get(primaryTimeframe);
  const primaryPatternNeeded = patternByTf.has(primaryTimeframe);
  if ((primaryNeeds && primaryNeeds.size > 0) || primaryPatternNeeded) {
    const indicators = primaryNeeds
      ? Array.from(primaryNeeds.values()).map((n) => ({
          indicatorId: n.indicatorId,
          params: n.params,
          field: n.field,
        }))
      : [];
    const patternIds = primaryPatternNeeded ? [...ALL_CANDLE_PATTERN_IDS] : [];
    const response = await fetchIndicatorSeries({
      symbol,
      timeframe: primaryTimeframe,
      startDate,
      endDate,
      indicators,
      patterns: patternIds,
    });
    if (primaryNeeds) {
      for (const need of primaryNeeds.values()) {
        const httpKey = makeIndicatorCacheKey(need.indicatorId, need.params, need.field);
        const arr = response.series[httpKey];
        if (arr) indicatorSeriesCache.set(need.snapshotKey, arr);
      }
    }
    if (primaryPatternNeeded) {
      for (const id of ALL_CANDLE_PATTERN_IDS) {
        const arr = response.patterns[id];
        if (arr) patternFlagsCache[id] = arr;
      }
    }
  }

  // 3. 上位足の取得 (= timeframe ごとに OHLCV + series + alignment + forward fill)
  for (const [tf, tfNeeds] of indicatorByTf) {
    const upperPatternNeeded = patternByTf.has(tf);
    if (tf === primaryTimeframe) continue;
    if (tfNeeds.size === 0 && !upperPatternNeeded) continue;
    await fetchUpperTimeframeAndFill(
      symbol,
      tf,
      startDate,
      endDate,
      primaryTimeframe,
      primaryBars,
      tfNeeds,
      upperPatternNeeded,
      indicatorSeriesCache,
      ohlcvSource,
    );
  }

  // 4. pattern lens も「indicator が使われていない上位足」で参照されるケース
  //    (= ohlcv 系は不要だが pattern だけ上位足を使う) を拾う
  for (const tf of patternByTf) {
    if (tf === primaryTimeframe) continue;
    if (indicatorByTf.has(tf)) continue; // 既に上で処理済
    await fetchUpperTimeframeAndFill(
      symbol,
      tf,
      startDate,
      endDate,
      primaryTimeframe,
      primaryBars,
      new Map(),
      true,
      indicatorSeriesCache,
      ohlcvSource,
    );
  }

  return { indicatorSeriesCache, patternFlagsCache };
}

/**
 * 上位足 1 つを取得して、主 timeframe バー長に forward fill した series を
 * 共通 cache (`indicatorSeriesCache`) に詰める helper。
 *
 * pattern flags は **上位足ごとの cache** が現状の構造ではなく、indicator 系列
 * と同じ snapshot key 経由で参照される (= `pattern@1h.engulfing_bull` 等)。
 * GenerationIndicatorCaches.patternFlagsCache は 主 timeframe 専用 (= 既存
 * snapshot 構築互換) のため、上位足 pattern は indicator 用 Map に boolean
 * を 0/1 数値で詰める形にすると evaluator 側も number 比較経路に乗せられて
 * シンプル... ではなく、boolean op (is_true / is_false) は left の Boolean
 * 評価なので、数値化すると 0/1 が boolean に Coerce される。OK。
 *
 * ただし、本 helper は indicator series と pattern flags を分けずに **同じ
 * `indicatorSeriesCache` Map に number/boolean 系列を詰める** 形を取らない
 * (= 型が混在して buildFeatureTable 側で扱いが複雑になる)。代わりに
 * **上位足 pattern は専用 key 形式 `pattern@<tf>.<patternId>` で indicator Map
 * に bool を 0/1 化して詰める**。surrogate 側で `pattern@1h is_true` の評価は
 * indicator series 経由で 0/1 を boolean 化して扱う。
 *
 * 注: 本 PR では **主 timeframe pattern のみ** evaluator 側 buildFeatureTable
 * の patternFlagsCache 経路、上位足 pattern は indicator series 経路 (= 0/1
 * 数値) として扱う。これで pattern lens の上位足参照は是非を問わず動く。
 * 後追い PR で patternFlagsCache を timeframe 別構造に正規化する余地を残す。
 */
async function fetchUpperTimeframeAndFill(
  symbol: string,
  tf: CanonicalTimeframe,
  startDate: Date,
  endDate: Date,
  primaryTimeframe: CanonicalTimeframe,
  primaryBars: readonly OhlcvBar[],
  tfNeeds: Map<string, DslIndicatorNeed>,
  patternNeeded: boolean,
  indicatorSeriesCache: Map<string, ReadonlyArray<number | null>>,
  ohlcvSource: OhlcvSource,
): Promise<void> {
  // 上位足 OHLCV (= alignment 計算 + 上位足 price/volume の forward fill)
  const upperBars = await ohlcvSource.fetchBars({
    symbol,
    timeframe: tf,
    startDate,
    endDate,
  });
  const alignment = buildBarAlignment(primaryBars, upperBars, primaryTimeframe, tf);

  // PR #130 Copilot review #2/#6/#8: 上位足の **OHLCV (open/high/low/close/volume)
  // も `ohlcv@<tf>.<field>` snapshot key で indicatorSeriesCache に詰める**。
  // これがないと `Condition.timeframe='1h'` の price 系 leaf (例: ohlcv@1h.close) や
  // touch_wick op が常に欠損 → false 評価になる。alignment + forward fill で
  // 主バー長に揃えた number 配列で詰める。
  const upperOpens: number[] = upperBars.map((b) => b.open);
  const upperHighs: number[] = upperBars.map((b) => b.high);
  const upperLows: number[] = upperBars.map((b) => b.low);
  const upperCloses: number[] = upperBars.map((b) => b.close);
  const upperVolumes: number[] = upperBars.map((b) => b.volume);
  for (const [field, arr] of [
    ['open', upperOpens],
    ['high', upperHighs],
    ['low', upperLows],
    ['close', upperCloses],
    ['volume', upperVolumes],
  ] as const) {
    const filled = forwardFillSeriesToPrimary<number | null>(arr, alignment, null);
    indicatorSeriesCache.set(`ohlcv@${tf}.${field}`, filled);
  }

  // 上位足 indicator + pattern を 1 HTTP で取得
  const indicators = Array.from(tfNeeds.values()).map((n) => ({
    indicatorId: n.indicatorId,
    params: n.params,
    field: n.field,
  }));
  const patternIds = patternNeeded ? [...ALL_CANDLE_PATTERN_IDS] : [];
  if (indicators.length === 0 && patternIds.length === 0) return;
  const response = await fetchIndicatorSeries({
    symbol,
    timeframe: tf,
    startDate,
    endDate,
    indicators,
    patterns: patternIds,
  });

  // indicator series を主バー長に forward fill
  for (const need of tfNeeds.values()) {
    const httpKey = makeIndicatorCacheKey(need.indicatorId, need.params, need.field);
    const arr = response.series[httpKey];
    if (!arr) continue;
    const filled = forwardFillSeriesToPrimary<number | null>(arr, alignment, null);
    indicatorSeriesCache.set(need.snapshotKey, filled);
  }

  // 上位足 pattern を indicator Map に 0/1 化して詰める (= snapshot key
  // `pattern@<tf>.<patternId>` の number 配列、evaluator 側で truthy 判定)
  if (patternNeeded) {
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      const arr = response.patterns[id];
      if (!arr) continue;
      const upperNumeric: (number | null)[] = arr.map((b) => (b ? 1 : 0));
      const filled = forwardFillSeriesToPrimary<number | null>(
        upperNumeric,
        alignment,
        null,
      );
      const key = `pattern@${tf}.${id}`;
      indicatorSeriesCache.set(key, filled);
    }
  }
}

function emptyPatternFlagsCache(): Record<CandlePatternId, ReadonlyArray<boolean>> {
  const out = {} as Record<CandlePatternId, ReadonlyArray<boolean>>;
  for (const id of ALL_CANDLE_PATTERN_IDS) out[id] = [];
  return out;
}

// 注: train/validation 分割時の slice は `SurrogateFitnessSimulator` 側の
// `sliceSimulationCaches` で扱う (= PR ④F Copilot review #4: 重複 export を避ける)。
