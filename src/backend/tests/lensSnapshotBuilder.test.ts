/**
 * LensSnapshotBuilder(src/services/lensSnapshotBuilder.ts)のユニットテスト
 *
 * 検証観点(NOTE_SIMILARITY_FOUNDATION.md §2-① / §9-1):
 * - eventTime 起点でバー・指標系列を集め、状態レンズ + インジケーターレンズが
 *   1 つの NoteLensSnapshot に合流すること
 * - 欠損耐性: analysis-engine 障害・バー不足でも snapshot 全体を失敗させない
 * - カバレッジ/鮮度: バー不足・鮮度切れ時に期間指定フェッチが 1 回試行される
 * - 決定性: 同じ入力から同じ特徴が得られる
 *
 * 外部依存(DB / analysis-engine / EODHD)は全て DI モックで遮断する。
 */

import {
  LensSnapshotBuilder,
  type LensSnapshotBuilderDeps,
} from '../../services/lensSnapshotBuilder';
import { resolveIndicatorLensSpecs } from '../../shared/similarity/indicatorLenses';
import { makeIndicatorCacheKey } from '../services/analysisEngineClient';
import { ALL_CANDLE_PATTERN_IDS } from '../../shared/patterns';
import type { AnalysisEngineIndicatorSeriesResponse } from '../../schemas/external/analysisEngine';

const EVENT_TIME = new Date('2026-06-01T12:00:00Z');
const BAR_MS = 15 * 60_000;

/** eventTime で終わる 15m バー列を作る(決定論的な波形) */
function makeBars(count: number, endTime: Date = EVENT_TIME) {
  return Array.from({ length: count }, (_, i) => {
    const timestamp = new Date(endTime.getTime() - (count - 1 - i) * BAR_MS);
    const base = 100 + Math.sin(i / 5) * 2 + i * 0.01;
    return {
      timestamp,
      open: base - 0.1,
      high: base + 0.3,
      low: base - 0.3,
      close: base,
      volume: 1000 + (i % 7) * 10,
    };
  });
}

/** バー列に整列した analysis-engine レスポンスを作る */
function makeEngineResponse(
  bars: ReturnType<typeof makeBars>
): AnalysisEngineIndicatorSeriesResponse {
  const n = bars.length;
  const timestamps = bars.map((b) => b.timestamp.toISOString().replace('.000Z', 'Z'));
  const rsiKey = makeIndicatorCacheKey('rsi', { period: 14 }, 'value');
  const patterns: Record<string, boolean[]> = {};
  for (const id of ALL_CANDLE_PATTERN_IDS) {
    patterns[id] = Array.from({ length: n }, () => false);
  }
  // 末尾バーで doji を検出した状態にする
  patterns['doji'][n - 1] = true;
  return {
    symbol: 'USDJPY',
    timeframe: '15m',
    timestamps,
    series: {
      [rsiKey]: Array.from({ length: n }, (_, i) => 40 + (i % 20)),
    },
    patterns,
    smc: {
      nearestObBullDistancePips: 25,
      nearestObBearDistancePips: -1,
      liquidityAboveCount: 2,
      liquidityBelowCount: 1,
      fvgBullCountLast20: 1,
      fvgBearCountLast20: 0,
      lastStructureEvent: 'BOS_BULL',
      barsSinceLastStructureEvent: 3,
      currentZone: 'DISCOUNT',
      zonePositionPct: 0.3,
    },
    chartPatterns: null,
    wyckoff: null,
  };
}

/** DI モック付きの builder を作る */
function makeBuilder(overrides: {
  bars?: ReturnType<typeof makeBars>;
  engineResponse?: AnalysisEngineIndicatorSeriesResponse | null;
  engineError?: Error;
  fetchSuccess?: boolean;
}) {
  const bars = overrides.bars ?? makeBars(130);
  const findManyAsOHLCVData = jest.fn().mockResolvedValue(bars);
  const fetchAndCacheOhlcvFn = jest.fn().mockResolvedValue({
    success: overrides.fetchSuccess ?? true,
    cachedCount: 0,
  });
  const fetchIndicatorSeriesFn = overrides.engineError
    ? jest.fn().mockRejectedValue(overrides.engineError)
    : jest.fn().mockResolvedValue(overrides.engineResponse ?? makeEngineResponse(bars));

  const deps = {
    ohlcvRepository: { findManyAsOHLCVData },
    fetchAndCacheOhlcvFn,
    fetchIndicatorSeriesFn,
  } as LensSnapshotBuilderDeps;
  return {
    builder: new LensSnapshotBuilder(deps),
    findManyAsOHLCVData,
    fetchAndCacheOhlcvFn,
    fetchIndicatorSeriesFn,
  };
}

const RSI_SPECS = resolveIndicatorLensSpecs([
  { indicatorId: 'rsi', params: { period: 14 }, enabled: true },
]);

