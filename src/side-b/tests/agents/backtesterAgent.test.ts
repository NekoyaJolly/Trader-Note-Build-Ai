/**
 * BacktesterAgent のテスト（Phase 4c Step D）
 *
 * 3 ツールをモックで注入し、並列実行の集約・部分失敗の扱い・
 * Phase 4b screening の流用挙動を検証する。
 */

import { BacktesterAgent } from '../../agents/BacktesterAgent';
import type { EdgeHypothesis, ScreeningResult } from '../../models/edgeHypothesis';
import type { ValidationTool, ValidationToolResult } from '../../validation/tools/types';

function makeTool(name: string, result: Partial<ValidationToolResult>): ValidationTool & { execute: jest.Mock } {
    return {
        name,
        implementation: 'native_ts',
        requiredInputs: ['kind', 'hypothesis'],
        execute: jest.fn().mockResolvedValue({
            toolName: name,
            success: true,
            passed: true,
            metrics: {},
            durationMs: 1,
            ...result,
        }),
        isAvailable: jest.fn().mockResolvedValue(true),
    };
}

function makeHypothesis(screeningResult?: ScreeningResult): EdgeHypothesis {
    return {
        id: 'hyp-bt-1',
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
        screeningResult,
    };
}

const goodScreening: ScreeningResult = {
    executedAt: new Date().toISOString(),
    tradeNoteId: 'note-1',
    passed: true,
    metrics: { pf: 1.5, winRate: 0.6, tradeCount: 30 },
    backtestRunId: 'run-abc',
};

const period = { start: '2025-01-01', end: '2025-12-31' };

