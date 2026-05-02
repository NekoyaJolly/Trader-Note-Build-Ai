/**
 * ScreeningOrchestrator のテスト (Critical-4 段階 1: BT 一本化)
 *
 * 旧経路 (MaterializationService + Side-A backtestService) は撤廃され、
 * analysis-engine 経由 BT (`runBacktest` 関数) と `ScreeningBacktestRunRepository` を
 * 注入する形に変わった。本テストは新経路の挙動を検証する。
 */

import { ScreeningOrchestrator } from '../../bridge/ScreeningOrchestrator';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';
import { StatusManager } from '../../ledger/statusManager';
import type {
    AnalysisEngineScreeningBacktestRequest,
    AnalysisEngineScreeningBacktestResponse,
} from '../../../schemas/external/analysisEngine';

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

function makeBtResponse(
    overrides?: Partial<AnalysisEngineScreeningBacktestResponse>,
): AnalysisEngineScreeningBacktestResponse {
    return {
        summary: {
            pf: 1.6,
            winRate: 0.6,
            tradeCount: 30,
            maxDD: 50,
            sharpe: 1.2,
            returnPct: 12.5,
        },
        trades: [],
        equity: null,
        engineVersion: 'analysis-engine/backtesting.py@0.6.5',
        unsupportedConditions: [],
        ...overrides,
    };
}

interface MockDeps {
    edgeLedger: {
        get: jest.Mock;
        recordScreeningResult: jest.Mock;
        markNotTestable: jest.Mock;
    };
    screeningBacktestRepo: {
        create: jest.Mock;
        findById: jest.Mock;
        findByHypothesis: jest.Mock;
    };
    runBacktest: jest.Mock<Promise<AnalysisEngineScreeningBacktestResponse>, [AnalysisEngineScreeningBacktestRequest]>;
    ohlcvRepo: {
        findManyAsOHLCVData: jest.Mock;
    };
    fetchAndCache: jest.Mock;
}

function makeMocks(overrides?: Partial<MockDeps>): MockDeps {
    return {
        edgeLedger: {
            get: jest.fn(),
            recordScreeningResult: jest.fn().mockResolvedValue(undefined),
            markNotTestable: jest.fn().mockResolvedValue(undefined),
            ...(overrides?.edgeLedger ?? {}),
        },
        screeningBacktestRepo: {
            create: jest.fn().mockImplementation((data: { hypothesisId: string }) =>
                Promise.resolve({
                    id: `screening-bt-${data.hypothesisId}`,
                    hypothesisId: data.hypothesisId,
                    createdAt: new Date(),
                }),
            ),
            findById: jest.fn(),
            findByHypothesis: jest.fn(),
            ...(overrides?.screeningBacktestRepo ?? {}),
        },
        runBacktest: (overrides?.runBacktest ?? jest.fn().mockResolvedValue(makeBtResponse())) as MockDeps['runBacktest'],
        ohlcvRepo: {
            findManyAsOHLCVData: jest.fn().mockImplementation((filter: { orderBy?: 'asc' | 'desc' }) => {
                const timestamp = filter.orderBy === 'desc'
                    ? new Date('2099-01-01T00:00:00Z')
                    : new Date('2000-01-01T00:00:00Z');
                return Promise.resolve([{ timestamp, open: 1, high: 1, low: 1, close: 1, volume: 0 }]);
            }),
            ...(overrides?.ohlcvRepo ?? {}),
        },
        fetchAndCache: overrides?.fetchAndCache ?? jest.fn().mockResolvedValue({
            success: true,
            cachedCount: 0,
            source: 'ctrader',
        }),
    };
}

function makeOrchestrator(deps: MockDeps) {
    type CtorArgs = ConstructorParameters<typeof ScreeningOrchestrator>;
    return new ScreeningOrchestrator(
        deps.edgeLedger as unknown as CtorArgs[0],
        new StatusManager(),
        deps.screeningBacktestRepo,
        deps.runBacktest as CtorArgs[3],
        deps.ohlcvRepo,
        deps.fetchAndCache,
    );
}

