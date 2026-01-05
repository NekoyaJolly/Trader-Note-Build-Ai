/**
 * FX市場時間ユーティリティ
 * 
 * 目的: FX市場（XAU/USDなど）の開場/休場判定
 * 
 * FX市場の特徴:
 * - 平日24時間取引可能
 * - 土日は休場
 * - 週の開始: 日曜22:00 UTC（冬時間）/ 21:00 UTC（夏時間）
 * - 週の終了: 金曜22:00 UTC（冬時間）/ 21:00 UTC（夏時間）
 * 
 * サマータイム（DST）:
 * - 米国DST: 3月第2日曜 〜 11月第1日曜
 * - 欧州DST: 3月最終日曜 〜 10月最終日曜
 * - 本システムでは米国DSTを基準とする
 */

/**
 * 米国サマータイムかどうかを判定
 * 
 * 米国DST: 3月第2日曜 02:00 〜 11月第1日曜 02:00
 * 
 * @param date - 判定する日付
 * @returns サマータイム中ならtrue
 */
export function isUSDaylightSavingTime(date: Date = new Date()): boolean {
  const year = date.getFullYear();
  
  // 3月第2日曜を計算
  const marchFirst = new Date(Date.UTC(year, 2, 1)); // 3月1日
  const marchSecondSunday = new Date(Date.UTC(
    year, 2, 
    (14 - marchFirst.getUTCDay()) % 7 + 8, // 第2日曜
    2, 0, 0
  ));
  
  // 11月第1日曜を計算
  const novemberFirst = new Date(Date.UTC(year, 10, 1)); // 11月1日
  const novemberFirstSunday = new Date(Date.UTC(
    year, 10,
    (7 - novemberFirst.getUTCDay()) % 7 + 1, // 第1日曜
    2, 0, 0
  ));
  
  return date >= marchSecondSunday && date < novemberFirstSunday;
}

/**
 * FX市場の週の開始時刻を取得（UTC）
 * 
 * @param date - 基準日
 * @returns その週の市場開始時刻
 */
export function getFXWeekStartUTC(date: Date = new Date()): Date {
  const isDST = isUSDaylightSavingTime(date);
  const openHourUTC = isDST ? 21 : 22; // 夏時間は21:00、冬時間は22:00
  
  // 日曜日を探す
  const sunday = new Date(date);
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  sunday.setUTCHours(openHourUTC, 0, 0, 0);
  
  return sunday;
}

/**
 * FX市場の週の終了時刻を取得（UTC）
 * 
 * @param date - 基準日
 * @returns その週の市場終了時刻
 */
export function getFXWeekEndUTC(date: Date = new Date()): Date {
  const isDST = isUSDaylightSavingTime(date);
  const closeHourUTC = isDST ? 21 : 22; // 夏時間は21:00、冬時間は22:00
  
  // 金曜日を探す
  const friday = new Date(date);
  const dayOfWeek = friday.getUTCDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  friday.setUTCDate(friday.getUTCDate() + daysUntilFriday);
  friday.setUTCHours(closeHourUTC, 0, 0, 0);
  
  return friday;
}

/**
 * FX市場が開場中かどうかを判定
 * 
 * @param date - 判定する日時
 * @returns 開場中ならtrue
 */
export function isFXMarketOpen(date: Date = new Date()): boolean {
  const dayOfWeek = date.getUTCDay(); // 0=日曜, 6=土曜
  const hour = date.getUTCHours();
  const isDST = isUSDaylightSavingTime(date);
  const transitionHour = isDST ? 21 : 22;
  
  // 土曜日は完全に休場
  if (dayOfWeek === 6) {
    return false;
  }
  
  // 日曜日は開始時刻以降のみ開場
  if (dayOfWeek === 0) {
    return hour >= transitionHour;
  }
  
  // 金曜日は終了時刻まで開場
  if (dayOfWeek === 5) {
    return hour < transitionHour;
  }
  
  // 月〜木は24時間開場
  return true;
}

/**
 * 次の市場開場時刻を取得
 * 
 * @param date - 基準日時
 * @returns 次の開場時刻（すでに開場中なら現在時刻）
 */
