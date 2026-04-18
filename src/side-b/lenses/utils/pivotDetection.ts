/**
 * ピボット検出ユーティリティ（Phase 3）
 *
 * DowTheoryLens / VolatilityRegimeLens で使う共通ロジック。
 * スイングハイ（極大値）とスイングロー（極小値）を検出する。
 *
 * 設計原則:
 * - 純関数（副作用なし、決定性あり）
 * - 入力バーのコピーは行わない（参照を返す）
 * - 直近 rightBars 本は確定していないため除外
 *
 * @see docs/design/phase_3_specification.md セクション4.1
 */

/**
 * ピボット検出が必要とする最小限のバー形状
 */
export interface OHLCVBar {
    readonly timestamp: Date;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume?: number;
}

/**
 * 検出されたピボット
 */
export interface Pivot {
    readonly type: 'high' | 'low';
    readonly price: number;
    readonly barIndex: number;
    readonly timestamp: Date;
}

/**
 * ピボット検出設定
 */
export interface PivotDetectionConfig {
    /** 前方比較バー数（デフォルト: 5） */
    leftBars: number;
    /** 後方比較バー数（デフォルト: 5） */
    rightBars: number;
}

export const DEFAULT_PIVOT_CONFIG: PivotDetectionConfig = {
    leftBars: 5,
    rightBars: 5,
};

/**
 * 価格データからピボット（スイングハイ/ロー）を検出する。
 *
 * leftBars と rightBars の期間内で最高値/最安値となるバーをピボットとする。
 * 直近の rightBars 本は候補にならない（未確定）。
 *
 * @param ohlcv 時系列 OHLCV 配列（昇順）
 * @param config 検出設定
 * @returns ピボット配列（時系列順）
 */
export function detectPivots(
    ohlcv: readonly OHLCVBar[],
    config: PivotDetectionConfig = DEFAULT_PIVOT_CONFIG,
): Pivot[] {
    const pivots: Pivot[] = [];
    const { leftBars, rightBars } = config;

    if (ohlcv.length < leftBars + rightBars + 1) {
        return pivots;
    }

    for (let i = leftBars; i < ohlcv.length - rightBars; i++) {
        const current = ohlcv[i];

        let isHigh = true;
        let isLow = true;

        for (let j = i - leftBars; j < i; j++) {
            if (ohlcv[j].high > current.high) isHigh = false;
            if (ohlcv[j].low < current.low) isLow = false;
            if (!isHigh && !isLow) break;
        }
        if (isHigh || isLow) {
            for (let j = i + 1; j <= i + rightBars; j++) {
                if (ohlcv[j].high > current.high) isHigh = false;
                if (ohlcv[j].low < current.low) isLow = false;
                if (!isHigh && !isLow) break;
            }
        }

        if (isHigh) {
            pivots.push({
                type: 'high',
                price: current.high,
                barIndex: i,
                timestamp: current.timestamp,
            });
        }
        if (isLow) {
            pivots.push({
                type: 'low',
                price: current.low,
                barIndex: i,
                timestamp: current.timestamp,
            });
        }
    }

    return pivots;
}

/**
 * 指定タイプ（high/low）のピボットを末尾から count 個返す。
 */
export function getRecentPivotsByType(
    pivots: readonly Pivot[],
    type: 'high' | 'low',
    count: number,
): Pivot[] {
    const filtered: Pivot[] = [];
    for (let i = pivots.length - 1; i >= 0 && filtered.length < count; i--) {
        if (pivots[i].type === type) filtered.push(pivots[i]);
    }
    return filtered.reverse();
}

/**
 * 最新ピボットから経過したバー数を返す（存在しなければ -1）。
 */
export function barsSincePivot(
    pivots: readonly Pivot[],
    type: 'high' | 'low',
    currentBarIndex: number,
): number {
    for (let i = pivots.length - 1; i >= 0; i--) {
        if (pivots[i].type === type) {
            return currentBarIndex - pivots[i].barIndex;
        }
    }
    return -1;
}
