/**
 * Critical-4 PR #96: Surrogate Rescue Lane のテスト
 *
 * 設計書 (docs/design/pr_96_surrogate_rescue_lane_agent_prompt.md) 必須テスト 10 件:
 *   1. normal pass が存在する場合、優先的に正式BT候補へ入る
 *   2. normal pass が 0 件でも near_miss_rescue が選ばれる
 *   3. low_drawdown_rescue が drawdown 最小候補を拾う
 *   4. trade_count_rescue が trade count 十分な候補を拾う
 *   5. novelty_rescue が総合上位以外から候補を拾う
 *   6. kill 条件に該当する候補は rescue されない
 *   7. 同一候補が複数 route に入った場合、重複排除される
 *   8. duplicateRemoved が summary に反映される
 *   9. normalPass=0 かつ rescue 使用時に fallbackApplied=true になる
 *   10. rescue 候補が 0 件の場合も例外を投げず summary に理由を残す
 */

import {
  classifyKill,
  isNearMiss,
  isNormalPass,
  selectFormalBtCandidatesWithRescue,
} from '../../evolution/surrogateRescuePolicy';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';
import type { SurrogateFitnessAggregate } from '../../strategy_dsl/SurrogateFitnessSimulator';

// =================================================================
// Fixture helpers
// =================================================================

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
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
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
  return {
    totalTrades: opts.totalTrades ?? 20,
    winningTrades: Math.round((opts.totalTrades ?? 20) * 0.6),
    losingTrades: Math.floor((opts.totalTrades ?? 20) * 0.4),
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

// =================================================================
// 単体ガード
// =================================================================

describe('classifyKill', () => {
  it('totalTrades=0 は kill', () => {
    const r = classifyKill(makeAgg({ totalTrades: 0 }));
    expect(r.isKill).toBe(true);
    expect(r.reason).toMatch(/totalTrades=0/);
  });

  it('trainPf が NaN は kill', () => {
    const r = classifyKill(makeAgg({ trainPf: NaN }));
    expect(r.isKill).toBe(true);
  });

  it('overfitScore が Infinity は kill', () => {
    const r = classifyKill(makeAgg({ overfitScore: Infinity }));
    expect(r.isKill).toBe(true);
  });

  it('maxDrawdownRate=0.85 は破綻 DD として kill', () => {
    const r = classifyKill(makeAgg({ maxDrawdownRate: 0.85 }));
    expect(r.isKill).toBe(true);
    expect(r.reason).toMatch(/maxDrawdownRate=0\.85/);
  });

  it('正常な metrics は kill されない', () => {
    expect(classifyKill(makeAgg({})).isKill).toBe(false);
  });
});

describe('isNormalPass / isNearMiss', () => {
  it('全条件通過は normal_pass', () => {
    const agg = makeAgg({ trainPf: 2.0, validationPf: 1.5, overfitScore: 0.15 });
    expect(isNormalPass(agg)).toBe(true);
    expect(isNearMiss(agg).yes).toBe(false);
  });

  it('1 条件のみ未達は near_miss', () => {
    const agg = makeAgg({ trainPf: 2.0, validationPf: 1.2, overfitScore: 0.15 }); // val PF 未達
    expect(isNormalPass(agg)).toBe(false);
    expect(isNearMiss(agg).yes).toBe(true);
    expect(isNearMiss(agg).failedCondition).toMatch(/validationPf/);
  });

  it('2 条件以上未達は near_miss ではない', () => {
    const agg = makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5 });
    expect(isNearMiss(agg).yes).toBe(false);
  });
});

// =================================================================
// 選抜本体: 必須 10 ケース
// =================================================================

