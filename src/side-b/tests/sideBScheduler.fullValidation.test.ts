/**
 * SideBScheduler.runFullValidationNow のテスト（Phase 4c Step G）
 *
 * edgeLedger / strategistAgent を jest.mock で差し替え、
 * フル検証ジョブの集計・例外ハンドリング・上限切り詰めを検証する。
 *
 * クールダウン（10秒スリープ）は long テストを避けるため期待値ベースで
 * トリガー回数のみチェック（実時間は測らない）。
 */

import type { EdgeHypothesis } from '../models/edgeHypothesis';

// Scheduler が依存するシングルトン群を置換
jest.mock('../ledger', () => ({
    edgeLedger: {
        findByStatus: jest.fn(),
    },
}));

jest.mock('../services/hypothesisValidationService', () => ({
    validateHypothesis: jest.fn(),
}));

jest.mock('../agent', () => ({
    pdcaLoop: {
        notifyAnalysisComplete: jest.fn(),
        notifyStrategyComplete: jest.fn(),
        notifyTradeCompleted: jest.fn(),
        notifyValidationBatchComplete: jest.fn(),
    },
}));

// 本番のスケジューラー初期化で他重い依存を読みたくないので最小モック
jest.mock('../utils/marketHours', () => ({
    isFXMarketOpen: jest.fn(() => true),
    getMarketStatusJST: jest.fn(() => ({
        isOpen: true,
        isDST: false,
        message: 'テスト',
        nextEvent: '',
    })),
}));

jest.mock('../../services/marketDataService');
jest.mock('../orchestrator/aiOrchestrator');
jest.mock('../services/summarySchedulerService', () => ({
    summarySchedulerService: {
        start: jest.fn(),
        stop: jest.fn(),
        getStatus: jest.fn(() => ({
            isRunning: false,
            config: { weeklyEnabled: false, monthlyEnabled: false },
        })),
    },
}));

jest.mock('../services/cronSimilarityService');
jest.mock('../repositories', () => ({
    findVirtualTrades: jest.fn().mockResolvedValue([]),
    updateTradeToOpen: jest.fn(),
    closeTrade: jest.fn(),
    planRepository: { findAll: jest.fn().mockResolvedValue([]) },
}));

jest.mock('../services/virtualTradeService', () => ({
    expirePendingTrades: jest.fn().mockResolvedValue(0),
    monitorEntryConditions: jest.fn(),
    monitorPositions: jest.fn(),
    createTradeFromPlan: jest.fn(),
}));

jest.mock('../repositories/aiNoteRepository', () => ({
    findAITradeNotesInPeriod: jest.fn().mockResolvedValue([]),
    findAITradeNoteByVirtualTradeId: jest.fn().mockResolvedValue(null),
}));

// ---------- ここから本体 ----------

import { SideBScheduler } from '../jobs/sideBScheduler';
import { edgeLedger } from '../ledger';
import { validateHypothesis } from '../services/hypothesisValidationService';
import { pdcaLoop } from '../agent';

const mockEdgeLedger = edgeLedger as unknown as { findByStatus: jest.Mock };
const mockValidate = validateHypothesis as unknown as jest.Mock;
const mockPdcaLoop = pdcaLoop as unknown as { notifyValidationBatchComplete: jest.Mock };

