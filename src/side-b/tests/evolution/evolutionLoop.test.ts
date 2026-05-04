/**
 * EvolutionLoop（モックで 1 世代）（Phase 5A / Critical-4 段階 4a.3）
 *
 * Phase 5A では EdgeLedger への自動登録は行わない。
 * 段階 4a.3: surrogate 厳格 3 条件を通った候補を analysis-engine 正式 BT で再検証し、
 *   `formalBtPassed === true` のものだけ `promotionCandidates` に残る。
 */

import { CrossoverAgent } from '../../agents/CrossoverAgent';
import { MutationAgent } from '../../agents/MutationAgent';
import { DiversityEnforcer } from '../../evolution/DiversityEnforcer';
import {
  EvolutionLoop,
  type RunScreeningBacktestFn,
  type EvolutionBacktestPersister,
} from '../../evolution/EvolutionLoop';
import { StrategyPopulation } from '../../evolution/StrategyPopulation';
import { SurrogateFitnessSimulator } from '../../strategy_dsl/SurrogateFitnessSimulator';
import { StrategyDSLSchema } from '../../strategy_dsl/schema';
import type { AnalysisEngineScreeningBacktestResponse } from '../../../schemas/external/analysisEngine';

function makeFormalBtResponse(
  pf: number,
  winRate: number,
  tradeCount: number,
): AnalysisEngineScreeningBacktestResponse {
  return {
    summary: {
      pf,
      winRate,
      tradeCount,
      maxDD: 0.05,
      sharpe: 1.2,
      returnPct: 0.1,
    },
    trades: [],
    equity: null,
    engineVersion: 'analysis-engine/backtesting.py@test',
    unsupportedConditions: [],
  };
}

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

    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockImplementation(async (strategy, _params, _period) => {
      const agg = adapter.evaluateFitnessOnBars(strategy, {}, { start: '2024-06-01', end: '2024-06-03' }, bars);
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

    const runFormalBacktest: RunScreeningBacktestFn = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(2.0, 0.6, 30));

    const loop = new EvolutionLoop({
      population: new StrategyPopulation(undefined),
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('trending_with_pullback');

    expect(report.eliteIds.length).toBeGreaterThanOrEqual(0);
    expect(report.scores).toBeDefined();
    expect(Array.isArray(report.promotionCandidates)).toBe(true);
    // 段階 4a.3: promotionCandidates に残るものは全て formalBtPassed=true
    for (const c of report.promotionCandidates) {
      expect(typeof c.dslId).toBe('string');
      expect(c.source).toBe('evolution');
      expect(c.formalBtPassed).toBe(true);
      expect(c.formalBtMetrics).not.toBeNull();
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

    const adapter = new SurrogateFitnessSimulator();
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
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
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

    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(1.8, 0.55, 35));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(runFormalBacktest).toHaveBeenCalledTimes(1);
    expect(report.promotionCandidates.length).toBeGreaterThanOrEqual(1);
    const cand = report.promotionCandidates.find((c) => c.dslId === 'loop-test-promote');
    expect(cand).toBeDefined();
    expect(cand?.source).toBe('evolution');
    expect(cand?.regime).toBe('breakout');
    expect(cand?.trainPf).toBeCloseTo(2.0);
    expect(cand?.validationPf).toBeCloseTo(1.6);
    expect(cand?.overfitScore).toBeCloseTo(0.15);
    expect(cand?.formalBtPassed).toBe(true);
    expect(cand?.formalBtMetrics).toEqual({ pf: 1.8, winRate: 0.55, tradeCount: 35 });
    expect(cand?.formalBtFailureReason).toBeUndefined();
  });

  it('段階 4a.3: surrogate を通っても正式 BT が失敗したら昇格候補にならない', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'loop-test-formal-fail',
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
        description: '正式BT失敗テスト',
      },
    });

    const adapter = new SurrogateFitnessSimulator();
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
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: 'loop-test-formal-fail',
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

    // analysis-engine が例外を投げるケース (HTTP エラー / timeout)
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockRejectedValue(new Error('analysis-engine unreachable'));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(runFormalBacktest).toHaveBeenCalledTimes(1);
    // surrogate を通っても正式 BT 失敗で promotionCandidates には残らない
    expect(report.promotionCandidates).toHaveLength(0);
    // ただし formalBtVerifiedCandidates には失敗理由付きで残る (運用ログ用)
    expect(report.formalBtVerifiedCandidates).toHaveLength(1);
    expect(report.formalBtVerifiedCandidates[0].formalBtPassed).toBe(false);
    expect(report.formalBtVerifiedCandidates[0].formalBtFailureReason).toMatch(
      /analysis-engine BT failed/,
    );
  });

  it('段階 4a.3: 正式 BT の PF が下限未満なら昇格候補にならない', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'loop-test-low-pf',
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
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });

    const adapter = new SurrogateFitnessSimulator();
    const summary = (n: number, w: number, p: number) => ({
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
    });
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: 'loop-test-low-pf',
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
    });

    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', dsl);

    // 正式 BT は PF=0.8 (< FORMAL_BT_MIN_PF=1.0) を返す
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(0.8, 0.45, 30));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(report.promotionCandidates).toHaveLength(0);
  });

  it('段階 4a.3: surrogate 候補数が top K を超える場合、上位 K 件のみ正式 BT に送る', async () => {
    const dsls = Array.from({ length: 8 }, (_, i) =>
      StrategyDSLSchema.parse({
        id: `topk-${i}`,
        generation: 0,
        parentIds: [],
        regimeTarget: 'breakout',
        symbol: 'EURUSD',
        timeframe: '1h',
        entry: {
          direction: 'long',
          trigger: {
            logic: 'AND',
            conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: i }],
          },
        },
        stopLoss: { type: 'fixed_pips', value: 30 },
        takeProfit: { type: 'rr_ratio', value: 1.5 },
        parameters: {},
        metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
      }),
    );

    const summary = (pf: number) => ({
      totalTrades: 20,
      winningTrades: 12,
      losingTrades: 8,
      winRate: 0.6,
      netProfit: 200,
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
    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockImplementation(async (s) => {
      // 全戦略が surrogate 厳格条件を通過するように mock。validation PF を id 順で変える。
      const idx = parseInt(s.id.replace('topk-', ''), 10);
      const pf = 1.7 + idx * 0.05;
      return {
        dslId: s.id,
        period: { start: '2024-01-01', end: '2024-12-31' },
        trainPf: 2.0,
        validationPf: pf,
        overfitScore: 0.15,
        train: { summary: summary(2.0), trades: [] },
        validation: { summary: summary(pf), trades: [] },
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
      };
    });

    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    for (const d of dsls) population.add('breakout', d);

    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.55, 30));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      runFormalBacktest,
      formalBtTopK: 3,
    });

    const report = await loop.runOneGeneration('breakout');

    // PR #96: rescue lane 導入で formalBtTopK の意味が変わった:
    //   - 旧: 「正式 BT 呼び出し総数」のキャップ
    //   - 新: rescue policy が overallTopK + 各 lane TopK で独立に候補を選抜
    //         (この PR では formalBtTopK は無視され formalBtCandidatePolicyV1 が支配)
    // 全 5 elite が同 metrics で normal_pass する場合、normal_pass=3 (overallTopK) +
    // novelty_rescue=1 (= top3 に未選抜の 4 番目を拾う) = 計 4 件が正式 BT に送られる。
    // low_drawdown / trade_count rescue は同候補と重複して dedup される。
    expect(runFormalBacktest).toHaveBeenCalledTimes(4);
    expect(report.formalBtCandidateSummary.normalPass).toBe(3);
    expect(report.formalBtCandidateSummary.noveltyRescue).toBeGreaterThanOrEqual(1);
    expect(report.formalBtCandidateSummary.killed).toBe(0);
  });

  it('段階 4a.4: 正式 BT 結果 (passed/failed 全件) が EvolutionBacktestRun に永続化される', async () => {
    const passingDsl = StrategyDSLSchema.parse({
      id: 'persist-pass',
      generation: 2,
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
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
    const failingDsl = StrategyDSLSchema.parse({
      ...passingDsl,
      id: 'persist-fail',
      entry: {
        direction: 'long',
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 1 }],
        },
      },
    });

    const adapter = new SurrogateFitnessSimulator();
    const summary = (pf: number) => ({
      totalTrades: 20,
      winningTrades: 12,
      losingTrades: 8,
      winRate: 0.6,
      netProfit: 200,
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
    jest.spyOn(adapter, 'evaluateFitness').mockImplementation(async (s) => ({
      dslId: s.id,
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 2.0,
      validationPf: 1.6,
      overfitScore: 0.15,
      train: { summary: summary(2.0), trades: [] },
      validation: { summary: summary(1.6), trades: [] },
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
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', passingDsl);
    population.add('breakout', failingDsl);

    // persist-pass は PF=1.5 (合格), persist-fail は PF=0.5 (PF 下限未達で失敗)
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockImplementation(async (req) => {
        const isPass = req.hypothesisId === 'persist-pass';
        return makeFormalBtResponse(isPass ? 1.5 : 0.5, 0.55, 30);
      });

    // EvolutionLoop は createMany / findRecentFormalBtPassed を呼ぶ。Pick<...> 型でモック化。
    const createMany: jest.MockedFunction<EvolutionBacktestPersister['createMany']> = jest
      .fn<
        ReturnType<EvolutionBacktestPersister['createMany']>,
        Parameters<EvolutionBacktestPersister['createMany']>
      >()
      .mockResolvedValue([]);
    const findRecentFormalBtPassed: jest.MockedFunction<
      EvolutionBacktestPersister['findRecentFormalBtPassed']
    > = jest
      .fn<
        ReturnType<EvolutionBacktestPersister['findRecentFormalBtPassed']>,
        Parameters<EvolutionBacktestPersister['findRecentFormalBtPassed']>
      >()
      .mockResolvedValue([]);
    const repoStub: EvolutionBacktestPersister = { createMany, findRecentFormalBtPassed };

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      runFormalBacktest,
      evolutionBacktestRepo: repoStub,
      evolutionRunId: '00000000-0000-0000-0000-000000000001',
    });

    const report = await loop.runOneGeneration('breakout');

    // verified には 2 件 (passed 1 + failed 1)、promotionCandidates は passed 1 のみ
    expect(report.formalBtVerifiedCandidates).toHaveLength(2);
    expect(report.promotionCandidates).toHaveLength(1);

    // createMany は 1 回呼ばれ、行は 2 件
    expect(createMany).toHaveBeenCalledTimes(1);
    const rows = createMany.mock.calls[0][0] as Array<{
      candidateId: string;
      formalBtPassed: boolean;
      formalBtFailureReason: string | null;
      generation: number;
      candidateHash: string;
      evolutionRunId: string;
      engine: string;
    }>;
    expect(rows).toHaveLength(2);

    const passRow = rows.find((r) => r.candidateId === 'persist-pass');
    const failRow = rows.find((r) => r.candidateId === 'persist-fail');
    expect(passRow?.formalBtPassed).toBe(true);
    expect(passRow?.formalBtFailureReason).toBeNull();
    expect(passRow?.generation).toBe(2);
    expect(passRow?.evolutionRunId).toBe('00000000-0000-0000-0000-000000000001');
    expect(passRow?.engine).toBe('analysis-engine');
    expect(typeof passRow?.candidateHash).toBe('string');
    expect(passRow?.candidateHash).toMatch(/^[0-9a-f]{64}$/);

    expect(failRow?.formalBtPassed).toBe(false);
    expect(failRow?.formalBtFailureReason).toMatch(/pf 0\.5/);
    // 同じ runId 内で異なる構造の DSL は異なる hash
    expect(passRow?.candidateHash).not.toBe(failRow?.candidateHash);
  });

  it('段階 4a.4: evolutionBacktestRepo に null を渡すと永続化はスキップされる', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'no-persist',
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
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });

    const adapter = new SurrogateFitnessSimulator();
    const s = (pf: number) => ({
      totalTrades: 20,
      winningTrades: 12,
      losingTrades: 8,
      winRate: 0.6,
      netProfit: 200,
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
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: 'no-persist',
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 2.0,
      validationPf: 1.6,
      overfitScore: 0.15,
      train: { summary: s(2.0), trades: [] },
      validation: { summary: s(1.6), trades: [] },
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

    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.55, 30));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      runFormalBacktest,
    });

    // 永続化スキップ = DB へのアクセスは発生しない (mock 不要で完走できる)
    const report = await loop.runOneGeneration('breakout');
    expect(report.promotionCandidates).toHaveLength(1);
    expect(runFormalBacktest).toHaveBeenCalledTimes(1);
  });
});
