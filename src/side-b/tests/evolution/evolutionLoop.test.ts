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
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
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
      edgeHypothesisLoader: null,
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
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
      mutationStrategy: 'llm',
      crossoverStrategy: 'llm',
      correlationId: 'evolution-test-20260603',
    });

    const report = await loop.runOneGeneration('breakout');

    expect(runFormalBacktest).toHaveBeenCalledTimes(1);
    // 正式BTにシンボル別の往復スプレッド(pips)と pipSize が渡る（コスト0過大評価の防止）。
    // EURUSD: 往復1.2pips / pipSize 0.0001。
    const formalBtArg = runFormalBacktest.mock.calls[0][0];
    const formalBtOptions = runFormalBacktest.mock.calls[0][1];
    expect(formalBtArg.config?.spreadPips).toBeCloseTo(1.2);
    expect(formalBtArg.config?.pipSize).toBeCloseTo(0.0001);
    // SL 最小フロア(=2×往復コスト1.2pips=2.4) / 最大キャップ(EURUSD=40pips) も正式BTに渡る。
    // 低ボラで ATR 基準 SL が往復コストに飲まれて縮みすぎる過大評価を engine 側で clamp する。
    expect(formalBtArg.config?.minStopLossPips).toBeCloseTo(2.4);
    expect(formalBtArg.config?.maxStopLossPips).toBe(40);
    expect(formalBtOptions?.correlationId).toBe('evolution-test-20260603');
    expect(report.correlationId).toBe('evolution-test-20260603');
    expect(report.errors.some((e) => e.includes('correlationId=evolution-test-20260603'))).toBe(true);
    expect(report.promotionCandidates.length).toBeGreaterThanOrEqual(1);
    const cand = report.promotionCandidates.find((c) => c.dslId === 'loop-test-promote');
    expect(cand).toBeDefined();
    expect(cand?.source).toBe('evolution');
    expect(cand?.regime).toBe('breakout');
    expect(cand?.trainPf).toBeCloseTo(2.0);
    expect(cand?.validationPf).toBeCloseTo(1.6);
    expect(cand?.overfitScore).toBeCloseTo(0.15);
    expect(cand?.formalBtPassed).toBe(true);
    // PR #100: maxDrawdown が analysis-engine summary.maxDD から埋まる
    expect(cand?.formalBtMetrics).toEqual({
      pf: 1.8,
      winRate: 0.55,
      tradeCount: 35,
      maxDrawdown: 0.05,
      returnPct: 0.1,
      sharpe: 1.2,
    });
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
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
      mutationStrategy: 'llm',
      crossoverStrategy: 'llm',
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
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
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
      edgeHypothesisLoader: null,
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
            conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: i + 0.0001 }],
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
      formalBtTopK: 3,
      mutationStrategy: 'llm',
      crossoverStrategy: 'llm',
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
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
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
      edgeHypothesisLoader: null,
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

  it('Phase B-1: analysis-engine の trades が createMany の row.trades に伝播する', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'persist-trades',
      generation: 1,
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
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });

    const adapter = new SurrogateFitnessSimulator();
    const summary = (pf: number) => ({
      totalTrades: 30,
      winningTrades: 18,
      losingTrades: 12,
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
      dslId: 'persist-trades',
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
    });

    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', dsl);

    // analysis-engine が trades を 3 件返す
    const sampleTrades = [
      {
        entryTime: '2024-06-01T00:00:00.000Z',
        entryPrice: 1.0850,
        exitTime: '2024-06-01T03:00:00.000Z',
        exitPrice: 1.0900,
        side: 'long' as const,
        pnl: 50,
        outcome: 'win' as const,
      },
      {
        entryTime: '2024-06-02T00:00:00.000Z',
        entryPrice: 1.0900,
        exitTime: '2024-06-02T03:00:00.000Z',
        exitPrice: 1.0850,
        side: 'long' as const,
        pnl: -50,
        outcome: 'loss' as const,
      },
      {
        entryTime: '2024-06-03T00:00:00.000Z',
        entryPrice: 1.0900,
        exitTime: null,
        exitPrice: null,
        side: 'long' as const,
        pnl: 0,
        outcome: 'timeout' as const,
      },
    ];

    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue({
        summary: { pf: 1.5, winRate: 0.6, tradeCount: 30, maxDD: 0.05, sharpe: 1.2, returnPct: 0.1 },
        trades: sampleTrades,
        equity: null,
        engineVersion: 'analysis-engine/backtesting.py@test',
        unsupportedConditions: [],
      });

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

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      runFormalBacktest,
      evolutionBacktestRepo: { createMany, findRecentFormalBtPassed },
      edgeHypothesisLoader: null,
      evolutionRunId: '00000000-0000-0000-0000-000000000099',
    });

    await loop.runOneGeneration('breakout');

    expect(createMany).toHaveBeenCalledTimes(1);
    const rows = createMany.mock.calls[0][0] as Array<{
      candidateId: string;
      trades?: ReadonlyArray<{
        entryTime: string;
        side: 'long' | 'short';
        pnl: number;
        outcome: 'win' | 'loss' | 'timeout';
      }>;
    }>;
    expect(rows).toHaveLength(1);

    // trades は entryTime / side / pnl / outcome のみ抽出 (entryPrice / exitPrice 等は除外)
    expect(rows[0].trades).toEqual([
      { entryTime: '2024-06-01T00:00:00.000Z', side: 'long', pnl: 50, outcome: 'win' },
      { entryTime: '2024-06-02T00:00:00.000Z', side: 'long', pnl: -50, outcome: 'loss' },
      { entryTime: '2024-06-03T00:00:00.000Z', side: 'long', pnl: 0, outcome: 'timeout' },
    ]);
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
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
      mutationStrategy: 'llm',
      crossoverStrategy: 'llm',
    });

    // 永続化スキップ = DB へのアクセスは発生しない (mock 不要で完走できる)
    const report = await loop.runOneGeneration('breakout');
    expect(report.promotionCandidates).toHaveLength(1);
    expect(runFormalBacktest).toHaveBeenCalledTimes(1);
  });

  // =================================================================
  // PR #100: FailureReason → RepairHint v1 統合テスト
  // =================================================================

  it('PR #100: 正式 BT 失敗候補に repairHint が付与され、repairHintSummary が生成される', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr100-fail',
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
      dslId: 'pr100-fail',
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

    // PF=0.7 < FORMAL_BT_MIN_PF(=1.0) で必ず失敗 + warning に PF<0.8 が記録されることを期待
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(0.7, 0.4, 30));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(report.promotionCandidates).toHaveLength(0);
    expect(report.formalBtVerifiedCandidates).toHaveLength(1);
    const failed = report.formalBtVerifiedCandidates[0];
    expect(failed.formalBtPassed).toBe(false);
    expect(failed.repairHint).toBeDefined();
    expect(failed.repairHint?.failureReason).toBe('low_pf');
    expect(failed.repairHint?.shouldUseForRepairMutation).toBe(true);
    expect(failed.repairHint?.warnings.some((w) => w.includes('PF'))).toBe(true);

    expect(report.repairHintSummary).toBeDefined();
    expect(report.repairHintSummary.totalFailures).toBe(1);
    expect(report.repairHintSummary.repairable).toBe(1);
    expect(report.repairHintSummary.excluded).toBe(0);
    expect(report.repairHintSummary.byFailureReason.low_pf).toBe(1);
    // route 情報も summary に反映される
    expect(Object.keys(report.repairHintSummary.byRoute)).not.toHaveLength(0);
  });

  it('PR #100: 全候補が正式 BT 成功なら repairHintSummary は totalFailures=0 で空集計', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr100-pass-only',
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
      dslId: 'pr100-pass-only',
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(report.promotionCandidates).toHaveLength(1);
    // 成功候補には repairHint は付かない
    for (const c of report.formalBtVerifiedCandidates) {
      if (c.formalBtPassed) expect(c.repairHint).toBeUndefined();
    }
    expect(report.repairHintSummary.totalFailures).toBe(0);
    expect(report.repairHintSummary.repairable).toBe(0);
    expect(report.repairHintSummary.excluded).toBe(0);
    expect(report.repairHintSummary.bySeverity).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      fatal: 0,
    });
  });

  it('PR #100 review: maxDD は formalBtMetrics.maxDrawdown に取り込まれ、RepairHint の risk action を発火させる', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr100-maxdd',
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
      dslId: 'pr100-maxdd',
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

    // PF=0.5 < FORMAL_BT_MIN_PF (失敗確定) + maxDD=0.5 (>0.3) で risk action 発火を期待
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue({
        summary: {
          pf: 0.5,
          winRate: 0.4,
          tradeCount: 30,
          maxDD: 0.5,
          sharpe: -0.2,
          returnPct: -0.1,
        },
        trades: [],
        equity: null,
        engineVersion: 'analysis-engine/backtesting.py@test',
        unsupportedConditions: [],
      });

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(report.formalBtVerifiedCandidates).toHaveLength(1);
    const failed = report.formalBtVerifiedCandidates[0];
    expect(failed.formalBtPassed).toBe(false);
    expect(failed.formalBtMetrics?.maxDrawdown).toBeCloseTo(0.5);
    expect(failed.repairHint?.failureReason).toBe('low_pf');
    // maxDrawdown > 0.3 で risk action が追加される
    expect(failed.repairHint?.actions.some((a) => a.target === 'risk')).toBe(true);
  });

  it('PR #100 review: 1世代目の RepairHint は同インスタンスで 2世代目 mutation に渡る', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr100-multigen',
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
      dslId: 'pr100-multigen',
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
    const generateMutantsSpy = jest
      .spyOn(mutationAgent, 'generateMutants')
      .mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', dsl);

    // 1 世代目: 必ず失敗 (PF=0.5) → RepairHint が生成される
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(0.5, 0.4, 30));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      mutationStrategy: 'llm',
      crossoverStrategy: 'llm',
    });

    // 1世代目: repairHints 引数も lastRepairHints も空 → 4 引数目は undefined
    await loop.runOneGeneration('breakout');
    const firstCall = generateMutantsSpy.mock.calls[0];
    expect(firstCall[3]).toBeUndefined();

    // 2世代目: 同じインスタンス。1 世代目の RepairHint が lastRepairHints として
    //   mutation に渡るはず (repairHints?.size > 0)
    await loop.runOneGeneration('breakout');
    const secondCall = generateMutantsSpy.mock.calls[1];
    const passedRepairHints = secondCall[3];
    expect(passedRepairHints).toBeDefined();
    expect(passedRepairHints?.size).toBeGreaterThan(0);
    // 値の中身も期待通り (low_pf)
    const firstHint = Array.from(passedRepairHints!.values())[0];
    expect(firstHint?.failureReason).toBe('low_pf');
  });

  it('PR #100 review: options.repairHintsForMutation で外部から RepairHints を注入できる', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr100-inject',
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
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });

    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: 'pr100-inject',
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 2.0,
      validationPf: 1.6,
      overfitScore: 0.15,
      train: {
        summary: {
          totalTrades: 20,
          winningTrades: 12,
          losingTrades: 8,
          winRate: 0.6,
          netProfit: 200,
          netProfitRate: 0.1,
          maxDrawdown: 30,
          maxDrawdownRate: 0.03,
          profitFactor: 2.0,
          averageWin: 15,
          averageLoss: -10,
          riskRewardRatio: 1.5,
          maxConsecutiveWins: 3,
          maxConsecutiveLosses: 2,
        },
        trades: [],
      },
      validation: {
        summary: {
          totalTrades: 10,
          winningTrades: 6,
          losingTrades: 4,
          winRate: 0.6,
          netProfit: 160,
          netProfitRate: 0.1,
          maxDrawdown: 30,
          maxDrawdownRate: 0.03,
          profitFactor: 1.6,
          averageWin: 15,
          averageLoss: -10,
          riskRewardRatio: 1.5,
          maxConsecutiveWins: 3,
          maxConsecutiveLosses: 2,
        },
        trades: [],
      },
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
    const generateMutantsSpy = jest
      .spyOn(mutationAgent, 'generateMutants')
      .mockResolvedValue([]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', dsl);

    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.6, 30));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    // 外部から (= 本番 scheduler 想定) RepairHints を注入
    const { createRepairHintV1 } = await import('../../evolution/repairHintPolicy');
    const injected = new Map([
      [
        'some-prev-candidate-id',
        createRepairHintV1({
          candidateId: 'some-prev-candidate-id',
          failureReason: 'insufficient_trades',
          metrics: { tradeCount: 0 },
        }),
      ],
    ]);
    await loop.runOneGeneration('breakout', { repairHintsForMutation: injected });

    const passed = generateMutantsSpy.mock.calls[0][3];
    expect(passed).toBeDefined();
    expect(passed?.size).toBe(1);
  });

  it('PR #100: analysis-engine 例外失敗候補は analysis_engine_error として repairHint 化される', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr100-engine-error',
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
      dslId: 'pr100-engine-error',
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

    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockRejectedValue(new Error('socket hang up'));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(report.formalBtVerifiedCandidates).toHaveLength(1);
    const failed = report.formalBtVerifiedCandidates[0];
    expect(failed.formalBtPassed).toBe(false);
    expect(failed.repairHint?.failureReason).toBe('analysis_engine_error');
    expect(failed.repairHint?.severity).toBe('high');
    expect(failed.repairHint?.actions.some((a) => a.target === 'dsl_shape')).toBe(true);
    expect(report.repairHintSummary.byFailureReason.analysis_engine_error).toBe(1);
    expect(report.repairHintSummary.bySeverity.high).toBe(1);
  });

  // =================================================================
  // PR #101: PromotionGate / EvolutionCandidateStage 統合テスト
  // =================================================================

  it('PR #101: GenerationReport に promotionGateSummary が含まれ、formal_bt_passed は validation_candidate に集計される', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr101-pass',
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
      dslId: 'pr101-pass',
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    // promotionGateSummary が報告に含まれる
    expect(report.promotionGateSummary).toBeDefined();
    expect(report.promotionGateDecisions.length).toBeGreaterThan(0);
    // formal_bt_passed 候補は validation_candidate に上がる
    expect(report.promotionGateSummary.byStage.validation_candidate).toBeGreaterThanOrEqual(1);
    // production への自動昇格は禁止 (= productionEligible は常に 0)
    expect(report.promotionGateSummary.productionEligible).toBe(0);
    // formal_bt_passed reason が積まれている
    expect(report.promotionGateSummary.byReason.formal_bt_passed).toBeGreaterThanOrEqual(1);
  });

  it('PR #101 review: 同 dsl が parent と verified に出ても二重計上されず、verified の最終 stage で確定する', async () => {
    // population に 1 件入れて parent pool に確実に乗せる + その候補が surrogate を通って
    // formal BT も通過するシナリオ。単一 dsl が parent_eligible と validation_candidate に
    // 二重計上されないことを確認 (PR #101 review #2)。
    const dsl = StrategyDSLSchema.parse({
      id: 'pr101-dedup',
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
      dslId: 'pr101-dedup',
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    // dslId 一意化: 同 candidateId が 2 件以上 decisions に出ない
    const ids = report.promotionGateDecisions.map((d) => d.candidateId);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);

    // pr101-dedup は verified に上がっているので validation_candidate で確定 (parent_eligible にならない)
    const target = report.promotionGateDecisions.find((d) => d.candidateId === 'pr101-dedup');
    expect(target).toBeDefined();
    expect(target?.toStage).toBe('validation_candidate');
    // totalCandidates と decisions 数も一致
    expect(report.promotionGateSummary.totalCandidates).toBe(report.promotionGateDecisions.length);
  });

  // =================================================================
  // PR #102: RepairHint Outcome Telemetry v1 統合テスト
  // =================================================================

  it('PR #102: 1世代目の baseline + repairHint を 2世代目で受け取り、improved を観測する', async () => {
    // 1世代目: 失敗 (PF=0.5) → repairHint 生成 → baseline 保持
    // 2世代目: 同インスタンスの lastRepairBaselines + lastRepairHints を使い、
    //   mutation child が PF 改善で formal BT 通過 → outcome=improved を期待
    const dsl = StrategyDSLSchema.parse({
      id: 'pr102-gen1',
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

    // mutation child (parent=pr102-gen1) を 1 件だけ返す
    const childDsl = StrategyDSLSchema.parse({
      id: 'pr102-gen2-child',
      generation: 1,
      parentIds: ['pr102-gen1'],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 1 }],
        },
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'mutation' },
    });

    const mutationAgent = new MutationAgent();
    const mutSpy = jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([childDsl]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', dsl);

    // 1世代目: PF=0.5 で失敗 / 2世代目: PF=1.5 で通過
    let callCount = 0;
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockImplementation(() => {
        callCount += 1;
        return Promise.resolve(
          callCount === 1
            ? makeFormalBtResponse(0.5, 0.4, 30) // gen1 failed
            : makeFormalBtResponse(1.5, 0.55, 30), // gen2 passed
        );
      });

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      mutationStrategy: 'llm',
      crossoverStrategy: 'llm',
    });

    // 1世代目: outcome は trace なし (baseline / repairHints が空) で 0 件
    const gen1 = await loop.runOneGeneration('breakout');
    expect(gen1.repairOutcomeSummary.attempted).toBe(0);
    expect(gen1.repairOutcomes).toEqual([]);

    // 2世代目: 1 件の child が repairHint を継承し、PF 改善で improved
    const gen2 = await loop.runOneGeneration('breakout');
    // mutation 4 引数目に repairHints が渡っていることを確認
    expect(mutSpy.mock.calls[1][3]).toBeDefined();
    expect(mutSpy.mock.calls[1][3]?.size).toBeGreaterThan(0);

    expect(gen2.repairOutcomeSummary.attempted).toBe(1);
    expect(gen2.repairOutcomeSummary.improved).toBe(1);
    expect(gen2.repairOutcomes).toHaveLength(1);
    const oc = gen2.repairOutcomes[0];
    expect(oc.childDslId).toBe('pr102-gen2-child');
    expect(oc.sourceCandidateId).toBe('pr102-gen1');
    expect(oc.failureReason).toBe('low_pf');
    expect(oc.status).toBe('improved');
    expect(oc.deltas.pfDelta).toBeGreaterThan(0);
    // outcome 集計に failureReason / target / route が含まれる
    expect(gen2.repairOutcomeSummary.byFailureReason.low_pf).toBeDefined();
    expect(gen2.repairOutcomeSummary.byRoute).not.toEqual({});
  });

  it('PR #102: outcome=improved でも productionEligible / promotionGateSummary は変わらない (観測のみ)', async () => {
    // 同じ multi-gen シナリオで、promotionGateSummary に production 影響がないことを確認
    const dsl = StrategyDSLSchema.parse({
      id: 'pr102-isolation',
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

    const childDsl = StrategyDSLSchema.parse({
      id: 'pr102-iso-child',
      generation: 1,
      parentIds: ['pr102-isolation'],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 1 }],
        },
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'mutation' },
    });

    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([childDsl]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', dsl);

    let n = 0;
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockImplementation(() => {
        n += 1;
        return Promise.resolve(
          n === 1 ? makeFormalBtResponse(0.5, 0.4, 30) : makeFormalBtResponse(1.5, 0.55, 30),
        );
      });

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      mutationStrategy: 'llm',
      crossoverStrategy: 'llm',
    });

    await loop.runOneGeneration('breakout');
    const gen2 = await loop.runOneGeneration('breakout');

    // outcome=improved
    expect(gen2.repairOutcomeSummary.improved).toBe(1);
    // PromotionGate は outcome に影響されない: productionEligible=0 のまま
    expect(gen2.promotionGateSummary.productionEligible).toBe(0);
    expect(gen2.promotionGateSummary.byStage.production_candidate).toBe(0);
    // child は formalBtPassed=true で validation_candidate に遷移する (production には行かない)
    expect(gen2.promotionGateSummary.byStage.validation_candidate).toBeGreaterThanOrEqual(1);
  });

  it('PR #102: repairApplied trace がない通常 mutation child は outcome 対象外', async () => {
    // 1世代目から repairHint なし (= passed) で開始 → 2世代目 mutation child は trace なし
    const dsl = StrategyDSLSchema.parse({
      id: 'pr102-no-trace',
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

    const childDsl = StrategyDSLSchema.parse({
      id: 'pr102-no-trace-child',
      generation: 1,
      parentIds: ['pr102-no-trace'],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 1 }],
        },
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'mutation' },
    });

    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([childDsl]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);
    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const population = new StrategyPopulation(undefined);
    population.add('breakout', dsl);

    // 1世代目も2世代目も passed (= 失敗なしなので repairHint も生成されない)
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    await loop.runOneGeneration('breakout');
    const gen2 = await loop.runOneGeneration('breakout');

    // gen1 で失敗ゼロ → repairHint なし → gen2 child に trace 付与なし → outcome 対象外
    expect(gen2.repairOutcomeSummary.attempted).toBe(0);
    expect(gen2.repairOutcomes).toEqual([]);
  });

  // =================================================================
  // PR #103: OOS / Walk-forward v1 統合テスト
  // =================================================================

  it('PR #103: oosBacktestRunner 未指定なら validation_candidate は not_evaluated', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr103-not-eval',
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
      dslId: 'pr103-not-eval',
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
      // oosBacktestRunner 未指定
    });

    const report = await loop.runOneGeneration('breakout');

    // formal_bt_passed → validation_candidate に上がっている
    expect(report.promotionGateSummary.byStage.validation_candidate).toBeGreaterThanOrEqual(1);
    // OOS は runner 未注入で not_evaluated
    expect(report.oosValidationSummary.attempted).toBe(1);
    expect(report.oosValidationSummary.notEvaluated).toBe(1);
    expect(report.oosValidationSummary.byStatus.not_evaluated).toBe(1);
    expect(report.oosValidationResults).toHaveLength(1);
    expect(report.oosValidationResults[0].status).toBe('not_evaluated');
    expect(report.oosValidationResults[0].warnings[0]).toMatch(/未注入/);
    // production には絶対に上がらない (PR #103 の不変条件)
    expect(report.promotionGateSummary.productionEligible).toBe(0);
  });

  it('PR #105: oosBacktestRunner 注入 + analysis-engine verdict=passed で oos_passed が観測される', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr103-with-runner',
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
      dslId: 'pr103-with-runner',
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

    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(1.8, 0.55, 35));

    // PR #105: analysis-engine の verdict を尊重する契約に変更。
    // adapter は { metrics, verdict } を返し、Evolution 側で再判定しない。
    const oosBacktestRunner = jest.fn().mockResolvedValue({
      metrics: {
        pf: 1.7,
        tradeCount: 50,
        maxDrawdown: 10,
        expectancy: null,
      },
      verdict: 'passed' as const,
      evaluationKind: 'oos' as const,
    });

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      oosBacktestRunner,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(oosBacktestRunner).toHaveBeenCalledTimes(1);
    expect(report.oosValidationSummary.attempted).toBe(1);
    expect(report.oosValidationSummary.passed).toBe(1);
    expect(report.oosValidationResults[0].status).toBe('oos_passed');
    expect(report.oosValidationResults[0].sourceStage).toBe('validation_candidate');
    // OOS passed でも production には上がらない
    expect(report.promotionGateSummary.productionEligible).toBe(0);
    expect(report.promotionGateSummary.byStage.production_candidate).toBe(0);
  });

  it('PR #103: oosBacktestRunner 例外でも runOneGeneration は落ちず unknown + oos_engine_error', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr103-runner-throws',
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
      dslId: 'pr103-runner-throws',
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

    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(1.8, 0.55, 35));

    const oosBacktestRunner = jest
      .fn()
      .mockRejectedValue(new Error('analysis-engine OOS unreachable'));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      oosBacktestRunner,
    });

    const report = await loop.runOneGeneration('breakout');
    expect(report.oosValidationSummary.attempted).toBe(1);
    expect(report.oosValidationSummary.unknown).toBe(1);
    expect(report.oosValidationResults[0].status).toBe('unknown');
    expect(report.oosValidationResults[0].failureReasons).toContain('oos_engine_error');
    expect(report.oosValidationResults[0].warnings[0]).toMatch(/analysis-engine 例外/);
    // 既存 summary は壊れない
    expect(report.promotionGateSummary.byStage.validation_candidate).toBeGreaterThanOrEqual(1);
    expect(report.repairOutcomeSummary).toBeDefined();
  });

  it('PR #103: validation_candidate でない候補 (repairable / parent_eligible 等) は OOS 対象外', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr103-no-target',
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
      dslId: 'pr103-no-target',
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

    // formal BT は失敗 (PF=0.5) → repairable に行く → validation_candidate にならない
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(0.5, 0.4, 30));

    const oosBacktestRunner = jest.fn().mockResolvedValue({
      metrics: { pf: 1.5, tradeCount: 50, maxDrawdown: 10, expectancy: null },
      verdict: 'passed' as const,
      evaluationKind: 'oos' as const,
    });

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      oosBacktestRunner,
    });

    const report = await loop.runOneGeneration('breakout');

    // validation_candidate は 0 件 (= 全部 repairable に流れた)
    expect(report.promotionGateSummary.byStage.validation_candidate).toBe(0);
    expect(report.promotionGateSummary.byStage.repairable).toBeGreaterThanOrEqual(1);
    // OOS runner は呼ばれない
    expect(oosBacktestRunner).not.toHaveBeenCalled();
    expect(report.oosValidationSummary.attempted).toBe(0);
    expect(report.oosValidationResults).toEqual([]);
  });

  it('PR #101: 正式 BT 失敗候補に repairHint があれば repairable stage に集計される', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr101-repairable',
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
      dslId: 'pr101-repairable',
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

    // PF=0.5 で formal BT 失敗 → repairHint が low_pf で生成 → repairable
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(0.5, 0.4, 30));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(report.promotionGateSummary.byStage.repairable).toBeGreaterThanOrEqual(1);
    expect(report.promotionGateSummary.repairable).toBeGreaterThanOrEqual(1);
    expect(report.promotionGateSummary.byReason.repair_hint_available).toBeGreaterThanOrEqual(1);
    // 失敗候補は production には絶対に上がらない
    expect(report.promotionGateSummary.productionEligible).toBe(0);
    expect(report.promotionGateSummary.byStage.production_candidate).toBe(0);
  });

  // =================================================================
  // PR #108: Quality-Diversity Archive Lite parent injection
  // =================================================================

  it('PR #108: qualityDiversityArchiveParents 未指定なら従来挙動 + parentPoolSummary 不変', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr108-no-archive',
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
      dslId: 'pr108-no-archive',
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });
    const report = await loop.runOneGeneration('breakout'); // archive parents 未指定
    expect(report.errors.find((e) => e.includes('quality diversity archive'))).toBeUndefined();
    expect(report.parentPoolSummary).toBeDefined();
    expect(report.formalBtCandidateSummary).toBeDefined();
  });

  it('PR #108: qualityDiversityArchiveParents 指定時に重複 dsl.id を除外して population に注入される', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'pr108-pop-base',
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
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
    const archiveParent = StrategyDSLSchema.parse({
      ...JSON.parse(JSON.stringify(dsl)),
      id: 'pr108-archive-1',
    });
    const duplicateOfBase = StrategyDSLSchema.parse({
      ...JSON.parse(JSON.stringify(dsl)),
      id: 'pr108-pop-base', // 既存と同 id
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
      edgeHypothesisLoader: null,
      runFormalBacktest,
    });
    const report = await loop.runOneGeneration('breakout', {
      qualityDiversityArchiveParents: [archiveParent, duplicateOfBase],
    });
    // 重複 id は skip され、archive-1 のみ追加 (= 1 件 injected)
    // 注: 本世代の population から removeWorst が後段で動くため、注入後の population
    // 状態は仕様上保証しない。injection log の 1 件 (= duplicate-skip 後の正味注入数)
    // を pin することで「重複除外 + 注入」が機能することを担保する。
    const injectionLog = report.errors.find((e) =>
      e.includes('quality diversity archive parents injected'),
    );
    expect(injectionLog).toBeDefined();
    expect(injectionLog).toContain('1');
  });
});

