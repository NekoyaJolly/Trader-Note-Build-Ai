/**
 * MonteCarloTool のテスト（Phase 4c）
 */

import { MonteCarloTool, shuffle, simulatePath, percentile } from '../../validation/tools/MonteCarloTool';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';

// 決定的乱数（LCG）
function makeSeededRng(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 2 ** 32;
        return state / 2 ** 32;
    };
}

function makeHypothesis(): EdgeHypothesis {
    return {
        id: 'hyp-mc-1',
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

/** 指定 PnL 列を持つ ScreeningBacktestRun レコードのモックを作る */
function makeRunRecord(pnls: number[]) {
    return {
        id: 'sbt-1',
        hypothesisId: 'hyp-mc-1',
        symbol: 'XAUUSD',
        timeframe: '15m',
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-12-31'),
        notePayload: {} as unknown,
        summary: { pf: 1.0, winRate: 0.5, tradeCount: pnls.length },
        trades: pnls.map((pnl, i) => ({
            entryTime: new Date(2026, 0, i + 1).toISOString(),
            entryPrice: 2000,
            exitTime: new Date(2026, 0, i + 2).toISOString(),
            exitPrice: 2000 + pnl,
            side: 'long' as const,
            pnl,
            outcome: (pnl > 0 ? 'win' : 'loss'),
        })),
        equity: null,
        engineVersion: 'analysis-engine/backtesting.py@0.6.5',
        createdAt: new Date(),
    };
}

describe('simulatePath', () => {
    it('空配列なら finalPnl=0, maxDrawdown=0', () => {
        expect(simulatePath([])).toEqual({ finalPnl: 0, maxDrawdown: 0 });
    });

    it('単調増加なら maxDrawdown=0', () => {
        const r = simulatePath([10, 10, 10]);
        expect(r.finalPnl).toBe(30);
        expect(r.maxDrawdown).toBe(0);
    });

    it('途中で下落があれば maxDrawdown に反映', () => {
        // peak 30 → 次で -20 → drawdown = 20
        const r = simulatePath([10, 10, 10, -20, 5]);
        expect(r.finalPnl).toBe(15);
        expect(r.maxDrawdown).toBe(20);
    });
});

describe('percentile', () => {
    it('空配列なら NaN', () => {
        expect(Number.isNaN(percentile([], 0.5))).toBe(true);
    });

    it('中央値を取り出せる', () => {
        const sorted = [1, 2, 3, 4, 5];
        expect(percentile(sorted, 0.5)).toBe(3);
    });

    it('q=0 で最小、q=1 で最大', () => {
        const sorted = [1, 2, 3, 4, 5];
        expect(percentile(sorted, 0)).toBe(1);
        expect(percentile(sorted, 1)).toBe(5);
    });
});

describe('shuffle', () => {
    it('同じ要素集合を保持する', () => {
        const rng = makeSeededRng(42);
        const out = shuffle([1, 2, 3, 4, 5], rng);
        expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('決定的 RNG で同じ出力になる', () => {
        const a = shuffle([1, 2, 3, 4, 5], makeSeededRng(123));
        const b = shuffle([1, 2, 3, 4, 5], makeSeededRng(123));
        expect(a).toEqual(b);
    });
});

describe('MonteCarloTool.execute', () => {
    const input = {
        kind: 'hypothesis' as const,
        hypothesis: makeHypothesis(),
        period: { start: '2025-01-01', end: '2025-12-31' },
        screeningBacktestRunId: 'sbt-1',
    };

    function makeRepo(pnls: number[] | null) {
        return {
            findById: jest.fn().mockResolvedValue(pnls === null ? null : makeRunRecord(pnls)),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
    }

    it('screeningBacktestRunId 未指定なら success=false', async () => {
        const tool = new MonteCarloTool();
        const res = await tool.execute({ ...input, screeningBacktestRunId: '' });
        expect(res.success).toBe(false);
        expect(res.passed).toBe(false);
        expect(res.error).toContain('screeningBacktestRunId');
    });

    it('ScreeningBacktestRun が見つからなければ success=false', async () => {
        const repo = makeRepo(null);
        const tool = new MonteCarloTool(
            repo,
        );
        const res = await tool.execute(input);
        expect(res.success).toBe(false);
        expect(res.error).toContain('見つからない');
    });

    it('トレード数不足なら passed=false / reason=insufficient_trades', async () => {
        const repo = makeRepo([10, -5, 3]);
        const tool = new MonteCarloTool(
            repo,
            {
                rng: makeSeededRng(1),
                simulationCount: 100,
            },
        );
        const res = await tool.execute(input);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(false);
        expect(res.metrics.reason).toBe('insufficient_trades');
    });

    it('全トレードが正の PnL なら passed=true(下側5%も正)', async () => {
        const pnls = Array.from({ length: 30 }, () => 5);
        const repo = makeRepo(pnls);
        const tool = new MonteCarloTool(
            repo,
            {
                rng: makeSeededRng(7),
                simulationCount: 200,
            },
        );
        const res = await tool.execute(input);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(true);
        expect(res.metrics.p5FinalPnl).toBeGreaterThan(0);
    });

    it('全トレードが負の PnL なら passed=false', async () => {
        const pnls = Array.from({ length: 30 }, () => -3);
        const repo = makeRepo(pnls);
        const tool = new MonteCarloTool(
            repo,
            {
                rng: makeSeededRng(7),
                simulationCount: 200,
            },
        );
        const res = await tool.execute(input);
        expect(res.passed).toBe(false);
        expect(res.metrics.p5FinalPnl).toBeLessThan(0);
    });

    it('metrics に tradeCount / simulationCount / p5 / p95 が入る', async () => {
        const pnls = [10, -5, 8, -3, 6, 12, -7, 2, 4, -1, 9, -2, 5, 7, -4, 11, -6, 3, 8, -3];
        const pnls30 = [...pnls, ...pnls.slice(0, 10)];
        const repo = makeRepo(pnls30);
        const tool = new MonteCarloTool(
            repo,
            {
                rng: makeSeededRng(42),
                simulationCount: 500,
            },
        );
        const res = await tool.execute(input);
        expect(res.success).toBe(true);
        expect(res.metrics.tradeCount).toBe(30);
        expect(res.metrics.simulationCount).toBe(500);
        expect(typeof res.metrics.p5FinalPnl).toBe('number');
        expect(typeof res.metrics.p95FinalPnl).toBe('number');
        expect(typeof res.metrics.medianMaxDrawdown).toBe('number');
    });

    // Critical-4 段階 4a.1: `kind: 'strategy'` 経路 (旧 `surrogateFitnessResult` 直接受け取り)
    // は撤廃済み。MonteCarloTool は ScreeningBacktestRun.id 経由の `kind: 'hypothesis'` のみで動く。
});
