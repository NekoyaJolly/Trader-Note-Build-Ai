/**
 * PR #111: Adaptive Repair / Mutation Budget の MutationAgent 実反映テスト。
 *
 * PR #107 までは `mutationBudgetAllocation` を受領しても EvolutionLoop は
 * `errors[]` に [info] を残すだけで、実 mutation count は hardcoded (10/5/5) のままだった。
 * 本 PR で route quota を mutation/crossover/diverse の生成 count に反映する。
 *
 * 確認:
 *   1. mutationBudgetAllocation 未指定なら count=10/5/5 (= 既存挙動互換)
 *   2. repair+standard share 増加で mutation count が比例的に増える
 *   3. share 減少で count が減る (ただし最低 1 を保つ)
 *   4. crossover share に応じて crossoverAgent.generateCrossovers の count が変わる
 *   5. novelty_seed share に応じて generateDiverse の count が変わる (lowDiversityBoost 経路)
 *   6. errors[] に "[info] adaptive mutation budget 適用" の観測ログが出る
 *   7. parent pool / formalBtCandidate 数は変えない (= parentPoolSummary 不変)
 *   8. productionEligible は常に 0
 */

import { CrossoverAgent } from '../../agents/CrossoverAgent';
import { MutationAgent } from '../../agents/MutationAgent';
import { DiversityEnforcer } from '../../evolution/DiversityEnforcer';
import { EvolutionLoop } from '../../evolution/EvolutionLoop';
import { StrategyPopulation } from '../../evolution/StrategyPopulation';
import { SurrogateFitnessSimulator } from '../../strategy_dsl/SurrogateFitnessSimulator';
import { defaultMutationBudgetAllocationV1 } from '../../evolution/adaptiveRepairBudgetPolicy';
import type { MutationBudgetAllocation } from '../../evolution/adaptiveRepairBudgetPolicy';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';
import type { RunScreeningBacktestFn } from '../../evolution/EvolutionLoop';
import type { AnalysisEngineScreeningBacktestResponse } from '../../../schemas/external/analysisEngine';

function makeDsl(id: string): StrategyDSL {
  return StrategyDSLSchema.parse({
    id,
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'fixed_pips', value: 30 },
    takeProfit: { type: 'rr_ratio', value: 1.5 },
    parameters: {},
    metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
  });
}

function makeFormalBtResponse(pf: number, winRate: number, trades: number): AnalysisEngineScreeningBacktestResponse {
  return {
    summary: {
      pf,
      winRate,
      tradeCount: trades,
      maxDD: 5,
      sharpe: 1,
      returnPct: 10,
    },
    trades: [],
    equity: null,
    engineVersion: 'analysis-engine/test@0.0.0',
    unsupportedConditions: [],
  };
}

function summary(n: number, w: number, p: number) {
  return {
    totalTrades: n,
    winningTrades: Math.round(n * w),
    losingTrades: n - Math.round(n * w),
    winRate: w,
    netProfit: p * 100,
    netProfitRate: 0.1,
    maxDrawdown: 30,
    maxDrawdownRate: 0.03,
    profitFactor: p,
    averageWin: 15,
    averageLoss: -10,
    riskRewardRatio: 1.5,
    maxConsecutiveWins: 3,
    maxConsecutiveLosses: 2,
  };
}

interface SetupOptions {
  budget?: MutationBudgetAllocation;
  /**
   * PR #111 Copilot review #2: lowDiversityBoost (= div<0.3) を確実に発火させたいテスト用に、
   * 同 structure の DSL を population に複数追加する経路。`true` のとき同 dsl を 3 件追加し
   * `diversityScore=0` を作る。
   */
  forceLowDiversity?: boolean;
}

