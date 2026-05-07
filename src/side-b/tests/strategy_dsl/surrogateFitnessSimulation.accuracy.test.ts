/**
 * DSL シミュの執行仮定・特徴量オンデマンド（バックテスト精度向上）
 */

import { StrategyDSLSchema } from '../../strategy_dsl/schema';
import { collectDslOhlcvFeatureNeeds } from '../../strategy_dsl/dslOhlcvFeatureNeeds';
import { runDslSimulation, type OhlcvBar } from '../../strategy_dsl/surrogateFitnessSimulation';

function bar(
  i: number,
  start: Date,
  o: number,
  h: number,
  l: number,
  c: number,
): OhlcvBar {
  return {
    timestamp: new Date(start.getTime() + i * 60 * 1000),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1000,
  };
}

describe('collectDslOhlcvFeatureNeeds', () => {
  it('close のみなら rsi/atr 不要', () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'n1',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 20 },
      takeProfit: { type: 'rr_ratio', value: 2 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    expect(collectDslOhlcvFeatureNeeds(dsl)).toEqual({ rsi: false, atr: false });
  });

  it('ohlcv.rsi 条件なら rsi 必須', () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'n2',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 20 },
      takeProfit: { type: 'rr_ratio', value: 2 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    expect(collectDslOhlcvFeatureNeeds(dsl)).toEqual({ rsi: true, atr: false });
  });

  it('SL が atr_multiple なら atr 必須', () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'n3',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }] },
      },
      stopLoss: { type: 'atr_multiple', value: 1.5 },
      takeProfit: { type: 'rr_ratio', value: 2 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    expect(collectDslOhlcvFeatureNeeds(dsl).atr).toBe(true);
  });
});

describe('runDslSimulation 執行オプション', () => {
  const start = new Date('2024-01-01T00:00:00Z');

  it('往復コスト（pips）で PnL が減る', () => {
    // 条件は常に真（close > 0）、即時エントリー、翌バーで利益確定できるよう上昇トレンド
    const bars: OhlcvBar[] = [];
    for (let k = 0; k < 30; k++) {
      const px = 1.1 + k * 0.0001;
      bars.push({
        timestamp: new Date(start.getTime() + k * 60 * 1000),
        open: px,
        high: px + 0.0003,
        low: px - 0.0003,
        close: px,
        volume: 1000,
      });
    }
    const dsl = StrategyDSLSchema.parse({
      id: 'c1',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1m',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 50 },
      takeProfit: { type: 'fixed_pips', value: 10 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    const base = runDslSimulation(bars, dsl, {}, { lotSize: 100_000 });
    const withCost = runDslSimulation(bars, dsl, {}, { lotSize: 100_000, roundTripCostPips: 2 });
    expect(base.trades.length).toBeGreaterThan(0);
    expect(withCost.trades.length).toBe(base.trades.length);
    const t0 = base.trades[0];
    const t1 = withCost.trades[0];
    // 2 pips * 0.0001 * 100000 = 20
    expect(t1.pnl).toBeCloseTo(t0.pnl - 20, 5);
  });

  it('同バー内 SL+TP 接触時、optimistic は TP 側（悲観は SL）', () => {
    // 建玉: エントリー直後の足で low が SL より下、high が TP より上
    const bars: OhlcvBar[] = [
      bar(0, start, 1.1, 1.1, 1.1, 1.1),
      bar(1, start, 1.1, 1.1, 1.1, 1.1),
      bar(2, start, 1.1, 1.2, 0.9, 1.0),
    ];
    const dsl = StrategyDSLSchema.parse({
      id: 'c2',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1m',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 100 },
      takeProfit: { type: 'fixed_pips', value: 100 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    // i=0 でシグナル、終値 1.1 でエントリー。i=1 で見る — 足2 で両ヒゲ
    const pessimistic = runDslSimulation(bars, dsl, {}, { lotSize: 1 });
    const optimistic = runDslSimulation(bars, dsl, {}, { lotSize: 1, intraBarExitMode: 'optimistic' });
    expect(pessimistic.trades.length).toBe(1);
    expect(optimistic.trades.length).toBe(1);
    expect(optimistic.trades[0].pnl).toBeGreaterThan(pessimistic.trades[0].pnl);
  });

  it('immediateEntryFill: next_bar_open はシグナル足の次の始値で建つ', () => {
    // 0: シグナル、1: 次足始値で約定、2: SL に届いて決済（建玉の記録用）
    const bars: OhlcvBar[] = [
      bar(0, start, 1.0, 1.0, 1.0, 1.0),
      bar(1, start, 1.5, 1.5, 1.5, 1.5),
      bar(2, start, 1.5, 1.5, 0.4, 1.0),
    ];
    const dsl = StrategyDSLSchema.parse({
      id: 'c3',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1m',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.5 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 100 },
      takeProfit: { type: 'fixed_pips', value: 200 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    const atClose = runDslSimulation(bars, dsl, {}, {});
    const atOpen = runDslSimulation(bars, dsl, {}, { immediateEntryFill: 'next_bar_open' });
    expect(atClose.trades[0].entryPrice).toBe(1.0);
    expect(atOpen.trades[0].entryPrice).toBe(1.5);
  });
});
