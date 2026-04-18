/**
 * WalkForwardTool のテスト（Phase 4c Step C）
 *
 * ユニット: PythonBridge / BacktestService をモックして判定ロジックを検証
 * 統合: env RUN_PYTHON_INTEGRATION=1 のとき実コンテナに向けて疎通
 */

import { WalkForwardTool } from '../../validation/tools/WalkForwardTool';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';

function makeHypothesis(): EdgeHypothesis {
    return {
        id: 'hyp-wf-1',
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

function makeSummary(eventsPnls: number[]) {
    return {
        runId: 'run-1',
        status: 'completed' as const,
        setupCount: eventsPnls.length,
        winCount: eventsPnls.filter((p) => p > 0).length,
        lossCount: eventsPnls.filter((p) => p < 0).length,
        timeoutCount: 0,
        winRate: 0,
        profitFactor: null,
        totalProfit: 0,
        totalLoss: 0,
        averagePnL: 0,
        expectancy: 0,
        maxDrawdown: null,
        events: eventsPnls.map((pnl, i) => ({
            entryTime: new Date(2025, 5, i + 1).toISOString(),
            entryPrice: 2000,
            matchScore: 0.7,
            exitTime: new Date(2025, 5, i + 2).toISOString(),
            exitPrice: 2000 + pnl,
            outcome: (pnl > 0 ? 'win' : 'loss') as 'win' | 'loss',
            pnl,
            holdingMinutes: 60,
        })),
    };
}

const basicInput = {
    hypothesis: makeHypothesis(),
    tradeNoteId: 'note-1',
    period: { start: '2025-01-01', end: '2025-12-31' },
    backtestRunId: 'run-1',
};

describe('WalkForwardTool.execute (unit)', () => {
    it('backtestRunId 未指定なら success=false', async () => {
        const bridge = { execute: jest.fn(), healthCheck: jest.fn() };
        const bt = { getResult: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        const res = await tool.execute({ ...basicInput, backtestRunId: undefined });
        expect(res.success).toBe(false);
        expect(res.error).toContain('backtestRunId');
        expect(bridge.execute).not.toHaveBeenCalled();
    });

    it('BT 結果が null なら success=false', async () => {
        const bridge = { execute: jest.fn(), healthCheck: jest.fn() };
        const bt = { getResult: jest.fn().mockResolvedValue(null) };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(false);
    });

    it('トレード数不足（<20）なら passed=false / reason=insufficient_trades', async () => {
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary([10, -5, 3])) };
        const bridge = { execute: jest.fn(), healthCheck: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(false);
        expect(res.metrics.reason).toBe('insufficient_trades');
        expect(bridge.execute).not.toHaveBeenCalled();
    });

    it('Python が overfitScore < 0.3 を返すなら passed=true', async () => {
        const pnls = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 10 : -5));
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(pnls)) };
        const bridge = {
            execute: jest.fn().mockResolvedValue({
                success: true,
                output: {
                    overfitScore: 0.15,
                    avgInSampleWinRate: 0.55,
                    avgOutOfSampleWinRate: 0.5,
                    inSamplePF: 1.8,
                    outOfSamplePF: 1.6,
                    splitCount: 4,
                    totalTradeCount: 30,
                    windowsEvaluated: 4,
                },
                durationMs: 50,
            }),
            healthCheck: jest.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(true);
        expect(res.metrics.overfitScore).toBe(0.15);
        expect(res.metrics.avgInSampleWinRate).toBe(0.55);
    });

    it('Python が overfitScore >= 0.3 を返すなら passed=false', async () => {
        const pnls = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 10 : -5));
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(pnls)) };
        const bridge = {
            execute: jest.fn().mockResolvedValue({
                success: true,
                output: {
                    overfitScore: 0.45,
                    avgInSampleWinRate: 0.8,
                    avgOutOfSampleWinRate: 0.35,
                    inSamplePF: 3.0,
                    outOfSamplePF: 0.9,
                    splitCount: 4,
                    totalTradeCount: 30,
                    windowsEvaluated: 4,
                },
                durationMs: 40,
            }),
            healthCheck: jest.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        const res = await tool.execute(basicInput);
        expect(res.passed).toBe(false);
        expect(res.interpretation).toContain('過学習');
    });

    it('Python 実行失敗なら success=false', async () => {
        const pnls = Array.from({ length: 30 }, () => 5);
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(pnls)) };
        const bridge = {
            execute: jest.fn().mockResolvedValue({
                success: false,
                error: 'timeout',
                durationMs: 300000,
            }),
            healthCheck: jest.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(false);
        expect(res.error).toContain('timeout');
    });

    it('Python 出力形式が不正なら success=false', async () => {
        const pnls = Array.from({ length: 30 }, () => 5);
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(pnls)) };
        const bridge = {
            execute: jest.fn().mockResolvedValue({
                success: true,
                output: { garbage: 'yes' },
                durationMs: 10,
            }),
            healthCheck: jest.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(false);
        expect(res.error).toContain('出力形式');
    });

    it('windowsEvaluated=0 なら passed=false / reason=insufficient_windows', async () => {
        const pnls = Array.from({ length: 30 }, () => 5);
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(pnls)) };
        const bridge = {
            execute: jest.fn().mockResolvedValue({
                success: true,
                output: {
                    overfitScore: null,
                    avgInSampleWinRate: null,
                    avgOutOfSampleWinRate: null,
                    inSamplePF: null,
                    outOfSamplePF: null,
                    splitCount: 4,
                    totalTradeCount: 30,
                    windowsEvaluated: 0,
                },
                durationMs: 10,
            }),
            healthCheck: jest.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(false);
        expect(res.metrics.reason).toBe('insufficient_windows');
    });

    it('isAvailable は PythonBridge.healthCheck を委譲する', async () => {
        const bridge = {
            execute: jest.fn(),
            healthCheck: jest.fn().mockResolvedValue(true),
        };
        const bt = { getResult: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(bridge as any, bt as any);
        expect(await tool.isAvailable()).toBe(true);
        expect(bridge.healthCheck).toHaveBeenCalled();
    });
});

