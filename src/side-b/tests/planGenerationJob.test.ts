/**
 * PlanGenerationJob 単体テスト (PR-5 / Phase 7: テスト整理)
 *
 * Plan 生成は既存 Scheduler テストがないため、Job 単体として基本挙動を固定化。
 */

jest.mock('../services/virtualTradeService', () => ({
  createTradeFromPlan: jest.fn(),
}));
jest.mock('../repositories', () => ({
  researchRepository: { findById: jest.fn() },
  researchOutputRepository: { findById: jest.fn() },
}));
jest.mock('../../backend/repositories/ohlcvRepository', () => ({
  ohlcvRepository: { bulkInsert: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../agent', () => ({
  pdcaLoop: {
    notifyAnalysisComplete: jest.fn(),
    notifyStrategyComplete: jest.fn(),
  },
}));

import { PlanGenerationJob, type PlanGenerationJobServices } from '../jobs/planGenerationJob';
import { createTradeFromPlan } from '../services/virtualTradeService';
import { researchRepository, researchOutputRepository } from '../repositories';
import { pdcaLoop } from '../agent';
import type { SideBSchedulerConfig } from '../jobs/sideBScheduler';

const mockCreateTradeFromPlan = createTradeFromPlan as jest.Mock;

function makeServices(): PlanGenerationJobServices {
  const marketDataService = {
    getHistoricalData: jest.fn().mockResolvedValue([
      { timestamp: new Date('2024-01-01T00:00:00Z'), open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
    ]),
    isCTraderAvailable: jest.fn().mockReturnValue(false),
  } as unknown as PlanGenerationJobServices['marketDataService'];
  const orchestrator = {
    generatePlan: jest.fn().mockResolvedValue({
      success: true,
      data: { id: 'plan-1', scenarios: [], researchId: null },
    }),
  } as unknown as PlanGenerationJobServices['orchestrator'];
  return { marketDataService, orchestrator };
}

function makeJob(opts: {
  onSymbolCompleted?: (s: string, d: Date) => void;
  getLastSymbolRun?: (s: string) => Date | undefined;
} = {}) {
  const addError = jest.fn();
  const log = jest.fn();
  const services = makeServices();
  return {
    job: new PlanGenerationJob(
      { addError, log },
      {
        servicesFactory: () => services,
        onSymbolCompleted: opts.onSymbolCompleted,
        getLastSymbolRun: opts.getLastSymbolRun,
      },
    ),
    addError,
    log,
    services,
  };
}

const minimalConfig: SideBSchedulerConfig = {
  symbols: ['XAU/USD'],
  timeframe: '15m',
  higherTimeframe: '4h',
  planIntervalHours: 4,
} as SideBSchedulerConfig;

describe('PlanGenerationJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('正常実行: 全シンボル成功で results.success=true', async () => {
    mockCreateTradeFromPlan.mockResolvedValue({ success: true, trade: { id: 'trade-1' } });
    const onSymbolCompleted = jest.fn();
    const { job, services } = makeJob({ onSymbolCompleted });

    const result = await job.runWithServices(minimalConfig, services);

    expect(result.success).toBe(true);
    expect(result.results).toEqual([{ symbol: 'XAU/USD', success: true }]);
    expect(result.message).toContain('1/1 シンボル成功');
    expect(onSymbolCompleted).toHaveBeenCalledWith('XAU/USD', expect.any(Date));
  });

  it('getLastSymbolRun で間隔内ならスキップ (lastRun = 直前)', async () => {
    const justRun = new Date(); // 直前に実行された想定
    const { job, services } = makeJob({ getLastSymbolRun: () => justRun });

    const result = await job.runWithServices(minimalConfig, services);

    expect(services.marketDataService.getHistoricalData).not.toHaveBeenCalled();
    // 全シンボルがスキップされたので results は空、success は false (successCount=0 のため)
    expect(result.results).toEqual([]);
    expect(result.success).toBe(false);
  });

  it('OHLCV 取得失敗で errors に計上、results.success=false', async () => {
    const { job, services } = makeJob();
    (services.marketDataService.getHistoricalData as jest.Mock).mockResolvedValue([]);

    const result = await job.runWithServices(minimalConfig, services);

    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('執行足OHLCVデータの取得に失敗');
  });

  it('orchestrator.generatePlan が success=false なら error 記録', async () => {
    const { job, services } = makeJob();
    (services.orchestrator.generatePlan as jest.Mock).mockResolvedValue({
      success: false,
      error: 'AI timeout',
    });

    const result = await job.runWithServices(minimalConfig, services);

    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('AI timeout');
  });

  it('createTradeFromPlan が skipped 返却でも success として扱う (ノートレード判断)', async () => {
    mockCreateTradeFromPlan.mockResolvedValue({
      success: true,
      skipped: true,
      skipReason: 'ノートレード判断',
    });
    const { job, services } = makeJob();

    const result = await job.runWithServices(minimalConfig, services);

    expect(result.results[0].success).toBe(true);
    expect(result.success).toBe(true);
  });

  it('run() は servicesFactory 経由で services を取得', async () => {
    mockCreateTradeFromPlan.mockResolvedValue({ success: true, trade: { id: 'trade-x' } });
    const currentServices = makeServices();
    const addError = jest.fn();
    const log = jest.fn();
    const job = new PlanGenerationJob(
      { addError, log },
      { servicesFactory: () => currentServices },
    );

    await job.run(minimalConfig);
    expect(currentServices.marketDataService.getHistoricalData).toHaveBeenCalled();
  });

  // ===========================================
  // Phase A: research 取得経路の分岐 (PR #233 Copilot review 指摘 #4)
  // ===========================================

  it('Phase A: researchOutputId がある plan は researchOutputRepository から research を取得', async () => {
    const mockMarketAnalysis = { regime: 'range' as const, summary: 'phase-a-new' };
    (researchOutputRepository.findById as jest.Mock).mockResolvedValue({
      marketAnalysis: mockMarketAnalysis,
    });
    (researchRepository.findById as jest.Mock).mockResolvedValue(null);
    mockCreateTradeFromPlan.mockResolvedValue({ success: true, trade: { id: 'trade-1' } });
    const { job, services } = makeJob();
    (services.orchestrator.generatePlan as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        id: 'plan-1',
        scenarios: [],
        researchId: null,
        researchOutputId: 'research-output-1',
      },
    });

    await job.runWithServices(minimalConfig, services);

    expect(researchOutputRepository.findById).toHaveBeenCalledWith('research-output-1');
    expect(researchRepository.findById).not.toHaveBeenCalled();
    expect(pdcaLoop.notifyAnalysisComplete).toHaveBeenCalledWith('XAU/USD', mockMarketAnalysis);
  });

  it('Phase A: researchOutputId 未指定 (旧データ) では researchRepository にフォールバック', async () => {
    const mockMarketAnalysis = { regime: 'trend' as const, summary: 'legacy-research' };
    (researchRepository.findById as jest.Mock).mockResolvedValue({
      marketAnalysis: mockMarketAnalysis,
    });
    (researchOutputRepository.findById as jest.Mock).mockResolvedValue(null);
    mockCreateTradeFromPlan.mockResolvedValue({ success: true, trade: { id: 'trade-2' } });
    const { job, services } = makeJob();
    (services.orchestrator.generatePlan as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        id: 'plan-legacy',
        scenarios: [],
        researchId: 'legacy-research-1',
        researchOutputId: null,
      },
    });

    await job.runWithServices(minimalConfig, services);

    expect(researchRepository.findById).toHaveBeenCalledWith('legacy-research-1');
    expect(researchOutputRepository.findById).not.toHaveBeenCalled();
    expect(pdcaLoop.notifyAnalysisComplete).toHaveBeenCalledWith('XAU/USD', mockMarketAnalysis);
  });

  it('Phase A: researchId / researchOutputId 両方 null なら pdcaLoop.notifyAnalysisComplete を呼ばない', async () => {
    mockCreateTradeFromPlan.mockResolvedValue({ success: true, trade: { id: 'trade-3' } });
    const { job, services } = makeJob();
    (services.orchestrator.generatePlan as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: 'plan-orphan', scenarios: [], researchId: null, researchOutputId: null },
    });

    await job.runWithServices(minimalConfig, services);

    expect(researchOutputRepository.findById).not.toHaveBeenCalled();
    expect(researchRepository.findById).not.toHaveBeenCalled();
    expect(pdcaLoop.notifyAnalysisComplete).not.toHaveBeenCalled();
  });
});
