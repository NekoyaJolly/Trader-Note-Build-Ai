/**
 * 進化ループ再設計 Phase 2: EvolutionLoop の mutation 配線テスト。
 *
 * mutationStrategy='deterministic' のとき、LLM の generateMutants ではなく
 * generateDeterministicMutants（= runOptimize 経由）が走ることを検証する。
 * 既定 'llm' の挙動は既存 evolutionLoop.test.ts が担保。
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
    });

    await loop.runOneGeneration('trending_with_pullback');

    // 決定論経路: LLM mutation は呼ばれず、runOptimize（WF）が最低 1 回走る。
    expect(generateMutantsSpy).not.toHaveBeenCalled();
    expect(runOptimize).toHaveBeenCalled();
    // 実 surrogate BT を回すため単体で 20-30s かかる。full-suite 並列負荷下で jest 既定
    // per-test timeout を超えて flaky に落ちるのを防ぐため明示的に長め timeout を与える。
  }, 60_000);
});