function makeHyp(id: string): EdgeHypothesis {
    return {
        id,
        statement: `test ${id}`,
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
 * scheduler は仮説間に 10 秒のクールダウンを置く。テストで実時間待ちは
 * 避けたいので、setTimeout を即時解決させるラッパーを jest.spyOn で被せる。
 */
function mockSleepToInstant() {
    const realSetTimeout = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation((
        cb: (...args: unknown[]) => void,
        _ms?: number,
    ) => {
        return realSetTimeout(cb, 0);
    });
}

describe('SideBScheduler.runFullValidationNow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSleepToInstant();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('screening_passed 仮説を取り出し、各検証結果を集計する', async () => {
        mockEdgeLedger.findByStatus.mockResolvedValue([
            makeHyp('h1'),
            makeHyp('h2'),
        ]);
        mockValidate
            .mockResolvedValueOnce({
                verdict: 'confirmed',
                hypothesisId: 'h1',
                baseCriteriaReasons: [],
                decidedAt: new Date(),
            })
            .mockResolvedValueOnce({
                verdict: 'rejected',
                hypothesisId: 'h2',
                baseCriteriaReasons: ['過学習'],
                decidedAt: new Date(),
            });

        const scheduler = new SideBScheduler({ fullValidationMaxPerRun: 5 });
        const result = await scheduler.runFullValidationNow();

        // PR #160 Copilot review #2: findByStatus に limit (fullValidationMaxPerRun=5) を渡して
        // DB 側で take を効かせる
        expect(mockEdgeLedger.findByStatus).toHaveBeenCalledWith('screening_passed', 5);
        expect(mockValidate).toHaveBeenCalledTimes(2);
        expect(result).toEqual({
            processed: 2,
            confirmed: 1,
            rejected: 1,
            notTestable: 0,
            errors: 0,
        });
        expect(mockPdcaLoop.notifyValidationBatchComplete).toHaveBeenCalledWith('full_validation', result);
    }, 30000);

    it('fullValidationMaxPerRun で上限を適用する', async () => {
        mockEdgeLedger.findByStatus.mockResolvedValue([
            makeHyp('h1'),
            makeHyp('h2'),
            makeHyp('h3'),
            makeHyp('h4'),
        ]);
        mockValidate.mockResolvedValue({
            verdict: 'confirmed',
            hypothesisId: 'x',
            baseCriteriaReasons: [],
            decidedAt: new Date(),
        });

        const scheduler = new SideBScheduler({ fullValidationMaxPerRun: 2 });
        const result = await scheduler.runFullValidationNow();

        expect(mockValidate).toHaveBeenCalledTimes(2);
        expect(result.processed).toBe(2);
    }, 30000);

    it('verdict=not_testable と insufficient_data は notTestable に計上', async () => {
        mockEdgeLedger.findByStatus.mockResolvedValue([
            makeHyp('h1'),
            makeHyp('h2'),
        ]);
        mockValidate
            .mockResolvedValueOnce({
                verdict: 'not_testable',
                hypothesisId: 'h1',
                baseCriteriaReasons: ['no trade note'],
                decidedAt: new Date(),
            })
            .mockResolvedValueOnce({
                verdict: 'insufficient_data',
                hypothesisId: 'h2',
                baseCriteriaReasons: ['too few'],
                decidedAt: new Date(),
            });

        const scheduler = new SideBScheduler({ fullValidationMaxPerRun: 5 });
        const result = await scheduler.runFullValidationNow();

        expect(result.notTestable).toBe(2);
        expect(result.confirmed).toBe(0);
        expect(result.rejected).toBe(0);
    }, 30000);

    it('1 仮説が throw しても他の仮説は継続、errors に計上', async () => {
        mockEdgeLedger.findByStatus.mockResolvedValue([
            makeHyp('h1'),
            makeHyp('h2'),
        ]);
        mockValidate
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({
                verdict: 'confirmed',
                hypothesisId: 'h2',
                baseCriteriaReasons: [],
                decidedAt: new Date(),
            });

        const scheduler = new SideBScheduler({ fullValidationMaxPerRun: 5 });
        const result = await scheduler.runFullValidationNow();

        expect(result).toEqual({
            processed: 2,
            confirmed: 1,
            rejected: 0,
            notTestable: 0,
            errors: 1,
        });
    }, 30000);

    it('対象 0 件なら StrategistAgent は呼ばれない', async () => {
        mockEdgeLedger.findByStatus.mockResolvedValue([]);
        const scheduler = new SideBScheduler({ fullValidationMaxPerRun: 5 });
        const result = await scheduler.runFullValidationNow();

        expect(mockValidate).not.toHaveBeenCalled();
        expect(result.processed).toBe(0);
    }, 30000);

    it('findByStatus が throw しても呼び出し自体は成功して errors=0（集計前の失敗）', async () => {
        mockEdgeLedger.findByStatus.mockRejectedValue(new Error('db down'));
        const scheduler = new SideBScheduler({ fullValidationMaxPerRun: 5 });
        const result = await scheduler.runFullValidationNow();

        // 対象取得失敗時は addError されるが、関数自体は例外を投げず集計0で返す
        expect(result.processed).toBe(0);
        expect(mockValidate).not.toHaveBeenCalled();
    }, 10000);
});
