/**
 * Critical-4 PR #97: BehaviorDescriptorLite / 類似度 / noveltyScore のテスト
 *
 * 設計書 (docs/design/pr_97_behavior_descriptor_lite_agent_prompt.md) 必須テスト 12 件:
 *   1. regimeTarget / timeframe を DSL から抽出できる
 *   2. entryKind を移動平均系として分類できる
 *   3. entryKind を oscillator 系として分類できる
 *   4. entryKind を volatility 系として分類できる
 *   5. indicatorKinds が重複除去され、安定順序で返る
 *   6. riskKind が SL/TP 構造から分類される
 *   7. tradeFrequencyClass が trade count から分類される
 *   8. unknown 値でも例外を投げない
 *   9. descriptor 完全一致なら totalSimilarity が高い
 *   10. descriptor が大きく異なるなら totalSimilarity が低い
 *   11. selected が空なら noveltyScore=1 になる
 *   12. selected がある場合 nearestCandidateId が入る
 */

import {
  compareBehaviorDescriptorsLite,
  extractBehaviorDescriptorLite,
  scoreNoveltyAgainstSelected,
} from '../../evolution/behaviorDescriptorLite';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';

// =================================================================
// fixture
// =================================================================

interface DslOverrides {
  id?: string;
  regimeTarget?: string;
  timeframe?: string;
  entryConditions?: Array<{ lens: string; feature: string; op?: '>' | '<' | '>=' | '<=' | '==' | '!='; value?: number }>;
  stopLoss?: { type: 'atr_multiple' | 'fixed_pips' | 'swing_point'; value?: number; lookbackBars?: number };
  takeProfit?: { type: 'rr_ratio' | 'fixed_pips' | 'atr_multiple'; value?: number };
}

function makeDsl(overrides: DslOverrides = {}): StrategyDSL {
  return StrategyDSLSchema.parse({
    id: overrides.id ?? `dsl-${Math.random().toString(36).slice(2)}`,
    generation: 0,
    parentIds: [],
    regimeTarget: overrides.regimeTarget ?? 'breakout',
    symbol: 'EURUSD',
    timeframe: overrides.timeframe ?? '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: overrides.entryConditions
          ? overrides.entryConditions.map((c) => ({
              lens: c.lens,
              feature: c.feature,
              op: c.op ?? '>',
              value: c.value ?? 0,
            }))
          : [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
      },
      orderType: 'market',
    },
    stopLoss: overrides.stopLoss ?? { type: 'fixed_pips', value: 30 },
    takeProfit: overrides.takeProfit ?? { type: 'rr_ratio', value: 1.5 },
    parameters: {},
    metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
  });
}

// =================================================================
// extractBehaviorDescriptorLite
// =================================================================

