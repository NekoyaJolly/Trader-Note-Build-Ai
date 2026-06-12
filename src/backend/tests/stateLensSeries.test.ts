/**
 * 状態レンズの per-bar 系列化 (src/services/stateLensSeries.ts) のユニットテスト
 *
 * 検証観点:
 * - 先読み (lookahead) 禁止: 未来バーを追加しても過去バーの値が変わらない (§12.2 不変条件)
 * - 決定性: 同じ入力で同じ出力 (AGENTS.md テストポリシー)
 * - 数値エンコード: categoricalEnum (values 順 index) / bool / orderedEnum
 * - 未対応レンズ (smc 等) のスキップとインジケーターレンズ (ind:) の無視
 */

import {
  STATE_LENS_CONTEXT_BARS,
  appendStateLensSeriesToCache,
  computeStateLensFeatureSeries,
  isTsComputableStateLensId,
  type StateLensBar,
} from '../../services/stateLensSeries';
import { makeLensCacheKey } from '../services/strategyConditionEvaluator';

const BAR_MS = 15 * 60_000;
/** 2026-01-05 (月) 00:00 UTC 起点 (FX 開場時間帯) */
const BASE_MS = Date.UTC(2026, 0, 5, 0, 0, 0);

/**
 * 上昇トレンドのジグザグバー列を作る (決定論的)。
 * 緩い上昇 + 周期 16 本の振動で、ピボット高値/安値が切り上がっていく。
 */
function makeUptrendBars(count: number): StateLensBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.3 + 3 * Math.sin((i * 2 * Math.PI) / 16);
    return {
      timestamp: new Date(BASE_MS + i * BAR_MS),
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000,
    };
  });
}

describe('computeStateLensFeatureSeries(状態レンズの per-bar 系列化)', () => {
  test('lookahead 禁止: 未来バーを追加しても過去バーの値が一切変わらない(§12.2 不変条件)', async () => {
    const longBars = makeUptrendBars(220);
    const shortBars = longBars.slice(0, 180);
    const longSeries = await computeStateLensFeatureSeries('dow_theory', {
      symbol: 'USDJPY',
      timeframe: '15m',
      bars: longBars,
    });
    const shortSeries = await computeStateLensFeatureSeries('dow_theory', {
      symbol: 'USDJPY',
      timeframe: '15m',
      bars: shortBars,
    });
    for (const key of Object.keys(shortSeries)) {
      expect(longSeries[key].slice(0, 180)).toEqual(shortSeries[key]);
    }
  });

  test('決定性: 同じ入力からは同じ系列を返す', async () => {
    const bars = makeUptrendBars(180);
    const params = { symbol: 'USDJPY', timeframe: '15m', bars };
    const first = await computeStateLensFeatureSeries('volatility_regime', params);
    const second = await computeStateLensFeatureSeries('volatility_regime', params);
    expect(first).toEqual(second);
  });

  test('dow_theory: 上昇ジグザグの末尾バーで trend_state=uptrend / 切り上げ bool が立つ', async () => {
    const bars = makeUptrendBars(200);
    const series = await computeStateLensFeatureSeries('dow_theory', {
      symbol: 'USDJPY',
      timeframe: '15m',
      bars,
    });
    const last = bars.length - 1;
    expect(series['trend_state'][last]).toBe('uptrend');
    expect(series['recent_higher_high'][last]).toBe(true);
    expect(series['recent_higher_low'][last]).toBe(true);
    // バー数不足の先頭バーは unclear (誠実なフォールバック)
    expect(series['trend_state'][0]).toBe('unclear');
  });

  test('volatility_regime: regime_label が定義済みラベル、percentile は 0-100', async () => {
    const bars = makeUptrendBars(200);
    const series = await computeStateLensFeatureSeries('volatility_regime', {
      symbol: 'USDJPY',
      timeframe: '15m',
      bars,
    });
    const last = bars.length - 1;
    expect(['contracting', 'low', 'normal', 'elevated', 'expanding']).toContain(
      series['regime_label'][last]
    );
    const percentile = series['bb_width_percentile'][last];
    expect(typeof percentile).toBe('number');
    expect(percentile).toBeGreaterThanOrEqual(0);
    expect(percentile).toBeLessThanOrEqual(100);
  });

  test('time_session: バーの時刻からセッション bool が決まる (00:00 UTC = 東京時間)', async () => {
    const bars = makeUptrendBars(8); // 00:00〜01:45 UTC
    const series = await computeStateLensFeatureSeries('time_session', {
      symbol: 'USDJPY',
      timeframe: '15m',
      bars,
    });
    // 東京セッション (0-6 UTC) 内
    expect(series['tokyo_active'][0]).toBe(true);
    expect(series['london_active'][0]).toBe(false);
    expect(series['is_weekend'][0]).toBe(false);
  });

  test('窓幅は STATE_LENS_CONTEXT_BARS = 150 (lensSnapshotBuilder の窓と同期)', () => {
    expect(STATE_LENS_CONTEXT_BARS).toBe(150);
  });

  test('isTsComputableStateLensId が対応 3 種のみ true', () => {
    expect(isTsComputableStateLensId('time_session')).toBe(true);
    expect(isTsComputableStateLensId('dow_theory')).toBe(true);
    expect(isTsComputableStateLensId('volatility_regime')).toBe(true);
    expect(isTsComputableStateLensId('smc')).toBe(false);
    expect(isTsComputableStateLensId('ind:rsi#p14')).toBe(false);
  });
});

