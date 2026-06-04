/**
 * ChartDataService / EODHDChartDataProvider 単体テスト
 *
 * 検証観点 (チャート基盤 EODHD 主体化):
 * - EODHD を主データソースとして優先する
 * - EODHD 障害時にローカルキャッシュへフォールバックする
 * - cTrader に一切依存しない (cTrader が無くても candles 取得が成立する)
 * - エラー種別 (invalid_symbol / invalid_timeframe / upstream_unavailable) を正しく投げる
 * - symbol 有効・データ無しは 200 相当 (空 candles + warning) で返す
 */

import { ChartDataService, type LocalCandleStore } from '../../services/chartDataService';
import { EODHDChartDataProvider } from '../../infrastructure/market/EODHDChartDataProvider';
import {
  ChartDataError,
  type ChartCandle,
  type ChartCandlesResponse,
  type ChartDataProvider,
} from '../../infrastructure/market/chart-data.types';
import type { EodhdProvider } from '../../infrastructure/market/EodhdProvider';
import type { MarketDataResult, OHLCVBar } from '../../infrastructure/market/IMarketDataProvider';

// ========================================
// テスト用ヘルパー
// ========================================

function chartCandle(time: number, close: number): ChartCandle {
  return { time, open: close, high: close, low: close, close, volume: 100 };
}

/** 任意の candles を返す ChartDataProvider モック */
function mockProvider(
  impl: (params: { symbol: string; timeframe: string }) => Promise<ChartCandlesResponse>,
  name = 'EODHD',
): ChartDataProvider {
  return {
    name,
    getCandles: (params) => impl(params),
  };
}

/** 任意の candles を返す LocalCandleStore モック */
function mockLocalStore(candles: ChartCandle[]): LocalCandleStore {
  return {
    getCandles: async () => candles,
  };
}

function eodhdResponse(candles: ChartCandle[]): ChartCandlesResponse {
  return {
    candles,
    meta: {
      source: 'EODHD',
      provider: 'EODHD',
      priceBasis: 'unknown',
      symbol: 'XAUUSD',
      timeframe: '1m',
      isRealtime: false,
      delayMs: 60000,
      generatedAt: new Date().toISOString(),
    },
    warning: 'EODHDのOHLCVはリアルタイムではない可能性があります。',
  };
}