// =================================================================
// Phase B-2: cron 跨ぎ carry state load/save 配線テスト
// =================================================================

import type {
  EvolutionInstanceCarryPersister,
  EvolutionCarryPayload,
  EvolutionInstanceCarryRecord,
} from '../../../backend/repositories/evolutionInstanceCarryRepository';

describe('EvolutionLoop Phase B-2: carry state load/save', () => {
  function buildBaseDsl(id: string) {
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
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
  }

  it('evolutionInstanceCarryRepo 未指定なら carry 経路は呼ばれない (既存挙動維持)', async () => {
    const dsl = buildBaseDsl('phase-b2-no-carry');
    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: dsl.id,
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 1.5,
      validationPf: 1.4,
      overfitScore: 0.1,
      train: {
        summary: {
          totalTrades: 30, winningTrades: 18, losingTrades: 12, winRate: 0.6,
          netProfit: 100, netProfitRate: 0.1, maxDrawdown: 30, maxDrawdownRate: 0.03,
          profitFactor: 1.5, averageWin: 15, averageLoss: -10,
          riskRewardRatio: 1.5, maxConsecutiveWins: 3, maxConsecutiveLosses: 2,
        },
        trades: [],
      },
      validation: {
        summary: {
          totalTrades: 15, winningTrades: 9, losingTrades: 6, winRate: 0.6,
          netProfit: 50, netProfitRate: 0.05, maxDrawdown: 15, maxDrawdownRate: 0.015,
          profitFactor: 1.4, averageWin: 12, averageLoss: -8,
          riskRewardRatio: 1.5, maxConsecutiveWins: 2, maxConsecutiveLosses: 1,
        },
        trades: [],
      },
      execution: {
        executionModel: 'legacy_zero_cost',
        executionConfigHash: 'legacy-zero-cost',
        dataSource: 'ctrader',
        costSummary: {
          model: 'legacy_zero_cost', dataSource: 'ctrader',
          roundTripCostPips: 0, roundTripCostAtrMult: 0, totalCost: 0,
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
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.6, 30));

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      // evolutionInstanceCarryRepo: undefined → null と同等 (= 既定 null で skip)
    });

    const report = await loop.runOneGeneration('breakout');
    // carry 関連の info ログが errors[] に含まれない
    const carryLogs = report.errors.filter((e) => e.includes('B-2 carry'));
    expect(carryLogs).toEqual([]);
  });

  it('evolutionInstanceCarryRepo 指定時、初回 runOneGeneration で findLatestByRegime + create が呼ばれる', async () => {
    const dsl = buildBaseDsl('phase-b2-empty-carry');
    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: dsl.id,
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 1.5,
      validationPf: 1.4,
      overfitScore: 0.1,
      train: {
        summary: {
          totalTrades: 30, winningTrades: 18, losingTrades: 12, winRate: 0.6,
          netProfit: 100, netProfitRate: 0.1, maxDrawdown: 30, maxDrawdownRate: 0.03,
          profitFactor: 1.5, averageWin: 15, averageLoss: -10,
          riskRewardRatio: 1.5, maxConsecutiveWins: 3, maxConsecutiveLosses: 2,
        },
        trades: [],
      },
      validation: {
        summary: {
          totalTrades: 15, winningTrades: 9, losingTrades: 6, winRate: 0.6,
          netProfit: 50, netProfitRate: 0.05, maxDrawdown: 15, maxDrawdownRate: 0.015,
          profitFactor: 1.4, averageWin: 12, averageLoss: -8,
          riskRewardRatio: 1.5, maxConsecutiveWins: 2, maxConsecutiveLosses: 1,
        },
        trades: [],
      },
      execution: {
        executionModel: 'legacy_zero_cost',
        executionConfigHash: 'legacy-zero-cost',
        dataSource: 'ctrader',
        costSummary: {
          model: 'legacy_zero_cost', dataSource: 'ctrader',
          roundTripCostPips: 0, roundTripCostAtrMult: 0, totalCost: 0,
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
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.6, 30));

    const findLatestByRegime: jest.MockedFunction<
      EvolutionInstanceCarryPersister['findLatestByRegime']
    > = jest.fn().mockResolvedValue(null);
    const create: jest.MockedFunction<EvolutionInstanceCarryPersister['create']> = jest.fn();
    const deleteOlderThan: jest.MockedFunction<
      EvolutionInstanceCarryPersister['deleteOlderThan']
    > = jest.fn();
    const carryRepo: EvolutionInstanceCarryPersister = {
      findLatestByRegime,
      create,
      deleteOlderThan,
    };

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      evolutionInstanceCarryRepo: carryRepo,
    });

    const report = await loop.runOneGeneration('breakout');

    expect(findLatestByRegime).toHaveBeenCalledTimes(1);
    expect(findLatestByRegime).toHaveBeenCalledWith('breakout');
    expect(create).toHaveBeenCalledTimes(1);
    const createArg = create.mock.calls[0][0];
    expect(createArg.regime).toBe('breakout');
    expect(createArg.payload.tradesByDslId).toBeDefined();
    expect(createArg.payload.repairHints).toBeDefined();
    expect(createArg.payload.repairBaselines).toBeDefined();

    // info ログに「carry なし」と「carry saved」が出る
    const noCarryLog = report.errors.find((e) => e.includes('既存 carry なし'));
    const savedLog = report.errors.find((e) => e.includes('B-2 carry saved'));
    expect(noCarryLog).toBeDefined();
    expect(savedLog).toBeDefined();
  });

  it('既存 carry が DB にあれば load して in-memory cache を初期化する (= info ログ確認)', async () => {
    const dsl = buildBaseDsl('phase-b2-with-carry');
    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: dsl.id,
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 1.5,
      validationPf: 1.4,
      overfitScore: 0.1,
      train: {
        summary: {
          totalTrades: 30, winningTrades: 18, losingTrades: 12, winRate: 0.6,
          netProfit: 100, netProfitRate: 0.1, maxDrawdown: 30, maxDrawdownRate: 0.03,
          profitFactor: 1.5, averageWin: 15, averageLoss: -10,
          riskRewardRatio: 1.5, maxConsecutiveWins: 3, maxConsecutiveLosses: 2,
        },
        trades: [],
      },
      validation: {
        summary: {
          totalTrades: 15, winningTrades: 9, losingTrades: 6, winRate: 0.6,
          netProfit: 50, netProfitRate: 0.05, maxDrawdown: 15, maxDrawdownRate: 0.015,
          profitFactor: 1.4, averageWin: 12, averageLoss: -8,
          riskRewardRatio: 1.5, maxConsecutiveWins: 2, maxConsecutiveLosses: 1,
        },
        trades: [],
      },
      execution: {
        executionModel: 'legacy_zero_cost',
        executionConfigHash: 'legacy-zero-cost',
        dataSource: 'ctrader',
        costSummary: {
          model: 'legacy_zero_cost', dataSource: 'ctrader',
          roundTripCostPips: 0, roundTripCostAtrMult: 0, totalCost: 0,
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
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.6, 30));

    const existingCarry: EvolutionInstanceCarryRecord = {
      id: 'carry-existing',
      evolutionRunId: '00000000-0000-0000-0000-000000000099',
      regime: 'breakout',
      generation: 5,
      payload: {
        tradesByDslId: {
          'parent-from-prev-cron': [
            { entryTime: '2024-05-01T00:00:00.000Z', side: 'long', pnl: 100, outcome: 'win' },
            { entryTime: '2024-05-02T00:00:00.000Z', side: 'short', pnl: -50, outcome: 'loss' },
          ],
        },
        repairHints: {},
        repairBaselines: {},
      } satisfies EvolutionCarryPayload,
      recordedAt: new Date('2026-05-09T00:00:00.000Z'),
    };

    const findLatestByRegime: jest.MockedFunction<
      EvolutionInstanceCarryPersister['findLatestByRegime']
    > = jest.fn().mockResolvedValue(existingCarry);
    const create: jest.MockedFunction<EvolutionInstanceCarryPersister['create']> = jest.fn();
    const deleteOlderThan: jest.MockedFunction<
      EvolutionInstanceCarryPersister['deleteOlderThan']
    > = jest.fn();
    const carryRepo: EvolutionInstanceCarryPersister = {
      findLatestByRegime,
      create,
      deleteOlderThan,
    };

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      evolutionInstanceCarryRepo: carryRepo,
    });

    const report = await loop.runOneGeneration('breakout');

    // 復元成功ログに前 cron の trades 件数が含まれる
    const restoredLog = report.errors.find((e) => e.includes('B-2 carry restored'));
    expect(restoredLog).toBeDefined();
    expect(restoredLog).toContain('trades=1');
    expect(restoredLog).toContain('carryId=carry-existing');

    // 当世代の cache (= 復元 trades + 当世代 trades) が save される
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('PR #140 review #1: regime 切替時に前 regime の cache が残留しない (state 汚染防止)', async () => {
    const dsl = buildBaseDsl('phase-b2-no-state-pollution');
    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: dsl.id,
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 1.5,
      validationPf: 1.4,
      overfitScore: 0.1,
      train: {
        summary: {
          totalTrades: 30, winningTrades: 18, losingTrades: 12, winRate: 0.6,
          netProfit: 100, netProfitRate: 0.1, maxDrawdown: 30, maxDrawdownRate: 0.03,
          profitFactor: 1.5, averageWin: 15, averageLoss: -10,
          riskRewardRatio: 1.5, maxConsecutiveWins: 3, maxConsecutiveLosses: 2,
        },
        trades: [],
      },
      validation: {
        summary: {
          totalTrades: 15, winningTrades: 9, losingTrades: 6, winRate: 0.6,
          netProfit: 50, netProfitRate: 0.05, maxDrawdown: 15, maxDrawdownRate: 0.015,
          profitFactor: 1.4, averageWin: 12, averageLoss: -8,
          riskRewardRatio: 1.5, maxConsecutiveWins: 2, maxConsecutiveLosses: 1,
        },
        trades: [],
      },
      execution: {
        executionModel: 'legacy_zero_cost',
        executionConfigHash: 'legacy-zero-cost',
        dataSource: 'ctrader',
        costSummary: {
          model: 'legacy_zero_cost', dataSource: 'ctrader',
          roundTripCostPips: 0, roundTripCostAtrMult: 0, totalCost: 0,
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
    population.add('reversal', { ...dsl, id: 'reversal-dsl', regimeTarget: 'reversal' });
    const runFormalBacktest = jest
      .fn<ReturnType<RunScreeningBacktestFn>, Parameters<RunScreeningBacktestFn>>()
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.6, 30));

    // 1 回目 (breakout) は carry あり、2 回目 (reversal) は carry なし
    const breakoutCarry: EvolutionInstanceCarryRecord = {
      id: 'carry-breakout',
      evolutionRunId: '00000000-0000-0000-0000-000000000099',
      regime: 'breakout',
      generation: 5,
      payload: {
        tradesByDslId: {
          'parent-breakout': [
            { entryTime: '2024-05-01T00:00:00.000Z', side: 'long', pnl: 100, outcome: 'win' },
          ],
        },
        repairHints: {},
        repairBaselines: {},
      },
      recordedAt: new Date(),
    };

    const findLatestByRegime: jest.MockedFunction<
      EvolutionInstanceCarryPersister['findLatestByRegime']
    > = jest
      .fn()
      .mockImplementation(async (regime: string) => {
        if (regime === 'breakout') return breakoutCarry;
        return null; // reversal は carry 無し
      });
    const create: jest.MockedFunction<EvolutionInstanceCarryPersister['create']> = jest.fn();
    const deleteOlderThan: jest.MockedFunction<
      EvolutionInstanceCarryPersister['deleteOlderThan']
    > = jest.fn();

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      evolutionInstanceCarryRepo: { findLatestByRegime, create, deleteOlderThan },
    });

    // breakout 実行 → carry がロードされる
    await loop.runOneGeneration('breakout');
    // reversal 実行 → carry なし、breakout の cache が漏れないことを確認
    await loop.runOneGeneration('reversal');

    // create は 2 回呼ばれる、reversal の payload に breakout の trades が混入していないこと
    expect(create).toHaveBeenCalledTimes(2);
    const reversalSaveArg = create.mock.calls[1][0];
    expect(reversalSaveArg.regime).toBe('reversal');
    // 'parent-breakout' (breakout 由来) が reversal の payload に含まれていないこと
    expect(reversalSaveArg.payload.tradesByDslId).not.toHaveProperty('parent-breakout');
  });

  it('PR #140 review #2: load 失敗時 (DB 一時障害) は flag を立てず、次世代で再試行する', async () => {
    const dsl = buildBaseDsl('phase-b2-retry-on-load-fail');
    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: dsl.id,
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 1.5,
      validationPf: 1.4,
      overfitScore: 0.1,
      train: {
        summary: {
          totalTrades: 30, winningTrades: 18, losingTrades: 12, winRate: 0.6,
          netProfit: 100, netProfitRate: 0.1, maxDrawdown: 30, maxDrawdownRate: 0.03,
          profitFactor: 1.5, averageWin: 15, averageLoss: -10,
          riskRewardRatio: 1.5, maxConsecutiveWins: 3, maxConsecutiveLosses: 2,
        },
        trades: [],
      },
      validation: {
        summary: {
          totalTrades: 15, winningTrades: 9, losingTrades: 6, winRate: 0.6,
          netProfit: 50, netProfitRate: 0.05, maxDrawdown: 15, maxDrawdownRate: 0.015,
          profitFactor: 1.4, averageWin: 12, averageLoss: -8,
          riskRewardRatio: 1.5, maxConsecutiveWins: 2, maxConsecutiveLosses: 1,
        },
        trades: [],
      },
      execution: {
        executionModel: 'legacy_zero_cost',
        executionConfigHash: 'legacy-zero-cost',
        dataSource: 'ctrader',
        costSummary: {
          model: 'legacy_zero_cost', dataSource: 'ctrader',
          roundTripCostPips: 0, roundTripCostAtrMult: 0, totalCost: 0,
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
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.6, 30));

    // 1 回目: load 失敗、2 回目: load 成功
    const findLatestByRegime: jest.MockedFunction<
      EvolutionInstanceCarryPersister['findLatestByRegime']
    > = jest
      .fn()
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce(null);
    const create: jest.MockedFunction<EvolutionInstanceCarryPersister['create']> = jest.fn();
    const deleteOlderThan: jest.MockedFunction<
      EvolutionInstanceCarryPersister['deleteOlderThan']
    > = jest.fn();

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      evolutionInstanceCarryRepo: { findLatestByRegime, create, deleteOlderThan },
    });

    const report1 = await loop.runOneGeneration('breakout');
    const report2 = await loop.runOneGeneration('breakout');

    // 1 回目で load が失敗 (warning ログ) → flag が立たないため 2 回目で再試行
    expect(findLatestByRegime).toHaveBeenCalledTimes(2);
    const warnLog1 = report1.errors.find((e) => e.includes('[warn] B-2 carry load 失敗'));
    expect(warnLog1).toBeDefined();
    // 2 回目は成功 (= '既存 carry なし' info ログ)
    const infoLog2 = report2.errors.find((e) => e.includes('既存 carry なし'));
    expect(infoLog2).toBeDefined();
  });

  it('同インスタンスで同 regime に対する 2 回目以降は load を再実行しない (in-memory 引き継ぎ)', async () => {
    const dsl = buildBaseDsl('phase-b2-loaded-once');
    const adapter = new SurrogateFitnessSimulator();
    jest.spyOn(adapter, 'evaluateFitness').mockResolvedValue({
      dslId: dsl.id,
      period: { start: '2024-01-01', end: '2024-12-31' },
      trainPf: 1.5,
      validationPf: 1.4,
      overfitScore: 0.1,
      train: {
        summary: {
          totalTrades: 30, winningTrades: 18, losingTrades: 12, winRate: 0.6,
          netProfit: 100, netProfitRate: 0.1, maxDrawdown: 30, maxDrawdownRate: 0.03,
          profitFactor: 1.5, averageWin: 15, averageLoss: -10,
          riskRewardRatio: 1.5, maxConsecutiveWins: 3, maxConsecutiveLosses: 2,
        },
        trades: [],
      },
      validation: {
        summary: {
          totalTrades: 15, winningTrades: 9, losingTrades: 6, winRate: 0.6,
          netProfit: 50, netProfitRate: 0.05, maxDrawdown: 15, maxDrawdownRate: 0.015,
          profitFactor: 1.4, averageWin: 12, averageLoss: -8,
          riskRewardRatio: 1.5, maxConsecutiveWins: 2, maxConsecutiveLosses: 1,
        },
        trades: [],
      },
      execution: {
        executionModel: 'legacy_zero_cost',
        executionConfigHash: 'legacy-zero-cost',
        dataSource: 'ctrader',
        costSummary: {
          model: 'legacy_zero_cost', dataSource: 'ctrader',
          roundTripCostPips: 0, roundTripCostAtrMult: 0, totalCost: 0,
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
      .mockResolvedValue(makeFormalBtResponse(1.5, 0.6, 30));

    const findLatestByRegime: jest.MockedFunction<
      EvolutionInstanceCarryPersister['findLatestByRegime']
    > = jest.fn().mockResolvedValue(null);
    const create: jest.MockedFunction<EvolutionInstanceCarryPersister['create']> = jest.fn();
    const deleteOlderThan: jest.MockedFunction<
      EvolutionInstanceCarryPersister['deleteOlderThan']
    > = jest.fn();
    const carryRepo: EvolutionInstanceCarryPersister = {
      findLatestByRegime,
      create,
      deleteOlderThan,
    };

    const loop = new EvolutionLoop({
      population,
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
      evolutionBacktestRepo: null,
      edgeHypothesisLoader: null,
      runFormalBacktest,
      evolutionInstanceCarryRepo: carryRepo,
    });

    await loop.runOneGeneration('breakout');
    await loop.runOneGeneration('breakout');

    // 同 regime に対する load は 1 回のみ (= multi-gen 経路で in-memory 引き継ぎ)
    expect(findLatestByRegime).toHaveBeenCalledTimes(1);
    // save は 2 回呼ばれる
    expect(create).toHaveBeenCalledTimes(2);
  });
});
