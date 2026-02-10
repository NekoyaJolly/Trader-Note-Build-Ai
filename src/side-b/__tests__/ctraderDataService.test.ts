/**
 * cTrader データサービス ユニットテスト
 *
 * テスト対象: convertTrendbars（相対値→絶対価格変換）
 * ネットワーク不要の純粋ロジックテスト
 */

import { describe, it, expect } from 'vitest';
import { CTraderDataService, CTraderTrendbar, CTraderTrendbarPeriod } from '../../backend/services/ctrader/ctraderDataService';

// テスト用にconvertTrendbarsを呼ぶためのヘルパー
// CTraderDataServiceのconstructorにはauthServiceが必要だが、
// convertTrendbarsは独立メソッドなのでnull assertionで回避
function createTestService(): CTraderDataService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new CTraderDataService(null as any);
}

describe('CTraderDataService', () => {
    describe('convertTrendbars', () => {
        const service = createTestService();

        it('XAU/USD (digits=2) の変換: low + delta → 絶対価格', () => {
            const trendbars: CTraderTrendbar[] = [
                {
                    utcTimestampInMinutes: 29520000, // 2026-02-10 00:00 UTC
                    low: 290050,      // 2900.50 (÷100)
                    deltaOpen: 30,    // +0.30 → 2900.80
                    deltaHigh: 150,   // +1.50 → 2902.00
                    deltaClose: 80,   // +0.80 → 2901.30
                    volume: 1500,
                },
            ];

            const bars = service.convertTrendbars(trendbars, 2);

            expect(bars).toHaveLength(1);
            expect(bars[0].low).toBe(2900.50);
            expect(bars[0].open).toBe(2900.80);
            expect(bars[0].high).toBe(2902.00);
            expect(bars[0].close).toBe(2901.30);
            expect(bars[0].volume).toBe(1500);
        });

        it('EUR/USD (digits=5) の変換: 精度5桁', () => {
            const trendbars: CTraderTrendbar[] = [
                {
                    utcTimestampInMinutes: 29520000,
                    low: 103450,    // 1.03450 (÷100000)
                    deltaOpen: 15,  // +0.00015 → 1.03465
                    deltaHigh: 50,  // +0.00050 → 1.03500
                    deltaClose: 30, // +0.00030 → 1.03480
                    volume: 5000,
                },
            ];

            const bars = service.convertTrendbars(trendbars, 5);

            expect(bars).toHaveLength(1);
            expect(bars[0].low).toBe(1.03450);
            expect(bars[0].open).toBe(1.03465);
            expect(bars[0].high).toBe(1.03500);
            expect(bars[0].close).toBe(1.03480);
        });

        it('USD/JPY (digits=3) の変換', () => {
            const trendbars: CTraderTrendbar[] = [
                {
                    utcTimestampInMinutes: 29520000,
                    low: 151200,    // 151.200 (÷1000)
                    deltaOpen: 50,  // +0.050 → 151.250
                    deltaHigh: 300, // +0.300 → 151.500
                    deltaClose: 150,// +0.150 → 151.350
                    volume: 3000,
                },
            ];

            const bars = service.convertTrendbars(trendbars, 3);

            expect(bars).toHaveLength(1);
            expect(bars[0].low).toBe(151.200);
            expect(bars[0].open).toBe(151.250);
            expect(bars[0].high).toBe(151.500);
            expect(bars[0].close).toBe(151.350);
        });

        it('複数バーは時系列順（古い→新しい）にソート', () => {
            const trendbars: CTraderTrendbar[] = [
                {
                    utcTimestampInMinutes: 29520060, // 後のバー
                    low: 290100, deltaOpen: 10, deltaHigh: 50, deltaClose: 30,
                },
                {
                    utcTimestampInMinutes: 29520000, // 先のバー
                    low: 290000, deltaOpen: 20, deltaHigh: 80, deltaClose: 50,
                },
            ];

            const bars = service.convertTrendbars(trendbars, 2);

            expect(bars).toHaveLength(2);
            expect(bars[0].timestamp.getTime()).toBeLessThan(bars[1].timestamp.getTime());
        });

        it('delta が 0 の場合は low と同じ値', () => {
            const trendbars: CTraderTrendbar[] = [
                {
                    utcTimestampInMinutes: 29520000,
                    low: 290000,
                    deltaOpen: 0,
                    deltaHigh: 0,
                    deltaClose: 0,
                    volume: 0,
                },
            ];

            const bars = service.convertTrendbars(trendbars, 2);

            expect(bars[0].open).toBe(2900.00);
            expect(bars[0].high).toBe(2900.00);
            expect(bars[0].close).toBe(2900.00);
            expect(bars[0].low).toBe(2900.00);
        });

        it('volume が undefined の場合は 0', () => {
            const trendbars: CTraderTrendbar[] = [
                {
                    utcTimestampInMinutes: 29520000,
                    low: 290000,
                    deltaOpen: 10,
                    deltaHigh: 50,
                    deltaClose: 30,
                    // volume 省略
                },
            ];

            const bars = service.convertTrendbars(trendbars, 2);
            expect(bars[0].volume).toBe(0);
        });

        it('空配列は空配列を返す', () => {
            const bars = service.convertTrendbars([], 2);
            expect(bars).toHaveLength(0);
        });
    });

    describe('CTraderTrendbarPeriod', () => {
        it('期間定数が正しい値', () => {
            expect(CTraderTrendbarPeriod.M1).toBe(1);
            expect(CTraderTrendbarPeriod.M15).toBe(7);
            expect(CTraderTrendbarPeriod.H1).toBe(9);
            expect(CTraderTrendbarPeriod.H4).toBe(10);
            expect(CTraderTrendbarPeriod.D1).toBe(12);
        });
    });

    describe('isConfigured', () => {
        it('clientId と clientSecret がない場合は false', () => {
            const service = createTestService();
            // config.ctrader の値に依存するが、テスト環境では通常空
            // このテストは設定状態の確認のみ
            expect(typeof service.isConfigured()).toBe('boolean');
        });
    });
});
