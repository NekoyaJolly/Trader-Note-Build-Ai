/**
 * 進化ループ再設計 Phase 3: EvolutionLoop の crossover 配線テスト。
 *
 * crossoverStrategy='deterministic' のとき、LLM の generateCrossovers ではなく
 * generateDeterministicCrossovers（= screening + runOptimize 経由）が走ることを検証する。
 */

import { CrossoverAgent } from '../../agents/CrossoverAgent';
import { MutationAgent } from '../../agents/MutationAgent';
import { DiversityEnforcer } from '../../evolution/DiversityEnforcer';
import {
  EvolutionLoop,
  type RunOptimizeFn,
  type RunScreeningBacktestFn,
} from '../../evolution/EvolutionLoop';
import { StrategyPopulation } from '../../evolution/StrategyPopulation';
import { SurrogateFitnessSimulator } from '../../strategy_dsl/SurrogateFitnessSimulator';
import type {
  AnalysisEngineOptimizeResponse,
  AnalysisEngineScreeningBacktestResponse,
} from '../../../schemas/external/analysisEngine';

function screeningResp(): AnalysisEngineScreeningBacktestResponse {
  return {
    summary: { pf: 1.4, winRate: 0.5, tradeCount: 80, maxDD: 0.05, sharpe: 1.0, returnPct: 0.1 },
    trades: [],
    equity: null,
    engineVersion: 'test',
    unsupportedConditions: [],
  };
}

function optimizeResp(): AnalysisEngineOptimizeResponse {
  return {
    bestParams: {},
    summary: { pf: 1.5, winRate: 0.5, tradeCount: 70, maxDD: 0.05, sharpe: 1.1, returnPct: 0.12 },
    equity: null,
    trades: [],
    engineVersion: 'test',
    overfitGuard: {
      method: 'walk_forward',
      windows: 4,
      minTradesPerWindow: 25,
      trialCount: 1,
      evaluatedFoldCount: 4,
      folds: [],
      aggregateOos: { pf: 1.3, winRate: 0.5, tradeCount: 60, maxDD: null, sharpe: 0.3, returnPct: null },
      dsr: null,
      verdict: 'robust',
    },
  };
}

describe('EvolutionLoop crossover 配線 (Phase 3)', () => {
  it("crossoverStrategy='deterministic' で generateCrossovers は呼ばれず screening/optimize 経由になる", async () => {
    const adapter = new SurrogateFitnessSimulator();
    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);

    const crossoverAgent = new CrossoverAgent();
    const generateCrossoversSpy = jest
      .spyOn(crossoverAgent, 'generateCrossovers')
      .mockResolvedValue([]);

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
      mutationStrategy: 'llm',
      crossoverStrategy: 'deterministic',
    });

    await loop.runOneGeneration('trending_with_pullback');

    // 決定論 crossover: LLM crossover は呼ばれず、screening BT が走る（baseline + variants）。
    expect(generateCrossoversSpy).not.toHaveBeenCalled();
    expect(runFormalBacktest).toHaveBeenCalled();
    // 実 surrogate BT を回すため単体で 20-30s かかる。full-suite 並列負荷下で jest 既定
    // per-test timeout を超えて flaky に落ちるのを防ぐため明示的に長め timeout を与える。
  }, 60_000);
});
