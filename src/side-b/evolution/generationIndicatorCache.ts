/**
 * 世代スコープ indicator/pattern キャッシュ構築 (PR ④F)。
 *
 * 役割:
 * - 1 世代で評価する全候補 DSL を walk して必要な
 *   `(indicator_id, params)` の和集合 + pattern 集合を集める
 * - analysis-engine `/v1/indicator-series` に **HTTP 1 回** で問い合わせて
 *   indicator series + pattern flags をまとめて取得する
 * - レスポンスの cacheKey (`id_{json}_field` 形式) を **DSL snapshot key
 *   形式 (`lens.feature(stable_params)`)** に変換して `Map` / `Record` に詰める
 * - 結果は `DslSimulationOptions.indicatorSeriesCache` /
 *   `patternFlagsCache` として `SurrogateFitnessSimulator` に渡される
 *
 * 設計判断:
 * - **真実は analysis-engine** (= pandas_ta)。TS 側で indicator を再計算しない
 *   (= PR ④F で旧 `indicatorSurrogate.ts` を撤廃済み)
 * - 候補ごとに HTTP すると数百回往復になり遅いため、世代スコープで 1 回に集約
 * - pythonSeries=false の indicator (adx/supertrend/pivot) は
 *   `collectDslIndicatorNeeds` 段階で除外済 (= registry の判定)
 */

import {
  fetchIndicatorSeries,
  makeIndicatorCacheKey,
} from '../../backend/services/analysisEngineClient';
import {
  ALL_CANDLE_PATTERN_IDS,
  type CandlePatternId,
} from '../../shared/patterns';
import {
  collectDslIndicatorNeeds,
  collectDslPatternNeed,
  type DslIndicatorNeed,
} from '../strategy_dsl/dslOhlcvFeatureNeeds';
import type { StrategyDSL } from '../strategy_dsl/schema';

/** EvolutionLoop が `evaluateFitness` に渡す世代スコープキャッシュ。 */
export interface GenerationIndicatorCaches {
  /** DSL snapshot key (`ohlcv.ema(period=20)` 等) → 値配列 (warm-up は null) */
  indicatorSeriesCache: ReadonlyMap<string, ReadonlyArray<number | null>>;
  /** patternId → bool 配列 */
  patternFlagsCache: Readonly<Record<CandlePatternId, ReadonlyArray<boolean>>>;
}

/**
 * 世代スコープで全候補が必要とする indicator + pattern を 1 HTTP で取得する。
 *
 * 候補が空 / 全候補が indicator も pattern も使わない場合は空キャッシュを返す
 * (= HTTP 呼び出し自体をスキップ)。HTTP エラーは投げ伝播 (= EvolutionLoop 側で
 * try/catch して個別候補のスコアを -1 に倒す既存経路に乗せる)。
 *
 * @param candidates 世代の評価対象 DSL リスト
 * @param symbol     シンボル (= 全候補で同一前提)
 * @param timeframe  時間足 (= 全候補で同一前提)
 * @param startDate  期間開始
 * @param endDate    期間終了
 */
export async function fetchGenerationIndicatorCaches(
  candidates: readonly StrategyDSL[],
  symbol: string,
  timeframe: string,
  startDate: Date,
  endDate: Date,
): Promise<GenerationIndicatorCaches> {
  // 1. 全候補 walk して indicator/pattern 集合を集める
  const indicatorByKey = new Map<string, DslIndicatorNeed>();
  let patternNeeded = false;
  for (const dsl of candidates) {
    for (const need of collectDslIndicatorNeeds(dsl)) {
      if (!indicatorByKey.has(need.snapshotKey)) {
        indicatorByKey.set(need.snapshotKey, need);
      }
    }
    if (collectDslPatternNeed(dsl)) {
      patternNeeded = true;
    }
  }

  const indicatorSpecs = Array.from(indicatorByKey.values()).map((need) => ({
    indicatorId: need.feature,
    params: need.params,
    field: 'value' as const,
  }));
  const patternIds = patternNeeded ? [...ALL_CANDLE_PATTERN_IDS] : [];

  // 2. HTTP 不要なら空キャッシュ
  if (indicatorSpecs.length === 0 && patternIds.length === 0) {
    return {
      indicatorSeriesCache: new Map(),
      patternFlagsCache: emptyPatternFlagsCache(),
    };
  }

  // 3. analysis-engine 呼び出し
  const response = await fetchIndicatorSeries({
    symbol,
    timeframe,
    startDate,
    endDate,
    indicators: indicatorSpecs,
    patterns: patternIds,
  });

  // 4. cacheKey 変換: HTTP key (`ema_{"period":20}_value`) → DSL key (`ohlcv.ema(period=20)`)
  const indicatorSeriesCache = new Map<string, ReadonlyArray<number | null>>();
  for (const need of indicatorByKey.values()) {
    const httpKey = makeIndicatorCacheKey(need.feature, need.params, 'value');
    const arr = response.series[httpKey];
    if (arr) {
      indicatorSeriesCache.set(need.snapshotKey, arr);
    }
  }

  // 5. patternFlagsCache 構築 (HTTP key = patternId そのまま)
  const patternFlagsCache = emptyPatternFlagsCache();
  if (patternNeeded) {
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      const arr = response.patterns[id];
      if (arr) {
        patternFlagsCache[id] = arr;
      }
    }
  }

  return { indicatorSeriesCache, patternFlagsCache };
}

function emptyPatternFlagsCache(): Record<CandlePatternId, ReadonlyArray<boolean>> {
  const out = {} as Record<CandlePatternId, ReadonlyArray<boolean>>;
  for (const id of ALL_CANDLE_PATTERN_IDS) out[id] = [];
  return out;
}

/**
 * 世代スコープ seriesMap / patternFlagsCache を `[start, end)` で slice する。
 * `evaluateFitness` 内で全期間 cache を train (前 70%) / validation (後 30%) に
 * 分割して `runDslSimulation` に渡すために使う。
 */
export function sliceGenerationCaches(
  caches: GenerationIndicatorCaches,
  start: number,
  end: number,
): GenerationIndicatorCaches {
  const slicedSeries = new Map<string, ReadonlyArray<number | null>>();
  for (const [key, arr] of caches.indicatorSeriesCache) {
    slicedSeries.set(key, arr.slice(start, end));
  }
  const slicedPatterns = {} as Record<CandlePatternId, ReadonlyArray<boolean>>;
  for (const id of ALL_CANDLE_PATTERN_IDS) {
    const arr = caches.patternFlagsCache[id];
    slicedPatterns[id] = arr ? arr.slice(start, end) : [];
  }
  return {
    indicatorSeriesCache: slicedSeries,
    patternFlagsCache: slicedPatterns,
  };
}
