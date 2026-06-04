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

/**
 * 実ゲート統合テスト (#6: OOS/WF 過学習ゲートの実効性を固定する)
 *
 * 上の describe は statusManager をモックして検証経路だけを見るが、ここでは
 * **実 StatusManager (default)** を validateHypothesis に通し、過学習候補が
 * 実際に confirmed を遮断されることを end-to-end で固定する。
 *
 * 背景: 「過学習(WF<0.3 未達)でも confirmed に昇格してしまう穴」が無いことが #6 の論点。
 * 実ゲート (canPromoteToConfirmedFull) は WF/MC/BH/screening/トレード数を AND 強制するが、
 * validateHypothesis がその結果を正しく反映して markConfirmedFull / markRejectedFull を
 * 分岐していることまで含めて回帰で守る。
 */
describe('validateHypothesis 実ゲート統合 (statusManager をモックしない)', () => {
  /** statusManager を省いて default の実 StatusManager を使う deps。 */
  function realGateDeps(mocks: Mocks): HypothesisValidationDeps {
    return {
      edgeLedger: mocks.ledger,
      backtester: mocks.backtester,
      // statusManager は渡さない → validateHypothesis が defaultStatusManager を使う
    };
  }

  it('WF passed=false(過学習) の候補は実ゲートで rejected になり confirmed に昇格しない', async () => {
    const mocks = makeMocks();
    // makeReport(false) は WF overfitScore=0.45 / MC 下側PnL=-30 / BH -0.01 で全滅
    const report = makeReport(false);
    mocks.ledger.get.mockResolvedValue(makeHypothesis());
    mocks.backtester.runFullValidation.mockResolvedValue(report);

    const verdict = await validateHypothesis('hyp-st-1', {}, realGateDeps(mocks));

    expect(verdict.verdict).toBe('rejected');
    expect(verdict.baseCriteriaReasons.some((r) => r.includes('過学習'))).toBe(true);
    // 結線の回帰を検知するため id / reason(過学習) / report まで固定する
    expect(mocks.ledger.markRejectedFull).toHaveBeenCalledWith(
      'hyp-st-1',
      expect.stringContaining('過学習'),
      report,
    );
    expect(mocks.ledger.markConfirmedFull).not.toHaveBeenCalled();
  });

  it('WF 未実施(walkForward 欠落) の候補は実ゲートで rejected になり confirmed に昇格しない', async () => {
    const mocks = makeMocks();
    // 他ツールは通過させ、WF だけ欠落させる = 「未検証で素通り」が起きないことを固定
    const report = makeReport(true, { walkForward: undefined });
    mocks.ledger.get.mockResolvedValue(makeHypothesis());
    mocks.backtester.runFullValidation.mockResolvedValue(report);

    const verdict = await validateHypothesis('hyp-st-1', {}, realGateDeps(mocks));

    expect(verdict.verdict).toBe('rejected');
    expect(verdict.baseCriteriaReasons.some((r) => r.includes('WalkForward'))).toBe(true);
    // rejected 分岐の結線を固定: id / reason(WalkForward) / report まで検証する
    expect(mocks.ledger.markRejectedFull).toHaveBeenCalledWith(
      'hyp-st-1',
      expect.stringContaining('WalkForward'),
      report,
    );
    expect(mocks.ledger.markConfirmedFull).not.toHaveBeenCalled();
  });

  it('4 ツール全通過(WF overfit<0.3) の候補のみ実ゲートで confirmed になる', async () => {
    const mocks = makeMocks();
    const report = makeReport(true);
    mocks.ledger.get.mockResolvedValue(makeHypothesis());
    mocks.backtester.runFullValidation.mockResolvedValue(report);

    const verdict = await validateHypothesis('hyp-st-1', {}, realGateDeps(mocks));

    expect(verdict.verdict).toBe('confirmed');
    expect(mocks.ledger.markConfirmedFull).toHaveBeenCalledWith('hyp-st-1', report);
    expect(mocks.ledger.markRejectedFull).not.toHaveBeenCalled();
  });
});
