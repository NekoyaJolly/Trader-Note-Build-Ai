/**
 * DiversityEnforcer（Phase 5）
 */

import { DiversityEnforcer } from '../../evolution/DiversityEnforcer';
import { StrategyDSLSchema } from '../../strategy_dsl/schema';

function minimalDsl(id: string, closeThreshold: number) {
  return StrategyDSLSchema.parse({
    id,
    generation: 0,
    parentIds: [],
    regimeTarget: 'r',
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: closeThreshold }],
      },
    },
    stopLoss: { type: 'fixed_pips', value: 10 },
    takeProfit: { type: 'rr_ratio', value: 2 },
    parameters: {},
    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: 'initial_random',
    },
  });
}

describe('DiversityEnforcer', () => {
  it('完全同一構造（id除く）は類似度 1 に近い', () => {
    const enforcer = new DiversityEnforcer();
    const a = minimalDsl('a', 1);
    const b = minimalDsl('b', 1);
    expect(enforcer.similarity(a, b)).toBe(1);
  });

  it('閾値を超えるペアを列挙する', () => {
    const enforcer = new DiversityEnforcer();
    const a = minimalDsl('a', 1);
    const b = minimalDsl('b', 1);
    const pairs = enforcer.findTooSimilarPairs([a, b], 0.9);
    expect(pairs.length).toBe(1);
  });

  it('filterDiverse で冗長を除去する', () => {
    const enforcer = new DiversityEnforcer();
    const a = minimalDsl('a', 1);
    const b = minimalDsl('b', 1);
    const kept = enforcer.filterDiverse([a, b], 0.99);
    expect(kept.length).toBe(1);
  });
});
