/**
 * ScreeningOrchestrator のテスト（Phase 4b 縮小版）
 *
 * MaterializationService / EdgeLedger / Side-A BacktestService を全てモックし、
 * Orchestrator のフロー制御と判定結果の EdgeLedger 反映を検証する。
 */

import { ScreeningOrchestrator } from '../../bridge/ScreeningOrchestrator';
import { MaterializationError } from '../../bridge/types';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';
import { StatusManager } from '../../ledger/statusManager';

function makeHypothesis(overrides?: Partial<EdgeHypothesis>): EdgeHypothesis {
    const base: EdgeHypothesis = {
        id: 'hyp-1',
        statement: '欧州時間開始直後の XAUUSD レジスタンス反発',
        category: 'time',
        conditions: [],
        expectedDirection: 'short',
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

interface MockDeps {
    materialization: {
        materializeForValidation: jest.Mock;
        materializeFromVirtualTrade: jest.Mock;
    };
    edgeLedger: {
        get: jest.Mock;
        recordScreeningResult: jest.Mock;
        markNotTestable: jest.Mock;
    };
    backtestService: {
        execute: jest.Mock;
        getResult: jest.Mock;
    };
    ohlcvRepo: {
        findManyAsOHLCVData: jest.Mock;
    };
    fetchAndCache: jest.Mock;
}

function makeMocks(overrides?: Partial<MockDeps>): MockDeps {
    return {
        materialization: {
            materializeForValidation: jest.fn(),
            materializeFromVirtualTrade: jest.fn(),
            ...(overrides?.materialization ?? {}),
        },
        edgeLedger: {
            get: jest.fn(),
            recordScreeningResult: jest.fn().mockResolvedValue(undefined),
            markNotTestable: jest.fn().mockResolvedValue(undefined),
            ...(overrides?.edgeLedger ?? {}),
        },
        backtestService: {
            execute: jest.fn(),
            getResult: jest.fn(),
            ...(overrides?.backtestService ?? {}),
        },
        ohlcvRepo: {
            findManyAsOHLCVData: jest.fn().mockImplementation((filter: { orderBy?: 'asc' | 'desc' }) => {
                const timestamp = filter.orderBy === 'desc'
                    ? new Date('2099-01-01T00:00:00Z')
                    : new Date('2000-01-01T00:00:00Z');
                return Promise.resolve([{ timestamp, open: 1, high: 1, low: 1, close: 1, volume: 0 }]);
            }),
            ...(overrides?.ohlcvRepo ?? {}),
        },
        fetchAndCache: jest.fn().mockResolvedValue({ success: true, cachedCount: 0, source: 'ctrader' }),
        ...(overrides?.fetchAndCache ? { fetchAndCache: overrides.fetchAndCache } : {}),
    };
}

function makeOrchestrator(deps: MockDeps) {
    type ScreeningConstructorArgs = ConstructorParameters<typeof ScreeningOrchestrator>;
    return new ScreeningOrchestrator(
        deps.materialization as unknown as ScreeningConstructorArgs[0],
        deps.edgeLedger as unknown as ScreeningConstructorArgs[1],
        new StatusManager(),
        deps.backtestService as unknown as ScreeningConstructorArgs[3],
        deps.ohlcvRepo,
        deps.fetchAndCache,
    );
}

describe('ScreeningOrchestrator.runScreening', () => {
    it('PF/勝率/トレード数を満たすと screening_passed を返し、recordScreeningResult が呼ばれる', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-1',
            tradeId: 'trade-1',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            maxHoldingMinutes: 720,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-1');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-1',
            status: 'completed',
            setupCount: 30,
            winCount: 18,
            lossCount: 12,
            timeoutCount: 0,
            winRate: 0.6,
            profitFactor: 1.6,
            totalProfit: 300,
            totalLoss: 187.5,
            averagePnL: 3.75,
            expectancy: 1.5,
            maxDrawdown: 50,
            events: [],
        });

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('screening_passed');
        expect(mocks.edgeLedger.recordScreeningResult).toHaveBeenCalledTimes(1);
        const [idArg, resultArg] = mocks.edgeLedger.recordScreeningResult.mock.calls[0];
        expect(idArg).toBe(hyp.id);
        expect(resultArg.passed).toBe(true);
        expect(resultArg.tradeNoteId).toBe('note-1');
        expect(resultArg.metrics).toEqual({ pf: 1.6, winRate: 0.6, tradeCount: 30 });
    });

    it('PF 不足なら verdict=rejected になり、recordScreeningResult に reasons が載る', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-1',
            tradeId: 'trade-1',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-2');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-2',
            status: 'completed',
            setupCount: 30,
            winCount: 10,
            lossCount: 20,
            timeoutCount: 0,
            winRate: 0.33,
            profitFactor: 0.9,
            totalProfit: 100,
            totalLoss: 111,
            averagePnL: -0.37,
            expectancy: -0.2,
            maxDrawdown: 80,
            events: [],
        });

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('rejected');
        const resultArg = mocks.edgeLedger.recordScreeningResult.mock.calls[0][1];
        expect(resultArg.passed).toBe(false);
        expect(Array.isArray(resultArg.reasons)).toBe(true);
        expect(resultArg.reasons.length).toBeGreaterThan(0);
    });

    it('Materialize 失敗時は markNotTestable が呼ばれ、verdict=not_testable', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockRejectedValue(
            new MaterializationError('ATR 取得不可'),
        );

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        expect(mocks.edgeLedger.markNotTestable).toHaveBeenCalledWith(hyp.id, expect.stringContaining('ATR'));
        expect(mocks.backtestService.execute).not.toHaveBeenCalled();
        expect(mocks.edgeLedger.recordScreeningResult).not.toHaveBeenCalled();
    });

    it('BT 結果取得失敗時は markNotTestable が呼ばれる', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-1',
            tradeId: 'trade-1',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-3');
        mocks.backtestService.getResult.mockResolvedValue(null);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        expect(mocks.edgeLedger.markNotTestable).toHaveBeenCalledWith(
            hyp.id,
            expect.stringContaining('BT 結果取得失敗'),
        );
    });

    it('仮説が unverified でない場合はデフォルトで Error を投げる', async () => {
        const hyp = makeHypothesis({ status: 'confirmed' });
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        await expect(makeOrchestrator(mocks).runScreening(hyp.id)).rejects.toThrow(/not unverified/);
    });

    it('force=true なら unverified 以外でも実行できる', async () => {
        const hyp = makeHypothesis({ status: 'rejected' });
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-1',
            tradeId: 'trade-1',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-4');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-4',
            status: 'completed',
            setupCount: 25,
            winCount: 15,
            lossCount: 10,
            timeoutCount: 0,
            winRate: 0.6,
            profitFactor: 1.5,
            totalProfit: 200,
            totalLoss: 133,
            averagePnL: 2.68,
            expectancy: 1.0,
            maxDrawdown: 40,
            events: [],
        });

        const result = await makeOrchestrator(mocks).runScreening(hyp.id, { force: true });

        expect(result.verdict).toBe('screening_passed');
    });

    it('仮説が見つからない場合は Error を投げる', async () => {
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(null);
        await expect(makeOrchestrator(mocks).runScreening('missing')).rejects.toThrow(
            /not found/,
        );
    });

    it('OHLCVが不足している場合はBT前にcTrader基準シンボルで補完する', async () => {
        const hyp = makeHypothesis({ symbols: ['XAU/USD'] });
        const mocks = makeMocks({
            ohlcvRepo: {
                findManyAsOHLCVData: jest.fn()
                    .mockResolvedValueOnce([])
                    .mockResolvedValueOnce([])
                    .mockImplementation((filter: { orderBy?: 'asc' | 'desc' }) => {
                        const timestamp = filter.orderBy === 'desc'
                            ? new Date('2099-01-01T00:00:00Z')
                            : new Date('2000-01-01T00:00:00Z');
                        return Promise.resolve([{ timestamp, open: 1, high: 1, low: 1, close: 1, volume: 0 }]);
                    }),
            },
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-1',
            tradeId: 'trade-1',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-fill');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-fill',
            status: 'completed',
            setupCount: 30,
            winCount: 18,
            lossCount: 12,
            timeoutCount: 0,
            winRate: 0.6,
            profitFactor: 1.6,
            totalProfit: 300,
            totalLoss: 187.5,
            averagePnL: 3.75,
            expectancy: 1.5,
            maxDrawdown: 50,
            events: [],
        });

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('screening_passed');
        expect(mocks.fetchAndCache).toHaveBeenCalledWith(
            'XAUUSD',
            '15m',
            expect.any(Date),
            expect.any(Date),
        );
        expect(mocks.backtestService.execute).toHaveBeenCalled();
    });

    it('OHLCV補完に失敗した場合はnot_testableとして記録する', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks({
            ohlcvRepo: {
                findManyAsOHLCVData: jest.fn().mockResolvedValue([]),
            },
            fetchAndCache: jest.fn().mockResolvedValue({
                success: false,
                cachedCount: 0,
                error: 'cTrader token expired',
            }),
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-1',
            tradeId: 'trade-1',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        expect(mocks.edgeLedger.markNotTestable).toHaveBeenCalledWith(
            hyp.id,
            expect.stringContaining('OHLCV補完失敗'),
        );
        expect(mocks.backtestService.execute).not.toHaveBeenCalled();
    });
});
