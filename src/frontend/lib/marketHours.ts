/**
 * 市場時間判定ユーティリティ
 * 
 * Forex / XAU 市場の営業時間を DST（サマータイム）対応で判定する。
 * 
 * Forex市場:
 *   - 月曜日 シドニー開場 〜 金曜日 NY閉場
 *   - UTC: 日曜 22:00 (冬) / 21:00 (夏) 〜 金曜 22:00 (冬) / 21:00 (夏)
 *   - 東京時間: 月曜 07:00 (冬) / 06:00 (夏) 〜 土曜 07:00 (冬) / 06:00 (夏)
 */

/**
 * 北米DST（3月第2日曜日 〜 11月第1日曜日）が有効かどうか判定
 */
function isUSdaylightSavingTime(date: Date): boolean {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth(); // 0-based

    // 4月〜10月は確実に DST 範囲内（or 外）
    if (month > 2 && month < 10) return true;  // Apr-Oct
    if (month < 2 || month > 10) return false; // Jan-Feb, Dec

    // 3月: 第2日曜日以降
    if (month === 2) {
        // 第2日曜日を計算
        const firstDay = new Date(Date.UTC(year, 2, 1));
        const firstSunday = 1 + ((7 - firstDay.getUTCDay()) % 7);
        const secondSunday = firstSunday + 7;
        const dstStart = new Date(Date.UTC(year, 2, secondSunday, 7, 0, 0)); // 2:00 EST = 7:00 UTC
        return date >= dstStart;
    }

    // 11月: 第1日曜日まで
    if (month === 10) {
        const firstDay = new Date(Date.UTC(year, 10, 1));
        const firstSunday = 1 + ((7 - firstDay.getUTCDay()) % 7);
        const dstEnd = new Date(Date.UTC(year, 10, firstSunday, 6, 0, 0)); // 2:00 EDT = 6:00 UTC
        return date < dstEnd;
    }

    return false;
}

export interface MarketStatus {
    isOpen: boolean;
    message: string;
    nextOpenTime: Date | null;
    currentSession: string | null; // 'sydney' | 'tokyo' | 'london' | 'newyork' | null
}

/**
 * Forex市場が開いているかどうかを判定する
 * 
 * @param now - 判定する日時（デフォルト: 現在時刻）
 * @returns MarketStatus
 */
export function getMarketStatus(now?: Date): MarketStatus {
    const date = now || new Date();
    const isDST = isUSdaylightSavingTime(date);

    // Forex市場の開閉場時間（UTC）
    // 冬時間: 日曜 22:00 UTC 開場 → 金曜 22:00 UTC 閉場
    // 夏時間: 日曜 21:00 UTC 開場 → 金曜 21:00 UTC 閉場
    const marketOpenHourUTC = isDST ? 21 : 22;
    const marketCloseHourUTC = isDST ? 21 : 22;

    const dayOfWeek = date.getUTCDay(); // 0=Sun, 6=Sat
    const hourUTC = date.getUTCHours();

    let isOpen = false;

    // 月曜〜木曜: 終日開場
    if (dayOfWeek >= 1 && dayOfWeek <= 4) {
        isOpen = true;
    }
    // 金曜: 閉場時間まで
    else if (dayOfWeek === 5) {
        isOpen = hourUTC < marketCloseHourUTC;
    }
    // 土曜: 閉場
    else if (dayOfWeek === 6) {
        isOpen = false;
    }
    // 日曜: 開場時間以降
    else if (dayOfWeek === 0) {
        isOpen = hourUTC >= marketOpenHourUTC;
    }

    // 現在のセッション判定（UTC基準）
    let currentSession: string | null = null;
    if (isOpen) {
        const adjustedHour = isDST ? hourUTC + 1 : hourUTC; // DST補正
        const normalizedHour = adjustedHour % 24;

        // セッション時間帯（UTC冬時間基準）
        // Sydney: 22:00-07:00 UTC (冬) / 21:00-06:00 UTC (夏)
        // Tokyo:  00:00-09:00 UTC (冬) / 23:00-08:00 UTC (夏)
        // London: 08:00-17:00 UTC (冬) / 07:00-16:00 UTC (夏)
        // NY:     13:00-22:00 UTC (冬) / 12:00-21:00 UTC (夏)
        if (normalizedHour >= 13 || normalizedHour < 7) {
            currentSession = normalizedHour >= 22 || normalizedHour < 7 ? 'sydney' : 'newyork';
        } else if (normalizedHour >= 0 && normalizedHour < 9) {
            currentSession = 'tokyo';
        } else if (normalizedHour >= 8 && normalizedHour < 17) {
            currentSession = normalizedHour < 13 ? 'london' : 'london'; // overlap with NY
        }
        // Simplified: determine main active session
        if (hourUTC >= (isDST ? 23 : 0) || hourUTC < (isDST ? 6 : 7)) {
            currentSession = 'tokyo';
        } else if (hourUTC >= (isDST ? 7 : 8) && hourUTC < (isDST ? 12 : 13)) {
            currentSession = 'london';
        } else if (hourUTC >= (isDST ? 12 : 13) && hourUTC < (isDST ? 21 : 22)) {
            currentSession = 'newyork';
        } else {
            currentSession = 'sydney';
        }
    }

    // 次回開場時刻を計算
    let nextOpenTime: Date | null = null;
    if (!isOpen) {
        const next = new Date(date);

        if (dayOfWeek === 6) {
            // 土曜 → 日曜の開場時間
            next.setUTCDate(next.getUTCDate() + 1);
            next.setUTCHours(marketOpenHourUTC, 0, 0, 0);
        } else if (dayOfWeek === 0 && hourUTC < marketOpenHourUTC) {
            // 日曜、開場前
            next.setUTCHours(marketOpenHourUTC, 0, 0, 0);
        } else if (dayOfWeek === 5 && hourUTC >= marketCloseHourUTC) {
            // 金曜、閉場後 → 次の日曜の開場
            next.setUTCDate(next.getUTCDate() + 2);
            next.setUTCHours(marketOpenHourUTC, 0, 0, 0);
        }

        nextOpenTime = next;
    }

    // メッセージ生成
    const sessionNames: Record<string, string> = {
        sydney: 'シドニー',
        tokyo: '東京',
        london: 'ロンドン',
        newyork: 'ニューヨーク',
    };

    let message: string;
    if (isOpen) {
        const sessionName = currentSession ? sessionNames[currentSession] : '';
        message = `市場は開場中です${sessionName ? `（${sessionName}セッション）` : ''}`;
    } else {
        if (nextOpenTime) {
            const formatter = new Intl.DateTimeFormat('ja-JP', {
                weekday: 'long',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Tokyo',
            });
            const nextOpenStr = formatter.format(nextOpenTime);
            message = `市場は閉場しています。次回開場: ${nextOpenStr}（東京時間）`;
        } else {
            message = '市場は閉場しています';
        }
    }

    return {
        isOpen,
        message,
        nextOpenTime,
        currentSession,
    };
}

/**
 * 簡易判定: 市場が開いているか
 */
export function isMarketOpen(now?: Date): boolean {
    return getMarketStatus(now).isOpen;
}
