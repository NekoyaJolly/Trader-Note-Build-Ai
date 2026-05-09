/**
 * SideBScheduler.runEvolutionCarryRetentionNow Phase B-3 テスト
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.4
 *
 * 検証内容:
 * - `evolutionInstanceCarryRepository.deleteOlderThan(14)` が呼ばれる
 * - 削除件数 > 0 のとき console.info で本番でも Cloud Logging に出るログ
 *   (= `this.log()` の production no-op 問題対応、PR #142 Copilot review #1)
 * - 削除件数 = 0 のときログを出さない (= ノイズ抑制)
 * - 例外時は飲んで継続 + addError でエラーリストに記録 (PR #142 Copilot review #2)
 */

const mockDeleteOlderThan = jest.fn();

jest.mock('../../backend/repositories/evolutionInstanceCarryRepository', () => ({
  evolutionInstanceCarryRepository: {
    deleteOlderThan: mockDeleteOlderThan,
    // 他メソッドは Phase B-3 では呼ばれないが念のため stub
    create: jest.fn(),
    findLatestByRegime: jest.fn(),
  },
}));

// SideBScheduler の重い依存を全 stub 化
jest.mock('../ledger', () => ({ edgeLedger: { findByStatus: jest.fn() } }));
jest.mock('../agents/StrategistAgent', () => ({ strategistAgent: { validate: jest.fn() } }));
jest.mock('../agents/CrossoverAgent', () => ({ CrossoverAgent: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../agents/MutationAgent', () => ({ MutationAgent: jest.fn().mockImplementation(() => ({})) }));
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
jest.mock('../evolution/EvolutionLoop', () => ({
  EvolutionLoop: jest.fn().mockImplementation(() => ({ runOneGeneration: jest.fn() })),
}));
jest.mock('../evolution/multiGenerationRunner', () => ({
  MULTI_GENERATION_DEFAULTS: { defaultGenerations: 2, maxGenerations: 5 },
  runMultiGenerationEvolutionV1: jest.fn(),
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
  getMarketStatusJST: jest.fn(() => ({ isOpen: true, isDST: false, message: '', nextEvent: '' })),
}));
jest.mock('../../services/marketDataService');
jest.mock('../orchestrator/aiOrchestrator');
jest.mock('../services/cronSimilarityService');
jest.mock('../services/summarySchedulerService', () => ({
  summarySchedulerService: {
    start: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(() => ({ isRunning: false, config: { weeklyEnabled: false, monthlyEnabled: false } })),
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

import { SideBScheduler } from '../jobs/sideBScheduler';

describe('SideBScheduler.runEvolutionCarryRetentionNow (Phase B-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteOlderThan.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deleteOlderThan(14) を呼び、削除件数を返す', async () => {
    mockDeleteOlderThan.mockResolvedValue(5);
    const scheduler = new SideBScheduler();
    const result = await scheduler.runEvolutionCarryRetentionNow();

    expect(mockDeleteOlderThan).toHaveBeenCalledTimes(1);
    expect(mockDeleteOlderThan).toHaveBeenCalledWith(14);
    expect(result.deleted).toBe(5);
    expect(result.error).toBeUndefined();
  });

  it('削除件数 > 0 のとき console.info で本番でも Cloud Logging に出るログを出す', async () => {
    mockDeleteOlderThan.mockResolvedValue(7);
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    const scheduler = new SideBScheduler();
    await scheduler.runEvolutionCarryRetentionNow();

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Phase B-3] EvolutionInstanceCarry retention: 7 件削除'),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('14 日より古い行'),
    );
  });

  it('削除件数 = 0 のとき console.info を呼ばない (= ノイズ抑制)', async () => {
    mockDeleteOlderThan.mockResolvedValue(0);
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    const scheduler = new SideBScheduler();
    const result = await scheduler.runEvolutionCarryRetentionNow();

    expect(result.deleted).toBe(0);
    // 0 件削除のログは出さない (= 通常運転時のノイズを避ける)
    const phaseLog = infoSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('[Phase B-3]') : false,
    );
    expect(phaseLog).toBeUndefined();
  });

  it('repo 例外時は飲んで {deleted: 0, error: ...} を返す + addError', async () => {
    mockDeleteOlderThan.mockRejectedValue(new Error('DB connection lost'));

    const scheduler = new SideBScheduler();
    const result = await scheduler.runEvolutionCarryRetentionNow();

    // 例外を上に投げず、エラー情報だけ返す
    expect(result.deleted).toBe(0);
    expect(result.error).toContain('DB connection lost');

    // scheduler の errors[] に記録されている (= addError 経路)
    const status = scheduler.getStatus();
    expect(status.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('[Phase B-3] EvolutionInstanceCarry retention 失敗')]),
    );
  });

  it('production NODE_ENV でも console.info は no-op にならず Cloud Logging へ出る (= this.log とは異なる経路)', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      mockDeleteOlderThan.mockResolvedValue(3);
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

      const scheduler = new SideBScheduler();
      await scheduler.runEvolutionCarryRetentionNow();

      // production でも console.info は呼ばれる (= PR #142 Copilot review #1 の修正趣旨)
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Phase B-3] EvolutionInstanceCarry retention: 3 件削除'),
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
