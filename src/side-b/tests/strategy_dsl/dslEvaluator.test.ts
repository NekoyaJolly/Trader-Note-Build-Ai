/**
 * DSLEvaluator の単体テスト（Phase 5）
 */

import type { LensFeature, LensFeatureSnapshot } from '../../lenses/types';
import { DSLEvaluator } from '../../strategy_dsl/DSLEvaluator';
import type { ConditionGroup } from '../../strategy_dsl/schema';

function makeSnapshot(close: number, rsi: number): LensFeatureSnapshot {
  const lf: LensFeature = {
    lensName: 'ohlcv',
    lensVersion: '1',
    features: { close, rsi, open: close, high: close, low: close, volume: 1 },
    computedAt: new Date(),
  };
  const features = new Map<string, LensFeature>();
  features.set('ohlcv', lf);
  return {
    timestamp: new Date(),
    symbol: 'EURUSD',
    features,
    totalComputeDurationMs: 0,
  };
}

describe('DSLEvaluator', () => {
  const ev = new DSLEvaluator();

  it('AND グループは全て真のときのみ真', () => {
    const g: ConditionGroup = {
      logic: 'AND',
      conditions: [
        { lens: 'ohlcv', feature: 'close', op: '>', value: 1 },
        { lens: 'ohlcv', feature: 'rsi', op: '<', value: 50 },
      ],
    };
    expect(ev.evaluateConditions(g, makeSnapshot(2, 30), {})).toBe(true);
    expect(ev.evaluateConditions(g, makeSnapshot(2, 60), {})).toBe(false);
  });

  it('OR グループはいずれかが真なら真', () => {
    const g: ConditionGroup = {
      logic: 'OR',
      conditions: [
        { lens: 'ohlcv', feature: 'rsi', op: '>', value: 90 },
        { lens: 'ohlcv', feature: 'close', op: '>', value: 1 },
      ],
    };
    expect(ev.evaluateConditions(g, makeSnapshot(2, 10), {})).toBe(true);
  });

  it('ネストしたグループを評価できる', () => {
    const g: ConditionGroup = {
      logic: 'AND',
      conditions: [
        {
          logic: 'OR',
          conditions: [
            { lens: 'ohlcv', feature: 'rsi', op: '<', value: 20 },
            { lens: 'ohlcv', feature: 'rsi', op: '>', value: 80 },
          ],
        },
        { lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 },
      ],
    };
    expect(ev.evaluateConditions(g, makeSnapshot(1, 10), {})).toBe(true);
    expect(ev.evaluateConditions(g, makeSnapshot(1, 50), {})).toBe(false);
  });

  it('$ パラメータを置換して比較する', () => {
    const c: ConditionGroup = {
      logic: 'AND',
      conditions: [{ lens: 'ohlcv', feature: 'rsi', op: '<', value: '$thr' }],
    };
    expect(ev.evaluateConditions(c, makeSnapshot(1, 40), { thr: 50 })).toBe(true);
    expect(() => ev.evaluateConditions(c, makeSnapshot(1, 40), {})).toThrow(/未定義パラメータ/);
  });

  it('between / in を評価できる', () => {
    const between: ConditionGroup = {
      logic: 'AND',
      conditions: [{ lens: 'ohlcv', feature: 'rsi', op: 'between', value: [20, 40] }],
    };
    expect(ev.evaluateConditions(between, makeSnapshot(1, 30), {})).toBe(true);

    const inn: ConditionGroup = {
      logic: 'AND',
      conditions: [{ lens: 'ohlcv', feature: 'rsi', op: 'in', value: [10, 30, 50] }],
    };
    expect(ev.evaluateConditions(inn, makeSnapshot(1, 30), {})).toBe(true);
  });

  // ===========================================
  // PR ①-B: cross / Touch / is_* 系 op
  // ===========================================
  describe('PR ①-B: 状態遷移系 op', () => {
    it('cross_above は前バー左<右、現バー左>右 のときのみ真', () => {
      const g: ConditionGroup = {
        logic: 'AND',
        conditions: [
          {
            lens: 'ohlcv',
            feature: 'close',
            op: 'cross_above',
            compareTarget: { lens: 'ohlcv', feature: 'rsi' },
          },
        ],
      };
      const prev = makeSnapshot(40, 50); // close 40 < rsi 50
      const curr = makeSnapshot(60, 50); // close 60 > rsi 50 → cross_above
      expect(ev.evaluateConditions(g, curr, {}, prev)).toBe(true);

      const noCrossPrev = makeSnapshot(60, 50);
      expect(ev.evaluateConditions(g, curr, {}, noCrossPrev)).toBe(false);
    });

    it('cross_below は前バー左>右、現バー左<右 のときのみ真', () => {
      const g: ConditionGroup = {
        logic: 'AND',
        conditions: [
          {
            lens: 'ohlcv',
            feature: 'close',
            op: 'cross_below',
            compareTarget: { lens: 'ohlcv', feature: 'rsi' },
          },
        ],
      };
      const prev = makeSnapshot(60, 50);
      const curr = makeSnapshot(40, 50);
      expect(ev.evaluateConditions(g, curr, {}, prev)).toBe(true);
    });

    it('cross_above は prevSnapshot 未指定なら false (= 先頭バー扱い)', () => {
      const g: ConditionGroup = {
        logic: 'AND',
        conditions: [
          {
            lens: 'ohlcv',
            feature: 'close',
            op: 'cross_above',
            compareTarget: { lens: 'ohlcv', feature: 'rsi' },
          },
        ],
      };
      const curr = makeSnapshot(60, 50);
      expect(ev.evaluateConditions(g, curr, {})).toBe(false);
    });

    it('cross_above の固定値 right も評価できる (= 前バー右値は同値)', () => {
      const g: ConditionGroup = {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: 'cross_above', value: 50 }],
      };
      const prev = makeSnapshot(40, 0);
      const curr = makeSnapshot(60, 0);
      expect(ev.evaluateConditions(g, curr, {}, prev)).toBe(true);
    });

    it('touch_close は左辺=右辺で真 (微小誤差は許容)', () => {
      const g: ConditionGroup = {
        logic: 'AND',
        conditions: [
          {
            lens: 'ohlcv',
            feature: 'close',
            op: 'touch_close',
            compareTarget: { lens: 'ohlcv', feature: 'rsi' },
          },
        ],
      };
      expect(ev.evaluateConditions(g, makeSnapshot(50, 50), {})).toBe(true);
      expect(ev.evaluateConditions(g, makeSnapshot(50, 51), {})).toBe(false);
    });

    it('touch_wick は左辺値が現バーの high-low レンジ内で真', () => {
      const g: ConditionGroup = {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'rsi', op: 'touch_wick', value: 0 }],
      };
      // makeSnapshot は close=high=low なので close=50 のとき high=low=50
      // rsi=50 は range 内
      expect(ev.evaluateConditions(g, makeSnapshot(50, 50), {})).toBe(true);
      expect(ev.evaluateConditions(g, makeSnapshot(50, 60), {})).toBe(false);
    });

    it('is_true / is_false は左辺の Boolean 評価のみで判定', () => {
      // boolean feature が snapshot に乗るケースを直接構築
      const lf: LensFeature = {
        lensName: 'pattern',
        lensVersion: '1',
        features: { pinbar: true, hammer: false },
        computedAt: new Date(),
      };
      const features = new Map<string, LensFeature>();
      features.set('pattern', lf);
      const snap: LensFeatureSnapshot = {
        timestamp: new Date(),
        symbol: 'EURUSD',
        features,
        totalComputeDurationMs: 0,
      };

      const gTrue: ConditionGroup = {
        logic: 'AND',
        conditions: [{ lens: 'pattern', feature: 'pinbar', op: 'is_true', value: 0 }],
      };
      expect(ev.evaluateConditions(gTrue, snap, {})).toBe(true);

      const gFalse: ConditionGroup = {
        logic: 'AND',
        conditions: [{ lens: 'pattern', feature: 'hammer', op: 'is_false', value: 0 }],
      };
      expect(ev.evaluateConditions(gFalse, snap, {})).toBe(true);

      const gFalseInverted: ConditionGroup = {
        logic: 'AND',
        conditions: [{ lens: 'pattern', feature: 'pinbar', op: 'is_false', value: 0 }],
      };
      expect(ev.evaluateConditions(gFalseInverted, snap, {})).toBe(false);
    });
  });
});