describe('extractBehaviorDescriptorLite (PR #97 必須 1〜8)', () => {
  it('1. regimeTarget / timeframe を DSL から抽出できる', () => {
    const d = extractBehaviorDescriptorLite(makeDsl({ regimeTarget: 'trending', timeframe: '4h' }));
    expect(d.regimeTarget).toBe('trending');
    expect(d.timeframe).toBe('4h');
  });

  it('2. entryKind を移動平均系として分類できる', () => {
    const d = extractBehaviorDescriptorLite(
      makeDsl({ entryConditions: [{ lens: 'ema', feature: 'ema_20' }] }),
    );
    expect(d.entryKind).toBe('ma');
    expect(d.indicatorKinds).toContain('ema');
  });

  it('3. entryKind を oscillator 系として分類できる', () => {
    const d = extractBehaviorDescriptorLite(
      makeDsl({ entryConditions: [{ lens: 'rsi', feature: 'rsi_14' }] }),
    );
    expect(d.entryKind).toBe('oscillator');
    expect(d.indicatorKinds).toContain('rsi');
  });

  it('4. entryKind を volatility 系として分類できる', () => {
    const d = extractBehaviorDescriptorLite(
      makeDsl({ entryConditions: [{ lens: 'atr', feature: 'atr_14' }] }),
    );
    expect(d.entryKind).toBe('volatility');
    expect(d.indicatorKinds).toContain('atr');
  });

  it('5. indicatorKinds が重複除去され、安定順序 (昇順) で返る', () => {
    const d = extractBehaviorDescriptorLite(
      makeDsl({
        entryConditions: [
          { lens: 'rsi', feature: 'rsi_14' },
          { lens: 'rsi', feature: 'rsi_14_v2' }, // 同 family
          { lens: 'ema', feature: 'ema_20' },
          { lens: 'atr', feature: 'atr_14' },
        ],
      }),
    );
    expect(d.indicatorKinds).toEqual(['atr', 'ema', 'rsi']);
  });

  it('6. riskKind が SL/TP 構造から分類される', () => {
    const slTp = extractBehaviorDescriptorLite(
      makeDsl({
        stopLoss: { type: 'fixed_pips', value: 30 },
        takeProfit: { type: 'rr_ratio', value: 1.5 },
      }),
    );
    expect(slTp.riskKind).toBe('sl_tp');

    const trailing = extractBehaviorDescriptorLite(
      makeDsl({
        stopLoss: { type: 'atr_multiple', value: 1.5 },
        takeProfit: { type: 'rr_ratio', value: 2 },
      }),
    );
    expect(trailing.riskKind).toBe('trailing');
  });

  it('7. tradeFrequencyClass が trade count から分類される', () => {
    const dsl = makeDsl();
    expect(extractBehaviorDescriptorLite(dsl).tradeFrequencyClass).toBe('unknown');
    expect(extractBehaviorDescriptorLite(dsl, { validationTradeCount: 5 }).tradeFrequencyClass).toBe('low');
    expect(extractBehaviorDescriptorLite(dsl, { validationTradeCount: 50 }).tradeFrequencyClass).toBe('medium');
    expect(extractBehaviorDescriptorLite(dsl, { validationTradeCount: 200 }).tradeFrequencyClass).toBe('high');
    expect(extractBehaviorDescriptorLite(dsl, { validationTradeCount: 0 }).tradeFrequencyClass).toBe('unknown');
  });

  it('8. unknown 値でも例外を投げない', () => {
    // 未知の lens / feature
    const d = extractBehaviorDescriptorLite(
      makeDsl({ entryConditions: [{ lens: 'unknown_lens', feature: 'unknown_feat' }] }),
    );
    expect(d.entryKind).toBe('unknown');
    expect(d.indicatorKinds).toContain('unknown');
  });
});

// =================================================================
// compareBehaviorDescriptorsLite
// =================================================================

describe('extractBehaviorDescriptorLite — Copilot fix: timeframe 正規化', () => {
  it("大文字小文字の違い ('1H' vs '1h') が normalizeTimeframe で吸収される", () => {
    const a = extractBehaviorDescriptorLite(makeDsl({ timeframe: '1H' }));
    const b = extractBehaviorDescriptorLite(makeDsl({ timeframe: '1h' }));
    expect(a.timeframe).toBe(b.timeframe);
  });

  it("'multi' 等の不正値は normalizeTimeframe の DEFAULT_TIMEFRAME (= '15m') にフォールバックする", () => {
    // hashStrategyDsl / BT 経路と同じ正規化なので、'multi' は '15m' 固定扱いされる。
    // 別の戦略が timeframe='multi' / timeframe='15m' で書かれていても、
    // descriptor 上は同一として扱われる (= novelty 計算で別物扱いにならない)。
    const multi = extractBehaviorDescriptorLite(makeDsl({ timeframe: 'multi' }));
    const fifteenMin = extractBehaviorDescriptorLite(makeDsl({ timeframe: '15m' }));
    expect(multi.timeframe).toBe(fifteenMin.timeframe);
  });
});

