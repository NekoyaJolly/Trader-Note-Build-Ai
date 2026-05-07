/**
 * time_session lens の計算 (PR ⑤D-1)。
 *
 * Side-B `TimeSessionLens` (= 単一 timestamp) と analysis-engine
 * `compute_time_session_features` (= 各バー) の **共通の式**。surrogate の
 * `snapshotAt` 内で各バーの timestamp から features を計算するために使う。
 *
 * 式は `src/side-b/lenses/TimeSessionLens.ts` と完全一致 (= drift 防止)、
 * Python `analysis-engine/app/backtest/time_session.py` とも一致 (= TS と
 * Python で同じ判定をする)。
 */

const TOKYO_OPEN_UTC = 0;
const TOKYO_CLOSE_UTC = 6;
const LONDON_OPEN_UTC = 8;
const LONDON_CLOSE_UTC = 16;
const NY_OPEN_UTC = 13;
const NY_CLOSE_UTC = 21;

function minutesSinceOpen(ts: Date, openHourUTC: number): number {
  const nowMinutes = ts.getUTCHours() * 60 + ts.getUTCMinutes();
  const openMinutes = openHourUTC * 60;
  if (nowMinutes < openMinutes) return -1;
  return nowMinutes - openMinutes;
}

function isFXMarketOpenSimple(ts: Date): boolean {
  const dayOfWeek = ts.getUTCDay(); // 0=日曜, 6=土曜
  const hour = ts.getUTCHours();
  // 土曜は終日休
  if (dayOfWeek === 6) return false;
  // 日曜は 21 UTC 以前は休
  if (dayOfWeek === 0 && hour < 21) return false;
  // 金曜 21 UTC 以降は休
  if (dayOfWeek === 5 && hour >= 21) return false;
  return true;
}

/**
 * time_session features を返す。snapshot key は呼び出し側で `time_session.` prefix
 * を付与する想定 (= flat dict で返す)。
 */
export function computeTimeSessionFeatures(
  ts: Date,
): Record<string, number | boolean> {
  const hour = ts.getUTCHours();
  const minute = ts.getUTCMinutes();
  const dayOfWeek = ts.getUTCDay();
  const dayOfMonth = ts.getUTCDate();

  const tokyoActive = hour >= TOKYO_OPEN_UTC && hour < TOKYO_CLOSE_UTC;
  const londonActive = hour >= LONDON_OPEN_UTC && hour < LONDON_CLOSE_UTC;
  const nyActive = hour >= NY_OPEN_UTC && hour < NY_CLOSE_UTC;
  const overlapLondonNy = londonActive && nyActive;
  const overlapTokyoLondon = hour === 7 || hour === 8;

  const isWeekend = !isFXMarketOpenSimple(ts);
  const isMondayOpen = dayOfWeek === 1 && hour < 4;
  const isFridayClose = dayOfWeek === 5 && hour >= 17 && hour < 22;
  const isTokyoLunch =
    (hour === 2 && minute >= 30) || (hour === 3 && minute < 30);

  return {
    utc_hour: hour,
    utc_minute: minute,
    day_of_week: dayOfWeek,
    day_of_month: dayOfMonth,
    tokyo_active: tokyoActive,
    london_active: londonActive,
    ny_active: nyActive,
    overlap_london_ny: overlapLondonNy,
    overlap_tokyo_london: overlapTokyoLondon,
    minutes_since_tokyo_open: tokyoActive
      ? minutesSinceOpen(ts, TOKYO_OPEN_UTC)
      : -1,
    minutes_since_london_open: londonActive
      ? minutesSinceOpen(ts, LONDON_OPEN_UTC)
      : -1,
    minutes_since_ny_open: nyActive ? minutesSinceOpen(ts, NY_OPEN_UTC) : -1,
    is_weekend: isWeekend,
    is_monday_open: isMondayOpen,
    is_friday_close: isFridayClose,
    is_tokyo_lunch: isTokyoLunch,
  };
}

/** time_session features の全 key 一覧 (= condition collect 用)。 */
export const TIME_SESSION_FEATURE_KEYS = [
  'utc_hour',
  'utc_minute',
  'day_of_week',
  'day_of_month',
  'tokyo_active',
  'london_active',
  'ny_active',
  'overlap_london_ny',
  'overlap_tokyo_london',
  'minutes_since_tokyo_open',
  'minutes_since_london_open',
  'minutes_since_ny_open',
  'is_weekend',
  'is_monday_open',
  'is_friday_close',
  'is_tokyo_lunch',
] as const;