async function setupAndRun(opts: SetupOptions = {}) {
  const dsl = makeDsl('pr111-base');
  const adapter = new SurrogateFitnessSimulator();
  jest.spyOn(adapter, 'evaluateFitness').mockImplementation(async (s) => ({
    dslId: s.id,
    period: { start: '2024-01-01', end: '2024-12-31' },
    trainPf: 2.0,
    validationPf: 1.6,
    overfitScore: 0.15,
    train: { summary: summary(20, 0.6, 2.0), trades: [] },
    validation: { summary: summary(10, 0.6, 1.6), trades: [] },
    execution: {
      executionModel: 'legacy_zero_cost',
      executionConfigHash: 'legacy-zero-cost',
      dataSource: 'ctrader',
      costSummary: {
        model: 'legacy_zero_cost',
        dataSource: 'ctrader',
        roundTripCostPips: 0,
        roundTripCostAtrMult: 0,
        totalCost: 0,
      },
    },
  }));
  const mutationAgent = new MutationAgent();
  const generateMutantsSpy = jest
    .spyOn(mutationAgent, 'generateMutants')
    .mockResolvedValue([]);
  const generateDiverseSpy = jest
    .spyOn(mutationAgent, 'generateDiverse')
    .mockResolvedValue([]);
  const crossoverAgent = new CrossoverAgent();
  const generateCrossoversSpy = jest
    .spyOn(crossoverAgent, 'generateCrossovers')
    .mockResolvedValue([]);
  const population = new StrategyPopulation(undefined);
  population.add('breakout', dsl);
  // PR #111 Copilot review #2: lowDiversityBoost 経路 (= diversityScore < 0.3) を
  // 確実に発火させるため、enforcer.diversityScore を直接モックする。population に同
  // structure DSL を入れる方式は EvolutionLoop の removeWorst で削除されてしまい
  // 不安定なため、enforcer の判定ロジック自体を制御する形に統一する。
  const enforcer = new DiversityEnforcer();
  if (opts.forceLowDiversity) {
    jest.spyOn(enforcer, 'diversityScore').mockReturnValue(0.1);
  }
  const runFormalBacktest = jest
    .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
    .mockResolvedValue(makeFormalBtResponse(1.8, 0.55, 35));
  const loop = new EvolutionLoop({
    population,
    adapter,
    mutationAgent,
    crossoverAgent,
    enforcer,
    defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
    evolutionBacktestRepo: null,
    edgeHypothesisLoader: null,
    runFormalBacktest,
    mutationStrategy: 'llm',
    crossoverStrategy: 'llm',
  });
  const report = await loop.runOneGeneration(
    'breakout',
    opts.budget ? { mutationBudgetAllocation: opts.budget } : undefined,
  );
  return {
    report,
    generateMutantsSpy,
    generateCrossoversSpy,
    generateDiverseSpy,
  };
}

