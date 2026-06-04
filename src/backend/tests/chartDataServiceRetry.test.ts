/**
 * ChartDataService 一過性障害耐性テスト (F4)
 *
 * 本番で観測した「EODHD intraday の一過性 upstream_unavailable によりデフォルト
 * 1 分足がハード 503 エラー画面化する」問題への対処を検証する:
 * - upstream_unavailable はリトライで吸収される
 * - リトライ後も障害かつキャッシュ無しなら 503 を投げず 200 + 空 + 一過性 warning に縮退
 * - ローカルキャッシュがあれば縮退より優先してキャッシュを返す
 * - invalid_symbol / invalid_timeframe はリトライせず即伝播
 */

import { ChartDataService, type LocalCandleStore } from '../../services/chartDataService';
import {
  ChartDataError,
  type ChartCandlesResponse,
  type ChartDataProvider,
  type GetCandlesParams,
} from '../../infrastructure/market/chart-data.types';

// FX カレンダーフィルタを回避するため暗号通貨シンボルを使う (24/7 稼働で休場除外なし)
const SYMBOL = 'BTCUSDT';

function candle(time: number): ChartCandlesResponse {
  return {
    candles: [{ time, open: 100, high: 101, low: 99, close: 100.5, volume: 10 }],
    meta: {
      source: 'EODHD',
      provider: 'EODHD',
      priceBasis: 'unknown',
      symbol: SYMBOL,
      timeframe: '1m',
      isRealtime: false,
      delayMs: null,
      generatedAt: new Date('2026-06-04T00:00:00.000Z').toISOString(),
    },
  };
}

class FakeProvider implements ChartDataProvider {
  readonly name = 'EODHD';
  calls = 0;
  constructor(private readonly behavior: (call: number) => ChartCandlesResponse) {}
  async getCandles(_params: GetCandlesParams): Promise<ChartCandlesResponse> {
    this.calls += 1;
    return this.behavior(this.calls);
  }
}

const emptyStore: LocalCandleStore = { getCandles: async () => [] };

describe('ChartDataService 一過性障害耐性', () => {
  it('upstream_unavailable はリトライで吸収して candles を返す', async () => {
    const provider = new FakeProvider((call) => {
      if (call < 3) throw new ChartDataError('upstream_unavailable', '一時的な障害');
      return candle(1780_000_000);
    });
    const svc = new ChartDataService({
      chartProvider: provider,
      localStore: emptyStore,
      retry: { maxAttempts: 3, delayMs: 0 },
    });
    const res = await svc.getCandles({ symbol: SYMBOL, timeframe: '1m', limit: 10 });
    expect(provider.calls).toBe(3);
    expect(res.candles).toHaveLength(1);
  });

  it('リトライ後も障害かつキャッシュ無しなら 503 を投げず 200 + 空 + warning に縮退', async () => {
    const provider = new FakeProvider(() => {
      throw new ChartDataError('upstream_unavailable', '継続障害');
    });
    const svc = new ChartDataService({
      chartProvider: provider,
      localStore: emptyStore,
      retry: { maxAttempts: 3, delayMs: 0 },
    });
    const res = await svc.getCandles({ symbol: SYMBOL, timeframe: '1m', limit: 10 });
    expect(provider.calls).toBe(3); // 初回 + 2 リトライ
    expect(res.candles).toHaveLength(0);
    expect(res.warning).toContain('一時的に取得できません');
  });

  it('障害時はローカルキャッシュがあれば縮退より優先して返す', async () => {
    const provider = new FakeProvider(() => {
      throw new ChartDataError('upstream_unavailable', '障害');
    });
    const store: LocalCandleStore = {
      getCandles: async () => [{ time: 1780_000_060, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
    };
    const svc = new ChartDataService({
      chartProvider: provider,
      localStore: store,
      retry: { maxAttempts: 2, delayMs: 0 },
    });
    const res = await svc.getCandles({ symbol: SYMBOL, timeframe: '1m', limit: 10 });
    expect(res.candles).toHaveLength(1);
    expect(res.meta.source).toBe('local');
  });

  it('maxAttempts=0 でも最低1回は provider を試行する (clamp, PR #338)', async () => {
    const provider = new FakeProvider(() => candle(1780_000_000));
    const svc = new ChartDataService({
      chartProvider: provider,
      localStore: emptyStore,
      retry: { maxAttempts: 0, delayMs: -100 },
    });
    const res = await svc.getCandles({ symbol: SYMBOL, timeframe: '1m', limit: 10 });
    expect(provider.calls).toBe(1);
    expect(res.candles).toHaveLength(1);
  });

  it('invalid_timeframe はリトライせず即伝播する', async () => {
    const provider = new FakeProvider(() => candle(1));
    const svc = new ChartDataService({
      chartProvider: provider,
      localStore: emptyStore,
      retry: { maxAttempts: 3, delayMs: 0 },
    });
    await expect(
      svc.getCandles({ symbol: SYMBOL, timeframe: 'bogus', limit: 10 }),
    ).rejects.toMatchObject({ kind: 'invalid_timeframe' });
    expect(provider.calls).toBe(0);
  });
});
