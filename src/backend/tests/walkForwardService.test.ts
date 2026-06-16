import { calculateRollingPeriodSplitsByDays } from '../services/walkForwardService';

function dateOnly(value: Date): string {
  return value.toISOString().split('T')[0];
}

describe('walkForwardService', () => {
  describe('calculateRollingPeriodSplitsByDays', () => {
    it('OOS日数ぶん開始位置を前進させる', () => {
      const splits = calculateRollingPeriodSplitsByDays(
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-02-15T00:00:00.000Z'),
        30,
        7
      );

      expect(splits).toHaveLength(3);
      expect(dateOnly(splits[0].inSampleStart)).toBe('2026-01-01');
      expect(dateOnly(splits[0].inSampleEnd)).toBe('2026-01-30');
      expect(dateOnly(splits[0].outOfSampleStart)).toBe('2026-01-31');
      expect(dateOnly(splits[0].outOfSampleEnd)).toBe('2026-02-06');

      expect(dateOnly(splits[1].inSampleStart)).toBe('2026-01-08');
      expect(dateOnly(splits[1].outOfSampleStart)).toBe('2026-02-07');

      expect(dateOnly(splits[2].inSampleStart)).toBe('2026-01-15');
      expect(dateOnly(splits[2].outOfSampleEnd)).toBe('2026-02-15');
    });

    it('日数が不正な場合は分割を作らない', () => {
      expect(
        calculateRollingPeriodSplitsByDays(
          new Date('2026-01-01T00:00:00.000Z'),
          new Date('2026-02-01T00:00:00.000Z'),
          0,
          7
        )
      ).toEqual([]);
    });
  });
});
