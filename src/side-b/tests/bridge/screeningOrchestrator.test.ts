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
        count: jest.Mock;
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
            // デフォルトは「期待バー数の 100% を満たす十分な数」を返す。
            // カバレッジ判定のテストでは override で 0 や 50% を指定する。
            count: jest.fn().mockResolvedValue(99_999_999),
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

    it('AxiosError 時は reason に status / code / response.data 先頭が含まれる (P0 観測性改善)', async () => {
        // 旧実装は `err.message` のみ採取で `'Error'` 単体に潰れていた。新実装では
        // AxiosError の status / code / response body を reason に展開し、再発時に
        // statusNote だけで原因 (= Cloud Run 5xx / 認証 401 / payload 422 等) が判別できる。
        const hyp = makeHypothesis();
        const axiosError = Object.assign(new Error('Request failed with status code 422'), {
            isAxiosError: true,
            code: 'ERR_BAD_REQUEST',
            response: {
                status: 422,
                data: { detail: 'invalid notePayload: triggerGroup missing' },
            },
        });
        const mocks = makeMocks({
            runBacktest: jest.fn().mockRejectedValue(axiosError) as MockDeps['runBacktest'],
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        const reasonArg = mocks.edgeLedger.markNotTestable.mock.calls[0][1];
        expect(reasonArg).toContain('analysis-engine BT');
        expect(reasonArg).toContain('status=422');
        expect(reasonArg).toContain('code=ERR_BAD_REQUEST');
        expect(reasonArg).toContain('triggerGroup missing'); // body から拾えていること
    });

    it('AxiosError で response が空 (ECONNREFUSED 等) の場合は code と message が含まれる', async () => {
        const hyp = makeHypothesis();
        const networkError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8000'), {
            isAxiosError: true,
            code: 'ECONNREFUSED',
            // response は存在しない (network 到達不能)
        });
        const mocks = makeMocks({
            runBacktest: jest.fn().mockRejectedValue(networkError) as MockDeps['runBacktest'],
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        const reasonArg = mocks.edgeLedger.markNotTestable.mock.calls[0][1];
        expect(reasonArg).toContain('code=ECONNREFUSED');
        expect(reasonArg).toContain('ECONNREFUSED 127.0.0.1');
        expect(reasonArg).not.toContain('status='); // response がないため status は付かない
    });

    it('非 Error 値 (string) を throw された場合は String(err) で fallback', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks({
            // 実装上 throw されるのは Error が大多数だが、外部ライブラリが string を throw する
            // ケースも理論上ありうる。fallback 経路が動くことを保証する。
            runBacktest: jest.fn().mockRejectedValue('raw string error') as MockDeps['runBacktest'],
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        const reasonArg = mocks.edgeLedger.markNotTestable.mock.calls[0][1];
        expect(reasonArg).toContain('analysis-engine BT');
        expect(reasonArg).toContain('raw string error');
    });

    it('OHLCV カバレッジ 90% 未満で fetchAndCache 失敗時は not_testable + 取得不能の理由', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks({
            ohlcvRepo: {
                count: jest.fn().mockResolvedValue(0),
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
            expect.stringContaining('OHLCV 取得不能'),
        );
        expect(mocks.runBacktest).not.toHaveBeenCalled();
    });

    it('OHLCV カバレッジ 90% 未満で fetchAndCache 後も不足なら not_testable + カバレッジ不足の理由', async () => {
        const hyp = makeHypothesis();
        // count を「fetch 前=0, fetch 後=不足のまま」で 2 段階返す
        let callCount = 0;
        const countMock = jest.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve(callCount === 1 ? 0 : 100); // 1 年 15m なら期待 25028 で 100 は 0.4% 程度
        });
        const mocks = makeMocks({
            ohlcvRepo: {
                count: countMock,
            },
            fetchAndCache: jest.fn().mockResolvedValue({
                success: true,
                cachedCount: 100,
                source: 'ctrader',
            }),
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id);

        expect(result.verdict).toBe('not_testable');
        expect(mocks.edgeLedger.markNotTestable).toHaveBeenCalledWith(
            hyp.id,
            expect.stringContaining('OHLCV カバレッジ不足'),
        );
        expect(mocks.runBacktest).not.toHaveBeenCalled();
    });

    it('OHLCV 不足時は cTrader 基準シンボルで補完してから BT を回す', async () => {
        const hyp = makeHypothesis({ symbols: ['XAU/USD'] });
        // 1 回目 (initial) は 0 件、2 回目 (after fetch) は十分な件数
        let callCount = 0;
        const countMock = jest.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve(callCount === 1 ? 0 : 99_999_999);
        });
        const mocks = makeMocks({
            ohlcvRepo: {
                count: countMock,
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

    it('options.period を渡すと analysis-engine へその期間で送信される', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const period = { start: '2025-06-01', end: '2025-12-31' };
        await makeOrchestrator(mocks).runScreening(hyp.id, { period });

        expect(mocks.runBacktest).toHaveBeenCalledTimes(1);
        const btCall = mocks.runBacktest.mock.calls[0][0];
        expect(btCall.startDate).toBe(new Date('2025-06-01').toISOString());
        expect(btCall.endDate).toBe(new Date('2025-12-31').toISOString());
    });

    it('期待バー数が 0 (期間が短すぎ) の場合はカバレッジ判定対象外として通る', async () => {
        // timeframe=1w で period が 3 日 → 期待バー数 = floor(3d × 5/7 / 7d) = 0
        const hyp = makeHypothesis({ timeframes: ['1w'] });
        const mocks = makeMocks({
            ohlcvRepo: {
                count: jest.fn().mockResolvedValue(0), // 0 でも expected=0 なので通る
            },
        });
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const result = await makeOrchestrator(mocks).runScreening(hyp.id, {
            period: { start: '2026-01-01', end: '2026-01-04' },
        });

        // カバレッジ判定で弾かれず BT 実行に進むこと
        // (BT 結果は makeBtResponse() の screening_passed)
        expect(result.verdict).toBe('screening_passed');
        expect(mocks.runBacktest).toHaveBeenCalledTimes(1);
    });

    it('options.period 未指定時は env SCREENING_PERIOD_DAYS で日数を制御できる', async () => {
        const hyp = makeHypothesis();
        const mocks = makeMocks();
        mocks.edgeLedger.get.mockResolvedValue(hyp);

        const original = process.env.SCREENING_PERIOD_DAYS;
        process.env.SCREENING_PERIOD_DAYS = '180'; // 半年
        try {
            await makeOrchestrator(mocks).runScreening(hyp.id);
        } finally {
            if (original === undefined) delete process.env.SCREENING_PERIOD_DAYS;
            else process.env.SCREENING_PERIOD_DAYS = original;
        }

        const btCall = mocks.runBacktest.mock.calls[0][0];
        const startMs = new Date(btCall.startDate).getTime();
        const endMs = new Date(btCall.endDate).getTime();
        const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));
        // 月跨ぎで ±1 日のずれは許容
        expect(diffDays).toBeGreaterThanOrEqual(179);
        expect(diffDays).toBeLessThanOrEqual(181);
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
