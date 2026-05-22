/**
 * EodhdProvider.getHistoricalData / getHistoricalRange / getCurrentPrice 単体テスト
 *
 * EODHD SDK は jest.mock でスタブ化し、Provider の以下を検証する:
 * - 内部 Timeframe → EODHD interval / period への正しいマッピング
 * - 15m / 30m / 4h の集約後の bar 数と OHLCV 合成
 * - intraday / eod のレスポンス → 内部 OHLCVBar 変換 (timestamp の Date 化)
 * - APIキー未設定時のエラー
 */

import type { EodDataPoint, IntradayDataPoint } from 'eodhd';

/** 各 test のために intraday / eod が返すデータをセットする */
const sdkMocks = {
  intraday: jest.fn<Promise<IntradayDataPoint[]>, [string, { interval: string; from?: number; to?: number }]>(),
  eod: jest.fn<Promise<EodDataPoint[]>, [string, { period?: string; from?: string; to?: string; order?: string }]>(),
  websocket: jest.fn(),
};

jest.mock('eodhd', () => ({
  EODHDClient: jest.fn().mockImplementation(() => ({
    intraday: sdkMocks.intraday,
    eod: sdkMocks.eod,
    websocket: sdkMocks.websocket,
  })),
}));

import { EodhdProvider } from '../../infrastructure/market/EodhdProvider';

function intradayPoint(isoUtc: string, o: number, h: number, l: number, c: number, v: number): IntradayDataPoint {
  return {
    timestamp: Math.floor(new Date(isoUtc).getTime() / 1000),
    gmtoffset: 0,
    datetime: isoUtc,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
  };
}

function eodPoint(date: string, o: number, h: number, l: number, c: number, v: number): EodDataPoint {
  return {
    date,
    open: o,
    high: h,
    low: l,
    close: c,
    adjusted_close: c,
    volume: v,
  };
}

describe('EodhdProvider.getHistoricalData (intraday native)', () => {
  beforeEach(() => {
    sdkMocks.intraday.mockReset();
    sdkMocks.eod.mockReset();
  });

  it('1m: SDK の intraday を interval=1m で呼び、変換結果をそのまま返す', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10),
      intradayPoint('2026-05-22T10:01:00Z', 101, 103, 100, 102, 20),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const result = await provider.getHistoricalData('XAU/USD', '1m', 2);

    expect(sdkMocks.intraday).toHaveBeenCalledTimes(1);
    const [providerSymbol, params] = sdkMocks.intraday.mock.calls[0];
    expect(providerSymbol).toBe('XAUUSD.FOREX');
    expect(params.interval).toBe('1m');

    expect(result.bars).toHaveLength(2);
    expect(result.bars[0]).toMatchObject({ open: 100, close: 101 });
    expect(result.bars[0].timestamp.toISOString()).toBe('2026-05-22T10:00:00.000Z');
    expect(result.symbol).toBe('XAU/USD');
    expect(result.provider).toBe('eodhd');
  });

  it('5m: SDK の intraday を interval=5m で呼ぶ', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    await provider.getHistoricalData('EUR/USD', '5m', 1);

    expect(sdkMocks.intraday.mock.calls[0][1].interval).toBe('5m');
  });

  it('1h: SDK の intraday を interval=1h で呼ぶ', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    await provider.getHistoricalData('USD/JPY', '1h', 1);

    expect(sdkMocks.intraday.mock.calls[0][1].interval).toBe('1h');
  });
});

