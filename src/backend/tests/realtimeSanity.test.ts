/**
 * realtimeSanity のユニットテスト
 *
 * 目的:
 * - DB汚染（価格スケール違い）対策のロジックが壊れていないことを担保する
 */

import {
  calculateMedian,
  filterBarsByReferencePrice,
  filterFreshBars,
  getCloseStats,
  looksLikeMisScaledBars,
  type PriceBarLike,
} from '../services/realtime/realtimeSanity';

function bar(close: number): PriceBarLike {
  return { open: close, high: close, low: close, close };
}

describe('realtimeSanity', () => {
  test('calculateMedian: 奇数/偶数で期待通りの中央値を返す', () => {
    expect(calculateMedian([3, 1, 2])).toBe(2);
    expect(calculateMedian([10, 20, 30, 40])).toBe(25);
  });

  test('getCloseStats: close の min/max/median を集計できる', () => {
    const stats = getCloseStats([bar(2), bar(1), bar(3)]);
    expect(stats.count).toBe(3);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(3);
    expect(stats.median).toBe(2);
  });

  test('filterBarsByReferencePrice: 参照価格から乖離したバーを除外できる', () => {
    const reference = 4600;
    const bars = [bar(4601), bar(4599), bar(7000), bar(2300), bar(4_600_000)];

    // 50% 許容なので 7000 は除外（4600→7000 は約52%）
    // 4,600,000 は当然除外
    // 2300 は「ちょうど50%」なので境界値として除外（スケール汚染の連鎖防止）
    const filtered = filterBarsByReferencePrice(bars, reference, 0.5);
    expect(filtered.map((b) => b.close)).toEqual([4601, 4599]);
  });

  test('looksLikeMisScaledBars: 価格が極端に小さい/大きい場合に true を返す', () => {
    expect(looksLikeMisScaledBars([bar(0.01), bar(0.01), bar(0.01)])).toBe(true);
    expect(looksLikeMisScaledBars([bar(4_600_000), bar(4_600_100), bar(4_599_900)])).toBe(true);
  });

  test('looksLikeMisScaledBars: 短期データとしてレンジが不自然に広い場合に true を返す', () => {
    // max/min が 100倍（> 50）なので異常扱い
    expect(looksLikeMisScaledBars([bar(1), bar(100), bar(2)])).toBe(true);
  });

  test('looksLikeMisScaledBars: 一般的なFX/金属の短期レンジは false になる', () => {
    expect(looksLikeMisScaledBars([bar(4600), bar(4610), bar(4590), bar(4605)])).toBe(false);
    expect(looksLikeMisScaledBars([bar(1.08), bar(1.081), bar(1.079)])).toBe(false);
  });

  describe('filterFreshBars', () => {
    const NOW = new Date('2026-06-17T20:00:00Z').getTime();
    const tbar = (iso: string) => ({ timestamp: new Date(iso) });

    test('maxAge より古い足 (凍結ゴースト) を除外し、新しい足は残す', () => {
      const bars = [
        tbar('2026-02-16T13:00:00Z'), // 数ヶ月前の凍結足
        tbar('2026-06-17T19:00:00Z'), // 1 時間前
        tbar('2026-06-17T19:58:00Z'), // 2 分前
      ];
      // maxAge = 45 分
      const fresh = filterFreshBars(bars, 45 * 60 * 1000, NOW);
      expect(fresh.map((b) => b.timestamp.toISOString())).toEqual([
        '2026-06-17T19:58:00.000Z',
      ]);
    });

    test('全件が古ければ空配列を返す (= 呼び出し側が EODHD へフォールバック)', () => {
      const bars = [tbar('2026-02-16T13:00:00Z'), tbar('2026-05-15T01:53:00Z')];
      expect(filterFreshBars(bars, 45 * 60 * 1000, NOW)).toEqual([]);
    });

    test('境界値 (ちょうど maxAge) は残す', () => {
      const bars = [tbar('2026-06-17T19:15:00Z')]; // ちょうど 45 分前
      expect(filterFreshBars(bars, 45 * 60 * 1000, NOW)).toHaveLength(1);
    });

    test('maxAgeMs が不正 (0 以下) なら全件返す (安全側)', () => {
      const bars = [tbar('2020-01-01T00:00:00Z')];
      expect(filterFreshBars(bars, 0, NOW)).toHaveLength(1);
      expect(filterFreshBars(bars, -1, NOW)).toHaveLength(1);
    });
  });
});


