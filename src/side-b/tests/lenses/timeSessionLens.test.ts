/**
 * TimeSessionLens テスト
 *
 * カバレッジ:
 * - 各セッション時間帯の境界値（UTC 0/8/13/16/21 時）
 * - オーバーラップ判定
 * - 曜日 / 月曜オープン / 金曜クローズ判定
 * - 週末・未来時刻・不正時刻
 * - 決定性
 */

import { TimeSessionLens } from '../../lenses/TimeSessionLens';
import type { LensInput } from '../../lenses';

const SYMBOL = 'XAUUSD';

function makeInput(isoTimestamp: string): LensInput {
  return {
    symbol: SYMBOL,
    timeframe: '15m',
    timestamp: new Date(isoTimestamp),
  };
}

describe('TimeSessionLens - セッション時間帯', () => {
  it('UTC 0時は東京のみアクティブ', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-04-15T00:00:00Z')); // 水曜

    expect(f.features.tokyo_active).toBe(true);
    expect(f.features.london_active).toBe(false);
    expect(f.features.ny_active).toBe(false);
    expect(f.features.overlap_london_ny).toBe(false);
  });

  it('UTC 8時はロンドンが開きオーバーラップ境界', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-04-15T08:00:00Z'));

    expect(f.features.tokyo_active).toBe(false);
    expect(f.features.london_active).toBe(true);
    expect(f.features.ny_active).toBe(false);
    expect(f.features.overlap_tokyo_london).toBe(true);
  });

  it('UTC 13時はロンドン/NY オーバーラップ開始', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-04-15T13:00:00Z'));

    expect(f.features.london_active).toBe(true);
    expect(f.features.ny_active).toBe(true);
    expect(f.features.overlap_london_ny).toBe(true);
  });

  it('UTC 16時でロンドンクローズ、NY 単独', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-04-15T16:00:00Z'));

    expect(f.features.london_active).toBe(false);
    expect(f.features.ny_active).toBe(true);
    expect(f.features.overlap_london_ny).toBe(false);
  });

  it('UTC 21時で NY もクローズ', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-04-15T21:00:00Z'));

    expect(f.features.tokyo_active).toBe(false);
    expect(f.features.london_active).toBe(false);
    expect(f.features.ny_active).toBe(false);
  });
});

describe('TimeSessionLens - 経過時間', () => {
  it('東京アクティブ中は minutes_since_tokyo_open を返す', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-04-15T02:30:00Z'));

    expect(f.features.minutes_since_tokyo_open).toBe(2 * 60 + 30);
    expect(f.features.minutes_since_london_open).toBe(-1);
    expect(f.features.minutes_since_ny_open).toBe(-1);
  });

  it('NY アクティブ中は minutes_since_ny_open が正の値', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-04-15T14:15:00Z'));

    expect(f.features.minutes_since_ny_open).toBe(75);
  });
});

describe('TimeSessionLens - 曜日・週末', () => {
  it('土曜は週末としてフラグが立つ', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-01-03T10:00:00Z')); // 土

    expect(f.features.day_of_week).toBe(6);
    expect(f.features.is_weekend).toBe(true);
  });

  it('月曜 UTC 1時は is_monday_open=true', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-01-05T01:00:00Z')); // 月

    expect(f.features.day_of_week).toBe(1);
    expect(f.features.is_monday_open).toBe(true);
  });

  it('金曜 UTC 18時は is_friday_close=true', async () => {
    const lens = new TimeSessionLens();
    const f = await lens.compute(makeInput('2026-01-02T18:00:00Z')); // 金

    expect(f.features.day_of_week).toBe(5);
    expect(f.features.is_friday_close).toBe(true);
  });
});

