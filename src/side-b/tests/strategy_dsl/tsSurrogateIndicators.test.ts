/**
 * PR #116b: TS surrogate の indicator series 統合テスト。
 *
 * 確認:
 *   1. `padLeadingNaN`: indicatorts 由来の出力を bar 数に揃える
 *   2. `computeTsSurrogateIndicator`: ema/sma/rsi/atr/macd/bb の各 indicator が計算される
 *   3. `collectDslIndicatorNeeds`: DSL から params 付き condition / compareTarget の need を抽出
 *   4. `DSLEvaluator`: params 付き leaf + compareTarget operand を評価できる
 *
 * 評価器の bar-by-bar 統合 (= snapshotAt 経由) は本テストでは個別 unit で確認し、
 * end-to-end (SurrogateFitnessSimulator → 実際の trade simulation) は既存テストの
 * 回帰確認 (449/449 passed) で担保する。
 */

import type { LensFeature, LensFeatureSnapshot } from '../../lenses/types';
import { DSLEvaluator } from '../../strategy_dsl/DSLEvaluator';
import { collectDslIndicatorNeeds } from '../../strategy_dsl/dslOhlcvFeatureNeeds';
import {
  computeTsSurrogateIndicator,
  isTsSurrogateIndicatorFeature,
  padLeadingNaN,
} from '../../strategy_dsl/indicatorSurrogate';
import type { Condition, ConditionGroup, StrategyDSL } from '../../strategy_dsl/schema';
import { StrategyDSLSchema } from '../../strategy_dsl/schema';

function makeDsl(triggerConditions: Condition[]): StrategyDSL {
  return StrategyDSLSchema.parse({
    id: 'pr116b-test',
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: { logic: 'AND', conditions: triggerConditions },
      orderType: 'market',
    },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2 },
    parameters: {},
    metadata: { createdAt: '2026-05-07T00:00:00Z', createdBy: 'mutation' },
  });
}

/** snapshot を 1 件分 (lens='ohlcv') 構築するヘルパ */
function makeSnapshot(features: Record<string, number | string | boolean>): LensFeatureSnapshot {
  const lf: LensFeature = {
    lensName: 'ohlcv',
    lensVersion: '1.0.0',
    features,
    computedAt: new Date(),
  };
  const map = new Map<string, LensFeature>();
  map.set('ohlcv', lf);
  return {
    timestamp: new Date(),
    symbol: 'EURUSD',
    features: map,
    totalComputeDurationMs: 0,
  };
}

describe('PR #116b: padLeadingNaN', () => {
  it('warm-up 期間分を NaN で先頭 padding', () => {
    const out = padLeadingNaN([10, 11, 12], 5);
    expect(out).toHaveLength(5);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBe(10);
    expect(out[3]).toBe(11);
    expect(out[4]).toBe(12);
  });

  it('既に bar 数を満たしていればそのまま (末尾 totalBars 個に揃える)', () => {
    const out = padLeadingNaN([1, 2, 3, 4, 5], 5);
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });

  it('totalBars=0 なら空配列', () => {
    expect(padLeadingNaN([1, 2, 3], 0)).toEqual([]);
  });
});

describe('PR #116b: computeTsSurrogateIndicator', () => {
  // 50 本程度の単純な OHLCV (緩やかに上昇)
  const N = 50;
  const close = Array.from({ length: N }, (_, i) => 1.0 + i * 0.001);
  const high = close.map((c) => c + 0.0005);
  const low = close.map((c) => c - 0.0005);
  const open = close.map((c) => c - 0.0001);
  const volume = Array.from({ length: N }, () => 1000);
  const bars = { open, high, low, close, volume };

  it.each(['ema', 'sma', 'rsi', 'atr', 'macd', 'bb'] as const)(
    '%s: 配列長は bar 数と一致 (= leading NaN padding)',
    (feature) => {
      const series = computeTsSurrogateIndicator(feature, undefined, bars);
      expect(series).not.toBeNull();
      expect(series).toHaveLength(N);
    },
  );

  it('ema: params.period を反映する (period=5 と period=20 で異なる series)', () => {
    const s5 = computeTsSurrogateIndicator('ema', { period: 5 }, bars)!;
    const s20 = computeTsSurrogateIndicator('ema', { period: 20 }, bars)!;
    // どちらも長さは bar 数
    expect(s5).toHaveLength(N);
    expect(s20).toHaveLength(N);
    // 末尾値は period によって異なる (period 短いほど直近価格に近い)
    expect(s5[N - 1]).not.toBe(s20[N - 1]);
  });

  it('未対応 feature は null', () => {
    expect(computeTsSurrogateIndicator('cci', { period: 14 }, bars)).toBeNull();
    expect(computeTsSurrogateIndicator('stochastic', undefined, bars)).toBeNull();
  });

  it('isTsSurrogateIndicatorFeature: ema/sma/rsi/atr/macd/bb のみ true', () => {
    for (const f of ['ema', 'sma', 'rsi', 'atr', 'macd', 'bb']) {
      expect(isTsSurrogateIndicatorFeature(f)).toBe(true);
    }
    for (const f of ['cci', 'stochastic', 'obv', 'unknown']) {
      expect(isTsSurrogateIndicatorFeature(f)).toBe(false);
    }
  });
});

