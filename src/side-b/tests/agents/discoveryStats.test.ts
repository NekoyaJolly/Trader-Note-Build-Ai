/**
 * DiscoveryAgent 統計エンジンのテスト（Phase 4a）
 */

import {
    aggregateFeatureValues,
    computeFeatureSeparations,
    cohensD,
    categoricalSeparation,
} from '../../agents/discoveryStats';
import type { AITradeNote } from '../../models/aiTradeNote';

function makeNote(
    outcome: 'win' | 'loss',
    lensFeatures: Record<string, Record<string, number | string | boolean>>,
): AITradeNote {
    return {
        id: `note-${Math.random()}`,
        virtualTradeId: 'vt-1',
        planId: 'plan-1',
        date: '2026-04-15',
        symbol: 'XAUUSD',
        direction: 'long',
        result: {
            outcome,
            pnlPips: outcome === 'win' ? 30 : -20,
            pnlPercentage: outcome === 'win' ? 0.3 : -0.2,
            riskRewardActual: 1.5,
            holdingDuration: 60,
        },
        entryAnalysis: {} as AITradeNote['entryAnalysis'],
        exitAnalysis: {} as AITradeNote['exitAnalysis'],
        planEvaluation: {} as AITradeNote['planEvaluation'],
        marketReview: {} as AITradeNote['marketReview'],
        learnings: {} as AITradeNote['learnings'],
        lensSnapshot: {
            timestamp: new Date().toISOString(),
            features: lensFeatures,
        },
        aiModel: 'test',
        createdAt: new Date(),
    };
}

describe('aggregateFeatureValues', () => {
    it('win/loss ごとに feature を分ける', () => {
        const notes: AITradeNote[] = [
            makeNote('win', { volatility_regime: { bb_width_percentile: 20 } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 25 } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 80 } }),
        ];
        const splits = aggregateFeatureValues(notes);
        const s = splits.get('volatility_regime::bb_width_percentile');
        expect(s).toBeDefined();
        expect(s!.wins).toEqual([20, 25]);
        expect(s!.losses).toEqual([80]);
    });

    it('lensSnapshot がない note は除外', () => {
        const notes: AITradeNote[] = [
            makeNote('win', { x: { y: 10 } }),
            {
                ...makeNote('loss', { x: { y: 20 } }),
                lensSnapshot: undefined,
            },
        ];
        const splits = aggregateFeatureValues(notes);
        const s = splits.get('x::y');
        expect(s!.wins).toEqual([10]);
        expect(s!.losses).toEqual([]);
    });

    it('breakeven は除外', () => {
        const notes: AITradeNote[] = [
            makeNote('win', { x: { y: 1 } }),
            {
                ...makeNote('loss', { x: { y: 2 } }),
                result: { ...makeNote('loss', {}).result, outcome: 'breakeven' as const },
            },
        ];
        const splits = aggregateFeatureValues(notes);
        const s = splits.get('x::y');
        expect(s!.wins).toEqual([1]);
        expect(s!.losses).toEqual([]);
    });
});

describe('computeFeatureSeparations', () => {
    it('最小サンプル数を満たさない feature は除外', () => {
        const splits = new Map([
            ['lens::feat', { wins: [1, 2], losses: [3] }], // 2 < 3
        ]);
        const separations = computeFeatureSeparations(splits);
        expect(separations).toEqual([]);
    });

    it('数値 feature で Cohen d を計算', () => {
        const splits = new Map([
            ['lens::feat', { wins: [10, 12, 11, 13, 14], losses: [5, 6, 4, 5, 7] }],
        ]);
        const separations = computeFeatureSeparations(splits);
        expect(separations).toHaveLength(1);
        expect(separations[0].separationScore).toBeGreaterThan(1);
        expect(separations[0].numericSummary).toBeDefined();
        expect(separations[0].numericSummary!.winMean).toBeGreaterThan(separations[0].numericSummary!.lossMean);
    });

    it('カテゴリ feature で条件付き勝率の乖離を計算', () => {
        const splits = new Map([
            [
                'lens::state',
                {
                    wins: ['uptrend', 'uptrend', 'uptrend', 'range', 'range'],
                    losses: ['downtrend', 'downtrend', 'range', 'range'],
                },
            ],
        ]);
        const separations = computeFeatureSeparations(splits);
        expect(separations).toHaveLength(1);
        expect(separations[0].separationScore).toBeGreaterThan(0);
        expect(separations[0].categoricalSummary).toBeDefined();
    });

    it('降順でソートされる', () => {
        const splits = new Map([
            ['A::x', { wins: [1, 2, 1, 2, 1], losses: [2, 3, 2, 3, 2] }], // 弱い分離
            ['B::y', { wins: [10, 11, 12, 10, 11], losses: [0, 1, 0, 1, 0] }], // 強い分離
        ]);
        const separations = computeFeatureSeparations(splits);
        expect(separations[0].lensName).toBe('B');
        expect(separations[0].separationScore).toBeGreaterThan(separations[1].separationScore);
    });
});

describe('cohensD', () => {
    it('分布が同じなら 0', () => {
        expect(cohensD([1, 2, 3], [1, 2, 3])).toBe(0);
    });

    it('分布が離れるほど大きい', () => {
        const d1 = Math.abs(cohensD([10, 11, 12], [5, 6, 7]));
        const d2 = Math.abs(cohensD([10, 11, 12], [1, 2, 3]));
        expect(d2).toBeGreaterThan(d1);
    });

    it('空配列は 0', () => {
        expect(cohensD([], [1, 2])).toBe(0);
    });
});

describe('categoricalSeparation', () => {
    it('ベース勝率と同じなら 0', () => {
        expect(
            categoricalSeparation({
                baseWinRate: 0.5,
                conditionalWinRate: { A: 0.5, B: 0.5 },
            }),
        ).toBe(0);
    });

    it('最大の乖離を返す', () => {
        expect(
            categoricalSeparation({
                baseWinRate: 0.5,
                conditionalWinRate: { A: 0.7, B: 0.4 },
            }),
        ).toBeCloseTo(0.2, 5);
    });
});
