/**
 * AIOrchestrator × StrategyBacktesterAgent 配線のスモークテスト
 *
 * レンズ計算を意図的に失敗させ、EdgeLedger / HypothesisGenerator / 専門家を
 * 経由しないようにして、Plan AI 以降と戦略 BT 呼び出しだけを検証する。
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AIOrchestrator } from '../../orchestrator/aiOrchestrator';
import { defaultLensAggregator } from '../../lenses';
import type { PlanAIService } from '../../services/planAIService';
import type { PlanAIResult } from '../../services/planAIService';
import type { ResearchOutputRepository, PlanRepository, CreatePlanInput } from '../../repositories';
import type { ResearchOutputWithTypes, AITradePlanWithTypes } from '../../repositories';
import type { FeatureVector12D } from '../../models/featureVector';
import type { DevilsAdvocateAgent } from '../../agents/DevilsAdvocateAgent';
import type { HypothesisGeneratorAgent } from '../../agents/HypothesisGeneratorAgent';
import type { StrategyBacktesterAgent } from '../../agents/StrategyBacktesterAgent';
import type { StrategyBacktesterRunResult } from '../../agents/StrategyBacktesterAgent';

const mockFeatureVector: FeatureVector12D = {
  trendStrength: 50,
  trendDirection: 50,
  maAlignment: 50,
  pricePosition: 50,
  rsiLevel: 50,
  macdMomentum: 50,
  momentumDivergence: 20,
  volatilityLevel: 50,
  bbWidth: 50,
  volatilityTrend: 50,
  supportProximity: 50,
  resistanceProximity: 50,
};

const mockResearch: ResearchOutputWithTypes = {
  id: 'orch-bt-research',
  symbol: 'XAUUSD',
  timeframe: '15m',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3600_000),
  featureVector: mockFeatureVector,
  aiModel: 'test',
  tokenUsage: 0,
  rawOutput: {},
  apiCallCost: null,
};

function buildPlanAIResultWithOneScenario(): PlanAIResult {
  return {
    model: 'mock-plan',
    tokenUsage: 10,
    output: {
      marketAnalysis: {
        regime: 'range',
        regimeConfidence: 50,
        trendDirection: 'sideways',
        volatility: 'medium',
        keyLevels: {
          strongResistance: [],
          resistance: [],
          support: [],
          strongSupport: [],
        },
        summary: 'テスト',
        additionalInsights: [],
      },
      scenarios: [
        {
          name: 'テストシナリオ',
          direction: 'long',
          priority: 'primary',
          entry: {
            type: 'limit',
            price: 2000,
            condition: '押し目',
            triggerIndicators: [],
          },
          stopLoss: { price: 1990, pips: 10, reason: 'SL' },
          takeProfit: { price: 2020, pips: 20, reason: 'TP' },
          riskReward: 2,
          confidence: 60,
          rationale: 'テスト',
          invalidationConditions: [],
        },
      ],
      overallConfidence: 60,
      warnings: [],
    },
  };
}

function buildStrategyBacktestResult(): StrategyBacktesterRunResult {
  return {
    scenarioResults: [],
    overallPassed: true,
    period: { start: '2024-01-01', end: '2025-01-01' },
    totalDurationMs: 2,
  };
}

function savedPlanFromCreate(input: CreatePlanInput): AITradePlanWithTypes {
  return {
    id: 'saved-plan-id',
    createdAt: new Date(),
    // Phase A: researchId / researchOutputId はどちらか一方が入る (nullable)
    researchId: input.researchId ?? null,
    researchOutputId: input.researchOutputId ?? null,
    // Prisma 由来の AITradePlan では日付列は Date
    targetDate: input.targetDate,
    symbol: input.symbol,
    marketAnalysis: input.marketAnalysis,
    scenarios: input.scenarios,
    overallConfidence: input.overallConfidence ?? 0,
    warnings: input.warnings ?? [],
    aiModel: input.aiModel ?? 'm',
    tokenUsage: input.tokenUsage ?? 0,
  };
}

describe('AIOrchestrator / StrategyBacktesterAgent', () => {
  let lensSpy: jest.SpiedFunction<typeof defaultLensAggregator.computeAll>;
  const runMock: jest.MockedFunction<StrategyBacktesterAgent['run']> = jest.fn();

  beforeEach(() => {
    lensSpy = jest
      .spyOn(defaultLensAggregator, 'computeAll')
      .mockRejectedValue(new Error('テスト用: レンズをスキップ'));
    runMock.mockReset();
    runMock.mockResolvedValue(buildStrategyBacktestResult());
  });

  afterEach(() => {
    lensSpy.mockRestore();
  });

  it('シナリオがあるとき strategyBacktester.run を呼び、戻りに strategyBacktest を載せる', async () => {
    const genPlan = jest.fn();
    genPlan.mockImplementation(async () => buildPlanAIResultWithOneScenario());
    const findResearch = jest.fn();
    findResearch.mockImplementation(async () => mockResearch);
    const findByDate = jest.fn();
    findByDate.mockImplementation(async () => null);
    const createPlan: jest.MockedFunction<
      (input: CreatePlanInput) => Promise<AITradePlanWithTypes>
    > = jest.fn();
    createPlan.mockImplementation(async (input: CreatePlanInput) => savedPlanFromCreate(input));
    const delPlan = jest.fn();
    delPlan.mockImplementation(async () => undefined);
    const critique = jest.fn();
    critique.mockImplementation(async () => ({
      output: {
        failureScenarios: [],
        weakestAssumption: { description: '', whyVulnerable: '' },
        recommendation: { action: 'proceed' as const, rationale: 'テスト' },
      },
      tokenUsage: 0,
      model: 'mock-da',
    }));

    const planAI = { generatePlan: genPlan } as unknown as PlanAIService;
    const researchRepo = { findById: findResearch } as unknown as ResearchOutputRepository;
    const planRepo = {
      findByDateAndSymbol: findByDate,
      create: createPlan,
      upsertByDateSymbol: createPlan,
      delete: delPlan,
    } as unknown as PlanRepository;
    const devilsAdvocate = { critique } as unknown as DevilsAdvocateAgent;
    const hgGen = jest.fn();
    const hypothesisGenerator = {
      generate: hgGen,
      toCreateInputs: jest.fn(),
    } as unknown as HypothesisGeneratorAgent;
    const strategyBacktester = { run: runMock } as unknown as StrategyBacktesterAgent;

    const orchestrator = new AIOrchestrator(
      undefined,
      planAI,
      researchRepo,
      planRepo,
      devilsAdvocate,
      hypothesisGenerator,
      strategyBacktester,
    );

    const result = await orchestrator.generatePlan({
      symbol: 'XAUUSD',
      targetDate: '2025-06-15',
      researchId: mockResearch.id,
    });

    expect(result.success).toBe(true);
    expect(result.data?.strategyBacktest).toEqual(buildStrategyBacktestResult());
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0][0]).toHaveLength(1);
    expect(runMock.mock.calls[0][0][0].name).toBe('テストシナリオ');
    expect(runMock.mock.calls[0][1]).toEqual({ symbol: 'XAUUSD', timeframe: '15m' });
    expect(hgGen).not.toHaveBeenCalled();
  });

  it('シナリオ 0 件のとき strategyBacktester.run は呼ばない', async () => {
    const one = buildPlanAIResultWithOneScenario();
    const genPlan = jest.fn();
    genPlan.mockImplementation(async () => ({
      ...one,
      output: { ...one.output, scenarios: [] },
    }));
    const findResearch = jest.fn();
    findResearch.mockImplementation(async () => mockResearch);
    const findByDate = jest.fn();
    findByDate.mockImplementation(async () => null);
    const createPlan: jest.MockedFunction<
      (input: CreatePlanInput) => Promise<AITradePlanWithTypes>
    > = jest.fn();
    createPlan.mockImplementation(async (input: CreatePlanInput) => savedPlanFromCreate(input));
    const delPlan = jest.fn();
    delPlan.mockImplementation(async () => undefined);
    const critique = jest.fn();

    const planAI = { generatePlan: genPlan } as unknown as PlanAIService;
    const researchRepo = { findById: findResearch } as unknown as ResearchOutputRepository;
    const planRepo = {
      findByDateAndSymbol: findByDate,
      create: createPlan,
      upsertByDateSymbol: createPlan,
      delete: delPlan,
    } as unknown as PlanRepository;
    const devilsAdvocate = { critique } as unknown as DevilsAdvocateAgent;
    const hypothesisGenerator = {
      generate: jest.fn(),
      toCreateInputs: jest.fn(),
    } as unknown as HypothesisGeneratorAgent;
    const strategyBacktester = { run: runMock } as unknown as StrategyBacktesterAgent;

    const orchestrator = new AIOrchestrator(
      undefined,
      planAI,
      researchRepo,
      planRepo,
      devilsAdvocate,
      hypothesisGenerator,
      strategyBacktester,
    );

    await orchestrator.generatePlan({
      symbol: 'XAUUSD',
      targetDate: '2025-06-15',
      researchId: mockResearch.id,
    });

    expect(runMock).not.toHaveBeenCalled();
  });

  it('run が例外のときは strategyBacktest を載せず Devil’s Advocate へ続行する', async () => {
    runMock.mockRejectedValue(new Error('BT ダウン'));
    const genPlan = jest.fn();
    genPlan.mockImplementation(async () => buildPlanAIResultWithOneScenario());
    const findResearch = jest.fn();
    findResearch.mockImplementation(async () => mockResearch);
    const findByDate = jest.fn();
    findByDate.mockImplementation(async () => null);
    const createPlan: jest.MockedFunction<
      (input: CreatePlanInput) => Promise<AITradePlanWithTypes>
    > = jest.fn();
    createPlan.mockImplementation(async (input: CreatePlanInput) => savedPlanFromCreate(input));
    const delPlan = jest.fn();
    delPlan.mockImplementation(async () => undefined);
    const daCritique = jest.fn();
    daCritique.mockImplementation(async () => ({
      output: {
        failureScenarios: [],
        weakestAssumption: { description: '', whyVulnerable: '' },
        recommendation: { action: 'proceed' as const, rationale: 'テスト' },
      },
      tokenUsage: 0,
      model: 'mock-da',
    }));

    const planAI = { generatePlan: genPlan } as unknown as PlanAIService;
    const researchRepo = { findById: findResearch } as unknown as ResearchOutputRepository;
    const planRepo = {
      findByDateAndSymbol: findByDate,
      create: createPlan,
      upsertByDateSymbol: createPlan,
      delete: delPlan,
    } as unknown as PlanRepository;
    const devilsAdvocate = { critique: daCritique } as unknown as DevilsAdvocateAgent;
    const hypothesisGenerator = {
      generate: jest.fn(),
      toCreateInputs: jest.fn(),
    } as unknown as HypothesisGeneratorAgent;
    const strategyBacktester = { run: runMock } as unknown as StrategyBacktesterAgent;

    const orchestrator = new AIOrchestrator(
      undefined,
      planAI,
      researchRepo,
      planRepo,
      devilsAdvocate,
      hypothesisGenerator,
      strategyBacktester,
    );

    const result = await orchestrator.generatePlan({
      symbol: 'XAUUSD',
      targetDate: '2025-06-15',
      researchId: mockResearch.id,
    });

    expect(result.success).toBe(true);
    expect(result.data?.strategyBacktest).toBeUndefined();
    expect(daCritique).toHaveBeenCalled();
  });
});
