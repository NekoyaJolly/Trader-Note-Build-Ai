/**
 * WalkForwardTool のテスト (Critical-4 段階 1.5: ScreeningBacktestRun 経由)
 *
 * ユニット: PythonBridge / ScreeningBacktestRunRepository をモックして判定ロジックを検証
 * 統合: env RUN_PYTHON_INTEGRATION=1 のとき実コンテナに向けて疎通
 */

import { WalkForwardTool } from '../../validation/tools/WalkForwardTool';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';
import type { ScreeningBacktestTrade } from '../../../schemas/external/analysisEngine';

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

/**
 * ScreeningBacktestRun 風のレコードを Prisma JSON 形式 (trades は Json) で返す。
 * 実 DB の Prisma モデルでは trades は JsonValue。テスト用に最小限の構造で OK。
 */
function makeRunRecord(pnls: number[]) {
    const trades: ScreeningBacktestTrade[] = pnls.map((pnl, i) => ({
        entryTime: new Date(2025, 5, i + 1).toISOString(),
        entryPrice: 2000,
        exitTime: new Date(2025, 5, i + 2).toISOString(),
        exitPrice: 2000 + pnl,
        side: 'long',
        pnl,
        outcome: pnl > 0 ? 'win' : 'loss',
    }));
    return {
        id: 'sbt-1',
        hypothesisId: 'hyp-wf-1',
        symbol: 'XAUUSD',
        timeframe: '15m',
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-12-31'),
        notePayload: {} as unknown,
        summary: { pf: 1.0, winRate: 0.5, tradeCount: pnls.length },
        trades, // ← Prisma 上は JsonValue だが、fromPrismaJsonValue が unknown を返すので型は緩く
        equity: null,
        engineVersion: 'analysis-engine/backtesting.py@0.6.5',
        createdAt: new Date(),
    };
}

const basicInput = {
    kind: 'hypothesis' as const,
    hypothesis: makeHypothesis(),
    period: { start: '2025-01-01', end: '2025-12-31' },
    screeningBacktestRunId: 'sbt-1',
};

