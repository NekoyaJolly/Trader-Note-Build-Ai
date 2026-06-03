/**
 * CTraderQuoteProvider 単体テスト
 *
 * 検証観点 (broker overlay):
 * - 取得成功時に bid/ask/spread と status=connected を返す
 * - cTrader 未接続時は status=disconnected (quote=null)
 * - 取得失敗 (接続済だが quote 取れず) は status=degraded
 * - getQuote は例外を投げず status で表現する (チャートを巻き込まない)
 */

import {
  CTraderQuoteProvider,
  type LatestBidAsk,
  type LatestQuoteFetcher,
} from '../services/ctrader/ctraderQuoteProvider';

function fetcher(opts: {
  available: boolean;
  latest?: LatestBidAsk | null;
  throwOnFetch?: boolean;
}): LatestQuoteFetcher {
  return {
    isAvailable: async () => opts.available,
    getLatestBidAsk: async () => {
      if (opts.throwOnFetch) throw new Error('tick 取得失敗');
      return opts.latest ?? null;
    },
  };
}

describe('CTraderQuoteProvider', () => {
  it('取得成功時に bid/ask/spread と connected を返す', async () => {
    const provider = new CTraderQuoteProvider(
      fetcher({
        available: true,
        latest: { bid: 1.2345, ask: 1.2347, timestamp: new Date('2026-06-03T00:00:00Z') },
      }),
    );

    const res = await provider.getQuote('EURUSD');

    expect(res.status).toBe('connected');
    expect(res.quote).not.toBeNull();
    expect(res.quote?.bid).toBe(1.2345);
    expect(res.quote?.ask).toBe(1.2347);
    // 浮動小数の誤差を許容
    expect(res.quote?.spread).toBeCloseTo(0.0002, 6);
    expect(res.quote?.broker).toBe('cTrader');
    expect(res.quote?.symbol).toBe('EURUSD');
  });

  it('cTrader 未接続なら disconnected (quote=null)', async () => {
    const provider = new CTraderQuoteProvider(fetcher({ available: false }));
    const res = await provider.getQuote('EURUSD');
    expect(res.status).toBe('disconnected');
    expect(res.quote).toBeNull();
    expect(res.warning).toBeTruthy();
  });

  it('接続済だが quote が取れない場合は degraded', async () => {
    const provider = new CTraderQuoteProvider(fetcher({ available: true, latest: null }));
    const res = await provider.getQuote('EURUSD');
    expect(res.status).toBe('degraded');
    expect(res.quote).toBeNull();
  });

  it('取得中に例外が出ても throw せず degraded を返す', async () => {
    const provider = new CTraderQuoteProvider(fetcher({ available: true, throwOnFetch: true }));
    const res = await provider.getQuote('EURUSD');
    expect(res.status).toBe('degraded');
    expect(res.quote).toBeNull();
  });
});
