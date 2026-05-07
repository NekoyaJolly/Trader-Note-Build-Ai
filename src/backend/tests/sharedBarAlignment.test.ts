/**
 * shared/marketdata/barAlignment の単体テスト (PR ⑤B)。
 *
 * バーアライメントの look-ahead bias 防止と forward fill の決定性を確認する。
 */

import {
  buildBarAlignment,
  forwardFillSeriesToPrimary,
  type OhlcvBar,
} from '../../shared/marketdata';

function bar(isoTimestamp: string): OhlcvBar {
  return {
    timestamp: new Date(isoTimestamp),
    open: 1,
    high: 1.1,
    low: 0.9,
    close: 1.05,
    volume: 1,
  };
}

describe('buildBarAlignment: look-ahead bias 防止', () => {
  it('15m + 1h: 主バーの close 時刻に閉じている上位足のみ参照可', () => {
    // 15m primary bars: 02:00, 02:15, 02:30, 02:45, 03:00
    const primaryBars = [
      bar('2026-01-01T02:00:00Z'),
      bar('2026-01-01T02:15:00Z'),
      bar('2026-01-01T02:30:00Z'),
      bar('2026-01-01T02:45:00Z'),
      bar('2026-01-01T03:00:00Z'),
    ];
    // 1h upper bars: 02:00 (close=03:00), 03:00 (close=04:00)
    const upperBars = [bar('2026-01-01T02:00:00Z'), bar('2026-01-01T03:00:00Z')];

    const alignment = buildBarAlignment(primaryBars, upperBars, '15m', '1h');

    // 02:00 (close 02:15) → 1h 02:00 (close 03:00) は未確定 → j=-1
    expect(alignment[0]).toBe(-1);
    // 02:15 (close 02:30) → 1h 02:00 (close 03:00) は未確定 → j=-1
    expect(alignment[1]).toBe(-1);
    // 02:30 (close 02:45) → j=-1
    expect(alignment[2]).toBe(-1);
    // 02:45 (close 03:00) → 1h 02:00 (close 03:00) ちょうど確定 → j=0
    expect(alignment[3]).toBe(0);
    // 03:00 (close 03:15) → 1h 02:00 (close 03:00) は確定済 → j=0、03:00 (close 04:00) は未確定
    expect(alignment[4]).toBe(0);
  });

  it('上位足が開始される前は j=-1', () => {
    const primaryBars = [
      bar('2026-01-01T00:00:00Z'),
      bar('2026-01-01T00:15:00Z'),
    ];
    const upperBars = [bar('2026-01-01T05:00:00Z')]; // 主より遅れて始まる
    const alignment = buildBarAlignment(primaryBars, upperBars, '15m', '1h');
    expect(alignment).toEqual([-1, -1]);
  });

  it('単調増加: alignment は降順にならない', () => {
    const primaryBars = Array.from({ length: 100 }, (_, i) =>
      bar(new Date(2026, 0, 1, 0, i * 15).toISOString()),
    );
    const upperBars = Array.from({ length: 25 }, (_, i) =>
      bar(new Date(2026, 0, 1, i, 0).toISOString()),
    );
    const alignment = buildBarAlignment(primaryBars, upperBars, '15m', '1h');
    for (let i = 1; i < alignment.length; i++) {
      expect(alignment[i]).toBeGreaterThanOrEqual(alignment[i - 1]);
    }
  });

  it('上位足空配列なら全 j=-1', () => {
    const primaryBars = [bar('2026-01-01T02:00:00Z'), bar('2026-01-01T02:15:00Z')];
    const alignment = buildBarAlignment(primaryBars, [], '15m', '1h');
    expect(alignment).toEqual([-1, -1]);
  });

  it('主バー空配列なら空配列', () => {
    const upperBars = [bar('2026-01-01T02:00:00Z')];
    const alignment = buildBarAlignment([], upperBars, '15m', '1h');
    expect(alignment).toEqual([]);
  });

  it('1h primary + 4h upper でも同じ規則', () => {
    const primaryBars = [
      bar('2026-01-01T00:00:00Z'),
      bar('2026-01-01T01:00:00Z'),
      bar('2026-01-01T02:00:00Z'),
      bar('2026-01-01T03:00:00Z'),
      bar('2026-01-01T04:00:00Z'),
    ];
    // 4h upper: 00:00 (close=04:00)
    const upperBars = [bar('2026-01-01T00:00:00Z')];
    const alignment = buildBarAlignment(primaryBars, upperBars, '1h', '4h');
    // 02:00 までの 1h バーは 4h 00:00 (close 04:00) がまだ閉じていない → j=-1
    expect(alignment[0]).toBe(-1);
    expect(alignment[1]).toBe(-1);
    expect(alignment[2]).toBe(-1);
    // 03:00 (close 04:00) で 4h 00:00 (close 04:00) はちょうど閉じる → j=0
    expect(alignment[3]).toBe(0);
    expect(alignment[4]).toBe(0);
  });
});

describe('forwardFillSeriesToPrimary', () => {
  it('alignment に従って upperSeries を主バー長に展開', () => {
    const upperSeries = [10, 20, 30];
    const alignment = [-1, -1, 0, 0, 1, 1, 2];
    const filled = forwardFillSeriesToPrimary<number | null>(upperSeries, alignment, null);
    expect(filled).toEqual([null, null, 10, 10, 20, 20, 30]);
  });

  it('null は fallback に倒す', () => {
    const upperSeries: (number | null)[] = [null, 20, null];
    const alignment = [0, 1, 2];
    const filled = forwardFillSeriesToPrimary<number | null>(upperSeries, alignment, null);
    expect(filled).toEqual([null, 20, null]);
  });

  it('boolean 配列でも動く (= pattern flags 用)', () => {
    const upperSeries = [true, false, true];
    const alignment = [-1, 0, 0, 1, 2];
    const filled = forwardFillSeriesToPrimary<boolean>(upperSeries, alignment, false);
    expect(filled).toEqual([false, true, true, false, true]);
  });

  it('alignment が範囲外なら fallback', () => {
    const upperSeries = [10];
    const alignment = [0, 5, -1];
    const filled = forwardFillSeriesToPrimary<number | null>(upperSeries, alignment, null);
    expect(filled).toEqual([10, null, null]);
  });
});