describe('ChartDataService', () => {
  it('EODHD を優先し、データがあればローカルストアを参照しない', async () => {
    const localStore = mockLocalStore([chartCandle(1000, 1)]);
    const localSpy = jest.spyOn(localStore, 'getCandles');
    const service = new ChartDataService({
      chartProvider: mockProvider(async () => eodhdResponse([chartCandle(2000, 2)])),
      localStore,
    });

    const result = await service.getCandles({ symbol: 'XAUUSD', timeframe: '1m' });

    expect(result.meta.source).toBe('EODHD');
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].close).toBe(2);
    // EODHD で取れたのでローカルは見に行かない
    expect(localSpy).not.toHaveBeenCalled();
  });

  it('EODHD が空ならローカルキャッシュ (source=local) にフォールバックする', async () => {
    const service = new ChartDataService({
      chartProvider: mockProvider(async () => eodhdResponse([])),
      localStore: mockLocalStore([chartCandle(3000, 3)]),
    });

    const result = await service.getCandles({ symbol: 'XAUUSD', timeframe: '1m' });

    expect(result.meta.source).toBe('local');
    expect(result.candles).toHaveLength(1);
    expect(result.warning).toContain('ローカルキャッシュ');
  });

  it('EODHD 障害でもローカルにデータがあれば local で返す (cTrader 非依存)', async () => {
    const service = new ChartDataService({
      chartProvider: mockProvider(async () => {
        throw new ChartDataError('upstream_unavailable', 'EODHD 障害');
      }),
      localStore: mockLocalStore([chartCandle(4000, 4)]),
      retry: { delayMs: 0 },
    });

    const result = await service.getCandles({ symbol: 'XAUUSD', timeframe: '1m' });
    expect(result.meta.source).toBe('local');
  });

  it('EODHD 障害かつローカルも空なら 503 を投げず空 candles + 一過性 warning に縮退する', async () => {
    // F4: 一過性障害でハード 503 エラー画面化するのを防ぐためソフト縮退する
    const service = new ChartDataService({
      chartProvider: mockProvider(async () => {
        throw new ChartDataError('upstream_unavailable', 'EODHD 障害');
      }),
      localStore: mockLocalStore([]),
      retry: { delayMs: 0 },
    });

    const result = await service.getCandles({ symbol: 'XAUUSD', timeframe: '1m' });
    expect(result.candles).toHaveLength(0);
    expect(result.warning).toContain('一時的に取得できません');
  });

  it('symbol 有効・データ無しは空 candles + warning で返す (404 にしない)', async () => {
    const service = new ChartDataService({
      chartProvider: mockProvider(async () => eodhdResponse([])),
      localStore: mockLocalStore([]),
    });

    const result = await service.getCandles({ symbol: 'XAUUSD', timeframe: '1m' });
    expect(result.candles).toHaveLength(0);
    expect(result.warning).toBeTruthy();
    expect(result.meta.source).toBe('EODHD');
  });

  it('未対応の時間足は invalid_timeframe を投げる', async () => {
    const service = new ChartDataService({
      chartProvider: mockProvider(async () => eodhdResponse([chartCandle(1, 1)])),
      localStore: mockLocalStore([]),
    });
    await expect(service.getCandles({ symbol: 'XAUUSD', timeframe: '3m' })).rejects.toMatchObject({
      kind: 'invalid_timeframe',
    });
  });

  it('不正なシンボルは invalid_symbol を投げる', async () => {
    const service = new ChartDataService({
      chartProvider: mockProvider(async () => eodhdResponse([chartCandle(1, 1)])),
      localStore: mockLocalStore([]),
    });
    await expect(service.getCandles({ symbol: 'X', timeframe: '1m' })).rejects.toMatchObject({
      kind: 'invalid_symbol',
    });
  });

  // 2026-05-28 12:00Z = 木 (開場) / 2026-05-30 12:00Z = 土 (閉場)
  const THU_OPEN = 1779969600;
  const SAT_CLOSED = 1780142400;

  it('FX/貴金属は閉場(土日)バーを除去する (細い線対策)', async () => {
    const service = new ChartDataService({
      chartProvider: mockProvider(async () =>
        eodhdResponse([chartCandle(THU_OPEN, 1), chartCandle(SAT_CLOSED, 2)]),
      ),
      localStore: mockLocalStore([]),
    });
    const result = await service.getCandles({ symbol: 'XAUUSD', timeframe: '1h' });
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].time).toBe(THU_OPEN);
  });

  it('暗号通貨 (24/7) は土日バーを除去しない', async () => {
    const service = new ChartDataService({
      chartProvider: mockProvider(async () =>
        eodhdResponse([chartCandle(THU_OPEN, 1), chartCandle(SAT_CLOSED, 2)]),
      ),
      localStore: mockLocalStore([]),
    });
    const result = await service.getCandles({ symbol: 'BTCUSD', timeframe: '1h' });
    expect(result.candles).toHaveLength(2);
  });
});

// ========================================
// EODHDChartDataProvider
// ========================================

/** EodhdProvider の最小モックを作る (tests のみ unknown 経由のキャスト許可) */
function fakeEodhdProvider(
  historical: (symbol: string, timeframe: string, limit: number) => Promise<MarketDataResult>,
): EodhdProvider {
  const stub = {
    getHistoricalData: historical,
    getHistoricalRange: async (): Promise<MarketDataResult> => ({
      symbol: 'XAUUSD',
      timeframe: '1m',
      bars: [],
      provider: 'eodhd',
      fetchedAt: new Date(),
    }),
  };
  return stub as unknown as EodhdProvider;
}

function bar(tsMs: number, close: number): OHLCVBar {
  return { timestamp: new Date(tsMs), open: close, high: close, low: close, close, volume: 10 };
}

describe('EODHDChartDataProvider', () => {
  it('OHLCVBar を ChartCandle (time=秒) + meta.source=EODHD に変換する', async () => {
    const provider = new EODHDChartDataProvider(
      fakeEodhdProvider(async () => ({
        symbol: 'XAUUSD',
        timeframe: '1m',
        bars: [bar(1_700_000_000_000, 2345.12)],
        provider: 'eodhd',
        fetchedAt: new Date(),
      })),
    );

    const res = await provider.getCandles({ symbol: 'XAUUSD', timeframe: '1m', limit: 10 });

    expect(res.meta.source).toBe('EODHD');
    expect(res.meta.isRealtime).toBe(false);
    expect(res.meta.delayMs).toBe(60000);
    expect(res.candles).toHaveLength(1);
    // ms → 秒 に変換されている
    expect(res.candles[0].time).toBe(1_700_000_000);
    expect(res.candles[0].close).toBe(2345.12);
  });

  it('EodhdProvider が throw したら upstream_unavailable に正規化する', async () => {
    const provider = new EODHDChartDataProvider(
      fakeEodhdProvider(async () => {
        throw new Error('EODHD_API_KEY 未設定');
      }),
    );

    await expect(
      provider.getCandles({ symbol: 'XAUUSD', timeframe: '1m', limit: 10 }),
    ).rejects.toMatchObject({ kind: 'upstream_unavailable' });
  });
});