describe('ScreeningOrchestrator.runScreening (Critical-4 段階 1)', () => {
    it('PF/勝率/トレード数を満たすと screening_passed を返し、ScreeningBacktestRun 永続化と recordScreeningResult が呼ばれる', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('screening_passed');
        if (result.verdict !== 'screening_passed') return; // 型ガード
        expect(result.screeningBacktestRunId).toBe(`screening-bt-${hyp.id}`);
        expect(mocks.runBacktest).toHaveBeenCalledTimes(1);
        expect(mocks.screeningBacktestRepo.create).toHaveBeenCalledTimes(1);
        expect(mocks.edgeLedger.recordScreeningResult).toHaveBeenCalledTimes(1);

        const [idArg, resultArg] = mocks.edgeLedger.recordScreeningResult.mock.calls[0];
        expect(idArg).toBe(hyp.id);
        expect(resultArg.passed).toBe(true);
        expect(resultArg.screeningBacktestRunId).toBe(`screening-bt-${hyp.id}`);
        expect(resultArg.metrics).toEqual({ pf: 1.6, winRate: 0.6, tradeCount: 30 });
        // 旧経路の tradeNoteId は新経路で生成されない
        expect(resultArg.tradeNoteId).toBeUndefined();
    });

    it('PF 不足なら verdict=rejected になり、reasons が記録される', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks({
            runBacktest: jest.fn().mockResolvedValue(
                makeBtResponse({
                    summary: {
                        pf: 0.9,
                        winRate: 0.33,
                        tradeCount: 30,
                        maxDD: 80,
                        sharpe: -0.2,
                        returnPct: -5,
                    },
                }),
            ) as MockDeps['runBacktest'],
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('rejected');
        if (result.verdict !== 'rejected') return;
        expect(result.reasons.length).toBeGreaterThan(0);

        const resultArg = mocks.edgeLedger.recordScreeningResult.mock.calls[0][1];
        expect(resultArg.passed).toBe(false);
        expect(Array.isArray(resultArg.reasons)).toBe(true);
        expect(resultArg.screeningBacktestRunId).toBe(`screening-bt-${hyp.id}`);
    });

    it('analysis-engine 通信失敗時は markNotTestable + verdict=not_testable', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks({
            runBacktest: jest.fn().mockRejectedValue(
                new Error('connect ECONNREFUSED'),
            ) as MockDeps['runBacktest'],
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        expect(mocks.edgeLedger.markNotTestable).toHaveBeenCalledWith(
            hyp.id,
            expect.stringContaining('analysis-engine BT'),
        );
        expect(mocks.screeningBacktestRepo.create).not.toHaveBeenCalled();
        expect(mocks.edgeLedger.recordScreeningResult).not.toHaveBeenCalled();
    });

    it('OHLCV 補完に失敗した場合は not_testable として記録する', async () => {
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

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        expect(mocks.edgeLedger.markNotTestable).toHaveBeenCalledWith(
            hyp.id,
            expect.stringContaining('OHLCV補完失敗'),
        );
        expect(mocks.runBacktest).not.toHaveBeenCalled();
    });

    it('OHLCV 不足時は cTrader 基準シンボルで補完してから BT を回す', async () => {
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
                        return Promise.resolve([{
                            timestamp,
                            open: 1,
                            high: 1,
                            low: 1,
                            close: 1,
                            volume: 0,
                        }]);
                    }),
            },
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('screening_passed');
        expect(mocks.fetchAndCache).toHaveBeenCalledWith(
            'XAUUSD',
            '15m',
            expect.any(Date),
            expect.any(Date),
        );
        // BT には正規化後シンボル + 正規化後 timeframe が渡る
        const btCall = mocks.runBacktest.mock.calls[0][0];
        expect(btCall.symbol).toBe('XAUUSD');
        expect(btCall.timeframe).toBe('15m');
    });

    it('仮説の defaultRiskManagement / conditions / direction を notePayload にそのまま渡す', async () => {
        const hyp = makeHypothesis({
            expectedDirection: 'long',
            conditions: [
                { lensName: 'volatility_regime', featureKey: 'is_squeeze', op: '==', value: true },
            ],
            defaultRiskManagement: {
                stopLoss: { type: 'atr_multiple', value: 2.0 },
                takeProfit: { type: 'rr_ratio', value: 3.0 },
                maxHoldingBars: 96,
            },
        });
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        await makeOrchestrator(mocks).runScreening(hyp.id);

        const btCall = mocks.runBacktest.mock.calls[0][0];
        expect(btCall.notePayload.direction).toBe('long');
        expect(btCall.notePayload.conditions).toEqual([
            { lensName: 'volatility_regime', featureKey: 'is_squeeze', op: '==', value: true },
        ]);
        expect(btCall.notePayload.stopLoss).toEqual({ type: 'atr_multiple', value: 2.0 });
        expect(btCall.notePayload.takeProfit).toEqual({ type: 'rr_ratio', value: 3.0 });
        expect(btCall.notePayload.maxHoldingBars).toBe(96);
    });

    it('defaultRiskManagement が無い仮説は DEFAULT_RISK_MANAGEMENT で補完される', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        await makeOrchestrator(mocks).runScreening(hyp.id);

        const btCall = mocks.runBacktest.mock.calls[0][0];
        // DEFAULT_RISK_MANAGEMENT: ATR×1.5 SL / RR=2.0 TP / 48 bars
        expect(btCall.notePayload.stopLoss).toEqual({ type: 'atr_multiple', value: 1.5 });
        expect(btCall.notePayload.takeProfit).toEqual({ type: 'rr_ratio', value: 2.0 });
        expect(btCall.notePayload.maxHoldingBars).toBe(48);
    });

    it('仮説に symbols が無い場合は not_testable', async () => {
        const hyp = makeHypothesis({ symbols: [] });
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        expect(mocks.edgeLedger.markNotTestable).toHaveBeenCalledWith(
            hyp.id,
            expect.stringContaining('symbols'),
        );
        expect(mocks.runBacktest).not.toHaveBeenCalled();
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

        const result = await makeOrchestrator(mocks).runScreening(hyp.id, { force: true });

        expect(result.verdict).toBe('screening_passed');
    });

    it('仮説が見つからない場合は Error を投げる', async () => {
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(null);
        await expect(makeOrchestrator(mocks).runScreening('missing')).rejects.toThrow(/not found/);
    });

    it('永続化された ScreeningBacktestRun に notePayload / summary / trades / equity / engineVersion が積まれる', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks({
            runBacktest: jest.fn().mockResolvedValue(
                makeBtResponse({
                    trades: [
                        {
                            entryTime: '2026-01-15T08:00:00.000Z',
                            entryPrice: 2300,
                            exitTime: '2026-01-15T10:00:00.000Z',
                            exitPrice: 2310,
                            side: 'long',
                            pnl: 10,
                            outcome: 'win',
                        },
                    ],
                    equity: [10000, 10010],
                }),
            ) as MockDeps['runBacktest'],
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(mocks.screeningBacktestRepo.create).toHaveBeenCalledTimes(1);
        const persistArg = mocks.screeningBacktestRepo.create.mock.calls[0][0];
        expect(persistArg.hypothesisId).toBe(hyp.id);
        expect(persistArg.symbol).toBe('XAUUSD');
        expect(persistArg.timeframe).toBe('15m');
        expect(persistArg.notePayload.direction).toBe('short');
        expect(persistArg.summary.pf).toBe(1.6);
        expect(persistArg.trades).toHaveLength(1);
        expect(persistArg.equity).toEqual([10000, 10010]);
        expect(persistArg.engineVersion).toBe('analysis-engine/backtesting.py@0.6.5');
    });
});
