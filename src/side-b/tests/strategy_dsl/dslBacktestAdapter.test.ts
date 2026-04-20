/**
 * DSLBacktestAdapter.runBacktestOnBars の単体テスト（Phase 5）
 */

import { DSLBacktestAdapter } from '../../strategy_dsl/DSLBacktestAdapter';
import type { OhlcvBar } from '../../strategy_dsl/dslBacktestSimulation';
import { StrategyDSLSchema } from '../../strategy_dsl/schema';

function syntheticUptrendBars(n: number): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  const start = new Date('2024-01-01T00:00:00Z');
  for (let i = 0; i < n; i++) {
    const px = 1.1 + i * 0.001;
    const t = new Date(start.getTime() + i * 60 * 60 * 1000);
    out.push({
      timestamp: t,
      open: px,
      high: px + 0.0005,
      low: px - 0.0005,
      close: px,
      volume: 1000,
    });
  }
  return out;
}

describe('DSLBacktestAdapter.runBacktestOnBars', () => {
  it('学習/検証に分割して集計する', () => {
    const dsl = StrategyDSLSchema.parse({
      id: 't-dsl-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 'test',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
        },
      },
      stopLoss: { type: 'fixed_pips', value: 50 },
      takeProfit: { type: 'rr_ratio', value: 2 },
      parameters: {},
      metadata: {
        createdAt: new Date().toISOString(),
        createdBy: 'initial_random',
      },
    });

    const bars = syntheticUptrendBars(80);
    const adapter = new DSLBacktestAdapter();
    const agg = adapter.runBacktestOnBars(dsl, {}, { start: '2024-01-01', end: '2024-01-10' }, bars);

    expect(agg.dslId).toBe('t-dsl-1');
    expect(agg.train.summary.totalTrades).toBeGreaterThanOrEqual(0);
    expect(agg.validation.summary.totalTrades).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(agg.overfitScore)).toBe(true);
  });
});
