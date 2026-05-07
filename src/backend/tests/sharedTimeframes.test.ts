/**
 * shared/timeframes の単体テスト (PR ⑤)。
 */

import {
  ALL_CANONICAL_TIMEFRAMES,
  compareTimeframes,
  isCanonicalTimeframe,
  isHigherTimeframe,
  normalizeTimeframe,
  timeframeSeconds,
} from '../../shared/timeframes';

describe('shared/timeframes: normalizeTimeframe', () => {
  it('canonical 表記はそのまま返す', () => {
    expect(normalizeTimeframe('1h')).toBe('1h');
    expect(normalizeTimeframe('15m')).toBe('15m');
  });

  it('alias を canonical に正規化', () => {
    expect(normalizeTimeframe('60m')).toBe('1h');
    expect(normalizeTimeframe('1H')).toBe('1h');
    expect(normalizeTimeframe('h1')).toBe('1h');
    expect(normalizeTimeframe('H1')).toBe('1h');
    expect(normalizeTimeframe('m15')).toBe('15m');
    expect(normalizeTimeframe('15min')).toBe('15m');
    expect(normalizeTimeframe('daily')).toBe('1d');
  });

  it('未知 timeframe は null', () => {
    expect(normalizeTimeframe('xxx')).toBeNull();
    expect(normalizeTimeframe('2h')).toBeNull();
    expect(normalizeTimeframe('')).toBeNull();
  });

  it('前後 whitespace は trim', () => {
    expect(normalizeTimeframe('  1h  ')).toBe('1h');
  });
});

describe('shared/timeframes: compareTimeframes', () => {
  it('同じ timeframe は 0', () => {
    expect(compareTimeframes('1h', '1h')).toBe(0);
    expect(compareTimeframes('15m', '15m')).toBe(0);
  });

  it('a が下位足なら負', () => {
    expect(compareTimeframes('15m', '1h')).toBeLessThan(0);
    expect(compareTimeframes('5m', '1d')).toBeLessThan(0);
  });

  it('a が上位足なら正', () => {
    expect(compareTimeframes('1h', '15m')).toBeGreaterThan(0);
    expect(compareTimeframes('1d', '5m')).toBeGreaterThan(0);
  });

  it('alias 同士の比較も正しい', () => {
    expect(compareTimeframes('60m', '1h')).toBe(0);
    expect(compareTimeframes('1H', '15m')).toBeGreaterThan(0);
  });

  it('未知 timeframe は例外', () => {
    expect(() => compareTimeframes('xxx', '1h')).toThrow(/未知の timeframe/);
    expect(() => compareTimeframes('1h', 'yyy')).toThrow(/未知の timeframe/);
  });
});

describe('shared/timeframes: isHigherTimeframe', () => {
  it('厳密に上位なら true', () => {
    expect(isHigherTimeframe('1h', '15m')).toBe(true);
    expect(isHigherTimeframe('1d', '4h')).toBe(true);
  });

  it('同じか下位なら false', () => {
    expect(isHigherTimeframe('1h', '1h')).toBe(false);
    expect(isHigherTimeframe('15m', '1h')).toBe(false);
  });
});

describe('shared/timeframes: timeframeSeconds', () => {
  it('canonical timeframe の秒数を返す', () => {
    expect(timeframeSeconds('1m')).toBe(60);
    expect(timeframeSeconds('15m')).toBe(900);
    expect(timeframeSeconds('1h')).toBe(3600);
    expect(timeframeSeconds('4h')).toBe(14400);
    expect(timeframeSeconds('1d')).toBe(86400);
  });
});

describe('shared/timeframes: ALL_CANONICAL_TIMEFRAMES', () => {
  it('短い順', () => {
    for (let i = 1; i < ALL_CANONICAL_TIMEFRAMES.length; i++) {
      expect(timeframeSeconds(ALL_CANONICAL_TIMEFRAMES[i])).toBeGreaterThan(
        timeframeSeconds(ALL_CANONICAL_TIMEFRAMES[i - 1]),
      );
    }
  });

  it('isCanonicalTimeframe は登録済 ID 全部 true', () => {
    for (const tf of ALL_CANONICAL_TIMEFRAMES) {
      expect(isCanonicalTimeframe(tf)).toBe(true);
    }
    expect(isCanonicalTimeframe('xxx')).toBe(false);
  });
});
