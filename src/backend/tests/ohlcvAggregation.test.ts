/**
 * ohlcvAggregation 単体テスト
 *
 * Phase B (EODHD 切替) の集約ロジックは EODHD intraday API の `1m / 5m / 1h` 制限を
 * 補うクライアント側集約。OHLCV の合成が壊れていると Side-B のバックテスト・進化探索が
 * すべて狂うため、純粋関数の段階で網羅テストを置く。
 */

import {
  TIMEFRAME_MS,
  planEodhdFetch,
  bucketStartMs,
  aggregateOHLCV,
} from '../../infrastructure/market/ohlcvAggregation';
import type { OHLCVBar } from '../../infrastructure/market/IMarketDataProvider';

function bar(
  isoTimestamp: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): OHLCVBar {
  return {
    timestamp: new Date(isoTimestamp),
    open,
    high,
    low,
    close,
    volume,
  };
}

describe('TIMEFRAME_MS', () => {
  it('各 timeframe を ms に正しく換算する', () => {
    expect(TIMEFRAME_MS['1m']).toBe(60_000);
    expect(TIMEFRAME_MS['5m']).toBe(300_000);
    expect(TIMEFRAME_MS['15m']).toBe(900_000);
    expect(TIMEFRAME_MS['30m']).toBe(1_800_000);
    expect(TIMEFRAME_MS['1h']).toBe(3_600_000);
    expect(TIMEFRAME_MS['4h']).toBe(14_400_000);
    expect(TIMEFRAME_MS['1d']).toBe(86_400_000);
    expect(TIMEFRAME_MS['1w']).toBe(604_800_000);
  });
});

describe('planEodhdFetch', () => {
  it('1m / 5m / 1h は intraday native (factor=1)', () => {
    expect(planEodhdFetch('1m')).toEqual({ kind: 'intraday', interval: '1m', factor: 1 });
    expect(planEodhdFetch('5m')).toEqual({ kind: 'intraday', interval: '5m', factor: 1 });
    expect(planEodhdFetch('1h')).toEqual({ kind: 'intraday', interval: '1h', factor: 1 });
  });

  it('15m / 30m は 5m × N を集約', () => {
    expect(planEodhdFetch('15m')).toEqual({ kind: 'intraday', interval: '5m', factor: 3 });
    expect(planEodhdFetch('30m')).toEqual({ kind: 'intraday', interval: '5m', factor: 6 });
  });

  it('4h は 1h × 4 を集約', () => {
    expect(planEodhdFetch('4h')).toEqual({ kind: 'intraday', interval: '1h', factor: 4 });
  });

  it('1d / 1w は eod period 経路', () => {
    expect(planEodhdFetch('1d')).toEqual({ kind: 'eod', period: 'd' });
    expect(planEodhdFetch('1w')).toEqual({ kind: 'eod', period: 'w' });
  });
});

describe('bucketStartMs', () => {
  it('15m バケットは :00 / :15 / :30 / :45 に揃う', () => {
    const fifteenMin = TIMEFRAME_MS['15m'];
    // 2026-05-22 10:07:30 UTC → 10:00 UTC
    const t1 = new Date('2026-05-22T10:07:30Z').getTime();
    expect(new Date(bucketStartMs(t1, fifteenMin)).toISOString()).toBe('2026-05-22T10:00:00.000Z');
    // 2026-05-22 10:14:59 UTC → 10:00 UTC (バケット末尾)
    const t2 = new Date('2026-05-22T10:14:59Z').getTime();
    expect(new Date(bucketStartMs(t2, fifteenMin)).toISOString()).toBe('2026-05-22T10:00:00.000Z');
    // 2026-05-22 10:15:00 UTC → 10:15 UTC (次バケット先頭)
    const t3 = new Date('2026-05-22T10:15:00Z').getTime();
    expect(new Date(bucketStartMs(t3, fifteenMin)).toISOString()).toBe('2026-05-22T10:15:00.000Z');
  });

  it('4h バケットは 00/04/08/12/16/20 UTC に揃う', () => {
    const fourH = TIMEFRAME_MS['4h'];
    // 2026-05-22 13:30 UTC → 12:00 UTC
    const t1 = new Date('2026-05-22T13:30:00Z').getTime();
    expect(new Date(bucketStartMs(t1, fourH)).toISOString()).toBe('2026-05-22T12:00:00.000Z');
    // 2026-05-22 16:00 UTC → 16:00 UTC
    const t2 = new Date('2026-05-22T16:00:00Z').getTime();
    expect(new Date(bucketStartMs(t2, fourH)).toISOString()).toBe('2026-05-22T16:00:00.000Z');
  });
});