describe('PR #116b: collectDslIndicatorNeeds', () => {
  it('params 付き condition から need を抽出', () => {
    const dsl = makeDsl([
      { lens: 'ohlcv', feature: 'ema', op: '>', value: 1.05, params: { period: 20 } },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(1);
    expect(needs[0].feature).toBe('ema');
    expect(needs[0].params).toEqual({ period: 20 });
    expect(needs[0].snapshotKey).toBe('ohlcv.ema(period=20)');
  });

  it('compareTarget の operand も need として抽出', () => {
    const dsl = makeDsl([
      {
        lens: 'ohlcv',
        feature: 'close',
        op: '>',
        compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } },
      },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    // close は tsSurrogate 対象外なので、compareTarget の ema(20) のみ抽出
    expect(needs.map((n) => n.snapshotKey)).toEqual(['ohlcv.ema(period=20)']);
  });

  it('同じ snapshot key は重複排除される', () => {
    const dsl = makeDsl([
      { lens: 'ohlcv', feature: 'ema', op: '>', value: 1.05, params: { period: 20 } },
      { lens: 'ohlcv', feature: 'ema', op: '<', value: 2.0, params: { period: 20 } },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(1);
  });

  it('未対応 feature (cci) は need に含まれない', () => {
    const dsl = makeDsl([
      { lens: 'ohlcv', feature: 'cci', op: '>', value: 100, params: { period: 14 } },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(0);
  });

  // PR #116b Copilot review #2+#3: params なしの rsi/atr は legacy 経路と二重計算で
  // snapshotAt 上書きが起きるため除外する
  it('params なしの ohlcv.rsi は need に含まれない (legacy 経路で計算済み)', () => {
    const dsl = makeDsl([{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 }]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(0);
  });

  it('params なしの ohlcv.atr も need に含まれない (legacy 経路で計算済み)', () => {
    const dsl = makeDsl([{ lens: 'ohlcv', feature: 'atr', op: '>', value: 0.001 }]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(0);
  });

  it('params 指定された rsi/atr (= legacy と異なるパラメータ) は need に含まれる', () => {
    const dsl = makeDsl([
      { lens: 'ohlcv', feature: 'rsi', op: '<', value: 30, params: { period: 7 } },
      { lens: 'ohlcv', feature: 'atr', op: '>', value: 0.001, params: { period: 21 } },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    const keys = needs.map((n) => n.snapshotKey).sort();
    expect(keys).toEqual(['ohlcv.atr(period=21)', 'ohlcv.rsi(period=7)']);
  });
});

describe('PR #116b: DSLEvaluator が params / compareTarget を解釈する', () => {
  const evaluator = new DSLEvaluator();
  const ANY_GROUP = (conditions: Condition[]): ConditionGroup => ({
    logic: 'AND',
    conditions,
  });

  it('params なし leaf は従来通り feature 名で lookup (後方互換)', () => {
    const snap = makeSnapshot({ rsi: 25 });
    const ok = evaluator.evaluateConditions(
      ANY_GROUP([{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 }]),
      snap,
      {},
    );
    expect(ok).toBe(true);
  });

  it('params 付き leaf は snapshot key 形式 (feature(params)) で lookup', () => {
    const snap = makeSnapshot({ 'ema(period=20)': 1.08 });
    const ok = evaluator.evaluateConditions(
      ANY_GROUP([
        { lens: 'ohlcv', feature: 'ema', op: '>', value: 1.05, params: { period: 20 } },
      ]),
      snap,
      {},
    );
    expect(ok).toBe(true);
  });

  it('compareTarget 付き leaf は別 indicator series の値を right operand に使う', () => {
    // close=1.10 > ema(20)=1.05 → true
    const snap = makeSnapshot({ close: 1.1, 'ema(period=20)': 1.05 });
    const ok = evaluator.evaluateConditions(
      ANY_GROUP([
        {
          lens: 'ohlcv',
          feature: 'close',
          op: '>',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } },
        },
      ]),
      snap,
      {},
    );
    expect(ok).toBe(true);
  });

  it('compareTarget の operand が snapshot に無いと false (= 未対応 condition は false)', () => {
    const snap = makeSnapshot({ close: 1.1 }); // ema(period=20) は無い
    const ok = evaluator.evaluateConditions(
      ANY_GROUP([
        {
          lens: 'ohlcv',
          feature: 'close',
          op: '>',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } },
        },
      ]),
      snap,
      {},
    );
    expect(ok).toBe(false);
  });

  it('params 付き lookup で snapshot に key が無ければ false', () => {
    const snap = makeSnapshot({ rsi: 50 }); // 'rsi(period=7)' は無い
    const ok = evaluator.evaluateConditions(
      ANY_GROUP([{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 30, params: { period: 7 } }]),
      snap,
      {},
    );
    expect(ok).toBe(false);
  });
});
