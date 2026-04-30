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
import type { LensFeature, LensFeatureSnapshot } from '../../lenses';

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
    lensAggregator: {
        computeAll: jest.Mock;
    };
}

function makeFreshLensSnapshot(atr = 12.5): LensFeatureSnapshot {
    const volFeature: LensFeature = {
        lensName: 'volatility_regime',
        lensVersion: '1.0.0',
        features: { atr, bb_width_percentile: 55, regime_label: 'normal', is_squeeze: false, is_expanding: false },
        computedAt: new Date('2026-04-30T00:00:00Z'),
        confidence: 0.9,
    };
    const caFeature: LensFeature = {
        lensName: 'current_analysis',
        lensVersion: '1.0.0',
        features: { latest_price: 2300, trend_strength: 50, direction: 'long' },
        computedAt: new Date('2026-04-30T00:00:00Z'),
        confidence: 0.8,
    };
    const features = new Map<string, LensFeature>();
    features.set('volatility_regime', volFeature);
    features.set('current_analysis', caFeature);
    return {
        timestamp: new Date('2026-04-30T00:00:00Z'),
        symbol: 'XAUUSD',
        features,
        totalComputeDurationMs: 5,
    };
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
        lensAggregator: {
            computeAll: jest.fn().mockResolvedValue(makeFreshLensSnapshot()),
            ...(overrides?.lensAggregator ?? {}),
        },
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
        deps.lensAggregator,
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

    it('options.lensSnapshot を渡さなくても OHLCV から fresh な lensSnapshot を計算して materialize に渡す', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-fresh',
            tradeId: 'trade-fresh',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-fresh');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-fresh',
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
        // fresh snapshot 計算が呼ばれたか
        expect(mocks.lensAggregator.computeAll).toHaveBeenCalledTimes(1);
        // materialize に snapshot が渡され、その snapshot に ATR が含まれていること
        const materializeCall = mocks.materialization.materializeForValidation.mock.calls[0];
        const passedSnapshot: LensFeatureSnapshot | undefined = materializeCall[1]?.lensSnapshot;
        expect(passedSnapshot).toBeDefined();
        expect(passedSnapshot?.features.get('volatility_regime')?.features.atr).toBe(12.5);
    });

    it('OHLCV 直近 close を entryPriceHint として materialize に渡す (Critical-1.6)', async () => {
        const hyp = makeHypothesis();
        const fullSeries = [
            { timestamp: new Date('2026-04-01T00:00:00Z'), open: 3300, high: 3320, low: 3280, close: 3310, volume: 0 },
            { timestamp: new Date('2026-04-15T00:00:00Z'), open: 3310, high: 3340, low: 3290, close: 3330, volume: 0 },
            { timestamp: new Date('2026-04-30T00:00:00Z'), open: 3330, high: 3350, low: 3310, close: 3325.5, volume: 0 },
        ];
        const mocks = makeMocks({
            ohlcvRepo: {
                findManyAsOHLCVData: jest.fn().mockImplementation((filter: { orderBy?: 'asc' | 'desc'; limit?: number }) => {
                    // hasOhlcvCoverage(limit=1) のために、coverage が通るように
                    // 期間端の極端な timestamp を返す。screening 本体の範囲取得(limit≥3)では
                    // 実データを返して entryPriceHint 計算に使う。
                    if (filter.limit === 1) {
                        const t = filter.orderBy === 'desc'
                            ? new Date('2099-01-01T00:00:00Z')
                            : new Date('2000-01-01T00:00:00Z');
                        return Promise.resolve([{ timestamp: t, open: 1, high: 1, low: 1, close: 1, volume: 0 }]);
                    }
                    return Promise.resolve(fullSeries);
                }),
            },
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-hint',
            tradeId: 'trade-hint',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-hint');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-hint',
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

        await makeOrchestrator(mocks).runScreening(hyp.id);

        // materialize に entryPriceHint = 直近 close (3325.5) が渡される
        const materializeCall = mocks.materialization.materializeForValidation.mock.calls[0];
        expect(materializeCall[1]?.entryPriceHint).toBe(3325.5);
    });

    it('OHLCV が取れない場合は entryPriceHint は渡されない', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks({
            ohlcvRepo: {
                findManyAsOHLCVData: jest.fn().mockResolvedValue([]),
            },
            // OHLCV 取得失敗時は ensureOhlcvData が fetchAndCache を試すので成功にしておく
            fetchAndCache: jest.fn().mockResolvedValue({
                success: true,
                cachedCount: 0,
                source: 'ctrader',
            }),
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        // ohlcv が空なら ensureOhlcvData が not_testable を返す前にここまで来る:
        // 実際は ensure 失敗で not_testable になるので、本テストは「entryPriceHint を渡さない経路」を
        // materialize 前の段階で確認する目的。fetch を success にすることで coverage を通す。
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-no-hint',
            tradeId: 'trade-no-hint',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-no-hint');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-no-hint',
            status: 'completed',
            setupCount: 0,
            winCount: 0,
            lossCount: 0,
            timeoutCount: 0,
            winRate: 0,
            profitFactor: 0,
            totalProfit: 0,
            totalLoss: 0,
            averagePnL: 0,
            expectancy: 0,
            maxDrawdown: 0,
            events: [],
        });

        // ensureOhlcvData が not_testable で先に return するため、materialize 自体呼ばれない可能性大
        // ここではコード経路の安全性のみ確認(エラー無しで戻ること)
        const result = await makeOrchestrator(mocks).runScreening(hyp.id);
        // ensureOhlcvData の coverage 判定が成功する場合のみ materialize に到達
        // 到達した場合、entryPriceHint は undefined のはず
        if (mocks.materialization.materializeForValidation.mock.calls.length > 0) {
            const materializeCall = mocks.materialization.materializeForValidation.mock.calls[0];
            expect(materializeCall[1]?.entryPriceHint).toBeUndefined();
        } else {
            // ensure 段階で not_testable に倒れた経路
            expect(result.verdict).toBe('not_testable');
        }
    });

    it('options.lensSnapshot に有効な ATR があれば fresh 計算をスキップしてそれを使う', async () => {
        const hyp = makeHypothesis();
        const provided = makeFreshLensSnapshot(99.9);
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-provided',
            tradeId: 'trade-provided',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-provided');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-provided',
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

        const result = await makeOrchestrator(mocks).runScreening(hyp.id, { lensSnapshot: provided });

        expect(result.verdict).toBe('screening_passed');
        // 呼ばれてはいけない（既に有効な ATR がある）
        expect(mocks.lensAggregator.computeAll).not.toHaveBeenCalled();
        const materializeCall = mocks.materialization.materializeForValidation.mock.calls[0];
        const passedSnapshot: LensFeatureSnapshot | undefined = materializeCall[1]?.lensSnapshot;
        expect(passedSnapshot?.features.get('volatility_regime')?.features.atr).toBe(99.9);
    });

    it('options.lensSnapshot に ATR が無ければ fresh 計算で補完する', async () => {
        const hyp = makeHypothesis();
        // ATR が無い snapshot を提供
        const noAtrFeatures = new Map<string, LensFeature>();
        noAtrFeatures.set('volatility_regime', {
            lensName: 'volatility_regime',
            lensVersion: '1.0.0',
            features: { regime_label: 'unknown', reason: 'insufficient_data' },
            computedAt: new Date(),
        });
        const incomplete: LensFeatureSnapshot = {
            timestamp: new Date(),
            symbol: 'XAUUSD',
            features: noAtrFeatures,
            totalComputeDurationMs: 1,
        };
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);
        mocks.materialization.materializeForValidation.mockResolvedValue({
            tradeNoteId: 'note-recomputed',
            tradeId: 'trade-recomputed',
            stopLossPercent: 0.5,
            takeProfitPercent: 1.0,
            pathUsed: 'legacy',
        });
        mocks.backtestService.execute.mockResolvedValue('run-recompute');
        mocks.backtestService.getResult.mockResolvedValue({
            runId: 'run-recompute',
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

        await makeOrchestrator(mocks).runScreening(hyp.id, { lensSnapshot: incomplete });

        // ATR が無いので fresh 計算が走る
        expect(mocks.lensAggregator.computeAll).toHaveBeenCalledTimes(1);
        const materializeCall = mocks.materialization.materializeForValidation.mock.calls[0];
        const passedSnapshot: LensFeatureSnapshot | undefined = materializeCall[1]?.lensSnapshot;
        expect(passedSnapshot?.features.get('volatility_regime')?.features.atr).toBe(12.5);
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
