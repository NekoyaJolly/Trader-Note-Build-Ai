/**
 * shared/timeframes/timeSession の単体テスト (PR ⑤D-1)。
 *
 * computeTimeSessionFeatures が TS / Python 両側で同じ結果を返すよう、固定
 * timestamp で期待値を pin する。Python 版は `analysis-engine/app/backtest/time_session.py`
 * に同期実装があり、本テストの期待値は両者で一致する形で書く。
 */

import {
  computeTimeSessionFeatures,
  TIME_SESSION_FEATURE_KEYS,
} from '../../shared/timeframes/timeSession';

describe('computeTimeSessionFeatures', () => {
  it('全 16 feature を返す', () => {
    const out = computeTimeSessionFeatures(new Date('2026-05-08T03:00:00Z'));
    for (const key of TIME_SESSION_FEATURE_KEYS) {
      expect(out).toHaveProperty(key);
    }
    expect(Object.keys(out).length).toBe(TIME_SESSION_FEATURE_KEYS.length);
  });

  it('東京セッション中 (UTC 03:00) → tokyo_active=true', () => {
    const out = computeTimeSessionFeatures(new Date('2026-05-08T03:00:00Z'));
    expect(out.utc_hour).toBe(3);
    expect(out.tokyo_active).toBe(true);
    expect(out.london_active).toBe(false);
    expect(out.ny_active).toBe(false);
  });

  it('ロンドン/NY オーバーラップ (UTC 14:00)', () => {
    const out = computeTimeSessionFeatures(new Date('2026-05-08T14:00:00Z'));
    expect(out.london_active).toBe(true);
    expect(out.ny_active).toBe(true);
    expect(out.overlap_london_ny).toBe(true);
  });

  it('東京/ロンドン境界 (UTC 07:00 or 08:00)', () => {
    expect(computeTimeSessionFeatures(new Date('2026-05-08T07:00:00Z')).overlap_tokyo_london).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-08T08:00:00Z')).overlap_tokyo_london).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-08T06:00:00Z')).overlap_tokyo_london).toBe(false);
  });

  it('day_of_month / day_of_week が UTC ベースで正しい', () => {
    // 2026-05-15 = 金曜 (UTC), day_of_week=5
    const out = computeTimeSessionFeatures(new Date('2026-05-15T10:00:00Z'));
    expect(out.day_of_month).toBe(15);
    expect(out.day_of_week).toBe(5);
  });

  it('ゴトー日の判定 (= day_of_month in [5,10,15,20,25,30])', () => {
    for (const day of [5, 10, 15, 20, 25, 30]) {
      const ts = new Date(`2026-05-${String(day).padStart(2, '0')}T10:00:00Z`);
      expect(computeTimeSessionFeatures(ts).day_of_month).toBe(day);
    }
  });

  it('is_friday_close (= 金曜 17-21 UTC)', () => {
    // 2026-05-15 = 金曜
    expect(computeTimeSessionFeatures(new Date('2026-05-15T17:00:00Z')).is_friday_close).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-15T20:00:00Z')).is_friday_close).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-15T22:00:00Z')).is_friday_close).toBe(false);
    // 2026-05-16 = 土曜
    expect(computeTimeSessionFeatures(new Date('2026-05-16T18:00:00Z')).is_friday_close).toBe(false);
  });

  it('is_monday_open (= 月曜の最初 4 時間)', () => {
    // 2026-05-11 = 月曜 (= UTC)
    expect(computeTimeSessionFeatures(new Date('2026-05-11T00:00:00Z')).is_monday_open).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-11T03:59:00Z')).is_monday_open).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-11T04:00:00Z')).is_monday_open).toBe(false);
  });

  it('is_tokyo_lunch (= UTC 02:30-03:30)', () => {
    expect(computeTimeSessionFeatures(new Date('2026-05-08T02:30:00Z')).is_tokyo_lunch).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-08T03:00:00Z')).is_tokyo_lunch).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-08T03:29:00Z')).is_tokyo_lunch).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-08T03:30:00Z')).is_tokyo_lunch).toBe(false);
    expect(computeTimeSessionFeatures(new Date('2026-05-08T02:29:00Z')).is_tokyo_lunch).toBe(false);
  });

  it('is_weekend: 土曜は終日 / 日曜 21 UTC 前まで / 金曜 21 UTC 以降', () => {
    // 2026-05-16 (土) は終日 weekend
    expect(computeTimeSessionFeatures(new Date('2026-05-16T05:00:00Z')).is_weekend).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-16T18:00:00Z')).is_weekend).toBe(true);
    // 2026-05-17 (日) 21 UTC で開場
    expect(computeTimeSessionFeatures(new Date('2026-05-17T20:00:00Z')).is_weekend).toBe(true);
    expect(computeTimeSessionFeatures(new Date('2026-05-17T21:00:00Z')).is_weekend).toBe(false);
    // 2026-05-15 (金) 20 UTC 開、21 UTC 閉
    expect(computeTimeSessionFeatures(new Date('2026-05-15T20:00:00Z')).is_weekend).toBe(false);
    expect(computeTimeSessionFeatures(new Date('2026-05-15T21:00:00Z')).is_weekend).toBe(true);
  });

  it('minutes_since_tokyo_open: セッション中は経過分、外は -1', () => {
    expect(computeTimeSessionFeatures(new Date('2026-05-08T00:00:00Z')).minutes_since_tokyo_open).toBe(0);
    expect(computeTimeSessionFeatures(new Date('2026-05-08T03:30:00Z')).minutes_since_tokyo_open).toBe(210);
    expect(computeTimeSessionFeatures(new Date('2026-05-08T07:00:00Z')).minutes_since_tokyo_open).toBe(-1);
  });
});
