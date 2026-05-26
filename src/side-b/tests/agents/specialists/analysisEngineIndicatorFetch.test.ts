/**
 * analysisEngineIndicatorFetch 単体テスト (Phase 6.8 Step 2、2026-05-27)
 *
 * 検証範囲:
 * - 2 TF 並列取得の正常系 (= current + higher 両方成功 → IndicatorSpecialistInput 構築)
 * - 現在 TF 取得失敗 → null
 * - 上位 TF 取得失敗 → fallback (= higher を空 indicators で埋める)
 * - response.series → IndicatorSeries マッピングが makeIndicatorCacheKey と一致
 */

import {
  fetchIndicatorBundleForMTF,
  type FetchIndicatorBundleInput,
} from '../../../agents/specialists/analysisEngineIndicatorFetch';
import { INDICATOR_CATALOG } from '../../../agents/specialists/indicatorCatalog';
import {
  fetchIndicatorSeries,
  makeIndicatorCacheKey,
} from '../../../../backend/services/analysisEngineClient';

jest.mock('../../../../backend/services/analysisEngineClient', () => {
  const actual = jest.requireActual('../../../../backend/services/analysisEngineClient');
  return {
    ...actual,
    fetchIndicatorSeries: jest.fn(),
  };
});

const mockFetch = fetchIndicatorSeries as jest.Mock;

function makeOhlcv(n: number) {
  const arr: Array<{
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }> = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)),
      open: 1.0 + i * 0.001,
      high: 1.0 + i * 0.001 + 0.0005,
      low: 1.0 + i * 0.001 - 0.0005,
      close: 1.0 + i * 0.001 + 0.0002,
      volume: 100,
    });
  }
  return arr;
}

function makeSeriesResponse(): { series: Record<string, Array<number | null>> } {
  // INDICATOR_CATALOG の各 spec に対し makeIndicatorCacheKey で正確な key を組み立て、
  // 値の系列を返すモック
  const series: Record<string, Array<number | null>> = {};
  for (const spec of INDICATOR_CATALOG) {
    const key = makeIndicatorCacheKey(spec.id, spec.params, spec.field);
    series[key] = [1.0, 1.1, 1.2, 1.3, 1.4]; // 5 件の系列
  }
  return { series };
}

function makeInput(): FetchIndicatorBundleInput {
  return {
    symbol: 'NZDCHF',
    currentTimeframe: '15m',
    higherTimeframe: '1h',
    currentOhlcv: makeOhlcv(20),
    higherOhlcv: makeOhlcv(20),
  };
}

describe('fetchIndicatorBundleForMTF', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('正常系: 2 TF 並列取得 → IndicatorSpecialistInput 構築', async () => {
    mockFetch.mockResolvedValue(makeSeriesResponse());

    const result = await fetchIndicatorBundleForMTF(makeInput());

    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('NZDCHF');
    expect(result?.currentTimeframe).toBe('15m');
    expect(result?.higherTimeframe).toBe('1h');
    // P0 必須 indicator (sma/ema/rsi/macd/atr) が current/higher どちらにも入っている
    expect(result?.current.indicators.sma).toBeDefined();
    expect(result?.current.indicators.rsi).toBeDefined();
    expect(result?.higher.indicators.sma).toBeDefined();
    expect(result?.higher.indicators.rsi).toBeDefined();
    // priceContext が OHLCV 末尾から構築されている
    expect(result?.current.priceContext.latestClose).toBeGreaterThan(0);
    // fetchIndicatorSeries が 2 回呼ばれた (= 2 TF 並列)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('現在 TF 取得失敗 → null', async () => {
    mockFetch.mockImplementation(({ timeframe }: { timeframe: string }) => {
      if (timeframe === '15m') return Promise.reject(new Error('current TF error'));
      return Promise.resolve(makeSeriesResponse());
    });

    const result = await fetchIndicatorBundleForMTF(makeInput());
    expect(result).toBeNull();
  });

  it('上位 TF 取得失敗 → current は採用、higher は空 indicators で fallback', async () => {
    mockFetch.mockImplementation(({ timeframe }: { timeframe: string }) => {
      if (timeframe === '1h') return Promise.reject(new Error('higher TF error'));
      return Promise.resolve(makeSeriesResponse());
    });

    const result = await fetchIndicatorBundleForMTF(makeInput());

    expect(result).not.toBeNull();
    // current は採用
    expect(result?.current.indicators.sma).toBeDefined();
    // higher は空 indicators で fallback (= IndicatorSpecialist が (unavailable) として処理)
    expect(Object.keys(result?.higher.indicators ?? {})).toHaveLength(0);
    // higher の priceContext は higherOhlcv から構築 (= 取得失敗でも OHLCV はある)
    expect(result?.higher.priceContext.latestClose).toBeGreaterThan(0);
  });

  it('higherOhlcv 未指定 → higher は currentOhlcv ベースの空 fallback', async () => {
    mockFetch.mockResolvedValue(makeSeriesResponse());

    const input = makeInput();
    const result = await fetchIndicatorBundleForMTF({ ...input, higherOhlcv: undefined });

    expect(result).not.toBeNull();
    // higher の indicators は空 (= 取得が試みられない)
    expect(Object.keys(result?.higher.indicators ?? {})).toHaveLength(0);
    // higher の priceContext は currentOhlcv ベースで構築されている (= latestClose > 0)
    expect(result?.higher.priceContext.latestClose).toBeGreaterThan(0);
    // fetchIndicatorSeries は current のみ 1 回呼ばれた
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('response.series の key が makeIndicatorCacheKey 形式と一致しないと対応 indicator が欠落', async () => {
    // 不一致な key (= prefix だけ合う) を返す → 完全一致でないので欠落
    mockFetch.mockResolvedValue({
      series: {
        sma_wrongkey_value: [1.0, 1.1, 1.2],
        rsi_wrongkey_value: [50, 55, 60],
      },
    });

    const result = await fetchIndicatorBundleForMTF(makeInput());

    expect(result).not.toBeNull();
    // makeIndicatorCacheKey と一致しないので indicators は空
    expect(Object.keys(result?.current.indicators ?? {})).toHaveLength(0);
  });
});