describe('appendStateLensSeriesToCache(状態レンズ系列のキャッシュ準備)', () => {
  test('categoricalEnum は values 順の index で数値エンコードされる (trend_state)', async () => {
    const bars = makeUptrendBars(200);
    const cache = new Map<string, number[]>();
    await appendStateLensSeriesToCache({
      indicatorCache: cache,
      lensConditions: [{ lensId: 'dow_theory' }],
      symbol: 'USDJPY',
      timeframe: '15m',
      bars,
    });
    const trendState = cache.get(makeLensCacheKey('dow_theory', 'trend_state'));
    expect(trendState).toHaveLength(bars.length);
    // values = ['uptrend','downtrend','range','unclear'] → uptrend = 0
    expect(trendState?.[bars.length - 1]).toBe(0);
    // bool は 1/0
    expect(cache.get(makeLensCacheKey('dow_theory', 'recent_higher_high'))?.[bars.length - 1]).toBe(1);
    // skip kind (絶対価格) はエンコード不能 = NaN
    const lastHighPrice = cache.get(makeLensCacheKey('dow_theory', 'last_high_price'));
    expect(lastHighPrice && Number.isNaN(lastHighPrice[bars.length - 1])).toBe(true);
  });

  test('engine 系レンズは engineSeries 未指定だとスキップし、ind: レンズは無視する (担当分離)', async () => {
    const bars = makeUptrendBars(60);
    const cache = new Map<string, number[]>();
    await appendStateLensSeriesToCache({
      indicatorCache: cache,
      lensConditions: [{ lensId: 'smc' }, { lensId: 'ind:rsi#p14' }],
      symbol: 'USDJPY',
      timeframe: '15m',
      bars,
    });
    expect(cache.size).toBe(0);
  });

  test('engine 系レンズ: per-bar payload 配列を features に変換し数値エンコードして格納する', async () => {
    const bars = makeUptrendBars(3);
    const cache = new Map<string, number[]>();
    /** バー i の payload (current_zone を変えて per-bar 値の対応を確認する) */
    const smcPayload = (zone: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM', event: string) => ({
      nearestObBullDistancePips: 12.5,
      nearestObBearDistancePips: -1,
      liquidityAboveCount: 2,
      liquidityBelowCount: 1,
      fvgBullCountLast20: 1,
      fvgBearCountLast20: 0,
      lastStructureEvent: event,
      barsSinceLastStructureEvent: 3,
      currentZone: zone,
      zonePositionPct: 0.25,
    });
    const fetchFn = jest.fn().mockResolvedValue({
      timestamps: [],
      series: {},
      smcSeries: [
        smcPayload('DISCOUNT', 'NONE'),
        smcPayload('EQUILIBRIUM', 'BOS_BULL'),
        smcPayload('PREMIUM', 'CHOCH_BEAR'),
      ],
    });
    await appendStateLensSeriesToCache({
      indicatorCache: cache,
      lensConditions: [{ lensId: 'smc' }],
      symbol: 'USDJPY',
      timeframe: '15m',
      bars,
      engineSeries: {
        startDate: bars[0].timestamp,
        endDate: bars[2].timestamp,
        fetchIndicatorSeriesFn: fetchFn,
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(expect.objectContaining({ stateLensSeries: ['smc'] }));
    // current_zone は orderedEnum ['DISCOUNT','EQUILIBRIUM','PREMIUM'] の index
    expect(cache.get(makeLensCacheKey('smc', 'current_zone'))).toEqual([0, 1, 2]);
    // last_structure_event は categoricalEnum values ['NONE','BOS_BULL','BOS_BEAR','CHOCH_BULL','CHOCH_BEAR'] の index
    expect(cache.get(makeLensCacheKey('smc', 'last_structure_event'))).toEqual([0, 1, 4]);
    // 数値はそのまま
    expect(cache.get(makeLensCacheKey('smc', 'zone_position_pct'))).toEqual([0.25, 0.25, 0.25]);
  });

  test('engine 系レンズ: 旧バージョン engine (配列なし) は警告スキップ = 条件不成立に倒す', async () => {
    const bars = makeUptrendBars(3);
    const cache = new Map<string, number[]>();
    const fetchFn = jest.fn().mockResolvedValue({ timestamps: [], series: {} });
    await appendStateLensSeriesToCache({
      indicatorCache: cache,
      lensConditions: [{ lensId: 'wyckoff' }],
      symbol: 'USDJPY',
      timeframe: '15m',
      bars,
      engineSeries: {
        startDate: bars[0].timestamp,
        endDate: bars[2].timestamp,
        fetchIndicatorSeriesFn: fetchFn,
      },
    });
    expect(cache.size).toBe(0);
  });

  test('engine 系レンズ: 系列長がバー列と一致しない場合は中断する (誤時点判定の防止)', async () => {
    const bars = makeUptrendBars(3);
    const fetchFn = jest.fn().mockResolvedValue({
      timestamps: [],
      series: {},
      chartPatternsSeries: [
        {
          patternDetected: 'NONE',
          patternConfidence: 0,
          patternBreakImminent: false,
          patternBarsCount: 0,
          patternDirectionBias: 'NEUTRAL',
        },
      ], // バー 3 本に対し 1 要素
    });
    await expect(
      appendStateLensSeriesToCache({
        indicatorCache: new Map(),
        lensConditions: [{ lensId: 'chart_pattern' }],
        symbol: 'USDJPY',
        timeframe: '15m',
        bars,
        engineSeries: {
          startDate: bars[0].timestamp,
          endDate: bars[2].timestamp,
          fetchIndicatorSeriesFn: fetchFn,
        },
      })
    ).rejects.toThrow('一致しません');
  });
});
