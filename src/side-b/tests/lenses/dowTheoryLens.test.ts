/**
 * DowTheoryLens のテスト（Phase 3）
 */

import { DowTheoryLens } from '../../lenses/DowTheoryLens';
import type { LensInput } from '../../lenses/types';
import type { OHLCVBar } from '../../lenses/utils/pivotDetection';

function makeBars(priceSeries: Array<{ high: number; low: number }>): OHLCVBar[] {
    return priceSeries.map((p, i) => ({
        timestamp: new Date(Date.UTC(2024, 0, 1, 0, i)),
        open: (p.high + p.low) / 2,
        high: p.high,
        low: p.low,
        close: (p.high + p.low) / 2,
    }));
}

function baseInput(bars: OHLCVBar[]): LensInput {
    return {
        symbol: 'XAUUSD',
        timeframe: '15m',
        timestamp: new Date(Date.UTC(2024, 0, 2)),
        ohlcvBars: bars,
    };
}

describe('DowTheoryLens', () => {
    let lens: DowTheoryLens;

    beforeEach(() => {
        lens = new DowTheoryLens();
    });

    describe('データ不足', () => {
        it('ohlcvBars がない場合は unclear / unknown を返す', async () => {
            const feature = await lens.compute({
                symbol: 'XAUUSD',
                timeframe: '15m',
                timestamp: new Date(),
            });
            expect(feature.features.trend_state).toBe('unclear');
            expect(feature.features.trend_phase).toBe('unknown');
            expect(feature.features.reason).toBe('insufficient_data');
            expect(feature.confidence).toBe(0);
        });

        it('バー数が minBars 未満の場合は unclear を返す', async () => {
            const bars = makeBars(
                Array.from({ length: 5 }, () => ({ high: 100, low: 99 })),
            );
            const feature = await lens.compute(baseInput(bars));
            expect(feature.features.trend_state).toBe('unclear');
        });
    });

    describe('上昇トレンド検出', () => {
        it('階段状に上昇するデータで uptrend を返す', async () => {
            // 2つの高値切り上げと2つの安値切り上げが必要
            const series: Array<{ high: number; low: number }> = [];
            // 上昇1段目
            for (let i = 0; i < 6; i++) series.push({ high: 100 + i, low: 95 + i });
            series.push({ high: 115, low: 103 }); // ピボット高1
            for (let i = 0; i < 5; i++) series.push({ high: 112 - i * 0.5, low: 102 - i * 0.5 });
            series.push({ high: 108, low: 99 }); // ピボット低1
            for (let i = 0; i < 5; i++) series.push({ high: 110 + i, low: 101 + i });
            series.push({ high: 125, low: 113 }); // ピボット高2（上位更新）
            for (let i = 0; i < 5; i++) series.push({ high: 122 - i * 0.5, low: 112 - i * 0.5 });
            series.push({ high: 118, low: 107 }); // ピボット低2（上位更新）
            for (let i = 0; i < 6; i++) series.push({ high: 120 + i, low: 109 + i });
            const bars = makeBars(series);

            const feature = await lens.compute(baseInput(bars));
            expect(feature.features.trend_state).toBe('uptrend');
            expect(feature.features.recent_higher_high).toBe(true);
            expect(feature.features.recent_higher_low).toBe(true);
            expect(feature.confidence).toBeGreaterThan(0.5);
        });
    });

    describe('下降トレンド検出', () => {
        it('階段状に下降するデータで downtrend を返す', async () => {
            const series: Array<{ high: number; low: number }> = [];
            for (let i = 0; i < 6; i++) series.push({ high: 120 - i, low: 115 - i });
            series.push({ high: 108, low: 100 }); // ピボット低1
            for (let i = 0; i < 5; i++) series.push({ high: 110 + i * 0.5, low: 104 + i * 0.5 });
            series.push({ high: 115, low: 107 }); // ピボット高1
            for (let i = 0; i < 5; i++) series.push({ high: 112 - i, low: 104 - i });
            series.push({ high: 100, low: 90 }); // ピボット低2（下位更新）
            for (let i = 0; i < 5; i++) series.push({ high: 102 + i * 0.5, low: 94 + i * 0.5 });
            series.push({ high: 108, low: 99 }); // ピボット高2（下位更新）
            for (let i = 0; i < 6; i++) series.push({ high: 105 - i, low: 96 - i });
            const bars = makeBars(series);

            const feature = await lens.compute(baseInput(bars));
            expect(feature.features.trend_state).toBe('downtrend');
            expect(feature.features.recent_lower_high).toBe(true);
            expect(feature.features.recent_lower_low).toBe(true);
        });
    });

    describe('決定性', () => {
        it('同じ入力で同じ出力を返す', async () => {
            const bars = makeBars(
                Array.from({ length: 40 }, (_, i) => ({
                    high: 100 + Math.sin(i / 3) * 10,
                    low: 95 + Math.sin(i / 3) * 10,
                })),
            );
            const a = await lens.compute(baseInput(bars));
            const b = await lens.compute(baseInput(bars));
            expect(a.features).toEqual(b.features);
        });
    });

    describe('メタデータ', () => {
        it('lensName / lensVersion / computedAt が設定される', async () => {
            const bars = makeBars(
                Array.from({ length: 20 }, (_, i) => ({ high: 100 + i, low: 95 + i })),
            );
            const feature = await lens.compute(baseInput(bars));
            expect(feature.lensName).toBe('dow_theory');
            expect(feature.lensVersion).toBe('1.0.0');
            expect(feature.computedAt).toBeInstanceOf(Date);
        });
    });
});
