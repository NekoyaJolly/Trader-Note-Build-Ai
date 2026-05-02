/**
 * StrategistAgent のテスト（Phase 4c Step E）
 *
 * EdgeLedger / BacktesterAgent / StatusManager / AIProvider を全て
 * モックして、verdict の経路と LLM フォールバックを検証する。
 */

import { StrategistAgent } from '../../agents/StrategistAgent';
import type { EdgeHypothesis, ConsolidatedValidationReport } from '../../models/edgeHypothesis';
import type { ValidationToolResult } from '../../validation/tools/types';

function makeHypothesis(overrides?: Partial<EdgeHypothesis>): EdgeHypothesis {
    return {
        id: 'hyp-st-1',
        statement: 'テスト仮説',
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
        materializedTradeNoteIds: [],
        screeningResult: {
            executedAt: new Date().toISOString(),
            passed: true,
            metrics: { pf: 1.5, winRate: 0.6, tradeCount: 30 },
            screeningBacktestRunId: 'sbt-1',
        },
        ...overrides,
    };
}

function makeToolResult(
    toolName: string,
    passed: boolean,
    extra: Partial<ValidationToolResult> = {},
): ValidationToolResult {
    return {
        toolName,
        success: true,
        passed,
        metrics: {},
        durationMs: 1,
        ...extra,
    };
}

function makeReport(
    allPassed: boolean,
    overrides?: Partial<ConsolidatedValidationReport>,
): ConsolidatedValidationReport {
    return {
        hypothesisId: 'hyp-st-1',
        periodUsed: { start: '2025-01-01', end: '2025-12-31' },
        screening: makeToolResult('screening', true, {
            metrics: { pf: 1.5, winRate: 0.6, tradeCount: 30 },
        }),
        walkForward: makeToolResult('walk_forward', allPassed, {
            metrics: { overfitScore: allPassed ? 0.15 : 0.45 },
        }),
        monteCarlo: makeToolResult('monte_carlo', allPassed, {
            metrics: { p5FinalPnl: allPassed ? 50 : -30 },
        }),
        buyAndHold: makeToolResult('buy_and_hold', allPassed, {
            metrics: { outperformance: allPassed ? 0.02 : -0.01 },
        }),
        allPassed,
        passedCount: allPassed ? 4 : 1,
        totalCount: 4,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalDurationMs: 100,
        errors: [],
        ...overrides,
    };
}

interface Mocks {
    ledger: {
        get: jest.Mock;
        markTesting: jest.Mock;
        markNotTestable: jest.Mock;
        markConfirmedFull: jest.Mock;
        markRejectedFull: jest.Mock;
    };
    backtester: { runFullValidation: jest.Mock };
    statusManager: { canPromoteToConfirmedFull: jest.Mock };
    ai: { chat: jest.Mock };
}

function makeMocks(): Mocks {
    return {
        ledger: {
            get: jest.fn(),
            markTesting: jest.fn().mockResolvedValue(undefined),
            markNotTestable: jest.fn().mockResolvedValue(undefined),
            markConfirmedFull: jest.fn().mockResolvedValue(undefined),
            markRejectedFull: jest.fn().mockResolvedValue(undefined),
        },
        backtester: { runFullValidation: jest.fn() },
        statusManager: { canPromoteToConfirmedFull: jest.fn() },
        ai: { chat: jest.fn() },
    };
}

function makeAgent(mocks: Mocks) {
    return new StrategistAgent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mocks.ledger as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mocks.backtester as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mocks.statusManager as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mocks.ai as any,
    );
}

