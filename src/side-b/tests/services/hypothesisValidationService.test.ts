/**
 * hypothesisValidationService のテスト (Step D-1)
 *
 * 旧 StrategistAgent (廃止) の決定論検証ロジックを引き継ぐ。
 * EdgeLedger / BacktesterAgent / StatusManager をモックして verdict 経路を検証する。
 * LLM 解釈は撤廃済のため、interpretation 系のテストは存在しない (= BT メトリクス機械判定のみ)。
 */

import {
  validateHypothesis,
  type HypothesisValidationDeps,
} from '../../services/hypothesisValidationService';
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
  };
}

/** Mocks を Pick ベースの deps として渡す (= as any を使わず型契約を満たす)。 */
function toDeps(mocks: Mocks): HypothesisValidationDeps {
  return {
    edgeLedger: mocks.ledger,
    backtester: mocks.backtester,
    statusManager: mocks.statusManager,
  };
}

describe('validateHypothesis', () => {
  it('仮説が存在しない場合は Error を投げる', async () => {
    const mocks = makeMocks();
    mocks.ledger.get.mockResolvedValue(null);
    await expect(validateHypothesis('missing', {}, toDeps(mocks))).rejects.toThrow(/not found/);
  });

  it('screeningBacktestRunId が無ければ verdict=not_testable', async () => {
    const mocks = makeMocks();
    mocks.ledger.get.mockResolvedValue(
      makeHypothesis({
        screeningResult: {
          executedAt: new Date().toISOString(),
          passed: true,
          metrics: { pf: 1.5, winRate: 0.6, tradeCount: 30 },
        },
      }),
    );
    const verdict = await validateHypothesis('hyp-st-1', {}, toDeps(mocks));
    expect(verdict.verdict).toBe('not_testable');
    expect(mocks.ledger.markNotTestable).toHaveBeenCalled();
    expect(mocks.backtester.runFullValidation).not.toHaveBeenCalled();
  });

  it('4 ツール全通過なら verdict=confirmed、markConfirmedFull が呼ばれる (interpretation なし)', async () => {
    const mocks = makeMocks();
    const report = makeReport(true);
    mocks.ledger.get.mockResolvedValue(makeHypothesis());
    mocks.backtester.runFullValidation.mockResolvedValue(report);
    mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({ ok: true, reasons: [] });

    const verdict = await validateHypothesis('hyp-st-1', {}, toDeps(mocks));
    expect(verdict.verdict).toBe('confirmed');
    expect(mocks.ledger.markTesting).toHaveBeenCalledWith('hyp-st-1');
    // LLM 解釈撤廃により markConfirmedFull は (id, report) の 2 引数のみ
    expect(mocks.ledger.markConfirmedFull).toHaveBeenCalledWith('hyp-st-1', report);
    expect(mocks.ledger.markRejectedFull).not.toHaveBeenCalled();
  });

  it('ツール失敗で rejected になる場合 markRejectedFull が呼ばれる', async () => {
    const mocks = makeMocks();
    const report = makeReport(false);
    mocks.ledger.get.mockResolvedValue(makeHypothesis());
    mocks.backtester.runFullValidation.mockResolvedValue(report);
    mocks.statusManager.canPromoteToConfirmedFull.mockReturnValue({
      ok: false,
      reasons: ['過学習スコア超過: 0.450', 'MonteCarlo 下側5%PnL マイナス: -30.00'],
    });

    const verdict = await validateHypothesis('hyp-st-1', {}, toDeps(mocks));
    expect(verdict.verdict).toBe('rejected');
    expect(verdict.baseCriteriaReasons).toContain('過学習スコア超過: 0.450');
    expect(mocks.ledger.markRejectedFull).toHaveBeenCalledWith(
      'hyp-st-1',
      expect.stringContaining('過学習'),
      report,
    );
    expect(mocks.ledger.markConfirmedFull).not.toHaveBeenCalled();
  });

  it('BacktesterAgent が throw したら markNotTestable / verdict=not_testable', async () => {
    const mocks = makeMocks();
    mocks.ledger.get.mockResolvedValue(makeHypothesis());
    mocks.backtester.runFullValidation.mockRejectedValue(new Error('python container down'));

    const verdict = await validateHypothesis('hyp-st-1', {}, toDeps(mocks));
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
    await validateHypothesis('hyp-st-1', { period }, toDeps(mocks));

    expect(mocks.backtester.runFullValidation).toHaveBeenCalledWith(
      expect.any(Object),
      'sbt-1',
      period,
    );
  });
});