describe('EodhdProvider.getHistoricalData (集約経路)', () => {
  beforeEach(() => {
    sdkMocks.intraday.mockReset();
    sdkMocks.eod.mockReset();
  });

  it('15m: 5m × 3 を取得し 1 本の 15m バーに集約する', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10),
      intradayPoint('2026-05-22T10:05:00Z', 101, 103, 100, 102, 20),
      intradayPoint('2026-05-22T10:10:00Z', 102, 105, 101, 104, 30),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const result = await provider.getHistoricalData('XAU/USD', '15m', 1);

    // intraday は 5m で叩いている
    expect(sdkMocks.intraday.mock.calls[0][1].interval).toBe('5m');
    // 集約後 1 本
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]).toMatchObject({
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      volume: 60,
    });
    expect(result.bars[0].timestamp.toISOString()).toBe('2026-05-22T10:00:00.000Z');
  });

  it('4h: 1h × 4 を取得し 1 本の 4h バーに集約する', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T12:00:00Z', 100, 101, 99, 100, 10),
      intradayPoint('2026-05-22T13:00:00Z', 100, 102, 98, 101, 10),
      intradayPoint('2026-05-22T14:00:00Z', 101, 103, 100, 102, 10),
      intradayPoint('2026-05-22T15:00:00Z', 102, 104, 101, 103, 10),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const result = await provider.getHistoricalData('USD/JPY', '4h', 1);

    expect(sdkMocks.intraday.mock.calls[0][1].interval).toBe('1h');
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]).toMatchObject({
      open: 100,
      high: 104,
      low: 98,
      close: 103,
      volume: 40,
    });
    expect(result.bars[0].timestamp.toISOString()).toBe('2026-05-22T12:00:00.000Z');
  });

  it('30m: 5m × 6 を取得し 1 本の 30m バーに集約する', async () => {
    const source: IntradayDataPoint[] = [];
    for (let i = 0; i < 6; i++) {
      const min = i * 5;
      const ts = `2026-05-22T10:${String(min).padStart(2, '0')}:00Z`;
      source.push(intradayPoint(ts, 100 + i, 101 + i, 99 + i, 100 + i + 0.5, 10));
    }
    sdkMocks.intraday.mockResolvedValueOnce(source);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const result = await provider.getHistoricalData('EUR/USD', '30m', 1);

    expect(sdkMocks.intraday.mock.calls[0][1].interval).toBe('5m');
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]).toMatchObject({ open: 100, high: 106, low: 99, close: 105.5, volume: 60 });
  });

  it('集約後の bar 数が limit を超えた場合、末尾 limit 件に絞り込む', async () => {
    // 6 本の 5m → 2 本の 15m に集約後、limit=1 で末尾 1 本だけ返す
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T10:00:00Z', 100, 101, 99, 100, 10),
      intradayPoint('2026-05-22T10:05:00Z', 100, 102, 99, 101, 10),
      intradayPoint('2026-05-22T10:10:00Z', 101, 103, 100, 102, 10),
      intradayPoint('2026-05-22T10:15:00Z', 102, 104, 101, 103, 10),
      intradayPoint('2026-05-22T10:20:00Z', 103, 105, 102, 104, 10),
      intradayPoint('2026-05-22T10:25:00Z', 104, 106, 103, 105, 10),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const result = await provider.getHistoricalData('XAU/USD', '15m', 1);

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].timestamp.toISOString()).toBe('2026-05-22T10:15:00.000Z');
  });
});

describe('EodhdProvider.getHistoricalData (eod 経路)', () => {
  beforeEach(() => {
    sdkMocks.intraday.mockReset();
    sdkMocks.eod.mockReset();
  });

  it('1d: SDK の eod を period=d で呼ぶ、UTC 00:00 timestamp に正規化', async () => {
    sdkMocks.eod.mockResolvedValueOnce([
      eodPoint('2026-05-20', 100, 102, 99, 101, 1000),
      eodPoint('2026-05-21', 101, 103, 100, 102, 1100),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const result = await provider.getHistoricalData('XAU/USD', '1d', 2);

    expect(sdkMocks.eod).toHaveBeenCalledTimes(1);
    expect(sdkMocks.eod.mock.calls[0][1].period).toBe('d');
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0].timestamp.toISOString()).toBe('2026-05-20T00:00:00.000Z');
    expect(result.bars[0]).toMatchObject({ open: 100, close: 101, volume: 1000 });
  });

  it('1w: SDK の eod を period=w で呼ぶ', async () => {
    sdkMocks.eod.mockResolvedValueOnce([
      eodPoint('2026-05-18', 100, 105, 95, 103, 5000),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const result = await provider.getHistoricalData('EUR/USD', '1w', 1);

    expect(sdkMocks.eod.mock.calls[0][1].period).toBe('w');
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]).toMatchObject({ open: 100, close: 103 });
  });
});

