/**
 * BuyAndHoldTool のテスト（Phase 4c）
 */

import { BuyAndHoldTool } from '../../validation/tools/BuyAndHoldTool';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';

function makeHypothesis(overrides?: Partial<EdgeHypothesis>): EdgeHypothesis {
    return {
        id: 'hyp-bh-1',
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
        ...overrides,
    };
}

/** totalPnl に相当する trades を持つ ScreeningBacktestRun レコードを作る */
function makeRunRecord(totalPnl: number, tradeCount: number = 20) {
    const perTrade = totalPnl / tradeCount;
    return {
        id: 'sbt-1',
        hypothesisId: 'hyp-bh-1',
        symbol: 'XAUUSD',
        timeframe: '15m',
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-12-31'),
        notePayload: {} as unknown,
        summary: { pf: 1.0, winRate: 1.0, tradeCount },
        trades: Array.from({ length: tradeCount }, (_, i) => ({
            entryTime: new Date(2026, 0, i + 1).toISOString(),
            entryPrice: 2000,
            exitTime: new Date(2026, 0, i + 2).toISOString(),
            exitPrice: 2000 + perTrade,
            side: 'long' as const,
            pnl: perTrade,
            outcome: 'win' as const,
        })),
        equity: null,
        engineVersion: 'analysis-engine/backtesting.py@0.6.5',
        createdAt: new Date(),
    };
}

function makeOhlcvRepo(firstClose: number | null, lastClose: number | null) {
    return {
        findMany: jest.fn(async (filter: { orderBy?: string; limit?: number }) => {
            if (filter.orderBy === 'asc') {
                return firstClose === null
                    ? []
                    : [{ close: firstClose, timestamp: new Date('2025-01-01') }];
            }
            return lastClose === null
                ? []
                : [{ close: lastClose, timestamp: new Date('2025-12-31') }];
        }),
    };
}

describe('BuyAndHoldTool.execute', () => {
    const input = {
        kind: 'hypothesis' as const,
        hypothesis: makeHypothesis(),
        period: { start: '2025-01-01', end: '2025-12-31' },
        screeningBacktestRunId: 'sbt-1',
    };

    function makeRepo(record: ReturnType<typeof makeRunRecord> | null) {
        return {
            findById: jest.fn().mockResolvedValue(record),
            create: jest.fn(),
            findByHypothesis: jest.fn(),
        };
    }

    type BHCtor = ConstructorParameters<typeof BuyAndHoldTool>;

    it('screeningBacktestRunId 未指定なら success=false', async () => {
        const repo = makeRepo(null);
        const ohlcv = makeOhlcvRepo(2000, 2100);
        const tool = new BuyAndHoldTool(
            repo,
            ohlcv as unknown as BHCtor[1],
        );
        const res = await tool.execute({ ...input, screeningBacktestRunId: '' });
        expect(res.success).toBe(false);
        expect(res.error).toContain('screeningBacktestRunId');
    });

    it('OHLCV 不足なら success=false', async () => {
        const repo = makeRepo(makeRunRecord(100, 25));
        const ohlcv = makeOhlcvRepo(null, null);
        const tool = new BuyAndHoldTool(
            repo,
            ohlcv as unknown as BHCtor[1],
        );
        const res = await tool.execute(input);
        expect(res.success).toBe(false);
        expect(res.error).toContain('OHLCV');
    });

    it('戦略が BH を大きく上回る場合 passed=true', async () => {
        // BH: (2100-2000)/2000 = 0.05 (5%)
        // 戦略: pnl=200 合計 / 2000 = 0.10 (10%)
        // outperformance = 0.05 > 0.005 → passed
        const repo = makeRepo(makeRunRecord(200, 25));
        const ohlcv = makeOhlcvRepo(2000, 2100);
        const tool = new BuyAndHoldTool(
            repo,
            ohlcv as unknown as BHCtor[1],
        );
        const res = await tool.execute(input);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(true);
        expect(res.metrics.buyAndHoldReturn).toBeCloseTo(0.05, 4);
        expect(res.metrics.strategyReturn).toBeCloseTo(0.1, 4);
        expect(res.metrics.outperformance).toBeGreaterThan(0.04);
    });

    it('戦略が BH を下回る場合 passed=false', async () => {
        const repo = makeRepo(makeRunRecord(40, 25));
        const ohlcv = makeOhlcvRepo(2000, 2100);
        const tool = new BuyAndHoldTool(
            repo,
            ohlcv as unknown as BHCtor[1],
        );
        const res = await tool.execute(input);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(false);
        expect(res.metrics.outperformance).toBeLessThan(0);
    });

    it('ショート仮説は BH と逆方向で比較される', async () => {
        // 下落相場: 2000 → 1900 で BH=-5%
        // 戦略リターン=+3% (60/2000) → comparableBhReturn=-(-0.05)=0.05
        // outperformance = 0.03 - 0.05 = -0.02 → passed=false
        const repo = makeRepo(makeRunRecord(60, 25));
        const ohlcv = makeOhlcvRepo(2000, 1900);
        const tool = new BuyAndHoldTool(
            repo,
            ohlcv as unknown as BHCtor[1],
            {},
        );
        const res = await tool.execute({
            ...input,
            hypothesis: makeHypothesis({ expectedDirection: 'short' }),
        });
        expect(res.success).toBe(true);
        expect(res.passed).toBe(false);
        expect(res.metrics.comparisonDirection).toBe('short');
    });

    it('periodDays を整数で返す', async () => {
        const repo = makeRepo(makeRunRecord(100, 25));
        const ohlcv = makeOhlcvRepo(2000, 2100);
        const tool = new BuyAndHoldTool(
            repo,
            ohlcv as unknown as BHCtor[1],
        );
        const res = await tool.execute(input);
        // 2025-01-01 ~ 2025-12-31 = 364 日
        expect(res.metrics.periodDays).toBe(364);
    });

    it('startClose が 0 以下なら fail', async () => {
        const repo = makeRepo(makeRunRecord(100, 25));
        const ohlcv = makeOhlcvRepo(0, 100);
        const tool = new BuyAndHoldTool(
            repo,
            ohlcv as unknown as BHCtor[1],
        );
        const res = await tool.execute(input);
        expect(res.success).toBe(false);
        expect(res.error).toContain('startClose');
    });
});