describe('WalkForwardTool.execute (unit)', () => {
    it('screeningBacktestRunId 未指定なら success=false', async () => {
        const bridge = { execute: jest.fn(), healthCheck: jest.fn() };
        const repo = { findById: jest.fn(), create: jest.fn(), findByHypothesis: jest.fn() };
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
        const res = await tool.execute({ ...basicInput, screeningBacktestRunId: '' });
        expect(res.success).toBe(false);
        expect(res.error).toContain('screeningBacktestRunId');
        expect(bridge.execute).not.toHaveBeenCalled();
    });

    it('ScreeningBacktestRun が見つからなければ success=false', async () => {
        const bridge = { execute: jest.fn(), healthCheck: jest.fn() };
        const repo = {
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(false);
        expect(res.error).toContain('見つからない');
    });

    it('トレード数不足(<20)なら passed=false / reason=insufficient_trades', async () => {
        const repo = {
            findById: jest.fn().mockResolvedValue(makeRunRecord([10, -5, 3])),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
        const bridge = { execute: jest.fn(), healthCheck: jest.fn() };
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(false);
        expect(res.metrics.reason).toBe('insufficient_trades');
        expect(bridge.execute).not.toHaveBeenCalled();
    });

    it('Python が overfitScore < 0.3 を返すなら passed=true', async () => {
        const pnls = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 10 : -5));
        const repo = {
            findById: jest.fn().mockResolvedValue(makeRunRecord(pnls)),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
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
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(true);
        expect(res.metrics.overfitScore).toBe(0.15);
        expect(res.metrics.avgInSampleWinRate).toBe(0.55);
    });

    it('Python が overfitScore >= 0.3 を返すなら passed=false', async () => {
        const pnls = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 10 : -5));
        const repo = {
            findById: jest.fn().mockResolvedValue(makeRunRecord(pnls)),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
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
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
        const res = await tool.execute(basicInput);
        expect(res.passed).toBe(false);
        expect(res.interpretation).toContain('過学習');
    });

    it('Python 実行失敗なら success=false', async () => {
        const pnls = Array.from({ length: 30 }, () => 5);
        const repo = {
            findById: jest.fn().mockResolvedValue(makeRunRecord(pnls)),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
        const bridge = {
            execute: jest.fn().mockResolvedValue({
                success: false,
                error: 'timeout',
                durationMs: 300000,
            }),
            healthCheck: jest.fn(),
        };
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(false);
        expect(res.error).toContain('timeout');
    });

    it('Python 出力形式が不正なら success=false', async () => {
        const pnls = Array.from({ length: 30 }, () => 5);
        const repo = {
            findById: jest.fn().mockResolvedValue(makeRunRecord(pnls)),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
        const bridge = {
            execute: jest.fn().mockResolvedValue({
                success: true,
                output: { garbage: 'yes' },
                durationMs: 10,
            }),
            healthCheck: jest.fn(),
        };
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
        const res = await tool.execute(basicInput);
        expect(res.success).toBe(false);
        expect(res.error).toContain('出力形式');
    });

    it('windowsEvaluated=0 なら passed=false / reason=insufficient_windows', async () => {
        const pnls = Array.from({ length: 30 }, () => 5);
        const repo = {
            findById: jest.fn().mockResolvedValue(makeRunRecord(pnls)),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
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
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
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
        const repo = { findById: jest.fn(), create: jest.fn(), findByHypothesis: jest.fn() };
        const tool = new WalkForwardTool(
            bridge as unknown as ConstructorParameters<typeof WalkForwardTool>[0],
            repo,
        );
        expect(await tool.isAvailable()).toBe(true);
        expect(bridge.healthCheck).toHaveBeenCalled();
    });
});

// ===========================================
// 統合テスト(実 Docker)
// ===========================================

const integrationEnabled = process.env.RUN_PYTHON_INTEGRATION === '1';
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('WalkForwardTool (integration with real Python container)', () => {
    it('均等分布トレードなら overfitScore が 0 近傍で passed=true', async () => {
        // 均等分布: 各窓で win/loss が同じ比率 → 理想的に overfitScore=0
        const pnls = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 10 : -5));
        const trades: ScreeningBacktestTrade[] = pnls.map((pnl, i) => ({
            entryTime: new Date(
                new Date('2025-01-01').getTime() +
                    (i * 365 * 24 * 60 * 60 * 1000) / 32,
            ).toISOString(),
            entryPrice: 2000,
            exitTime: new Date(
                new Date('2025-01-01').getTime() +
                    ((i + 1) * 365 * 24 * 60 * 60 * 1000) / 32,
            ).toISOString(),
            exitPrice: 2000 + pnl,
            side: 'long',
            pnl,
            outcome: pnl > 0 ? 'win' : 'loss',
        }));

        const run = {
            id: 'sbt-int-1',
            hypothesisId: 'hyp-wf-1',
            symbol: 'XAUUSD',
            timeframe: '15m',
            periodStart: new Date('2025-01-01'),
            periodEnd: new Date('2025-12-31'),
            notePayload: {} as unknown,
            summary: { pf: 1.0, winRate: 0.5, tradeCount: trades.length },
            trades,
            equity: null,
            engineVersion: 'analysis-engine/backtesting.py@0.6.5',
            createdAt: new Date(),
        };

        const repo = {
            findById: jest.fn().mockResolvedValue(run),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
        const tool = new WalkForwardTool(
            undefined,
            repo,
        );
        const res = await tool.execute({
            ...basicInput,
            screeningBacktestRunId: 'sbt-int-1',
        });
        expect(res.success).toBe(true);
        expect(res.passed).toBe(true);
        expect(res.metrics.overfitScore).toBeCloseTo(0, 5);
    }, 30000);
});
