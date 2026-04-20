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
        { lens: 'ohlcv', feature: 'close', op: '>', value: 0 },
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
});
