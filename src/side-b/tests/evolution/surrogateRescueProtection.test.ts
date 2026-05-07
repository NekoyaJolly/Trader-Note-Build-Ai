/**
 * PR #105: Surrogate Rescue Lane 保護 pin テスト。
 *
 * `surrogateRescuePolicy.ts` / `formalBtCandidateSummary` は **全件正式BTを避ける**
 * ための軽量選抜層であり、評価エンジンではない。OOS-aware PromotionGate (PR #105) の
 * 責務分離作業中に、誤って削除・無効化・型変更されないよう以下を pin する:
 *
 *   1. selectFormalBtCandidatesWithRescue は引き続き呼び出し可能
 *   2. FormalBtCandidateSummary が必須キーを保持する
 *   3. SurrogateRoute の 6 値 (normal_pass / 4 rescue / kill) が消えない
 *   4. RescueSelectionOverrides で formalBtTopK / 各 lane TopK を差し替えられる
 *   5. 入力空でも例外なし、kill 分類など補助 API も健在
 *
 * これらが破れた場合、PR #105 は Rescue Lane を壊しているとみなす。
 */

import {
  classifyKill,
  formalBtCandidatePolicyV1,
  isNearMiss,
  isNormalPass,
  selectFormalBtCandidatesWithRescue,
  type FormalBtCandidateSummary,
  type RescueSelectionOverrides,
  type SurrogateRoute,
} from '../../evolution/surrogateRescuePolicy';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';
import type { SurrogateFitnessAggregate } from '../../strategy_dsl/SurrogateFitnessSimulator';

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

function makeSummary(opts: {
  totalTrades?: number;
  maxDrawdownRate?: number;
  profitFactor?: number;
}): SurrogateFitnessAggregate['validation']['summary'] {
  const total = opts.totalTrades ?? 20;
  return {
    totalTrades: total,
    winningTrades: Math.round(total * 0.6),
    losingTrades: Math.floor(total * 0.4),
    winRate: 0.6,
    netProfit: 200,
    netProfitRate: 0.1,
    maxDrawdown: (opts.maxDrawdownRate ?? 0.05) * 1000,
    maxDrawdownRate: opts.maxDrawdownRate ?? 0.05,
    profitFactor: opts.profitFactor ?? 1.5,
    averageWin: 15,
    averageLoss: -10,
    riskRewardRatio: 1.5,
    maxConsecutiveWins: 3,
    maxConsecutiveLosses: 2,
  };
}

function makeAgg(opts: {
  trainPf?: number;
  validationPf?: number;
  overfitScore?: number;
  totalTrades?: number;
  maxDrawdownRate?: number;
}): SurrogateFitnessAggregate {
  return {
    dslId: 'x',
    period: { start: '2024-01-01', end: '2024-12-31' },
    train: {
      summary: makeSummary({ profitFactor: opts.trainPf ?? 2.0, totalTrades: opts.totalTrades }),
      trades: [],
    },
    validation: {
      summary: makeSummary({
        profitFactor: opts.validationPf ?? 1.6,
        totalTrades: opts.totalTrades ?? 20,
        maxDrawdownRate: opts.maxDrawdownRate ?? 0.05,
      }),
      trades: [],
    },
    overfitScore: opts.overfitScore ?? 0.15,
    trainPf: opts.trainPf ?? 2.0,
    validationPf: opts.validationPf ?? 1.6,
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
}

function input(id: string, agg = makeAgg({}), surrogateScore = 0.8) {
  return { dsl: makeDsl(id), aggregate: agg, surrogateScore };
}

describe('PR #105: Surrogate Rescue Lane 保護 pin', () => {
  it('1. selectFormalBtCandidatesWithRescue は呼び出し可能で、normal_pass を分類する', () => {
    const r = selectFormalBtCandidatesWithRescue([input('np1'), input('np2')]);
    expect(Array.isArray(r.entries)).toBe(true);
    expect(r.summary).toBeDefined();
    expect(r.entries.some((e) => e.route === 'normal_pass')).toBe(true);
  });

  it('2. FormalBtCandidateSummary が必須キーを保持する (= 型契約 pin)', () => {
    const r = selectFormalBtCandidatesWithRescue([input('np1')]);
    const s: FormalBtCandidateSummary = r.summary;
    expect(s).toEqual(
      expect.objectContaining({
        normalPass: expect.any(Number),
        nearMissRescue: expect.any(Number),
        noveltyRescue: expect.any(Number),
        lowDrawdownRescue: expect.any(Number),
        tradeCountRescue: expect.any(Number),
        killed: expect.any(Number),
        uniqueCandidates: expect.any(Number),
        duplicateRemoved: expect.any(Number),
        fallbackApplied: expect.any(Boolean),
      }),
    );
    // fallbackReason は string | null
    expect(['string', 'object']).toContain(typeof s.fallbackReason);
  });

  it('3. SurrogateRoute の 6 値が消えない (= analysis-engine 寄せでも route 軸は維持)', () => {
    const routes: SurrogateRoute[] = [
      'normal_pass',
      'near_miss_rescue',
      'novelty_rescue',
      'low_drawdown_rescue',
      'trade_count_rescue',
      'kill',
    ];
    expect(routes).toHaveLength(6);
    expect(new Set(routes).size).toBe(6);
  });

  it('4. RescueSelectionOverrides で overallTopK を差し替えられる', () => {
    const candidates = [input('np1'), input('np2'), input('np3'), input('np4')];
    const overrides: RescueSelectionOverrides = { overallTopK: 1 };
    const r = selectFormalBtCandidatesWithRescue(candidates, overrides);
    expect(r.summary.normalPass).toBeLessThanOrEqual(1);
    expect(formalBtCandidatePolicyV1.overallTopK).toBe(3);
  });

  it('5. classifyKill / isNormalPass / isNearMiss は引き続き export されている', () => {
    expect(typeof classifyKill).toBe('function');
    expect(typeof isNormalPass).toBe('function');
    expect(typeof isNearMiss).toBe('function');
    const k = classifyKill(makeAgg({ totalTrades: 0 }));
    expect(k.isKill).toBe(true);
  });

  it('6. 入力が空でも例外を投げず summary を返す', () => {
    const r = selectFormalBtCandidatesWithRescue([]);
    expect(r.entries).toEqual([]);
    expect(r.summary.uniqueCandidates).toBe(0);
  });
});
