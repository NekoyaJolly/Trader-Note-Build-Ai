/**
 * 進化ループ再設計 Phase 2: EvolutionLoop の mutation 配線テスト。
 *
 * mutationStrategy='deterministic' のとき、LLM の generateMutants ではなく
 * generateDeterministicMutants（= runOptimize 経由）が走ることを検証する。
 * hybrid 標準経路の bundle 生成も本ファイルで検証する。
 */

import { CrossoverAgent } from '../../agents/CrossoverAgent';
import { MutationAgent } from '../../agents/MutationAgent';
import { DiversityEnforcer } from '../../evolution/DiversityEnforcer';
import {
  EvolutionLoop,
  type RunOptimizeFn,
  type RunScreeningBacktestFn,
} from '../../evolution/EvolutionLoop';
import { generateHybridMutants } from '../../evolution/hybridMutation';
import { StrategyPopulation } from '../../evolution/StrategyPopulation';
import { SurrogateFitnessSimulator } from '../../strategy_dsl/SurrogateFitnessSimulator';
import type { Condition, ConditionGroup, StrategyDSL } from '../../strategy_dsl/schema';
import type {
  AnalysisEngineOptimizeResponse,
  AnalysisEngineScreeningBacktestResponse,
} from '../../../schemas/external/analysisEngine';

type ImmediateEntry = Extract<StrategyDSL['entry'], { trigger: ConditionGroup }>;

function screeningResp(): AnalysisEngineScreeningBacktestResponse {
  return {
    summary: { pf: 1.4, winRate: 0.5, tradeCount: 60, maxDD: 0.05, sharpe: 1.0, returnPct: 0.1 },
    trades: [],
    equity: null,
    engineVersion: 'test',
    unsupportedConditions: [],
  };
}

function optimizeResp(): AnalysisEngineOptimizeResponse {
  return {
    bestParams: { slValue: 1.8, tpValue: 2.4 },
    summary: { pf: 1.5, winRate: 0.5, tradeCount: 70, maxDD: 0.05, sharpe: 1.1, returnPct: 0.12 },
    equity: null,
    trades: [],
    engineVersion: 'test',
    overfitGuard: {
      method: 'walk_forward',
      windows: 4,
      minTradesPerWindow: 25,
      trialCount: 9,
      evaluatedFoldCount: 4,
      folds: [],
      aggregateOos: { pf: 1.3, winRate: 0.5, tradeCount: 60, maxDD: null, sharpe: 0.3, returnPct: null },
      dsr: null,
      verdict: 'robust',
    },
  };
}

function makeParentDsl(): StrategyDSL {
  return {
    id: 'parent-hybrid-1',
    generation: 3,
    parentIds: [],
    regimeTarget: 'trend',
    symbol: 'XAUUSD',
    timeframe: '15m',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [
          {
            lens: 'ohlcv',
            feature: 'close',
            op: '>',
            compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } },
          },
        ],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2 },
    parameters: {},
    metadata: {
      createdAt: '2026-06-02T00:00:00.000Z',
      createdBy: 'initial_random',
    },
  };
}

function immediateEntryOf(dsl: StrategyDSL): ImmediateEntry {
  if (!('trigger' in dsl.entry)) {
    throw new Error(`immediate entry ではありません: ${dsl.id}`);
  }
  return dsl.entry;
}

function structuralDraftFrom(parent: StrategyDSL): StrategyDSL {
  const entry = immediateEntryOf(parent);
  return {
    ...parent,
    id: 'llm-structural-draft-1',
    generation: parent.generation + 1,
    parentIds: [parent.id],
    entry: {
      ...entry,
      trigger: {
        logic: 'AND',
        conditions: [
          ...entry.trigger.conditions,
          { lens: 'ohlcv', feature: 'rsi', op: '<', value: 45 } satisfies Condition,
        ],
      } satisfies ConditionGroup,
    },
    metadata: {
      createdAt: '2026-06-02T00:00:00.000Z',
      createdBy: 'mutation',
      description: 'LLM 構造案: RSI フィルタを追加',
    },
  };
}