describe('LensSnapshotBuilder', () => {
  test('状態レンズとインジケーターレンズが 1 つの snapshot に合流する', async () => {
    const { builder, fetchAndCacheOhlcvFn } = makeBuilder({});
    const result = await builder.build({
      symbol: 'USDJPY',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorSpecs: RSI_SPECS,
    });

    expect(result.snapshot).not.toBeNull();
    const lensIds = Object.keys(result.snapshot!.lenses);
    // バー由来の状態レンズ
    expect(lensIds).toContain('time_session');
    expect(lensIds).toContain('dow_theory');
    expect(lensIds).toContain('volatility_regime');
    // analysis-engine payload 由来の状態レンズ
    expect(lensIds).toContain('pattern');
    expect(lensIds).toContain('smc');
    // インジケーターレンズ
    expect(lensIds).toContain('ind:rsi#p14');
    expect(result.snapshot!.lenses['ind:rsi#p14'].features['rsi_zone']).toBeDefined();
    // パターン flag が末尾バーの doji を反映している
    expect(result.snapshot!.lenses['pattern'].features['doji']).toBe(true);
    // SMC payload が snake_case の featureKey に変換されている
    expect(result.snapshot!.lenses['smc'].features['current_zone']).toBe('DISCOUNT');
    // eventTime が snapshot に正確に刻まれる
    expect(result.snapshot!.eventTime).toBe(EVENT_TIME.toISOString());
    // バーが十分 + 新鮮なので期間フェッチは呼ばれない
    expect(fetchAndCacheOhlcvFn).not.toHaveBeenCalled();
  });

  test('決定性: 同じ入力から同じレンズ特徴が得られる', async () => {
    const bars = makeBars(130);
    const first = makeBuilder({ bars });
    const second = makeBuilder({ bars });
    const resultA = await first.builder.build({
      symbol: 'USDJPY',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorSpecs: RSI_SPECS,
    });
    const resultB = await second.builder.build({
      symbol: 'USDJPY',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorSpecs: RSI_SPECS,
    });
    expect(resultA.snapshot!.lenses).toEqual(resultB.snapshot!.lenses);
  });

  test('バー不足時は期間フェッチを 1 回試行し、warnings に残る', async () => {
    const { builder, fetchAndCacheOhlcvFn } = makeBuilder({ bars: makeBars(50) });
    const result = await builder.build({
      symbol: 'USDJPY',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorSpecs: [],
    });
    expect(fetchAndCacheOhlcvFn).toHaveBeenCalledTimes(1);
    expect(result.snapshot).not.toBeNull();
    expect(result.warnings.some((w) => w.includes('不足'))).toBe(true);
  });

  test('鮮度切れ(最終バーが eventTime から離れすぎ)時は最終バー以降を期間フェッチする', async () => {
    // 最終バーが eventTime の 3 時間前 → 鮮度切れ
    const staleEnd = new Date(EVENT_TIME.getTime() - 3 * 60 * 60_000);
    const staleBars = makeBars(130, staleEnd);
    const { builder, fetchAndCacheOhlcvFn } = makeBuilder({ bars: staleBars });
    await builder.build({
      symbol: 'USDJPY',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorSpecs: [],
    });
    expect(fetchAndCacheOhlcvFn).toHaveBeenCalledTimes(1);
    // フェッチ開始は最終バー時刻(ウィンドウ全体の再取得をしない)
    const fetchFrom = fetchAndCacheOhlcvFn.mock.calls[0][2] as Date;
    expect(fetchFrom.getTime()).toBe(staleEnd.getTime());
  });

  test('ensureCoverage=false なら不足・鮮度切れでもフェッチしない(cron 用)', async () => {
    const { builder, fetchAndCacheOhlcvFn } = makeBuilder({ bars: makeBars(50) });
    await builder.build({
      symbol: 'USDJPY',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorSpecs: [],
      ensureCoverage: false,
    });
    expect(fetchAndCacheOhlcvFn).not.toHaveBeenCalled();
  });

  test('analysis-engine 障害時もバー由来の状態レンズだけで snapshot を返す(全体を壊さない)', async () => {
    const { builder } = makeBuilder({ engineError: new Error('engine down') });
    const result = await builder.build({
      symbol: 'USDJPY',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorSpecs: RSI_SPECS,
    });
    expect(result.snapshot).not.toBeNull();
    const lensIds = Object.keys(result.snapshot!.lenses);
    expect(lensIds).toContain('dow_theory');
    expect(lensIds).toContain('time_session');
    // engine 由来のレンズは欠落する(= 比較時に共通レンズから外れるだけ)
    expect(lensIds).not.toContain('smc');
    expect(lensIds).not.toContain('ind:rsi#p14');
    expect(result.warnings.some((w) => w.includes('analysis-engine'))).toBe(true);
  });

  test('バーが全く無い場合のみ snapshot=null を返す', async () => {
    const { builder } = makeBuilder({ bars: [], fetchSuccess: false });
    const result = await builder.build({
      symbol: 'NEWSYM',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorSpecs: [],
    });
    expect(result.snapshot).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('未対応の時間足では snapshot=null と警告を返す', async () => {
    const { builder } = makeBuilder({});
    const result = await builder.build({
      symbol: 'USDJPY',
      timeframe: '2m',
      eventTime: EVENT_TIME,
      indicatorSpecs: [],
    });
    expect(result.snapshot).toBeNull();
    expect(result.warnings[0]).toContain('未対応の時間足');
  });
});