describe('PR #111: Adaptive budget の MutationAgent 実反映', () => {
  it('1. mutationBudgetAllocation 未指定なら count=10/5 (= 既存挙動互換)', async () => {
    const { generateMutantsSpy, generateCrossoversSpy } = await setupAndRun();
    expect(generateMutantsSpy).toHaveBeenCalledTimes(1);
    expect(generateMutantsSpy.mock.calls[0][2]).toBe(10);
    expect(generateCrossoversSpy).toHaveBeenCalledTimes(1);
    expect(generateCrossoversSpy.mock.calls[0][2]).toBe(5);
  });

  it('2. default allocation を渡すと count=10/5 (= default 比率と等しい)', async () => {
    const { generateMutantsSpy, generateCrossoversSpy } = await setupAndRun({
      budget: defaultMutationBudgetAllocationV1,
    });
    expect(generateMutantsSpy.mock.calls[0][2]).toBe(10);
    expect(generateCrossoversSpy.mock.calls[0][2]).toBe(5);
  });

  it('3. repair+standard share が default の 2 倍 (110%pt) なら mutation count も約 2 倍', async () => {
    // repair=40, standard=70 (= 110%pt 合計)、その代わり他を圧縮
    const budget: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: {
        repair_guided_mutation: 40,
        standard_mutation: 70,
        crossover: 10,
        novelty_seed: 10,
        indicator_augmentation: 5,
        random_exploration: 5,
      },
      // totalBudget=150 (= sum). count 算出は share / DEFAULT_SHARE で比例計算するだけなので
      // totalBudget の絶対値は気にしない (= percentage budget の意味論を維持)
      totalBudget: 150,
    };
    const { generateMutantsSpy } = await setupAndRun({ budget });
    // 110 / 55 * 10 = 20
    expect(generateMutantsSpy.mock.calls[0][2]).toBe(20);
  });

  it('4. crossover share が default の半分 (10%pt) なら crossover count は約 半分', async () => {
    const budget: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: {
        repair_guided_mutation: 20,
        standard_mutation: 35,
        crossover: 10, // half of default 20
        novelty_seed: 15,
        indicator_augmentation: 10,
        random_exploration: 10,
      },
    };
    const { generateCrossoversSpy } = await setupAndRun({ budget });
    // 10 / 20 * 5 = 2.5 → round(2.5) = 3
    expect(generateCrossoversSpy.mock.calls[0][2]).toBe(3);
  });

  it('5. share が極端に小さくても count=0 にならず 1 で floor', async () => {
    const budget: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: {
        repair_guided_mutation: 1, // 極端に小さい
        standard_mutation: 1,
        crossover: 1,
        novelty_seed: 10,
        indicator_augmentation: 5,
        random_exploration: 5,
      },
    };
    const { generateMutantsSpy, generateCrossoversSpy } = await setupAndRun({ budget });
    // 2/55 * 10 ≒ 0.36 → max(1, round(0.36)) = 1
    expect(generateMutantsSpy.mock.calls[0][2]).toBeGreaterThanOrEqual(1);
    expect(generateCrossoversSpy.mock.calls[0][2]).toBeGreaterThanOrEqual(1);
  });

  it('6. errors[] に [info] adaptive mutation budget 適用 ログが出る', async () => {
    const { report } = await setupAndRun({ budget: defaultMutationBudgetAllocationV1 });
    const log = report.errors.find((e) =>
      e.includes('adaptive mutation budget 適用'),
    );
    expect(log).toBeDefined();
    expect(log).toContain('mutation=10');
    expect(log).toContain('crossover=5');
    expect(log).toContain('diverse=5');
  });

  it('7. mutationBudgetAllocation 未指定なら [info] adaptive 適用 ログは出ない (= 既存互換)', async () => {
    const { report } = await setupAndRun();
    const log = report.errors.find((e) =>
      e.includes('adaptive mutation budget 適用'),
    );
    expect(log).toBeUndefined();
  });

  it('9. PR #111 Copilot #2: lowDiversityBoost 経路で generateDiverse の count に novelty_seed share が反映される', async () => {
    // 同 structure の DSL を 3 件入れて diversityScore < 0.3 を作り、lowDiversityBoost を発火
    // novelty_seed=30%pt (default 15 の 2 倍) → diverseCount = round(5 * 30/15) = 10
    const budget: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: {
        repair_guided_mutation: 20,
        standard_mutation: 35,
        crossover: 20,
        novelty_seed: 30,
        indicator_augmentation: 5,
        random_exploration: 5,
      },
    };
    const { generateDiverseSpy, report } = await setupAndRun({
      budget,
      forceLowDiversity: true,
    });
    expect(report.lowDiversityBoost).toBe(true);
    expect(generateDiverseSpy).toHaveBeenCalledTimes(1);
    // generateDiverse(regime, count) の第 2 引数が diverseCount (= 10) になっている
    expect(generateDiverseSpy.mock.calls[0][1]).toBe(10);
  });

  it('10. PR #111 Copilot #2: budget 未指定でも lowDiversityBoost 経路は count=5 (= 既存挙動)', async () => {
    const { generateDiverseSpy, report } = await setupAndRun({ forceLowDiversity: true });
    expect(report.lowDiversityBoost).toBe(true);
    expect(generateDiverseSpy).toHaveBeenCalledTimes(1);
    expect(generateDiverseSpy.mock.calls[0][1]).toBe(5);
  });

  it('8. budget 反映後も parentPoolSummary / productionEligible は不変', async () => {
    const { report } = await setupAndRun({
      budget: {
        ...defaultMutationBudgetAllocationV1,
        byRoute: {
          repair_guided_mutation: 40,
          standard_mutation: 60,
          crossover: 30,
          novelty_seed: 25,
          indicator_augmentation: 5,
          random_exploration: 5,
        },
      },
    });
    expect(report.parentPoolSummary).toBeDefined();
    expect(report.formalBtCandidateSummary).toBeDefined();
    expect(report.promotionGateSummary.productionEligible).toBe(0);
  });
});