describe('EodhdProvider.getCurrentPrice', () => {
  beforeEach(() => {
    sdkMocks.intraday.mockReset();
    sdkMocks.eod.mockReset();
  });

  it('limit=1 で getHistoricalData を呼び、最後の bar を返す', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const bar = await provider.getCurrentPrice('XAU/USD', '1h');

    expect(bar).not.toBeNull();
    expect(bar?.close).toBe(101);
  });

  it('bars が空なら null を返す', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const bar = await provider.getCurrentPrice('XAU/USD', '1h');

    expect(bar).toBeNull();
  });
});

describe('EodhdProvider.getHistoricalRange', () => {
  beforeEach(() => {
    sdkMocks.intraday.mockReset();
    sdkMocks.eod.mockReset();
  });

  it('intraday: from/to を Unix epoch 秒で渡し、レンジ外バーは除外する', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T09:55:00Z', 99, 100, 98, 99, 10),  // レンジ外
      intradayPoint('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10),
      intradayPoint('2026-05-22T10:05:00Z', 101, 103, 100, 102, 10),
      intradayPoint('2026-05-22T10:30:00Z', 103, 104, 102, 103, 10), // レンジ外
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const fromDate = new Date('2026-05-22T10:00:00Z');
    const toDate = new Date('2026-05-22T10:20:00Z');
    const result = await provider.getHistoricalRange('XAU/USD', '5m', fromDate, toDate);

    // 範囲外 (09:55 / 10:30) は除外
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0].timestamp.toISOString()).toBe('2026-05-22T10:00:00.000Z');
    expect(result.bars[1].timestamp.toISOString()).toBe('2026-05-22T10:05:00.000Z');

    // SDK には Unix epoch 秒で渡している
    const params = sdkMocks.intraday.mock.calls[0][1];
    expect(params.from).toBe(Math.floor(fromDate.getTime() / 1000));
    expect(params.to).toBe(Math.floor(toDate.getTime() / 1000));
  });

  it('eod: from/to を YYYY-MM-DD 形式で渡す', async () => {
    sdkMocks.eod.mockResolvedValueOnce([
      eodPoint('2026-05-20', 100, 102, 99, 101, 1000),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    await provider.getHistoricalRange(
      'XAU/USD',
      '1d',
      new Date('2026-05-19T00:00:00Z'),
      new Date('2026-05-21T00:00:00Z'),
    );

    const params = sdkMocks.eod.mock.calls[0][1];
    expect(params.from).toBe('2026-05-19');
    expect(params.to).toBe('2026-05-21');
    expect(params.period).toBe('d');
  });

  it('集約経路 (15m): 5m を取得して集約してから範囲フィルタする', async () => {
    sdkMocks.intraday.mockResolvedValueOnce([
      intradayPoint('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10),
      intradayPoint('2026-05-22T10:05:00Z', 101, 103, 100, 102, 10),
      intradayPoint('2026-05-22T10:10:00Z', 102, 105, 101, 104, 10),
      intradayPoint('2026-05-22T10:15:00Z', 104, 106, 103, 105, 10),
      intradayPoint('2026-05-22T10:20:00Z', 105, 107, 104, 106, 10),
      intradayPoint('2026-05-22T10:25:00Z', 106, 108, 105, 107, 10),
    ]);

    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const result = await provider.getHistoricalRange(
      'XAU/USD',
      '15m',
      new Date('2026-05-22T10:00:00Z'),
      new Date('2026-05-22T10:30:00Z'),
    );

    expect(result.bars).toHaveLength(2);
    expect(result.bars[0]).toMatchObject({ open: 100, close: 104 });
    expect(result.bars[1]).toMatchObject({ open: 104, close: 107 });
  });
});

describe('EodhdProvider — API キー未設定', () => {
  beforeEach(() => {
    sdkMocks.intraday.mockReset();
    sdkMocks.eod.mockReset();
  });

  it('APIキーがないと getHistoricalData は throw する', async () => {
    const provider = new EodhdProvider({ apiToken: '' });
    await expect(provider.getHistoricalData('XAU/USD', '5m', 10)).rejects.toThrow(
      /EODHD_API_KEY/,
    );
  });

  it('APIキーがないと getHistoricalRange は throw する', async () => {
    const provider = new EodhdProvider({ apiToken: '' });
    await expect(
      provider.getHistoricalRange(
        'XAU/USD',
        '5m',
        new Date('2026-05-22T10:00:00Z'),
        new Date('2026-05-22T11:00:00Z'),
      ),
    ).rejects.toThrow(/EODHD_API_KEY/);
  });
});
