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

/** totalPnl に相当する events を生成する */
function makeSummary(totalPnl: number, tradeCount: number = 20) {
    const perTrade = totalPnl / tradeCount;
    return {
        runId: 'run-1',
        status: 'completed' as const,
        setupCount: tradeCount,
        winCount: 0,
        lossCount: 0,
        timeoutCount: 0,
        winRate: 0,
        profitFactor: null,
        totalProfit: 0,
        totalLoss: 0,
        averagePnL: perTrade,
        expectancy: 0,
        maxDrawdown: null,
        events: Array.from({ length: tradeCount }, (_, i) => ({
            entryTime: new Date(2026, 0, i + 1).toISOString(),
            entryPrice: 2000,
            matchScore: 0.8,
            exitTime: new Date(2026, 0, i + 2).toISOString(),
            exitPrice: 2000 + perTrade,
            outcome: 'win' as const,
            pnl: perTrade,
            holdingMinutes: 60,
        })),
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
        tradeNoteId: 'note-1',
        period: { start: '2025-01-01', end: '2025-12-31' },
        backtestRunId: 'run-1',
    };

    it('backtestRunId 未指定なら success=false', async () => {
        const bt = { getResult: jest.fn() };
        const ohlcv = makeOhlcvRepo(2000, 2100);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new BuyAndHoldTool(bt as any, ohlcv as any);
        const res = await tool.execute({ ...input, backtestRunId: undefined });
        expect(res.success).toBe(false);
        expect(res.error).toContain('backtestRunId');
    });

    it('OHLCV 不足なら success=false', async () => {
        const bt = { getResult: jest.fn() };
        const ohlcv = makeOhlcvRepo(null, null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new BuyAndHoldTool(bt as any, ohlcv as any);
        const res = await tool.execute(input);
        expect(res.success).toBe(false);
        expect(res.error).toContain('OHLCV');
    });

    it('戦略が BH を大きく上回る場合 passed=true', async () => {
        // BH: (2100-2000)/2000 = 0.05 (5%)
        // 戦略: pnl=200 合計 / 2000 = 0.10 (10%)
        // outperformance = 0.05 > 0.005 → passed
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(200, 25)) };
        const ohlcv = makeOhlcvRepo(2000, 2100);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new BuyAndHoldTool(bt as any, ohlcv as any);
        const res = await tool.execute(input);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(true);
        expect(res.metrics.buyAndHoldReturn).toBeCloseTo(0.05, 4);
        expect(res.metrics.strategyReturn).toBeCloseTo(0.1, 4);
        expect(res.metrics.outperformance).toBeGreaterThan(0.04);
    });

    it('戦略が BH を下回る場合 passed=false', async () => {
        // BH: 5%, 戦略: 2% → outperformance = -3%
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(40, 25)) };
        const ohlcv = makeOhlcvRepo(2000, 2100);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new BuyAndHoldTool(bt as any, ohlcv as any);
        const res = await tool.execute(input);
        expect(res.success).toBe(true);
        expect(res.passed).toBe(false);
        expect(res.metrics.outperformance).toBeLessThan(0);
    });

    it('ショート仮説は BH と逆方向で比較される', async () => {
        // 下落相場: 2000 → 1900 で BH=-5%
        // 戦略リターン=+3% → comparableBhReturn=-(-0.05)=0.05...
        // wait: direction='short' → comparableBhReturn = -(-0.05) = 0.05
        // outperformance = 0.03 - 0.05 = -0.02 → passed=false
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(60, 25)) };
        const ohlcv = makeOhlcvRepo(2000, 1900);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new BuyAndHoldTool(bt as any, ohlcv as any, {});
        const res = await tool.execute({
            ...input,
            hypothesis: makeHypothesis({ expectedDirection: 'short' }),
        });
        expect(res.success).toBe(true);
        // 戦略 (0.03) < 反転 BH (0.05) → passed=false
        expect(res.passed).toBe(false);
        expect(res.metrics.comparisonDirection).toBe('short');
    });

    it('periodDays を整数で返す', async () => {
        const bt = { getResult: jest.fn().mockResolvedValue(makeSummary(100, 25)) };
        const ohlcv = makeOhlcvRepo(2000, 2100);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new BuyAndHoldTool(bt as any, ohlcv as any);
        const res = await tool.execute(input);
        // 2025-01-01 ~ 2025-12-31 = 364 日
        expect(res.metrics.periodDays).toBe(364);
    });

    it('startClose が 0 以下なら fail', async () => {
        const bt = { getResult: jest.fn() };
        const ohlcv = makeOhlcvRepo(0, 100);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tool = new BuyAndHoldTool(bt as any, ohlcv as any);
        const res = await tool.execute(input);
        expect(res.success).toBe(false);
        expect(res.error).toContain('startClose');
    });
});
