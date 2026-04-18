/**
 * StatusManager.canPromoteToConfirmedFull のテスト（Phase 4c）
 *
 * 4ツール統合レポートに基づく confirmed 昇格判定の検証。
 */

import { StatusManager } from '../../ledger/statusManager';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';
import type { ConsolidatedValidationReport } from '../../validation/reports';
import type { ValidationToolResult } from '../../validation/tools/types';

function makeHypothesis(): EdgeHypothesis {
    return {
        id: 'hyp-full-1',
        statement: 'test',
        category: 'time',
        conditions: [],
        expectedDirection: 'long',
        status: 'screening_passed',
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
}

function makeToolResult(
    toolName: string,
    passed: boolean,
    metrics: Record<string, number | string | boolean> = {},
): ValidationToolResult {
    return {
        toolName,
        success: true,
        passed,
        metrics,
        durationMs: 10,
    };
}

function makeReport(overrides?: Partial<ConsolidatedValidationReport>): ConsolidatedValidationReport {
    const base: ConsolidatedValidationReport = {
        hypothesisId: 'hyp-full-1',
        periodUsed: { start: '2025-01-01', end: '2025-12-31' },
        screening: makeToolResult('screening', true, { tradeCount: 30, pf: 1.5, winRate: 0.6 }),
        walkForward: makeToolResult('walk_forward', true, { overfitScore: 0.2 }),
        monteCarlo: makeToolResult('monte_carlo', true, { p5FinalPnl: 15 }),
        buyAndHold: makeToolResult('buy_and_hold', true, { outperformance: 0.02 }),
        allPassed: true,
        passedCount: 4,
        totalCount: 4,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalDurationMs: 500,
        errors: [],
    };
    return { ...base, ...overrides };
}

describe('StatusManager.canPromoteToConfirmedFull', () => {
    let sm: StatusManager;

    beforeEach(() => {
        sm = new StatusManager();
    });

    it('4ツール全通過 & トレード数十分 なら ok=true', () => {
        const result = sm.canPromoteToConfirmedFull(makeHypothesis(), makeReport());
        expect(result.ok).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it('screening 未実施なら ok=false', () => {
        const result = sm.canPromoteToConfirmedFull(
            makeHypothesis(),
            makeReport({ screening: undefined }),
        );
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('スクリーニング'))).toBe(true);
    });

    it('walkForward not passed なら理由に過学習スコアが含まれる', () => {
        const result = sm.canPromoteToConfirmedFull(
            makeHypothesis(),
            makeReport({
                walkForward: makeToolResult('walk_forward', false, { overfitScore: 0.45 }),
            }),
        );
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('過学習'))).toBe(true);
    });

    it('monteCarlo not passed なら理由に下側5%PnLが含まれる', () => {
        const result = sm.canPromoteToConfirmedFull(
            makeHypothesis(),
            makeReport({
                monteCarlo: makeToolResult('monte_carlo', false, { p5FinalPnl: -12.5 }),
            }),
        );
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('MonteCarlo'))).toBe(true);
    });

    it('buyAndHold not passed なら理由に BH が含まれる', () => {
        const result = sm.canPromoteToConfirmedFull(
            makeHypothesis(),
            makeReport({
                buyAndHold: makeToolResult('buy_and_hold', false, { outperformance: -0.01 }),
            }),
        );
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('BuyAndHold'))).toBe(true);
    });

    it('walkForward 未実施なら理由に WalkForward が含まれる', () => {
        const result = sm.canPromoteToConfirmedFull(
            makeHypothesis(),
            makeReport({ walkForward: undefined }),
        );
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('WalkForward'))).toBe(true);
    });

    it('トレード数不足（< 20）なら ok=false', () => {
        const result = sm.canPromoteToConfirmedFull(
            makeHypothesis(),
            makeReport({
                screening: makeToolResult('screening', true, { tradeCount: 10 }),
            }),
        );
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('トレード数不足'))).toBe(true);
    });

    it('複数失敗が全て reasons に載る', () => {
        const result = sm.canPromoteToConfirmedFull(
            makeHypothesis(),
            makeReport({
                walkForward: makeToolResult('walk_forward', false, { overfitScore: 0.8 }),
                monteCarlo: makeToolResult('monte_carlo', false, { p5FinalPnl: -50 }),
            }),
        );
        expect(result.ok).toBe(false);
        expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    });
});
