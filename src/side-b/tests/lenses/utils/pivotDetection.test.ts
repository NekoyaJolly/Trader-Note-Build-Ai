/**
 * ピボット検出ユーティリティのテスト
 */

import {
    detectPivots,
    getRecentPivotsByType,
    barsSincePivot,
    type OHLCVBar,
} from '../../../lenses/utils/pivotDetection';

function bar(i: number, high: number, low: number, close?: number): OHLCVBar {
    return {
        timestamp: new Date(Date.UTC(2024, 0, 1, i)),
        open: close ?? (high + low) / 2,
        high,
        low,
        close: close ?? (high + low) / 2,
    };
}

describe('detectPivots', () => {
    it('データ不足（11本未満）では空配列を返す', () => {
        const bars = Array.from({ length: 10 }, (_, i) => bar(i, 100 + i, 90 + i));
        const pivots = detectPivots(bars);
        expect(pivots).toEqual([]);
    });

    it('単純な山型データからピボット高を検出する', () => {
        // 11本: 中央 (index=5) が最高値
        const bars = [
            bar(0, 100, 95),
            bar(1, 101, 96),
            bar(2, 102, 97),
            bar(3, 103, 98),
            bar(4, 104, 99),
            bar(5, 110, 100), // ピボット高
            bar(6, 105, 99),
            bar(7, 104, 98),
            bar(8, 103, 97),
            bar(9, 102, 96),
            bar(10, 101, 95),
        ];
        const pivots = detectPivots(bars);
        expect(pivots.length).toBeGreaterThan(0);
        const high = pivots.find((p) => p.type === 'high');
        expect(high?.price).toBe(110);
        expect(high?.barIndex).toBe(5);
    });

    it('単純な谷型データからピボット低を検出する', () => {
        const bars = [
            bar(0, 100, 95),
            bar(1, 99, 94),
            bar(2, 98, 93),
            bar(3, 97, 92),
            bar(4, 96, 91),
            bar(5, 95, 85), // ピボット低
            bar(6, 97, 90),
            bar(7, 98, 91),
            bar(8, 99, 92),
            bar(9, 100, 93),
            bar(10, 101, 94),
        ];
        const pivots = detectPivots(bars);
        const low = pivots.find((p) => p.type === 'low');
        expect(low?.price).toBe(85);
        expect(low?.barIndex).toBe(5);
    });

    it('同じ入力で同じ出力を返す（決定性）', () => {
        const bars = Array.from({ length: 20 }, (_, i) =>
            bar(i, 100 + Math.sin(i) * 10, 90 + Math.sin(i) * 10),
        );
        const a = detectPivots(bars);
        const b = detectPivots(bars);
        expect(a).toEqual(b);
    });

    it('leftBars/rightBars を変更すると検出結果が変わる', () => {
        const bars = Array.from({ length: 20 }, (_, i) =>
            bar(i, 100 + Math.sin(i) * 10, 90 + Math.sin(i) * 10),
        );
        const defaultPivots = detectPivots(bars, { leftBars: 5, rightBars: 5 });
        const narrowPivots = detectPivots(bars, { leftBars: 2, rightBars: 2 });
        expect(narrowPivots.length).toBeGreaterThanOrEqual(defaultPivots.length);
    });
});

describe('getRecentPivotsByType', () => {
    it('指定タイプの直近 N 個を時系列順で返す', () => {
        const pivots = [
            { type: 'high' as const, price: 100, barIndex: 5, timestamp: new Date() },
            { type: 'low' as const, price: 90, barIndex: 10, timestamp: new Date() },
            { type: 'high' as const, price: 110, barIndex: 15, timestamp: new Date() },
            { type: 'low' as const, price: 85, barIndex: 20, timestamp: new Date() },
            { type: 'high' as const, price: 115, barIndex: 25, timestamp: new Date() },
        ];
        const recent = getRecentPivotsByType(pivots, 'high', 2);
        expect(recent).toHaveLength(2);
        expect(recent[0].price).toBe(110);
        expect(recent[1].price).toBe(115);
    });
});

describe('barsSincePivot', () => {
    it('最新ピボットからの経過バー数を正しく返す', () => {
        const pivots = [
            { type: 'high' as const, price: 100, barIndex: 5, timestamp: new Date() },
            { type: 'high' as const, price: 110, barIndex: 15, timestamp: new Date() },
        ];
        expect(barsSincePivot(pivots, 'high', 20)).toBe(5);
    });

    it('該当タイプのピボットがなければ -1 を返す', () => {
        const pivots = [
            { type: 'high' as const, price: 100, barIndex: 5, timestamp: new Date() },
        ];
        expect(barsSincePivot(pivots, 'low', 10)).toBe(-1);
    });
});