// PR ⑤D-1 + Copilot review #3-4: day_of_month / is_tokyo_lunch のテスト
// 注: TimeSessionLens は未来時刻 (> now + 60s) を例外にするため、過去日付 (2026-01)
//     を使う (= 既存テスト群と同じ慣行)。
describe('TimeSessionLens - PR ⑤D-1 で追加した features', () => {
  it('day_of_month は UTC 日付で 1-31 を返す', async () => {
    const lens = new TimeSessionLens();
    expect((await lens.compute(makeInput('2026-01-08T03:00:00Z'))).features.day_of_month).toBe(8);
    expect((await lens.compute(makeInput('2026-01-15T10:00:00Z'))).features.day_of_month).toBe(15);
    expect((await lens.compute(makeInput('2026-01-01T00:00:00Z'))).features.day_of_month).toBe(1);
    expect((await lens.compute(makeInput('2026-01-31T23:59:00Z'))).features.day_of_month).toBe(31);
  });

  it('day_of_month はゴトー日 (= [5,10,15,20,25,30]) で in 評価可能な値を返す', async () => {
    const lens = new TimeSessionLens();
    for (const day of [5, 10, 15, 20, 25, 30]) {
      const ts = `2026-01-${String(day).padStart(2, '0')}T10:00:00Z`;
      const f = await lens.compute(makeInput(ts));
      expect(f.features.day_of_month).toBe(day);
    }
  });

  it('is_tokyo_lunch は UTC 02:30-03:30 で true', async () => {
    const lens = new TimeSessionLens();
    expect((await lens.compute(makeInput('2026-01-08T02:30:00Z'))).features.is_tokyo_lunch).toBe(true);
    expect((await lens.compute(makeInput('2026-01-08T03:00:00Z'))).features.is_tokyo_lunch).toBe(true);
    expect((await lens.compute(makeInput('2026-01-08T03:29:00Z'))).features.is_tokyo_lunch).toBe(true);
  });

  it('is_tokyo_lunch は境界値の外側 (02:29 / 03:30) で false', async () => {
    const lens = new TimeSessionLens();
    expect((await lens.compute(makeInput('2026-01-08T02:29:00Z'))).features.is_tokyo_lunch).toBe(false);
    expect((await lens.compute(makeInput('2026-01-08T03:30:00Z'))).features.is_tokyo_lunch).toBe(false);
  });

  it('PR ⑤D-1: shared 関数経由で計算しているので surrogate / Python と式が一致', async () => {
    // shared 関数を直接呼んだ結果と TimeSessionLens.compute の結果が同一であること
    const { computeTimeSessionFeatures } = await import('../../../shared/timeframes/timeSession');
    const ts = new Date('2026-01-15T14:30:00Z');
    const lens = new TimeSessionLens();
    const lensFeatures = (await lens.compute({
      symbol: 'EURUSD',
      timeframe: '15m',
      timestamp: ts,
    })).features;
    const sharedFeatures = computeTimeSessionFeatures(ts);
    // 全 16 feature が一致
    for (const [key, value] of Object.entries(sharedFeatures)) {
      expect(lensFeatures[key]).toBe(value);
    }
  });
});

describe('TimeSessionLens - 不正入力', () => {
  it('未来時刻（60秒以上先）は例外を投げる', async () => {
    const lens = new TimeSessionLens();
    const future = new Date(Date.now() + 3600_000);
    await expect(
      lens.compute({ symbol: SYMBOL, timeframe: '15m', timestamp: future })
    ).rejects.toThrow(/future/);
  });

  it('無効な Date は例外を投げる', async () => {
    const lens = new TimeSessionLens();
    await expect(
      lens.compute({ symbol: SYMBOL, timeframe: '15m', timestamp: new Date('invalid') })
    ).rejects.toThrow(/invalid/);
  });
});

describe('TimeSessionLens - 決定性', () => {
  it('同じ timestamp で同じ features を返す', async () => {
    const lens = new TimeSessionLens();
    const input = makeInput('2026-04-15T10:00:00Z');

    const f1 = await lens.compute(input);
    const f2 = await lens.compute(input);

    expect(f1.features).toEqual(f2.features);
  });
});
