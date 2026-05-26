/**
 * IndicatorSpecialist 用 analysis-engine 連携 helper (Phase 6.8 Step 2、2026-05-27)
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md §4 (= analysis-engine 連携)
 *
 * 役割:
 * - analysis-engine `/v1/indicator-series` を **現在 TF + 上位 TF の 2 並列** で叩き、
 *   各 indicator を `IndicatorSeries` に整形して `IndicatorSpecialistInput` を組み立てる
 * - priceContext は呼び出し側 (aiOrchestrator) が持つ OHLCV 末尾から構築
 * - 取得失敗時は本 helper は null を返す (= 呼び出し側で「indicatorAnalysis なしで続行」を判断)
 *
 * 本 PR ではキャッシュ層 / フォールバック計算は実装しない (= 次以降の PR で追加)。
 */

import { fetchIndicatorSeries } from '../../../backend/services/analysisEngineClient';
import type { AnalysisEngineIndicatorSpec } from '../../../schemas/external/analysisEngine';
import { toIndicatorSeries } from './IndicatorSpecialist';
import { INDICATOR_CATALOG } from './indicatorCatalog';
import type {
  IndicatorSeries,
  IndicatorSpecialistInput,
  TimeframeData,
} from './types';
import type { SupportedTimeframe } from '../../constants/timeframes';
import type { IndicatorId } from '../../../shared/indicators/registry';

/** aiOrchestrator から渡される OHLCV (= priceContext 構築用) */
export interface OhlcvBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface FetchIndicatorBundleInput {
  symbol: string;
  currentTimeframe: SupportedTimeframe;
  higherTimeframe: SupportedTimeframe;
  /** 現在 TF の OHLCV (= priceContext + startDate/endDate 算出用) */
  currentOhlcv: ReadonlyArray<OhlcvBar>;
  /** 上位 TF の OHLCV (= 同上、null なら higherTimeframeData を null で返す) */
  higherOhlcv?: ReadonlyArray<OhlcvBar>;
}

/**
 * `INDICATOR_CATALOG` を analysis-engine の `indicators[]` フォーマットに変換。
 *
 * shared registry の IndicatorId と analysis-engine 側の `indicatorId` 文字列は一致する
 * 前提 (= `analysis-engine/app/indicators.py` の compute_indicator_series の case 分岐と
 * INDICATOR_CATALOG の id を整合させる)。
 */
function catalogToAnalysisEngineSpecs(): AnalysisEngineIndicatorSpec[] {
  return INDICATOR_CATALOG.map((spec) => ({
    indicatorId: spec.id,
    params: spec.params,
    field: spec.field,
  }));
}

/**
 * OHLCV 末尾から priceContext を組み立てる。
 * volume が未取得の場合は 0、session の高低は OHLCV 全体ではなく **末尾 1 本** を採用
 * (= scheduler が短期セッション内の bar を渡す前提)。
 */
function buildPriceContext(ohlcv: ReadonlyArray<OhlcvBar>): TimeframeData['priceContext'] {
  if (ohlcv.length === 0) {
    return { latestClose: 0, latestVolume: 0, sessionHigh: 0, sessionLow: 0 };
  }
  const last = ohlcv[ohlcv.length - 1];
  // sessionHigh / sessionLow は直近 N 本 (= 全体 or 24 本程度) の高低、ここでは全体採用
  let sessionHigh = -Infinity;
  let sessionLow = Infinity;
  for (const bar of ohlcv) {
    if (bar.high > sessionHigh) sessionHigh = bar.high;
    if (bar.low < sessionLow) sessionLow = bar.low;
  }
  return {
    latestClose: last.close,
    latestVolume: last.volume ?? 0,
    sessionHigh,
    sessionLow,
  };
}

/**
 * 1 つの TF について analysis-engine から indicator 系列を取得し、TimeframeData に整形。
 *
 * 失敗時は警告ログ出力 + null。呼び出し側 (= 2 並列 caller) が null を判断材料にする。
 */
async function fetchTimeframeData(args: {
  symbol: string;
  timeframe: SupportedTimeframe;
  ohlcv: ReadonlyArray<OhlcvBar>;
}): Promise<TimeframeData | null> {
  const { symbol, timeframe, ohlcv } = args;
  if (ohlcv.length === 0) {
    console.warn(`[IndicatorSpecialist] ${timeframe} の OHLCV が空、TimeframeData=null`);
    return null;
  }

  const startDate = ohlcv[0].timestamp;
  const endDate = ohlcv[ohlcv.length - 1].timestamp;

  try {
    const response = await fetchIndicatorSeries({
      symbol,
      timeframe,
      startDate,
      endDate,
      indicators: catalogToAnalysisEngineSpecs(),
    });

    // response.series は Record<string, Array<number | null>>
    // 各 cache key (= indicator + params + field) を IndicatorSeries に変換
    const indicators: Partial<Record<IndicatorId, IndicatorSeries>> = {};
    for (const spec of INDICATOR_CATALOG) {
      // analysis-engine の cache key 形式は `{indicator_id}_{params_key}_{field}` だが、
      // 呼び出し側で indicators[] を 1 spec/id ずつ送るので response key は予測可能。
      // 簡略化: response.series の中で、key が当該 indicator id を prefix に持つものを採用。
      const matchKey = Object.keys(response.series).find((k) =>
        k.toLowerCase().startsWith(`${spec.id.toLowerCase()}_`),
      );
      if (!matchKey) continue;
      const values = response.series[matchKey];
      if (Array.isArray(values)) {
        indicators[spec.id] = toIndicatorSeries(values);
      }
    }

    return {
      indicators,
      priceContext: buildPriceContext(ohlcv),
    };
  } catch (err) {
    console.warn(
      `[IndicatorSpecialist] analysis-engine 取得失敗 (${symbol}/${timeframe}):`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * 現在 TF + 上位 TF の indicator を 2 並列で取得し `IndicatorSpecialistInput` を返す。
 *
 * 失敗時の挙動:
 * - 現在 TF が取得失敗 → null (= IndicatorSpecialist 呼び出しをスキップ、呼び出し側で判断)
 * - 上位 TF が取得失敗 → currentTimeframeData は採用、higher は空の indicators で fallback
 *   (= IndicatorSpecialist の prompt は不在 indicator を (unavailable) として処理する設計)
 */
export async function fetchIndicatorBundleForMTF(
  input: FetchIndicatorBundleInput,
): Promise<IndicatorSpecialistInput | null> {
  const { symbol, currentTimeframe, higherTimeframe, currentOhlcv, higherOhlcv } = input;

  const [currentData, higherData] = await Promise.all([
    fetchTimeframeData({ symbol, timeframe: currentTimeframe, ohlcv: currentOhlcv }),
    higherOhlcv
      ? fetchTimeframeData({ symbol, timeframe: higherTimeframe, ohlcv: higherOhlcv })
      : Promise.resolve(null),
  ]);

  if (!currentData) {
    return null;
  }

  // higher が null でも続行 (= 上位 TF データなしのデグレード判断は IndicatorSpecialist 側で)
  const higherFallback: TimeframeData = {
    indicators: {},
    priceContext: buildPriceContext(higherOhlcv ?? currentOhlcv),
  };

  return {
    symbol,
    currentTimeframe,
    higherTimeframe,
    current: currentData,
    higher: higherData ?? higherFallback,
  };
}