describe('aggregateOHLCV', () => {
  it('空配列を渡したら空配列を返す', () => {
    expect(aggregateOHLCV([], TIMEFRAME_MS['15m'])).toEqual([]);
  });

  it('15m 集約 — 5m × 3 を 1 本にまとめる (open=最初の open、close=最後の close)', () => {
    const source: OHLCVBar[] = [
      bar('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10),
      bar('2026-05-22T10:05:00Z', 101, 103, 100, 102, 20),
      bar('2026-05-22T10:10:00Z', 102, 105, 101, 104, 30),
    ];

    const result = aggregateOHLCV(source, TIMEFRAME_MS['15m']);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      volume: 60,
    });
    expect(result[0].timestamp.toISOString()).toBe('2026-05-22T10:00:00.000Z');
  });

  it('15m 集約 — 6 本の 5m を 2 本の 15m に分ける (バケット境界跨ぎ)', () => {
    const source: OHLCVBar[] = [
      bar('2026-05-22T10:00:00Z', 100, 101, 99, 100, 10),
      bar('2026-05-22T10:05:00Z', 100, 102, 99, 101, 10),
      bar('2026-05-22T10:10:00Z', 101, 103, 100, 102, 10),
      bar('2026-05-22T10:15:00Z', 102, 104, 101, 103, 10),
      bar('2026-05-22T10:20:00Z', 103, 105, 102, 104, 10),
      bar('2026-05-22T10:25:00Z', 104, 106, 103, 105, 10),
    ];

    const result = aggregateOHLCV(source, TIMEFRAME_MS['15m']);

    expect(result).toHaveLength(2);
    expect(result[0].timestamp.toISOString()).toBe('2026-05-22T10:00:00.000Z');
    expect(result[0]).toMatchObject({ open: 100, high: 103, low: 99, close: 102, volume: 30 });
    expect(result[1].timestamp.toISOString()).toBe('2026-05-22T10:15:00.000Z');
    expect(result[1]).toMatchObject({ open: 102, high: 106, low: 101, close: 105, volume: 30 });
  });

  it('4h 集約 — 1h × 4 を 1 本にまとめる', () => {
    const source: OHLCVBar[] = [
      bar('2026-05-22T12:00:00Z', 100, 101, 99, 100, 10),
      bar('2026-05-22T13:00:00Z', 100, 102, 98, 101, 10),
      bar('2026-05-22T14:00:00Z', 101, 103, 100, 102, 10),
      bar('2026-05-22T15:00:00Z', 102, 104, 101, 103, 10),
    ];

    const result = aggregateOHLCV(source, TIMEFRAME_MS['4h']);

    expect(result).toHaveLength(1);
    expect(result[0].timestamp.toISOString()).toBe('2026-05-22T12:00:00.000Z');
    expect(result[0]).toMatchObject({ open: 100, high: 104, low: 98, close: 103, volume: 40 });
  });

  it('順不同で渡しても時系列順で返す (内部 sort)', () => {
    const source: OHLCVBar[] = [
      bar('2026-05-22T10:25:00Z', 104, 106, 103, 105, 10),
      bar('2026-05-22T10:05:00Z', 100, 102, 99, 101, 10),
      bar('2026-05-22T10:15:00Z', 102, 104, 101, 103, 10),
      bar('2026-05-22T10:20:00Z', 103, 105, 102, 104, 10),
      bar('2026-05-22T10:00:00Z', 100, 101, 99, 100, 10),
      bar('2026-05-22T10:10:00Z', 101, 103, 100, 102, 10),
    ];

    const result = aggregateOHLCV(source, TIMEFRAME_MS['15m']);

    expect(result).toHaveLength(2);
    expect(result[0].timestamp.getTime()).toBeLessThan(result[1].timestamp.getTime());
    expect(result[0]).toMatchObject({ open: 100, close: 102 });
    expect(result[1]).toMatchObject({ open: 102, close: 105 });
  });

  it('30m 集約 — 5m × 6 が 1 本にまとまる', () => {
    const source: OHLCVBar[] = [];
    for (let i = 0; i < 6; i++) {
      const min = i * 5;
      const ts = `2026-05-22T10:${String(min).padStart(2, '0')}:00Z`;
      source.push(bar(ts, 100 + i, 101 + i, 99 + i, 100 + i + 0.5, 10));
    }

    const result = aggregateOHLCV(source, TIMEFRAME_MS['30m']);

    expect(result).toHaveLength(1);
    expect(result[0].timestamp.toISOString()).toBe('2026-05-22T10:00:00.000Z');
    expect(result[0].open).toBe(100);
    expect(result[0].high).toBe(106);
    expect(result[0].low).toBe(99);
    expect(result[0].close).toBe(105.5);
    expect(result[0].volume).toBe(60);
  });

  it('単一 source bar が単独バケットになる (不完全バケットは破棄しない)', () => {
    const source: OHLCVBar[] = [bar('2026-05-22T10:07:00Z', 100, 102, 99, 101, 10)];
    const result = aggregateOHLCV(source, TIMEFRAME_MS['15m']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ open: 100, high: 102, low: 99, close: 101, volume: 10 });
    expect(result[0].timestamp.toISOString()).toBe('2026-05-22T10:00:00.000Z');
  });

  it('symbol フィールドを最初の bar から引き継ぐ', () => {
    const source: OHLCVBar[] = [
      { ...bar('2026-05-22T10:00:00Z', 100, 102, 99, 101, 10), symbol: 'XAU/USD' },
      { ...bar('2026-05-22T10:05:00Z', 101, 103, 100, 102, 20), symbol: 'XAU/USD' },
    ];
    const result = aggregateOHLCV(source, TIMEFRAME_MS['15m']);
    expect(result[0].symbol).toBe('XAU/USD');
  });
});