describe('selectFormalBtCandidatesWithRescue (PR #96 必須テスト)', () => {
  it('1. normal pass が存在する場合、優先的に正式 BT 候補へ入る', () => {
    const inputs = [
      { dsl: makeDsl('np-1'), aggregate: makeAgg({ trainPf: 2.0, validationPf: 1.5 }), surrogateScore: 0.9 },
      { dsl: makeDsl('np-2'), aggregate: makeAgg({ trainPf: 1.8, validationPf: 1.4 }), surrogateScore: 0.7 },
    ];
    const { entries, summary } = selectFormalBtCandidatesWithRescue(inputs);
    expect(summary.normalPass).toBe(2);
    expect(summary.fallbackApplied).toBe(false);
    expect(entries[0].route).toBe('normal_pass');
  });

  it('2. normal pass が 0 件でも near_miss_rescue が選ばれる', () => {
    // 1 条件のみ未達の候補のみ
    const inputs = [
      { dsl: makeDsl('nm-1'), aggregate: makeAgg({ trainPf: 2.0, validationPf: 1.2, overfitScore: 0.15 }), surrogateScore: 0.6 },
    ];
    const { summary } = selectFormalBtCandidatesWithRescue(inputs);
    expect(summary.normalPass).toBe(0);
    expect(summary.nearMissRescue).toBe(1);
    expect(summary.fallbackApplied).toBe(true);
  });

  it('3. low_drawdown_rescue が drawdown 最小候補を拾う', () => {
    const inputs = [
      { dsl: makeDsl('low-dd'), aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, maxDrawdownRate: 0.02 }), surrogateScore: 0.1 },
      { dsl: makeDsl('high-dd'), aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, maxDrawdownRate: 0.5 }), surrogateScore: 0.5 },
    ];
    const { entries, summary } = selectFormalBtCandidatesWithRescue(inputs);
    const lowDd = entries.find((e) => e.route === 'low_drawdown_rescue');
    expect(lowDd).toBeDefined();
    expect(lowDd!.dsl.id).toBe('low-dd');
    expect(summary.lowDrawdownRescue).toBeGreaterThanOrEqual(1);
  });

  it('4. trade_count_rescue が trade count 最大の候補を拾う', () => {
    const inputs = [
      { dsl: makeDsl('few-trades'), aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, totalTrades: 5 }), surrogateScore: 0.4 },
      { dsl: makeDsl('many-trades'), aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, totalTrades: 100 }), surrogateScore: 0.3 },
    ];
    const { entries } = selectFormalBtCandidatesWithRescue(inputs);
    const tcr = entries.find((e) => e.route === 'trade_count_rescue');
    expect(tcr).toBeDefined();
    expect(tcr!.dsl.id).toBe('many-trades');
  });

  it('5. novelty_rescue が総合上位以外から候補を拾う', () => {
    // 5 件全て normal_pass、surrogate score 0.9 / 0.8 / 0.7 / 0.6 / 0.5
    const inputs = Array.from({ length: 5 }, (_, i) => ({
      dsl: makeDsl(`np-${i}`),
      aggregate: makeAgg({}),
      surrogateScore: 0.9 - i * 0.1,
    }));
    const { entries, summary } = selectFormalBtCandidatesWithRescue(inputs);
    // normal_pass: top 3 (np-0, np-1, np-2)
    // novelty: 残りから 1 件 (np-3 か np-4)
    expect(summary.normalPass).toBe(3);
    expect(summary.noveltyRescue).toBeGreaterThanOrEqual(1);
    const novelEntry = entries.find((e) => e.route === 'novelty_rescue');
    expect(novelEntry).toBeDefined();
    // novelty は top 3 に入っていない id
    expect(['np-3', 'np-4']).toContain(novelEntry!.dsl.id);
  });

  it('6. kill 条件に該当する候補は rescue されない', () => {
    const inputs = [
      { dsl: makeDsl('zero-trades'), aggregate: makeAgg({ totalTrades: 0 }), surrogateScore: 0.5 },
      { dsl: makeDsl('nan-pf'), aggregate: makeAgg({ trainPf: NaN }), surrogateScore: 0.4 },
      { dsl: makeDsl('broken-dd'), aggregate: makeAgg({ maxDrawdownRate: 0.95 }), surrogateScore: 0.3 },
      { dsl: makeDsl('survivor'), aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5 }), surrogateScore: 0.2 },
    ];
    const { entries, summary } = selectFormalBtCandidatesWithRescue(inputs);
    expect(summary.killed).toBe(3);
    // survivor のみ rescue 対象
    expect(entries.every((e) => e.dsl.id === 'survivor')).toBe(true);
  });

  it('7. 同一候補が複数 route に入った場合、重複排除される (= 1 件のみ)', () => {
    // 1 件で normal_pass + low_drawdown + trade_count_rescue 全てに該当
    const inputs = [
      {
        dsl: makeDsl('multi-route'),
        aggregate: makeAgg({
          trainPf: 2.0,
          validationPf: 1.5,
          overfitScore: 0.15,
          maxDrawdownRate: 0.01,
          totalTrades: 100,
        }),
        surrogateScore: 0.9,
      },
    ];
    const { entries, summary } = selectFormalBtCandidatesWithRescue(inputs);
    expect(summary.uniqueCandidates).toBe(1);
    expect(entries[0].route).toBe('normal_pass'); // 最高優先度の route が採用される
  });

  it('8. duplicateRemoved が summary に反映される', () => {
    const inputs = [
      {
        dsl: makeDsl('multi-route'),
        aggregate: makeAgg({ trainPf: 2.0, validationPf: 1.5, maxDrawdownRate: 0.01, totalTrades: 100 }),
        surrogateScore: 0.9,
      },
    ];
    const { summary } = selectFormalBtCandidatesWithRescue(inputs);
    // normal_pass で先に採用 → low_drawdown / trade_count / novelty で重複扱いになるため > 0
    expect(summary.duplicateRemoved).toBeGreaterThan(0);
  });

  it('9. normalPass=0 かつ rescue 使用時に fallbackApplied=true になる', () => {
    const inputs = [
      { dsl: makeDsl('nm'), aggregate: makeAgg({ trainPf: 2.0, validationPf: 1.2, overfitScore: 0.15 }), surrogateScore: 0.5 },
    ];
    const { summary } = selectFormalBtCandidatesWithRescue(inputs);
    expect(summary.normalPass).toBe(0);
    expect(summary.fallbackApplied).toBe(true);
    expect(summary.fallbackReason).toMatch(/normal_pass=0/);
  });

  it('10. rescue 候補が 0 件 (= 全候補 kill) でも例外を投げず summary に理由を残す', () => {
    const inputs = [
      { dsl: makeDsl('k1'), aggregate: makeAgg({ totalTrades: 0 }), surrogateScore: 0 },
      { dsl: makeDsl('k2'), aggregate: makeAgg({ trainPf: NaN }), surrogateScore: 0 },
    ];
    const { entries, summary } = selectFormalBtCandidatesWithRescue(inputs);
    expect(entries).toHaveLength(0);
    expect(summary.uniqueCandidates).toBe(0);
    expect(summary.killed).toBe(2);
    expect(summary.fallbackReason).toMatch(/all candidates killed/);
  });

  it('入力が空配列でも例外なし', () => {
    const { entries, summary } = selectFormalBtCandidatesWithRescue([]);
    expect(entries).toHaveLength(0);
    expect(summary.uniqueCandidates).toBe(0);
    expect(summary.killed).toBe(0);
    expect(summary.fallbackReason).toMatch(/no candidates/);
  });
});
