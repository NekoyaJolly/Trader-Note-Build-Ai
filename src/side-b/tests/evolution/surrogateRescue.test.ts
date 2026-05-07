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

  it('overrides.overallTopK で normal_pass の上限を差し替えられる (= formalBtTopK 反映)', () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({
      dsl: makeDsl(`np-${i}`),
      aggregate: makeAgg({}),
      surrogateScore: 0.9 - i * 0.1,
    }));
    const { summary: s3 } = selectFormalBtCandidatesWithRescue(inputs, { overallTopK: 3 });
    expect(s3.normalPass).toBe(3);
    const { summary: s2 } = selectFormalBtCandidatesWithRescue(inputs, { overallTopK: 2 });
    expect(s2.normalPass).toBe(2);
    const { summary: s5 } = selectFormalBtCandidatesWithRescue(inputs, { overallTopK: 5 });
    expect(s5.normalPass).toBe(5);
  });

  it('trade_count_rescue は minTradesForTradeCountRescue 未満を救済しない', () => {
    // 全候補が minTrade 未満 → trade_count_rescue は 0 件
    const inputs = [
      {
        dsl: makeDsl('low-trades-1'),
        aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, totalTrades: 10 }),
        surrogateScore: 0.4,
      },
      {
        dsl: makeDsl('low-trades-2'),
        aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, totalTrades: 5 }),
        surrogateScore: 0.3,
      },
    ];
    const { summary, entries } = selectFormalBtCandidatesWithRescue(inputs, {
      minTradesForTradeCountRescue: 20,
    });
    expect(summary.tradeCountRescue).toBe(0);
    expect(entries.find((e) => e.route === 'trade_count_rescue')).toBeUndefined();
  });

  // ===========================================
  // PR #97 novelty rescue 追加要件
  // ===========================================

  it('PR #97-1. novelty_rescue が未選択候補のうち最も構造的に違う候補を選ぶ', () => {
    // sel: ema 系 (= normal_pass で選ばれる)
    const selDsl = StrategyDSLSchema.parse({
      id: 'sel-ema',
      generation: 0,
      parentIds: [],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ema', feature: 'ema_20', op: '>', value: 0 }] },
        orderType: 'market',
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
    // 候補 1: ema 系 (selected と類似 → novelty 低)
    const candSimilar = StrategyDSLSchema.parse({ ...selDsl, id: 'cand-similar' });
    // 候補 2: RSI 系 (selected と異なる → novelty 高)
    const candNovel = StrategyDSLSchema.parse({
      ...selDsl,
      id: 'cand-novel',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'rsi', feature: 'rsi_14', op: '>', value: 50 }] },
        orderType: 'market',
      },
    });

    const inputs = [
      // selected 入りする normal_pass 候補
      { dsl: selDsl, aggregate: makeAgg({}), surrogateScore: 0.9 },
      // novelty_rescue で拾われるべき候補
      { dsl: candSimilar, aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5 }), surrogateScore: 0.5 },
      { dsl: candNovel, aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5 }), surrogateScore: 0.4 },
    ];
    const { entries } = selectFormalBtCandidatesWithRescue(inputs);
    const novel = entries.find((e) => e.route === 'novelty_rescue');
    expect(novel).toBeDefined();
    expect(novel!.dsl.id).toBe('cand-novel'); // 構造が違う方が選ばれる (surrogateScore は低くても)
  });

  it('PR #97-2. noveltyScore 同点なら surrogateScore 高い候補が選ばれる', () => {
    // selected と全く同じ構造の cand 2 件 → どちらも novelty=0、surrogateScore で tie-break
    const selDsl = StrategyDSLSchema.parse({
      id: 'sel-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ema', feature: 'ema_20', op: '>', value: 0 }] },
        orderType: 'market',
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
    const cand1 = StrategyDSLSchema.parse({ ...selDsl, id: 'cand-low' });
    const cand2 = StrategyDSLSchema.parse({ ...selDsl, id: 'cand-high' });
    const inputs = [
      { dsl: selDsl, aggregate: makeAgg({}), surrogateScore: 0.9 },
      { dsl: cand1, aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5 }), surrogateScore: 0.3 },
      { dsl: cand2, aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5 }), surrogateScore: 0.6 },
    ];
    const { entries } = selectFormalBtCandidatesWithRescue(inputs);
    const novel = entries.find((e) => e.route === 'novelty_rescue');
    expect(novel?.dsl.id).toBe('cand-high');
  });

  it('PR #97-3. normal_pass / low_drawdown / trade_count で既に選ばれた候補は novelty_rescue で重複選択されない', () => {
    // 1 candidate が複数 lane で eligible になっても、優先順位最上位 (normal_pass) が採用され、
    // novelty_rescue は別の candidate を拾う
    const selDsl = StrategyDSLSchema.parse({
      id: 'sel-multi',
      generation: 0,
      parentIds: [],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ema', feature: 'ema_20', op: '>', value: 0 }] },
        orderType: 'market',
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
    const cand = StrategyDSLSchema.parse({ ...selDsl, id: 'cand-other', entry: { ...selDsl.entry, trigger: { logic: 'AND', conditions: [{ lens: 'rsi', feature: 'rsi_14', op: '>', value: 50 }] } } });
    const inputs = [
      { dsl: selDsl, aggregate: makeAgg({ totalTrades: 100, maxDrawdownRate: 0.01 }), surrogateScore: 0.9 },
      { dsl: cand, aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5 }), surrogateScore: 0.4 },
    ];
    const { entries } = selectFormalBtCandidatesWithRescue(inputs);
    // selDsl は normal_pass + low_drawdown + trade_count 全てに eligible だが、
    // 優先順位で normal_pass のみ採用される
    const dslIds = entries.map((e) => e.dsl.id);
    const selDslCount = dslIds.filter((id) => id === 'sel-multi').length;
    expect(selDslCount).toBe(1);
    // novelty_rescue では別の candidate (cand-other) が拾われる
    const novel = entries.find((e) => e.route === 'novelty_rescue');
    expect(novel?.dsl.id).toBe('cand-other');
  });

  it('PR #97-4. novelty reason に noveltyScore / nearestSimilarity が含まれる', () => {
    const selDsl = StrategyDSLSchema.parse({
      id: 'sel',
      generation: 0,
      parentIds: [],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ema', feature: 'ema_20', op: '>', value: 0 }] },
        orderType: 'market',
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
    const cand = StrategyDSLSchema.parse({ ...selDsl, id: 'cand', entry: { ...selDsl.entry, trigger: { logic: 'AND', conditions: [{ lens: 'rsi', feature: 'rsi_14', op: '>', value: 50 }] } } });
    const inputs = [
      { dsl: selDsl, aggregate: makeAgg({}), surrogateScore: 0.9 },
      { dsl: cand, aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5 }), surrogateScore: 0.4 },
    ];
    const { entries } = selectFormalBtCandidatesWithRescue(inputs);
    const novel = entries.find((e) => e.route === 'novelty_rescue');
    expect(novel?.reason).toMatch(/noveltyScore=/);
    expect(novel?.reason).toMatch(/nearestSimilarity=/);
    expect(novel?.reason).toMatch(/nearestCandidateId=/);
  });

  it('PR #97-5. 全候補が類似していても例外を投げず、最も似た候補を nearestCandidateId に残す', () => {
    // 全候補が同一構造 → noveltyScore=0 で全て同点だが、surrogateScore で tie-break
    const baseDsl = StrategyDSLSchema.parse({
      id: 'base',
      generation: 0,
      parentIds: [],
      regimeTarget: 'breakout',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ema', feature: 'ema_20', op: '>', value: 0 }] },
        orderType: 'market',
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
    const c1 = StrategyDSLSchema.parse({ ...baseDsl, id: 'c1' });
    const c2 = StrategyDSLSchema.parse({ ...baseDsl, id: 'c2' });
    const c3 = StrategyDSLSchema.parse({ ...baseDsl, id: 'c3' });
    const inputs = [
      { dsl: c1, aggregate: makeAgg({ trainPf: 2.0, validationPf: 1.5 }), surrogateScore: 0.9 },
      { dsl: c2, aggregate: makeAgg({ trainPf: 2.0, validationPf: 1.5 }), surrogateScore: 0.8 },
      { dsl: c3, aggregate: makeAgg({ trainPf: 2.0, validationPf: 1.5 }), surrogateScore: 0.7 },
    ];
    expect(() => selectFormalBtCandidatesWithRescue(inputs)).not.toThrow();
    const { entries } = selectFormalBtCandidatesWithRescue(inputs);
    const novel = entries.find((e) => e.route === 'novelty_rescue');
    if (novel) {
      // nearestCandidateId は selected (= c1, c2 のいずれか) を指す
      expect(['c1', 'c2']).toContain(novel.reason.match(/nearestCandidateId=([^,]+)/)?.[1] ?? '');
    }
  });

  it('trade_count_rescue は閾値以上の候補のみから最大値を選ぶ', () => {
    const inputs = [
      // trades=15: 閾値 20 未満なので除外
      {
        dsl: makeDsl('below-threshold'),
        aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, totalTrades: 15 }),
        surrogateScore: 0.5,
      },
      // trades=25: 閾値以上の中で最大なら採用
      {
        dsl: makeDsl('eligible'),
        aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, totalTrades: 25 }),
        surrogateScore: 0.4,
      },
      // trades=22: 閾値以上だが eligible より少ない
      {
        dsl: makeDsl('eligible-smaller'),
        aggregate: makeAgg({ trainPf: 1.0, validationPf: 1.0, overfitScore: 0.5, totalTrades: 22 }),
        surrogateScore: 0.35,
      },
    ];
    const { entries } = selectFormalBtCandidatesWithRescue(inputs, {
      minTradesForTradeCountRescue: 20,
    });
    const tcr = entries.find((e) => e.route === 'trade_count_rescue');
    expect(tcr).toBeDefined();
    expect(tcr!.dsl.id).toBe('eligible'); // below-threshold は除外、eligible-smaller は trades 少
  });
});