// ===========================================
// 統合テスト（実 Docker）
// ===========================================

const integrationEnabled = process.env.RUN_PYTHON_INTEGRATION === '1';
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('WalkForwardTool (integration with real Python container)', () => {
    it('均等分布イベントなら overfitScore が 0 近傍で passed=true', async () => {
        // 均等分布: 各窓で win/loss が同じ比率 → 理想的に overfitScore=0
        // 32件 [10, -5, 10, -5, ...] を期間にわたり均等配置
        const pnls = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 10 : -5));
        const events = pnls.map((pnl, i) => ({
            entryTime: new Date(
                new Date('2025-01-01').getTime() +
                    (i * 365 * 24 * 60 * 60 * 1000) / 32,
            ).toISOString(),
            entryPrice: 2000,
            matchScore: 0.7,
            exitTime: new Date(
                new Date('2025-01-01').getTime() +
                    ((i + 1) * 365 * 24 * 60 * 60 * 1000) / 32,
            ).toISOString(),
            exitPrice: 2000 + pnl,
            outcome: (pnl > 0 ? 'win' : 'loss') as 'win' | 'loss',
            pnl,
            holdingMinutes: 60,
        }));

        const summary = {
            runId: 'run-int-1',
            status: 'completed' as const,
            setupCount: events.length,
            winCount: 16,
            lossCount: 16,
            timeoutCount: 0,
            winRate: 0.5,
            profitFactor: null,
            totalProfit: 0,
            totalLoss: 0,
            averagePnL: 0,
            expectancy: 0,
            maxDrawdown: null,
            events,
        };

        const bt = { getResult: jest.fn().mockResolvedValue(summary) };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new WalkForwardTool(undefined, bt as any);
        const res = await tool.execute({
            ...basicInput,
            backtestRunId: 'run-int-1',
        });
        expect(res.success).toBe(true);
        expect(res.passed).toBe(true);
        expect(res.metrics.overfitScore).toBeCloseTo(0, 5);
    }, 30000);
});
