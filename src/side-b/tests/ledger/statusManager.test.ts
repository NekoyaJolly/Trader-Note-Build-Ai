/**
 * StatusManager のテスト（Phase 4b: WF only ロジック）
 */

import {
    StatusManager,
    PROMOTION_THRESHOLDS,
} from '../../ledger/statusManager';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';

function makeHypothesis(overrides?: Partial<EdgeHypothesis>): EdgeHypothesis {
    const base: EdgeHypothesis = {
        id: 'h1',
        statement: 'レンジ下限で反発しやすい',
        category: 'level',
        conditions: [],
        expectedDirection: 'long',
        status: 'unverified',
        statusUpdatedAt: new Date(),
        symbols: ['XAUUSD'],
        timeframes: ['15m'],
        observationCount: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalPnlPips: 0,
        avgRR: 0,
        source: 'ai_generated',
        firstObservedAt: new Date(),
        lastObservedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    return { ...base, ...overrides };
}

describe('StatusManager.canPromoteToConfirmed (Phase 4b: WF only)', () => {
    let sm: StatusManager;

    beforeEach(() => {
        sm = new StatusManager();
    });

    it('ウォークフォワード未実施なら ok=false', () => {
        const h = makeHypothesis();
        const result = sm.canPromoteToConfirmed(h);
        expect(result.ok).toBe(false);
        expect(result.reasons).toEqual(
            expect.arrayContaining([expect.stringContaining('ウォークフォワード')]),
        );
    });

    it('avgInSamplePF 不足で ok=false', () => {
        const h = makeHypothesis({
            walkForwardResults: {
                overfitScore: 0.2,
                avgInSampleWinRate: 0.55,
                avgOutOfSampleWinRate: 0.54,
                avgInSamplePF: 1.2,
                avgOutOfSamplePF: 1.5,
                totalTradeCount: 50,
                runAt: new Date(),
            },
        });
        const result = sm.canPromoteToConfirmed(h);
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('学習期間 PF'))).toBe(true);
    });

    it('avgOutOfSamplePF 不足で ok=false', () => {
        const h = makeHypothesis({
            walkForwardResults: {
                overfitScore: 0.2,
                avgInSampleWinRate: 0.55,
                avgOutOfSampleWinRate: 0.5,
                avgInSamplePF: 1.8,
                avgOutOfSamplePF: 1.1,
                totalTradeCount: 50,
                runAt: new Date(),
            },
        });
        const result = sm.canPromoteToConfirmed(h);
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('検証期間 PF'))).toBe(true);
    });

    it('過学習スコア超過で ok=false', () => {
        const h = makeHypothesis({
            walkForwardResults: {
                overfitScore: 0.5,
                avgInSampleWinRate: 0.65,
                avgOutOfSampleWinRate: 0.45,
                avgInSamplePF: 2.0,
                avgOutOfSamplePF: 1.5,
                totalTradeCount: 50,
                runAt: new Date(),
            },
        });
        const result = sm.canPromoteToConfirmed(h);
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('過学習'))).toBe(true);
    });

    it('総トレード数不足で ok=false', () => {
        const h = makeHypothesis({
            walkForwardResults: {
                overfitScore: 0.15,
                avgInSampleWinRate: 0.6,
                avgOutOfSampleWinRate: 0.58,
                avgInSamplePF: 1.7,
                avgOutOfSamplePF: 1.4,
                totalTradeCount: 10,
                runAt: new Date(),
            },
        });
        const result = sm.canPromoteToConfirmed(h);
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('総トレード数'))).toBe(true);
    });

    it('全条件クリアで ok=true', () => {
        const h = makeHypothesis({
            walkForwardResults: {
                overfitScore: 0.15,
                avgInSampleWinRate: 0.6,
                avgOutOfSampleWinRate: 0.58,
                avgInSamplePF: 1.7,
                avgOutOfSamplePF: 1.4,
                totalTradeCount: 100,
                runAt: new Date(),
            },
        });
        const result = sm.canPromoteToConfirmed(h);
        expect(result.ok).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it('avgInSamplePF / avgOutOfSamplePF が undefined だと欠落として扱う', () => {
        const h = makeHypothesis({
            walkForwardResults: {
                overfitScore: 0.15,
                avgInSampleWinRate: 0.6,
                avgOutOfSampleWinRate: 0.58,
                totalTradeCount: 100,
                runAt: new Date(),
            },
        });
        const result = sm.canPromoteToConfirmed(h);
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('avgInSamplePF'))).toBe(true);
        expect(result.reasons.some((r) => r.includes('avgOutOfSamplePF'))).toBe(true);
    });

    it('閾値は CLAUDE.md 規定値を使用', () => {
        expect(PROMOTION_THRESHOLDS.trainingPF).toBe(1.5);
        expect(PROMOTION_THRESHOLDS.validationPF).toBe(1.3);
        expect(PROMOTION_THRESHOLDS.overfitScore).toBe(0.3);
    });
});

describe('StatusManager.shouldMarkStale', () => {
    let sm: StatusManager;

    beforeEach(() => {
        sm = new StatusManager();
    });

    it('観測数が不足していたら yes=false', () => {
        const h = makeHypothesis({ observationCount: 5 });
        expect(sm.shouldMarkStale(h).yes).toBe(false);
    });

    it('期待勝率がなければ yes=false', () => {
        const h = makeHypothesis({
            observationCount: 20,
            winCount: 5,
            lossCount: 15,
        });
        expect(sm.shouldMarkStale(h).yes).toBe(false);
    });

    it('WF の avgOutOfSampleWinRate を期待値として使う（Phase 4b）', () => {
        const h = makeHypothesis({
            observationCount: 20,
            winCount: 5,
            lossCount: 15,
            walkForwardResults: {
                overfitScore: 0.15,
                avgInSampleWinRate: 0.65,
                avgOutOfSampleWinRate: 0.6,
                avgInSamplePF: 1.7,
                avgOutOfSamplePF: 1.4,
                totalTradeCount: 100,
                runAt: new Date(),
            },
        });
        const res = sm.shouldMarkStale(h);
        expect(res.yes).toBe(true);
        expect(res.reason).toContain('実績勝率');
    });

    it('Phase 4a の backtestResults.winRate にもフォールバック', () => {
        const h = makeHypothesis({
            observationCount: 20,
            winCount: 5,
            lossCount: 15,
            backtestResults: { pf: 1.8, winRate: 0.6, tradeCount: 100, runAt: new Date() },
        });
        const res = sm.shouldMarkStale(h);
        expect(res.yes).toBe(true);
    });

    it('勝率が許容範囲内なら yes=false', () => {
        const h = makeHypothesis({
            observationCount: 20,
            winCount: 11,
            lossCount: 9,
            walkForwardResults: {
                overfitScore: 0.15,
                avgInSampleWinRate: 0.65,
                avgOutOfSampleWinRate: 0.6,
                avgInSamplePF: 1.7,
                avgOutOfSamplePF: 1.4,
                totalTradeCount: 100,
                runAt: new Date(),
            },
        });
        expect(sm.shouldMarkStale(h).yes).toBe(false);
    });
});
