/**
 * EvolutionLoop（モックで 1 世代）（Phase 5A）
 *
 * Phase 5A では EdgeLedger への自動登録は行わず、
 * 厳格条件を満たしたエリートは `report.promotionCandidates`
 * にメタとして残る（Phase 5B で Phase 4c へ橋渡しする前提）。
 */

import { CrossoverAgent } from '../../agents/CrossoverAgent';
import { MutationAgent } from '../../agents/MutationAgent';
import { DiversityEnforcer } from '../../evolution/DiversityEnforcer';
import { EvolutionLoop } from '../../evolution/EvolutionLoop';
import { StrategyPopulation } from '../../evolution/StrategyPopulation';
import { DSLBacktestAdapter } from '../../strategy_dsl/DSLBacktestAdapter';
import { StrategyDSLSchema } from '../../strategy_dsl/schema';

describe('EvolutionLoop.runOneGeneration（Phase 5A）', () => {
  it('空集団ならシード後にスコアが付き、レポートが返る（EdgeLedger は呼ばない）', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'loop-test-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 'trending_with_pullback',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
        },
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: {
        createdAt: new Date().toISOString(),
        createdBy: 'initial_random',
      },
    });

    const bars = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(`2024-06-01T${String(i).padStart(2, '0')}:00:00Z`),
      open: 1 + i * 0.0001,
      high: 1 + i * 0.0001 + 0.0002,
      low: 1 + i * 0.0001 - 0.0002,
      close: 1 + i * 0.0001,
      volume: 1000,
    }));

    const adapter = new DSLBacktestAdapter();
    jest.spyOn(adapter, 'runBacktest').mockImplementation(async (strategy, _params, _period) => {
      const agg = adapter.runBacktestOnBars(strategy, {}, { start: '2024-06-01', end: '2024-06-03' }, bars);
      return Promise.resolve(agg);
    });

    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([
      StrategyDSLSchema.parse({
        ...dsl,
        id: 'm1',
        parentIds: [dsl.id],
        generation: 1,
        metadata: { ...dsl.metadata, createdBy: 'mutation' },
      }),
    ]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);

    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const loop = new EvolutionLoop({
      population: new StrategyPopulation(undefined),
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
    });

    const report = await loop.runOneGeneration('trending_with_pullback');

    expect(report.eliteIds.length).toBeGreaterThanOrEqual(0);
    expect(report.scores).toBeDefined();
    expect(Array.isArray(report.promotionCandidates)).toBe(true);
    // Phase 5A: promotionCandidates が報告されたら、メタに dslId と source='evolution' が入る
    for (const c of report.promotionCandidates) {
      expect(typeof c.dslId).toBe('string');
      expect(c.source).toBe('evolution');
    }
  });

  it('厳格条件を満たす戦略は promotionCandidates に現れ、EdgeLedger には書かない', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'loop-test-promote',
      generation: 0,
      parentIds: [],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
        },
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: {
        createdAt: new Date().toISOString(),
        createdBy: 'initial_random',
        description: '昇格候補テスト',
      },
    });

    const adapter = new DSLBacktestAdapter();
    const makeSummary = (totalTrades: number, winRate: number, pf: number) => ({
      totalTrades,
      winningTrades: Math.round(totalTrades * winRate),
      losingTrades: totalTrades - Math.round(totalTrades * winRate),
      winRate,
      netProfit: pf * 100,
      netProfitRate: 0.1,
      maxDrawdown: 30,
      maxDrawdownRate: 0.03,
      profitFactor: pf,
      averageWin: 15,
      averageLoss: -10,
      riskRewardRatio: 1.5,
      maxConsecutiveWins: 3,
      maxConsecutiveLosses: 2,
    });

    // 厳格 3 条件を満たす集計値（学習 PF > 1.5, 検証 PF > 1.3, 過学習 < 0.3）
    jest.spyOn(adapter, 'runBacktest').mockResolvedValue({
      dslId: 'loop-test-promote',
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 2.0,
      validationPf: 1.6,
      overfitScore: 0.15,
      train: { summary: makeSummary(20, 0.6, 2.0), trades: [] },
      validation: { summary: makeSummary(10, 0.6, 1.6), trades: [] },
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
    });

    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', dsl);

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
    });

    const report = await loop.runOneGeneration('breakout');

    expect(report.promotionCandidates.length).toBeGreaterThanOrEqual(1);
    const cand = report.promotionCandidates.find((c) => c.dslId === 'loop-test-promote');
    expect(cand).toBeDefined();
    expect(cand?.source).toBe('evolution');
    expect(cand?.regime).toBe('breakout');
    expect(cand?.trainPf).toBeCloseTo(2.0);
    expect(cand?.validationPf).toBeCloseTo(1.6);
    expect(cand?.overfitScore).toBeCloseTo(0.15);
  });
});