describe('StrategistAgent.validate', () => {
    it('仮説が存在しない場合は Error を投げる', async () => {
        const mocks = makeMocks();
        mocks.ledger.get.mockResolvedValue(null);
        await expect(makeAgent(mocks).validate('missing')).rejects.toThrow(/not found/);
    });

    it('screeningBacktestRunId が無ければ verdict=not_testable', async () => {
        const mocks = makeMocks();
        mocks.ledger.get.mockResolvedValue(makeHypothesis({
            screeningResult: {
                executedAt: new Date().toISOString(),
                passed: true,
                metrics: { pf: 1.5, winRate: 0.6, tradeCount: 30 },
            },
        }));
        const verdict = await makeAgent(mocks).validate('hyp-st-1', { skipLLM: true });
        expect(verdict.verdict).toBe('not_testable');
        expect(mocks.ledger.markNotTestable).toHaveBeenCalled();
        expect(mocks.backtester.runFullValidation).not.toHaveBeenCalled();
    });

    it('4 ツール全通過なら verdict=confirmed、markConfirmedFull が呼ばれる', async () => {
        const mocks = makeMocks();
        const hyp = makeHypothesis();
        const report = makeReport(true);
        mocks.ledger.get.mockResolvedValue(hyp);
        mocks.backtester.runFullValidation.mockResolvedValue(report);
        mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({ ok: true, reasons: [] });
        mocks.ai.chat.mockResolvedValue({
            content: JSON.stringify({
                interpretation: '良好なスクリーニング + WF/MC/BH すべて通過',
                actionableInsights: ['類似カテゴリの仮説を追加生成'],
            }),
            toolCalls: [],
            tokenUsage: 100,
            model: 'gemini-3-flash-preview',
            finishReason: 'stop',
        });

        const verdict = await makeAgent(mocks).validate('hyp-st-1');
        expect(verdict.verdict).toBe('confirmed');
        expect(verdict.interpretation).toContain('WF/MC/BH');
        expect(verdict.actionableInsights).toEqual(['類似カテゴリの仮説を追加生成']);
        expect(mocks.ledger.markTesting).toHaveBeenCalledWith('hyp-st-1');
        expect(mocks.ledger.markConfirmedFull).toHaveBeenCalledWith(
            'hyp-st-1',
            report,
            expect.stringContaining('WF/MC/BH'),
            ['類似カテゴリの仮説を追加生成'],
        );
        expect(mocks.ledger.markRejectedFull).not.toHaveBeenCalled();
    });

    it('ツール失敗で rejected になる場合 markRejectedFull が呼ばれる', async () => {
        const mocks = makeMocks();
        const hyp = makeHypothesis();
        const report = makeReport(false);
        mocks.ledger.get.mockResolvedValue(hyp);
        mocks.backtester.runFullValidation.mockResolvedValue(report);
        mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({
            ok: false,
            reasons: ['過学習スコア超過: 0.450', 'MonteCarlo 下側5%PnL マイナス: -30.00'],
        });
        mocks.ai.chat.mockResolvedValue({
            content: JSON.stringify({
                interpretation: '過学習気味で OOS で性能劣化。BH 比でも負けている。',
                actionableInsights: ['RR 条件の緩和を検討', '別カテゴリで再試行'],
            }),
            toolCalls: [],
            tokenUsage: 80,
            model: 'gemini-3-flash-preview',
            finishReason: 'stop',
        });

        const verdict = await makeAgent(mocks).validate('hyp-st-1');
        expect(verdict.verdict).toBe('rejected');
        expect(verdict.baseCriteriaReasons).toContain('過学習スコア超過: 0.450');
        expect(mocks.ledger.markRejectedFull).toHaveBeenCalledWith(
            'hyp-st-1',
            expect.stringContaining('過学習'),
            report,
            expect.stringContaining('BH'),
            ['RR 条件の緩和を検討', '別カテゴリで再試行'],
        );
        expect(mocks.ledger.markConfirmedFull).not.toHaveBeenCalled();
    });

    it('LLM 呼び出しが throw しても判定は完了する（interpretation=undefined）', async () => {
        const mocks = makeMocks();
        mocks.ledger.get.mockResolvedValue(makeHypothesis());
        mocks.backtester.runFullValidation.mockResolvedValue(makeReport(true));
        mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({ ok: true, reasons: [] });
        mocks.ai.chat.mockRejectedValue(new Error('429 quota exceeded'));

        const verdict = await makeAgent(mocks).validate('hyp-st-1');
        expect(verdict.verdict).toBe('confirmed');
        expect(verdict.interpretation).toBeUndefined();
        expect(verdict.actionableInsights).toBeUndefined();
        expect(mocks.ledger.markConfirmedFull).toHaveBeenCalledWith(
            'hyp-st-1',
            expect.any(Object),
            undefined,
            undefined,
        );
    });

    it('LLM 出力が JSON ではない場合 interpretation=undefined でフォールバック', async () => {
        const mocks = makeMocks();
        mocks.ledger.get.mockResolvedValue(makeHypothesis());
        mocks.backtester.runFullValidation.mockResolvedValue(makeReport(true));
        mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({ ok: true, reasons: [] });
        mocks.ai.chat.mockResolvedValue({
            content: 'これは JSON ではないテキストです',
            toolCalls: [],
            tokenUsage: 50,
            model: 'gemini-3-flash-preview',
            finishReason: 'stop',
        });

        const verdict = await makeAgent(mocks).validate('hyp-st-1');
        expect(verdict.verdict).toBe('confirmed');
        expect(verdict.interpretation).toBeUndefined();
    });

    it('LLM がコードフェンス付きで返しても JSON を抽出できる', async () => {
        const mocks = makeMocks();
        mocks.ledger.get.mockResolvedValue(makeHypothesis());
        mocks.backtester.runFullValidation.mockResolvedValue(makeReport(true));
        mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({ ok: true, reasons: [] });
        mocks.ai.chat.mockResolvedValue({
            content: '```json\n{"interpretation": "ok", "actionableInsights": []}\n```',
            toolCalls: [],
            tokenUsage: 50,
            model: 'gemini-3-flash-preview',
            finishReason: 'stop',
        });

        const verdict = await makeAgent(mocks).validate('hyp-st-1');
        expect(verdict.verdict).toBe('confirmed');
        expect(verdict.interpretation).toBe('ok');
        expect(verdict.actionableInsights).toEqual([]);
    });

    it('skipLLM=true なら AIProvider.chat は呼ばれず interpretation も付かない', async () => {
        const mocks = makeMocks();
        mocks.ledger.get.mockResolvedValue(makeHypothesis());
        mocks.backtester.runFullValidation.mockResolvedValue(makeReport(true));
        mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({ ok: true, reasons: [] });

        const verdict = await makeAgent(mocks).validate('hyp-st-1', { skipLLM: true });
        expect(verdict.verdict).toBe('confirmed');
        expect(mocks.ai.chat).not.toHaveBeenCalled();
        expect(verdict.interpretation).toBeUndefined();
    });

    it('BacktesterAgent が throw したら markNotTestable / verdict=not_testable', async () => {
        const mocks = makeMocks();
        mocks.ledger.get.mockResolvedValue(makeHypothesis());
        mocks.backtester.runFullValidation.mockRejectedValue(new Error('python container down'));

        const verdict = await makeAgent(mocks).validate('hyp-st-1', { skipLLM: true });
        expect(verdict.verdict).toBe('not_testable');
        expect(verdict.baseCriteriaReasons[0]).toContain('python container down');
        expect(mocks.ledger.markNotTestable).toHaveBeenCalled();
        expect(mocks.ledger.markConfirmedFull).not.toHaveBeenCalled();
        expect(mocks.ledger.markRejectedFull).not.toHaveBeenCalled();
    });

    it('options.period を渡すと BacktesterAgent にその期間が伝わる', async () => {
        const mocks = makeMocks();
        mocks.ledger.get.mockResolvedValue(makeHypothesis());
        mocks.backtester.runFullValidation.mockResolvedValue(makeReport(true));
        mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({ ok: true, reasons: [] });

        const period = { start: '2024-06-01', end: '2024-12-31' };
        await makeAgent(mocks).validate('hyp-st-1', { period, skipLLM: true });

        expect(mocks.backtester.runFullValidation).toHaveBeenCalledWith(
            expect.any(Object),
            'sbt-1',
            period,
        );
    });
});
