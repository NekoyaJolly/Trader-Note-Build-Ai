/**
 * SideBScheduler.runEvolutionNow Phase A multi-generation テスト
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.A
 *
 * 検証内容:
 * - evolutionGenerations=1 (default) で従来単世代経路 (= EvolutionLoop.runOneGeneration 直接呼び出し、
 *   multiGenerationRunner は使われない、後方互換)
 * - evolutionGenerations>=2 で runMultiGenerationEvolutionV1 経由になり、世代数が伝播する
 * - env EVOLUTION_GENERATIONS / EVOLUTION_ADAPTIVE_BUDGET / EVOLUTION_QD_ARCHIVE が config に反映される
 * - env 不正値 (範囲外整数 / 文字列) は無視される (= warning + DEFAULT_CONFIG)
 *
 * 重い依存 (StrategyPopulation / EvolutionLoop / multiGenerationRunner / ML deps) は
 * jest.mock で全て差し替える。本ファイルは「scheduler の dispatch logic」だけを検証する。
 */

import type { GenerationReport } from '../evolution/EvolutionLoop';
import type { MultiGenerationRunReport } from '../evolution/multiGenerationRunner';

// =================================================================
// jest.mock: scheduler が import する重い依存を全部差し替える
// =================================================================

jest.mock('../ledger', () => ({
  edgeLedger: {
    findByStatus: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../agents/StrategistAgent', () => ({
  strategistAgent: { validate: jest.fn() },
}));

jest.mock('../agents/CrossoverAgent', () => ({
  CrossoverAgent: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../agents/MutationAgent', () => ({
  MutationAgent: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../evolution/StrategyPopulation', () => ({
  StrategyPopulation: jest.fn().mockImplementation(() => ({
    load: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    getByRegime: jest.fn().mockReturnValue([]),
  })),
}));

jest.mock('../evolution/DiversityEnforcer', () => ({
  DiversityEnforcer: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../strategy_dsl/SurrogateFitnessSimulator', () => ({
  SurrogateFitnessSimulator: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../evolution/analysisEngineRobustnessAdapter', () => ({
  defaultOosBacktestRunner: jest.fn(),
}));

const runOneGenerationMock = jest.fn();
jest.mock('../evolution/EvolutionLoop', () => ({
  EvolutionLoop: jest.fn().mockImplementation(() => ({
    runOneGeneration: runOneGenerationMock,
  })),
}));

const runMultiGenMock = jest.fn();
jest.mock('../evolution/multiGenerationRunner', () => ({
  // 実 module の export と整合させる: MULTI_GENERATION_DEFAULTS を残しつつ runner を mock 化
  MULTI_GENERATION_DEFAULTS: { defaultGenerations: 2, maxGenerations: 5 },
  runMultiGenerationEvolutionV1: runMultiGenMock,
}));

jest.mock('../agent', () => ({
  pdcaLoop: {
    notifyAnalysisComplete: jest.fn(),
    notifyStrategyComplete: jest.fn(),
    notifyTradeCompleted: jest.fn(),
    notifyValidationBatchComplete: jest.fn(),
  },
}));

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
jest.mock('../services/cronSimilarityService');
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

// ---------- 本体 ----------

import { SideBScheduler } from '../jobs/sideBScheduler';

function makeReport(regime: string, candidates = 0): GenerationReport {
  return {
    regime,
    scores: {},
    eliteIds: [],
    mutantsReceived: 0,
    crossoversReceived: 0,
    addedToPopulation: 0,
    formalBtVerifiedCandidates: [],
    promotionCandidates: [],
    lowDiversityBoost: false,
    errors: [],
    parentPoolSummary: {
      totalSelected: 0,
      bySource: {
        formal_bt_passed: 0,
        current_population: 0,
        novelty_seed: 0,
        edge_hypothesis: 0,
      },
      fallbackToCurrentOnly: false,
    },
    formalBtCandidateSummary: {
      uniqueCandidates: candidates,
      byRoute: {
        normal_pass: 0,
        near_miss_rescue: 0,
        low_drawdown_rescue: 0,
        trade_count_rescue: 0,
        novelty_rescue: 0,
        kill: 0,
      },
      duplicatesRemoved: 0,
      fallbackUsed: false,
    },
    repairHintSummary: {
      totalFailures: 0,
      bySeverity: { low: 0, medium: 0, high: 0, fatal: 0 },
      byFailureReason: {},
      byRoute: {},
    },
    promotionGateSummary: {
      total: 0,
      byStage: {
        parent_eligible: 0,
        formal_bt_candidate: 0,
        validation_candidate: 0,
        repairable: 0,
        repair_excluded: 0,
        validation_confirmed: 0,
        production_candidate: 0,
      },
      byDecision: {
        promote: 0,
        hold: 0,
        reject: 0,
      },
      byReason: {},
    },
    promotionGateDecisions: [],
    repairOutcomeSummary: {
      total: 0,
      byOutcome: {
        improved: 0,
        worsened: 0,
        unchanged: 0,
        unknown: 0,
      },
      byActionTarget: {},
      byRoute: {},
      improved: 0,
      worsened: 0,
      unchanged: 0,
      unknown: 0,
    },
    repairOutcomes: [],
    oosValidationSummary: {
      total: 0,
      byStatus: {
        oos_passed: 0,
        oos_failed: 0,
        walk_forward_passed: 0,
        walk_forward_failed: 0,
        not_evaluated: 0,
        insufficient_oos_data: 0,
        oos_engine_error: 0,
      },
      byRoute: {},
    },
    oosValidationResults: [],
    oosAwarePromotionSummary: {
      total: 0,
      validationConfirmed: 0,
      hold: 0,
      productionEligibleChanged: false,
    },
    oosAwarePromotionDecisions: [],
  } as unknown as GenerationReport;
}

function makeMultiGenReport(regime: string, generations: number): MultiGenerationRunReport {
  const generationEntries = Array.from({ length: generations }, (_, i) => ({
    generationIndex: i,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'completed' as const,
    report: makeReport(regime, i + 1),
    warnings: [],
  }));
  // PR #138 Copilot review #5: generations に応じた配列長を Array.from で常に生成する
  // (= 旧実装の [0,0,0].slice() だと generations >= 4 で配列長不足、将来テスト拡張時に落とし穴)
  const zerosByGen = Array.from({ length: generations }, () => 0);
  return {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    options: {
      generations,
      regime,
    },
    generations: generationEntries,
    trendSummary: {
      generationsRequested: generations,
      generationsCompleted: generations,
      generationsFailed: 0,
      stoppedEarly: false,
      stopReason: null,
      formalBtCandidatesByGeneration: generationEntries.map((_, i) => i + 1),
      formalBtPassedByGeneration: generationEntries.map((_, i) => i + 1),
      repairHintsByGeneration: [...zerosByGen],
      repairOutcomeImprovedByGeneration: [...zerosByGen],
      validationCandidatesByGeneration: generationEntries.map((_, i) => i + 1),
      validationConfirmedByGeneration: [...zerosByGen],
      oosPassedByGeneration: [...zerosByGen],
      oosFailedByGeneration: [...zerosByGen],
      productionEligibleByGeneration: [...zerosByGen],
      warnings: [],
    },
    finalState: {
      lastRepairHints: new Map(),
      lastRepairBaselines: new Map(),
      lastPromotionGateDecisions: [],
      lastOosValidationResults: [],
      warnings: [],
    },
    warnings: [],
  };
}

// 30 秒スリープを即時化
function mockSleepToInstant() {
  const realSetTimeout = global.setTimeout;
  jest.spyOn(global, 'setTimeout').mockImplementation(((
    cb: (...args: unknown[]) => void,
    _ms?: number,
  ) => realSetTimeout(cb, 0)));
}

describe('SideBScheduler.runEvolutionNow Phase A multi-generation', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSleepToInstant();
    runOneGenerationMock.mockReset();
    runMultiGenMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('evolutionGenerations=1 (default) では runOneGeneration を regime 数だけ呼び、multi-gen runner は呼ばない', async () => {
    runOneGenerationMock.mockImplementation((regime: string) =>
      Promise.resolve(makeReport(regime, 1)),
    );

    const scheduler = new SideBScheduler({
      evolutionRegimes: ['breakout', 'reversal'],
      evolutionGenerations: 1,
    });
    const result = await scheduler.runEvolutionNow();

    expect(runOneGenerationMock).toHaveBeenCalledTimes(2);
    expect(runOneGenerationMock).toHaveBeenNthCalledWith(1, 'breakout');
    expect(runOneGenerationMock).toHaveBeenNthCalledWith(2, 'reversal');
    expect(runMultiGenMock).not.toHaveBeenCalled();
    expect(result.regimeReports).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('evolutionGenerations=3 で runMultiGenerationEvolutionV1 が regime 数だけ呼ばれ、generations が伝播する', async () => {
    runMultiGenMock.mockImplementation(({ options, runOneGeneration }) => {
      // runner adapter が呼ばれることを最低限検証
      expect(typeof runOneGeneration).toBe('function');
      return Promise.resolve(makeMultiGenReport(options.regime, options.generations));
    });

    const scheduler = new SideBScheduler({
      evolutionRegimes: ['breakout', 'reversal'],
      evolutionGenerations: 3,
      evolutionAdaptiveBudget: true,
      evolutionQDArchive: true,
      evolutionQDParentLimit: 4,
    });
    const result = await scheduler.runEvolutionNow();

    expect(runMultiGenMock).toHaveBeenCalledTimes(2);
    // 1 回目の呼び出し options を検証
    const firstCall = runMultiGenMock.mock.calls[0][0];
    expect(firstCall.options).toMatchObject({
      generations: 3,
      regime: 'breakout',
      adaptiveRepairBudget: true,
      qualityDiversityArchive: true,
      qualityDiversityArchiveParentLimit: 4,
    });
    expect(runOneGenerationMock).not.toHaveBeenCalled();
    // 各 regime 3 世代 × 2 regime = 6 件カウント
    expect(result.regimeReports).toBe(6);
  });

  it('multi-gen 経路で 1 regime 失敗しても他 regime は処理を続ける', async () => {
    runMultiGenMock
      .mockImplementationOnce(() => {
        throw new Error('analysis-engine timeout');
      })
      .mockImplementationOnce(({ options }) =>
        Promise.resolve(makeMultiGenReport(options.regime, options.generations)),
      );

    const scheduler = new SideBScheduler({
      evolutionRegimes: ['breakout', 'reversal'],
      evolutionGenerations: 2,
    });
    const result = await scheduler.runEvolutionNow();

    expect(runMultiGenMock).toHaveBeenCalledTimes(2);
    // 失敗 regime は generation 単位ではカウントされず、成功 regime の 2 世代分のみ
    expect(result.regimeReports).toBe(2);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('analysis-engine timeout')]),
    );
  });

  it('env EVOLUTION_GENERATIONS=2 で multi-gen 経路に切り替わる', async () => {
    process.env.EVOLUTION_GENERATIONS = '2';
    runMultiGenMock.mockImplementation(({ options }) =>
      Promise.resolve(makeMultiGenReport(options.regime, options.generations)),
    );

    const scheduler = new SideBScheduler({
      evolutionRegimes: ['breakout'],
      // evolutionGenerations は未指定 → env の 2 が反映される
    });
    await scheduler.runEvolutionNow();

    expect(runMultiGenMock).toHaveBeenCalledTimes(1);
    expect(runMultiGenMock.mock.calls[0][0].options.generations).toBe(2);
    expect(runOneGenerationMock).not.toHaveBeenCalled();
  });

  it('env EVOLUTION_ADAPTIVE_BUDGET=true / EVOLUTION_QD_ARCHIVE=true / EVOLUTION_QD_PARENT_LIMIT=3 が config に反映される', async () => {
    process.env.EVOLUTION_GENERATIONS = '2';
    process.env.EVOLUTION_ADAPTIVE_BUDGET = 'true';
    process.env.EVOLUTION_QD_ARCHIVE = 'true';
    process.env.EVOLUTION_QD_PARENT_LIMIT = '3';
    runMultiGenMock.mockImplementation(({ options }) =>
      Promise.resolve(makeMultiGenReport(options.regime, options.generations)),
    );

    const scheduler = new SideBScheduler({ evolutionRegimes: ['breakout'] });
    await scheduler.runEvolutionNow();

    const call = runMultiGenMock.mock.calls[0][0];
    expect(call.options).toMatchObject({
      generations: 2,
      adaptiveRepairBudget: true,
      qualityDiversityArchive: true,
      qualityDiversityArchiveParentLimit: 3,
    });
  });

  it('env EVOLUTION_GENERATIONS=invalid (範囲外整数) は無視され、default=1 (= 単世代) で動く', async () => {
    process.env.EVOLUTION_GENERATIONS = '99'; // max=5 を超過
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    runOneGenerationMock.mockImplementation((regime: string) =>
      Promise.resolve(makeReport(regime, 1)),
    );

    const scheduler = new SideBScheduler({ evolutionRegimes: ['breakout'] });
    await scheduler.runEvolutionNow();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('EVOLUTION_GENERATIONS=99'),
    );
    // default=1 で単世代経路
    expect(runOneGenerationMock).toHaveBeenCalledTimes(1);
    expect(runMultiGenMock).not.toHaveBeenCalled();
  });

  it('configOverride 引数 > env > DEFAULT_CONFIG の優先順位', async () => {
    process.env.EVOLUTION_GENERATIONS = '3';
    runMultiGenMock.mockImplementation(({ options }) =>
      Promise.resolve(makeMultiGenReport(options.regime, options.generations)),
    );

    // configOverride で 2 を明示 → env の 3 を上書き
    const scheduler = new SideBScheduler({
      evolutionRegimes: ['breakout'],
      evolutionGenerations: 2,
    });
    await scheduler.runEvolutionNow();

    expect(runMultiGenMock.mock.calls[0][0].options.generations).toBe(2);
  });

  // PR #138 Copilot review: 厳密整数チェック / 想定外 bool 文字列 / config 値 clamp
  describe('PR #138 Copilot review 対応', () => {
    it("EVOLUTION_GENERATIONS='2abc' (parseInt 受理だが厳密整数ではない) は warning + 無視", async () => {
      process.env.EVOLUTION_GENERATIONS = '2abc';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      runOneGenerationMock.mockImplementation((regime: string) =>
        Promise.resolve(makeReport(regime, 1)),
      );

      const scheduler = new SideBScheduler({ evolutionRegimes: ['breakout'] });
      await scheduler.runEvolutionNow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EVOLUTION_GENERATIONS=2abc'),
      );
      // default=1 で単世代経路
      expect(runMultiGenMock).not.toHaveBeenCalled();
      expect(runOneGenerationMock).toHaveBeenCalledTimes(1);
    });

    it("EVOLUTION_GENERATIONS='2.9' (小数表記) は warning + 無視", async () => {
      process.env.EVOLUTION_GENERATIONS = '2.9';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      runOneGenerationMock.mockImplementation((regime: string) =>
        Promise.resolve(makeReport(regime, 1)),
      );

      const scheduler = new SideBScheduler({ evolutionRegimes: ['breakout'] });
      await scheduler.runEvolutionNow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EVOLUTION_GENERATIONS=2.9'),
      );
      expect(runMultiGenMock).not.toHaveBeenCalled();
    });

    it("EVOLUTION_ADAPTIVE_BUDGET='yes' (= 想定外文字列) は warning + DEFAULT_CONFIG (false) を維持", async () => {
      process.env.EVOLUTION_GENERATIONS = '2';
      process.env.EVOLUTION_ADAPTIVE_BUDGET = 'yes';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      runMultiGenMock.mockImplementation(({ options }) =>
        Promise.resolve(makeMultiGenReport(options.regime, options.generations)),
      );

      const scheduler = new SideBScheduler({ evolutionRegimes: ['breakout'] });
      await scheduler.runEvolutionNow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EVOLUTION_ADAPTIVE_BUDGET=yes'),
      );
      // DEFAULT_CONFIG.evolutionAdaptiveBudget は false なので、runner には false が渡る
      expect(runMultiGenMock.mock.calls[0][0].options.adaptiveRepairBudget).toBe(false);
    });

    it("EVOLUTION_QD_PARENT_LIMIT='3foo' (= parseInt 受理だが厳密整数ではない) は warning + 無視", async () => {
      process.env.EVOLUTION_GENERATIONS = '2';
      process.env.EVOLUTION_QD_PARENT_LIMIT = '3foo';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      runMultiGenMock.mockImplementation(({ options }) =>
        Promise.resolve(makeMultiGenReport(options.regime, options.generations)),
      );

      const scheduler = new SideBScheduler({ evolutionRegimes: ['breakout'] });
      await scheduler.runEvolutionNow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EVOLUTION_QD_PARENT_LIMIT=3foo'),
      );
      // DEFAULT_CONFIG.evolutionQDParentLimit は 2
      expect(runMultiGenMock.mock.calls[0][0].options.qualityDiversityArchiveParentLimit).toBe(2);
    });

    it('configOverride で範囲外の値 (=0) を渡すと scheduler 側で clamp して動く', async () => {
      // configOverride 経由で 0 を渡す → scheduler で max(1, ...) に clamp される
      runOneGenerationMock.mockImplementation((regime: string) =>
        Promise.resolve(makeReport(regime, 1)),
      );

      const scheduler = new SideBScheduler({
        evolutionRegimes: ['breakout'],
        evolutionGenerations: 0,
      });
      const result = await scheduler.runEvolutionNow();

      // generations=1 (clamp 後) → 単世代経路
      expect(runMultiGenMock).not.toHaveBeenCalled();
      expect(runOneGenerationMock).toHaveBeenCalledTimes(1);
      expect(result.regimeReports).toBe(1);
    });

    it('configOverride で範囲外の値 (=99) を渡すと scheduler 側で max=5 に clamp', async () => {
      runMultiGenMock.mockImplementation(({ options }) =>
        Promise.resolve(makeMultiGenReport(options.regime, options.generations)),
      );

      const scheduler = new SideBScheduler({
        evolutionRegimes: ['breakout'],
        evolutionGenerations: 99,
      });
      await scheduler.runEvolutionNow();

      // 5 (= MULTI_GENERATION_DEFAULTS.maxGenerations) に clamp
      expect(runMultiGenMock.mock.calls[0][0].options.generations).toBe(5);
    });
  });
});