describe('compareBehaviorDescriptorsLite (PR #97 必須 9〜10)', () => {
  it('9. descriptor 完全一致なら totalSimilarity=1', () => {
    const a = extractBehaviorDescriptorLite(
      makeDsl({
        regimeTarget: 'breakout',
        timeframe: '1h',
        entryConditions: [{ lens: 'ema', feature: 'ema_20' }],
      }),
    );
    const sim = compareBehaviorDescriptorsLite(a, a);
    expect(sim.totalSimilarity).toBe(1);
    expect(sim.regimeSimilarity).toBe(1);
    expect(sim.indicatorSimilarity).toBe(1);
  });

  it('Copilot fix: stopLossKind / takeProfitKind の違いも similarity に反映される', () => {
    // 同 riskKind=sl_tp だが具体型が違う → 全体の totalSimilarity が完全一致より低い
    const a = extractBehaviorDescriptorLite(
      makeDsl({
        stopLoss: { type: 'fixed_pips', value: 30 },
        takeProfit: { type: 'rr_ratio', value: 1.5 },
      }),
    );
    const b = extractBehaviorDescriptorLite(
      makeDsl({
        stopLoss: { type: 'fixed_pips', value: 30 },
        takeProfit: { type: 'fixed_pips', value: 30 }, // TP の type のみ違う
      }),
    );
    const sim = compareBehaviorDescriptorsLite(a, b);
    expect(sim.takeProfitSimilarity).toBe(0); // 違う
    expect(sim.totalSimilarity).toBeLessThan(1); // 完全一致ではない
  });

  it('Copilot fix: tradeFrequencyClass の違いも similarity に反映される', () => {
    const dsl = makeDsl();
    const lowFreq = extractBehaviorDescriptorLite(dsl, { validationTradeCount: 5 }); // low
    const highFreq = extractBehaviorDescriptorLite(dsl, { validationTradeCount: 200 }); // high
    const sim = compareBehaviorDescriptorsLite(lowFreq, highFreq);
    expect(sim.tradeFrequencySimilarity).toBe(0);
    expect(sim.totalSimilarity).toBeLessThan(1);
  });

  it('10. descriptor が大きく異なるなら totalSimilarity が低い', () => {
    const a = extractBehaviorDescriptorLite(
      makeDsl({
        regimeTarget: 'breakout',
        timeframe: '1h',
        entryConditions: [{ lens: 'ema', feature: 'ema_20' }],
        stopLoss: { type: 'fixed_pips', value: 30 },
        takeProfit: { type: 'rr_ratio', value: 1.5 },
      }),
    );
    const b = extractBehaviorDescriptorLite(
      makeDsl({
        regimeTarget: 'reversal',
        timeframe: '4h',
        entryConditions: [{ lens: 'rsi', feature: 'rsi_14' }],
        stopLoss: { type: 'atr_multiple', value: 2 },
        takeProfit: { type: 'atr_multiple', value: 3 },
      }),
    );
    const sim = compareBehaviorDescriptorsLite(a, b);
    expect(sim.totalSimilarity).toBeLessThan(0.3);
  });
});

// =================================================================
// scoreNoveltyAgainstSelected
// =================================================================

describe('scoreNoveltyAgainstSelected (PR #97 必須 11〜12)', () => {
  it('11. selected が空なら noveltyScore=1 / nearestCandidateId=null', () => {
    const cand = makeDsl({ id: 'cand-1' });
    const result = scoreNoveltyAgainstSelected(cand, []);
    expect(result.noveltyScore).toBe(1);
    expect(result.nearestCandidateId).toBeNull();
    expect(result.reason).toMatch(/no selected candidates/);
  });

  it('12. selected がある場合 nearestCandidateId が入る + reason に noveltyScore / nearestSimilarity / diff が含まれる', () => {
    const cand = makeDsl({
      id: 'cand-rsi',
      entryConditions: [{ lens: 'rsi', feature: 'rsi_14' }],
    });
    const sel1 = makeDsl({
      id: 'sel-ema',
      entryConditions: [{ lens: 'ema', feature: 'ema_20' }],
    });
    const sel2 = makeDsl({
      id: 'sel-atr',
      entryConditions: [{ lens: 'atr', feature: 'atr_14' }],
    });
    const result = scoreNoveltyAgainstSelected(cand, [sel1, sel2]);
    expect(result.nearestCandidateId).not.toBeNull();
    expect(['sel-ema', 'sel-atr']).toContain(result.nearestCandidateId);
    expect(result.noveltyScore).toBeGreaterThan(0);
    expect(result.reason).toMatch(/noveltyScore=/);
    expect(result.reason).toMatch(/nearestSimilarity=/);
    expect(result.reason).toMatch(/diff=/);
  });

  it('selected と完全一致なら nearestSimilarity=1, noveltyScore=0', () => {
    const cand = makeDsl({ id: 'cand', regimeTarget: 'breakout', timeframe: '1h' });
    const result = scoreNoveltyAgainstSelected(cand, [cand]);
    expect(result.nearestSimilarity).toBe(1);
    expect(result.noveltyScore).toBe(0);
  });

  it('複数 selected の中で最も似ているもの (= nearestSimilarity 最大) が選ばれる', () => {
    // cand: ema 系
    const cand = makeDsl({ id: 'cand', entryConditions: [{ lens: 'ema', feature: 'ema_20' }] });
    // sel-similar: 同じ ema 系 (高 similarity)
    const sel1 = makeDsl({ id: 'sel-similar', entryConditions: [{ lens: 'ema', feature: 'ema_50' }] });
    // sel-diff: rsi (低 similarity)
    const sel2 = makeDsl({ id: 'sel-diff', entryConditions: [{ lens: 'rsi', feature: 'rsi_14' }] });
    const result = scoreNoveltyAgainstSelected(cand, [sel2, sel1]);
    expect(result.nearestCandidateId).toBe('sel-similar');
  });
});
