/**
 * AITradeScenario → StrategyDSL 変換（Phase 6.7b）の最小検証
 */
import { describe, it, expect } from '@jest/globals';
import type { AITradeScenario } from '../../models/tradePlan';
import { scenarioToStrategyDSL } from '../../strategy_dsl/scenarioToStrategyDSL';
import { ImmediateEntrySchema } from '../../strategy_dsl/schema';

function baseScenario(over: Partial<AITradeScenario> = {}): AITradeScenario {
  return {
    id: 'XAUUSD-2026-01-15-1',
    name: 'テスト',
    direction: 'long',
    priority: 'primary',
    entry: {
      type: 'limit',
      price: 2000,
      condition: '押し目',
      triggerIndicators: ['support'],
    },
    stopLoss: { price: 1990, pips: 10, reason: '直近安値' },
    takeProfit: { price: 2020, pips: 20, reason: 'R:R' },
    riskReward: 2,
    confidence: 70,
    rationale: '理由',
    invalidationConditions: [],
    ...over,
  };
}

describe('scenarioToStrategyDSL', () => {
  it('ロングは close > 価格、固定 pips / rr を埋める', () => {
    const dsl = scenarioToStrategyDSL(baseScenario(), {
      symbol: 'XAUUSD',
      timeframe: '15m',
    });
    const ent = ImmediateEntrySchema.parse(dsl.entry);
    expect(dsl.symbol).toBe('XAUUSD');
    expect(dsl.timeframe).toBe('15m');
    expect(ent.direction).toBe('long');
    expect(ent.orderType).toBe('limit');
    expect(dsl.stopLoss).toEqual({ type: 'fixed_pips', value: 10 });
    expect(dsl.takeProfit.type).toBe('rr_ratio');
  });

  it('ショートは close < 価格', () => {
    const dsl = scenarioToStrategyDSL(
      baseScenario({ direction: 'short', entry: { ...baseScenario().entry, price: 1.1 } }),
      { symbol: 'EURUSD', timeframe: '1h' },
    );
    const ent = ImmediateEntrySchema.parse(dsl.entry);
    const first = ent.trigger.conditions[0]!;
    expect('op' in first && first.op).toBe('<');
  });

  it('SL pips 欠損時は 20 既定', () => {
    const s = baseScenario();
    s.stopLoss = { ...s.stopLoss, pips: NaN };
    const dsl = scenarioToStrategyDSL(s, { symbol: 'X', timeframe: '15m' });
    expect(dsl.stopLoss).toEqual({ type: 'fixed_pips', value: 20 });
  });
});