describe('EvolutionLoop mutation 配線 (Phase 2)', () => {
  it("mutationStrategy='deterministic' で runOptimize 経由になり LLM generateMutants は呼ばれない", async () => {
    const adapter = new SurrogateFitnessSimulator();

    const mutationAgent = new MutationAgent();
    const generateMutantsSpy = jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);

    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const runFormalBacktest: RunScreeningBacktestFn = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(screeningResp());
    const runOptimize: RunOptimizeFn = jest
      .fn<ReturnType<RunOptimizeFn>, Parameters<RunOptimizeFn>>()
      .mockResolvedValue(optimizeResp());

    const loop = new EvolutionLoop({
      population: new StrategyPopulation(undefined),
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      runOptimize,
      mutationStrategy: 'deterministic',
      crossoverStrategy: 'llm',
    });

    await loop.runOneGeneration('trending_with_pullback');

    // 決定論経路: LLM mutation は呼ばれず、runOptimize（WF）が最低 1 回走る。
    expect(generateMutantsSpy).not.toHaveBeenCalled();
    expect(runOptimize).toHaveBeenCalled();
    // 実 surrogate BT を回すため単体で 20-30s かかる。full-suite 並列負荷下で jest 既定
    // per-test timeout を超えて flaky に落ちるのを防ぐため明示的に長め timeout を与える。
  }, 60_000);

  it('Hybrid mutation は bundle を生成しつつ返却 mutants を count 以下に抑える', async () => {
    const parent = makeParentDsl();
    const mutationAgent = new MutationAgent();
    const generateMutantsSpy = jest
      .spyOn(mutationAgent, 'generateMutants')
      .mockImplementation((parents: StrategyDSL[]) => {
        const first = parents[0];
        return Promise.resolve(first ? [structuralDraftFrom(first)] : []);
      });

    const runFormalBacktest: RunScreeningBacktestFn = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(screeningResp());
    const runOptimize: RunOptimizeFn = jest
      .fn<ReturnType<RunOptimizeFn>, Parameters<RunOptimizeFn>>()
      .mockResolvedValue(optimizeResp());

    const result = await generateHybridMutants(
      {
        parents: [parent],
        scores: new Map([[parent.id, 1]]),
        count: 1,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T00:00:00.000Z',
        mutationAgent,
      },
      { runScreeningBacktest: runFormalBacktest, runOptimize },
    );

    expect(generateMutantsSpy).toHaveBeenCalledTimes(1);
    expect(runFormalBacktest).toHaveBeenCalled();
    expect(runOptimize).toHaveBeenCalled();
    expect(result.summary).toEqual({
      parentCount: 1,
      baselineEvaluated: 1,
      optimizedBaseCreated: 1,
      structuralVariantCreated: 1,
    });
    const bundle = result.bundles[0];
    if (!bundle) {
      throw new Error('Hybrid mutation bundle が生成されていません');
    }
    expect(bundle.parentDsl.id).toBe(parent.id);
    expect(bundle.optimizedBase?.parentIds).toEqual([parent.id]);
    expect(bundle.structuralVariant?.parentIds).toEqual(['llm-structural-draft-1']);
    const optimizedConditions = bundle.optimizedBase
      ? immediateEntryOf(bundle.optimizedBase).trigger.conditions
      : [];
    const structuralConditions = bundle.structuralVariant
      ? immediateEntryOf(bundle.structuralVariant).trigger.conditions
      : [];
    expect(optimizedConditions).toHaveLength(1);
    expect(structuralConditions).toHaveLength(2);
    // adaptive budget の count は返却 mutant 数の上限として守る。
    // bundle には structuralVariant も残るため、観測情報は失われない。
    expect(result.mutants).toHaveLength(1);
  });
});