describe('BacktesterAgent.runFullValidation', () => {
    it('4 ツール全 passed の場合 allPassed=true / passedCount=4', async () => {
        const tools = {
            walkForward: makeTool('walk_forward', { passed: true }),
            monteCarlo: makeTool('monte_carlo', { passed: true }),
            buyAndHold: makeTool('buy_and_hold', { passed: true }),
        };
        const agent = new BacktesterAgent(tools);

        const report = await agent.runFullValidation(makeHypothesis(goodScreening), 'note-1', period);

        expect(report.allPassed).toBe(true);
        expect(report.passedCount).toBe(4);
        expect(report.totalCount).toBe(4);
        expect(report.errors).toEqual([]);
        expect(report.screening?.passed).toBe(true);
        expect(report.walkForward?.passed).toBe(true);
        expect(report.monteCarlo?.passed).toBe(true);
        expect(report.buyAndHold?.passed).toBe(true);
    });

    it('backtestRunId を下位ツールに伝搬する', async () => {
        const tools = {
            walkForward: makeTool('walk_forward', { passed: true }),
            monteCarlo: makeTool('monte_carlo', { passed: true }),
            buyAndHold: makeTool('buy_and_hold', { passed: true }),
        };
        const agent = new BacktesterAgent(tools);

        await agent.runFullValidation(makeHypothesis(goodScreening), 'note-1', period);

        for (const tool of [tools.walkForward, tools.monteCarlo, tools.buyAndHold]) {
            expect(tool.execute).toHaveBeenCalledTimes(1);
            const arg = tool.execute.mock.calls[0]![0]!;
            expect(arg.kind).toBe('hypothesis');
            expect(arg.backtestRunId).toBe('run-abc');
        }
    });

    it('Promise reject した 1 ツールは errors に入り、他ツール結果は保持', async () => {
        const tools = {
            walkForward: {
                name: 'walk_forward',
                implementation: 'python_bridge' as const,
                requiredInputs: ['kind', 'hypothesis'] as const,
                execute: jest.fn().mockRejectedValue(new Error('Python container down')),
                isAvailable: jest.fn().mockResolvedValue(false),
            },
            monteCarlo: makeTool('monte_carlo', { passed: true }),
            buyAndHold: makeTool('buy_and_hold', { passed: true }),
        };
        const agent = new BacktesterAgent(tools);

        const report = await agent.runFullValidation(makeHypothesis(goodScreening), 'note-1', period);

        expect(report.walkForward).toBeUndefined();
        expect(report.monteCarlo?.passed).toBe(true);
        expect(report.buyAndHold?.passed).toBe(true);
        expect(report.errors).toEqual(
            expect.arrayContaining([expect.stringContaining('walkForward')]),
        );
        expect(report.allPassed).toBe(false);
    });

    it('success=false を返したツールは errors に理由が入り passed=false', async () => {
        const tools = {
            walkForward: makeTool('walk_forward', {
                success: false,
                passed: false,
                error: 'timeout',
            }),
            monteCarlo: makeTool('monte_carlo', { passed: true }),
            buyAndHold: makeTool('buy_and_hold', { passed: true }),
        };
        const agent = new BacktesterAgent(tools);

        const report = await agent.runFullValidation(makeHypothesis(goodScreening), 'note-1', period);
        expect(report.allPassed).toBe(false);
        expect(report.errors.some((e) => e.includes('timeout'))).toBe(true);
    });

    it('1 ツールが passed=false なら allPassed=false', async () => {
        const tools = {
            walkForward: makeTool('walk_forward', { passed: false }),
            monteCarlo: makeTool('monte_carlo', { passed: true }),
            buyAndHold: makeTool('buy_and_hold', { passed: true }),
        };
        const agent = new BacktesterAgent(tools);

        const report = await agent.runFullValidation(makeHypothesis(goodScreening), 'note-1', period);
        expect(report.allPassed).toBe(false);
        expect(report.passedCount).toBe(3);
    });

    it('screeningResult が無い仮説は screening=undefined / allPassed=false', async () => {
        const tools = {
            walkForward: makeTool('walk_forward', { passed: true }),
            monteCarlo: makeTool('monte_carlo', { passed: true }),
            buyAndHold: makeTool('buy_and_hold', { passed: true }),
        };
        const agent = new BacktesterAgent(tools);

        const report = await agent.runFullValidation(makeHypothesis(undefined), 'note-1', period);
        expect(report.screening).toBeUndefined();
        expect(report.allPassed).toBe(false);
        expect(report.passedCount).toBe(3);
    });

    it('screeningResult.passed=false なら screening.passed=false / allPassed=false', async () => {
        const rejected: ScreeningResult = {
            ...goodScreening,
            passed: false,
            reasons: ['PF不足'],
        };
        const tools = {
            walkForward: makeTool('walk_forward', { passed: true }),
            monteCarlo: makeTool('monte_carlo', { passed: true }),
            buyAndHold: makeTool('buy_and_hold', { passed: true }),
        };
        const agent = new BacktesterAgent(tools);

        const report = await agent.runFullValidation(makeHypothesis(rejected), 'note-1', period);
        expect(report.screening?.passed).toBe(false);
        expect(report.allPassed).toBe(false);
        expect(report.screening?.interpretation).toContain('PF不足');
    });

    it('report.hypothesisId / periodUsed / startedAt / completedAt が埋まる', async () => {
        const tools = {
            walkForward: makeTool('walk_forward', { passed: true }),
            monteCarlo: makeTool('monte_carlo', { passed: true }),
            buyAndHold: makeTool('buy_and_hold', { passed: true }),
        };
        const agent = new BacktesterAgent(tools);

        const report = await agent.runFullValidation(makeHypothesis(goodScreening), 'note-1', period);
        expect(report.hypothesisId).toBe('hyp-bt-1');
        expect(report.periodUsed).toEqual(period);
        expect(typeof report.startedAt).toBe('string');
        expect(typeof report.completedAt).toBe('string');
        expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('3 ツールは並列実行される（各 executeが呼ばれる）', async () => {
        const executionOrder: string[] = [];
        function makeDelayedTool(name: string, delayMs: number): ValidationTool {
            return {
                name,
                implementation: 'native_ts',
                requiredInputs: ['kind', 'hypothesis'],
                execute: jest.fn(async () => {
                    await new Promise((r) => setTimeout(r, delayMs));
                    executionOrder.push(name);
                    return {
                        toolName: name,
                        success: true,
                        passed: true,
                        metrics: {},
                        durationMs: delayMs,
                    };
                }),
                isAvailable: jest.fn().mockResolvedValue(true),
            };
        }

        const tools = {
            walkForward: makeDelayedTool('walk_forward', 30),
            monteCarlo: makeDelayedTool('monte_carlo', 10),
            buyAndHold: makeDelayedTool('buy_and_hold', 20),
        };
        const agent = new BacktesterAgent(tools);
        await agent.runFullValidation(makeHypothesis(goodScreening), 'note-1', period);

        // 並列実行なら完了が早い順(10ms → 20ms → 30ms)になる。
        // 直列だと開始順(walk_forward → monte_carlo → buy_and_hold)に並ぶので、
        // 完了順が遅延昇順と一致することが並列性の決定的な証明になる。
        // (壁時計の比較は CI 環境依存で flaky になりがちなので使わない)
        expect(executionOrder).toEqual(['monte_carlo', 'buy_and_hold', 'walk_forward']);
    });
});
