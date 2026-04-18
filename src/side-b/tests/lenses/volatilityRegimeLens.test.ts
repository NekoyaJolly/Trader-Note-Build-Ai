/**
 * VolatilityRegimeLens のテスト（Phase 3）
 */

import { VolatilityRegimeLens } from '../../lenses/VolatilityRegimeLens';
import type { LensInput } from '../../lenses/types';
import type { OHLCVBar } from '../../lenses/utils/pivotDetection';

function makeBars(closes: number[], volatility = 1): OHLCVBar[] {
    return closes.map((c, i) => ({
        timestamp: new Date(Date.UTC(2024, 0, 1, 0, i)),
        open: c - volatility / 2,
        high: c + volatility,
        low: c - volatility,
        close: c,
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

describe('VolatilityRegimeLens', () => {
    let lens: VolatilityRegimeLens;

    beforeEach(() => {
        lens = new VolatilityRegimeLens();
    });

    describe('データ不足', () => {
        it('ohlcvBars がない場合は unknown を返す', async () => {
            const feature = await lens.compute({
                symbol: 'XAUUSD',
                timeframe: '15m',
                timestamp: new Date(),
            });
            expect(feature.features.regime_label).toBe('unknown');
            expect(feature.confidence).toBe(0);
        });

        it('バー数が minBars 未満の場合も unknown を返す', async () => {
            const bars = makeBars([100, 101, 102, 103]);
            const feature = await lens.compute(baseInput(bars));
            expect(feature.features.regime_label).toBe('unknown');
        });
    });

    describe('収縮状態の検出', () => {
        it('最近急にボラが縮小したデータで contracting を返す', async () => {
            // 前半は高ボラ、後半は低ボラ → 最新バーのBB幅は低パーセンタイル
            const highVol: number[] = [];
            for (let i = 0; i < 80; i++) highVol.push(100 + Math.sin(i) * 10);
            const lowVol: number[] = [];
            for (let i = 0; i < 30; i++) lowVol.push(100 + Math.sin(i) * 0.1);
            const bars = makeBars([...highVol, ...lowVol]);

            const feature = await lens.compute(baseInput(bars));
            expect(feature.features.regime_label).toBe('contracting');
            expect(feature.features.is_squeeze).toBe(true);
        });
    });

    describe('拡大状態の検出', () => {
        it('最近急にボラが拡大したデータで expanding 系を返す', async () => {
            const lowVol: number[] = [];
            for (let i = 0; i < 80; i++) lowVol.push(100 + Math.sin(i) * 0.1);
            const highVol: number[] = [];
            for (let i = 0; i < 30; i++) highVol.push(100 + Math.sin(i) * 20);
            const bars = makeBars([...lowVol, ...highVol]);

            const feature = await lens.compute(baseInput(bars));
            expect(['elevated', 'expanding']).toContain(feature.features.regime_label);
        });
    });

    describe('BB幅 / ATR の計算', () => {
        it('一定ボラの場合 BB幅は安定し、ATR変化率は 0 付近', async () => {
            const bars = makeBars(
                Array.from({ length: 110 }, (_, i) => 100 + Math.sin(i / 2) * 5),
            );
            const feature = await lens.compute(baseInput(bars));

            const atrChange = feature.features.atr_change_rate as number;
            expect(Math.abs(atrChange)).toBeLessThan(0.5);
            expect(feature.features.bb_width).toBeGreaterThan(0);
            expect(feature.features.atr).toBeGreaterThan(0);
        });
    });

    describe('パーセンタイル範囲', () => {
        it('bb_width_percentile は 0〜100 の範囲内', async () => {
            const bars = makeBars(
                Array.from({ length: 110 }, (_, i) => 100 + Math.sin(i / 5) * 3),
            );
            const feature = await lens.compute(baseInput(bars));
            const p = feature.features.bb_width_percentile as number;
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(100);
        });
    });

    describe('決定性', () => {
        it('同じ入力で同じ出力を返す', async () => {
            const bars = makeBars(
                Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 4) * 5),
            );
            const a = await lens.compute(baseInput(bars));
            const b = await lens.compute(baseInput(bars));
            expect(a.features).toEqual(b.features);
        });
    });

    describe('メタデータ', () => {
        it('lensName / lensVersion / computedAt が設定される', async () => {
            const bars = makeBars(Array.from({ length: 100 }, (_, i) => 100 + i * 0.1));
            const feature = await lens.compute(baseInput(bars));
            expect(feature.lensName).toBe('volatility_regime');
            expect(feature.lensVersion).toBe('1.0.0');
            expect(feature.computedAt).toBeInstanceOf(Date);
        });
    });
});
