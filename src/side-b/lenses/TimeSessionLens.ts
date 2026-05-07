/**
 * TimeSessionLens - 時刻から主要市場セッション状態を判定するレンズ
 *
 * LLM 非依存・純粋な時刻計算のみ。
 *
 * セッション定義（全て UTC 基準）:
 * - 東京: 0-6 UTC（JST 9-15）
 * - ロンドン: 8-16 UTC
 * - NY: 13-21 UTC
 * - ロンドン/NY オーバーラップ: 13-16 UTC
 * - 東京/ロンドン オーバーラップ: 7-8 UTC 境界付近（実務上 8 UTC）
 *
 * 週末判定は src/side-b/utils/marketHours.ts の isFXMarketOpen と整合する
 * （土曜 UTC 終日 + 金曜クローズ後〜日曜オープン前）。
 *
 * @see docs/design/phase_1_specification.md セクション 4.3
 */

import type { Lens, LensFeature, LensInput } from './types';
import { isFXMarketOpen } from '../utils/marketHours';

const TOKYO_OPEN_UTC = 0;
const TOKYO_CLOSE_UTC = 6;
const LONDON_OPEN_UTC = 8;
const LONDON_CLOSE_UTC = 16;
const NY_OPEN_UTC = 13;
const NY_CLOSE_UTC = 21;

function minutesSinceOpen(now: Date, openHourUTC: number): number {
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const openMinutes = openHourUTC * 60;
  if (nowMinutes < openMinutes) {
    return -1;
  }
  return nowMinutes - openMinutes;
}

export class TimeSessionLens implements Lens {
  readonly name = 'time_session';
  // PR ⑤D-1: day_of_month / is_tokyo_lunch 追加で minor bump
  readonly version = '1.1.0';
  readonly dependencies = ['timestamp'] as const;

  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    const ts = input.timestamp;

    if (isNaN(ts.getTime())) {
      throw new Error('TimeSessionLens: invalid timestamp');
    }
    if (ts.getTime() > Date.now() + 60_000) {
      throw new Error('TimeSessionLens: timestamp is in the future');
    }

    const hour = ts.getUTCHours();
    const minute = ts.getUTCMinutes();
    const dayOfWeek = ts.getUTCDay();
    const dayOfMonth = ts.getUTCDate();

    const tokyoActive = hour >= TOKYO_OPEN_UTC && hour < TOKYO_CLOSE_UTC;
    const londonActive = hour >= LONDON_OPEN_UTC && hour < LONDON_CLOSE_UTC;
    const nyActive = hour >= NY_OPEN_UTC && hour < NY_CLOSE_UTC;
    const overlapLondonNy = londonActive && nyActive;
    const overlapTokyoLondon = hour === 7 || hour === 8;

    const marketOpen = isFXMarketOpen(ts);
    const isWeekend = !marketOpen;

    // 月曜の最初の4時間: 日曜オープン直後〜月曜未明
    const isMondayOpen = dayOfWeek === 1 && hour < 4;
    // 金曜の最後の4時間: クローズ手前 17-21 UTC
    const isFridayClose = dayOfWeek === 5 && hour >= 17 && hour < 22;
    // PR ⑤D-1: 東京昼休み (JST 11:30-12:30 = UTC 02:30-03:30、薄商い)
    const isTokyoLunch =
      (hour === 2 && minute >= 30) || (hour === 3 && minute < 30);

    const features: Record<string, number | string | boolean> = {
      utc_hour: hour,
      utc_minute: minute,
      day_of_week: dayOfWeek,
      // PR ⑤D-1: 月の日付 (1-31)。ゴトー日 (= [5,10,15,20,25,30]) のような
      // 日本特有のアノマリー戦略を表現可能にする。
      day_of_month: dayOfMonth,
      tokyo_active: tokyoActive,
      london_active: londonActive,
      ny_active: nyActive,
      overlap_london_ny: overlapLondonNy,
      overlap_tokyo_london: overlapTokyoLondon,
      minutes_since_tokyo_open: tokyoActive ? minutesSinceOpen(ts, TOKYO_OPEN_UTC) : -1,
      minutes_since_london_open: londonActive ? minutesSinceOpen(ts, LONDON_OPEN_UTC) : -1,
      minutes_since_ny_open: nyActive ? minutesSinceOpen(ts, NY_OPEN_UTC) : -1,
      is_weekend: isWeekend,
      is_monday_open: isMondayOpen,
      is_friday_close: isFridayClose,
      is_tokyo_lunch: isTokyoLunch,
    };

    return {
      lensName: this.name,
      lensVersion: this.version,
      features,
      computedAt: new Date(),
      computeDurationMs: Date.now() - start,
      confidence: 1.0,
    };
  }
}