export function getNextMarketOpen(date: Date = new Date()): Date {
  if (isFXMarketOpen(date)) {
    return date;
  }
  
  const isDST = isUSDaylightSavingTime(date);
  const openHourUTC = isDST ? 21 : 22;
  
  // 次の日曜を探す
  const nextSunday = new Date(date);
  const daysUntilSunday = (7 - nextSunday.getUTCDay()) % 7;
  nextSunday.setUTCDate(nextSunday.getUTCDate() + daysUntilSunday);
  nextSunday.setUTCHours(openHourUTC, 0, 0, 0);
  
  // もし現在が日曜で開場時刻前なら、今日の開場時刻を返す
  if (date.getUTCDay() === 0 && date.getUTCHours() < openHourUTC) {
    const today = new Date(date);
    today.setUTCHours(openHourUTC, 0, 0, 0);
    return today;
  }
  
  return nextSunday;
}

/**
 * 次の市場閉場時刻を取得
 * 
 * @param date - 基準日時
 * @returns 次の閉場時刻
 */
export function getNextMarketClose(date: Date = new Date()): Date {
  if (!isFXMarketOpen(date)) {
    // 休場中なら、次の週の金曜を返す
    const nextOpen = getNextMarketOpen(date);
    return getNextMarketClose(nextOpen);
  }
  
  const isDST = isUSDaylightSavingTime(date);
  const closeHourUTC = isDST ? 21 : 22;
  
  // 今週の金曜を探す
  const friday = new Date(date);
  const dayOfWeek = friday.getUTCDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  if (daysUntilFriday === 0 && friday.getUTCHours() >= closeHourUTC) {
    // 金曜の閉場時刻を過ぎている場合、来週の金曜
    friday.setUTCDate(friday.getUTCDate() + 7);
  } else {
    friday.setUTCDate(friday.getUTCDate() + daysUntilFriday);
  }
  friday.setUTCHours(closeHourUTC, 0, 0, 0);
  
  return friday;
}

/**
 * 市場状態の詳細情報を取得
 * 
 * @param date - 判定する日時
 * @returns 市場状態の詳細
 */
export function getMarketStatus(date: Date = new Date()): {
  isOpen: boolean;
  isDST: boolean;
  currentTime: Date;
  nextOpen: Date | null;
  nextClose: Date | null;
  message: string;
} {
  const isOpen = isFXMarketOpen(date);
  const isDST = isUSDaylightSavingTime(date);
  
  if (isOpen) {
    return {
      isOpen: true,
      isDST,
      currentTime: date,
      nextOpen: null,
      nextClose: getNextMarketClose(date),
      message: `FX市場は開場中です${isDST ? '（サマータイム）' : ''}`,
    };
  }
  
  const nextOpen = getNextMarketOpen(date);
  return {
    isOpen: false,
    isDST,
    currentTime: date,
    nextOpen,
    nextClose: null,
    message: `FX市場は休場中です。次の開場: ${nextOpen.toISOString()}`,
  };
}

/**
 * 日本時間での市場情報を取得（ユーザー向け）
 * 
 * @param date - 基準日時
 * @returns 日本時間での市場情報
 */
export function getMarketStatusJST(date: Date = new Date()): {
  isOpen: boolean;
  isDST: boolean;
  message: string;
  nextEvent: string;
} {
  const status = getMarketStatus(date);
  
  const formatJST = (d: Date): string => {
    return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  };
  
  if (status.isOpen && status.nextClose) {
    return {
      isOpen: true,
      isDST: status.isDST,
      message: `FX市場は開場中${status.isDST ? '（サマータイム）' : ''}`,
      nextEvent: `閉場予定: ${formatJST(status.nextClose)}`,
    };
  }
  
  if (status.nextOpen) {
    return {
      isOpen: false,
      isDST: status.isDST,
      message: 'FX市場は休場中',
      nextEvent: `開場予定: ${formatJST(status.nextOpen)}`,
    };
  }
  
  return {
    isOpen: false,
    isDST: status.isDST,
    message: 'FX市場は休場中',
    nextEvent: '不明',
  };
}
