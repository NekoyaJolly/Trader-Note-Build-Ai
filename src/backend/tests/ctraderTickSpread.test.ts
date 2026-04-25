/**
 * Phase 6.8: cTrader tick → spread series 変換のユニットテスト
 */

import {
  aggregateSpreadTicks,
  convertCTraderTicks,
  mergeBidAskTicks,
  type CTraderRawTickData,
} from '../services/ctrader/ctraderDataService';

describe('cTrader tick spread utilities', () => {
  it('先頭絶対timestamp + 以降差分timestampを価格tickに変換する', () => {
    const raw: CTraderRawTickData[] = [
      { timestamp: 1_700_000_000_000, tick: 110000 },
      { timestamp: 250, tick: 110010 },
      { timestamp: 250, tick: 110020 },
    ];
    const ticks = convertCTraderTicks(raw, 5, 'bid');
    expect(ticks.map(t => t.timestamp.getTime())).toEqual([
      1_700_000_000_000,
      1_700_000_000_250,
      1_700_000_000_500,
    ]);
    expect(ticks.map(t => t.price)).toEqual([1.1, 1.1001, 1.1002]);
    expect(ticks.every(t => t.quoteType === 'bid')).toBe(true);
  });

  it('BID/ASKを近傍timestampでマージしてspreadを作る', () => {
    const bid = [
      { timestamp: new Date(1_000), price: 1.1, quoteType: 'bid' as const },
      { timestamp: new Date(2_000), price: 1.101, quoteType: 'bid' as const },
    ];
    const ask = [
      { timestamp: new Date(1_050), price: 1.1002, quoteType: 'ask' as const },
      { timestamp: new Date(2_200), price: 1.1013, quoteType: 'ask' as const },
    ];
    const spreads = mergeBidAskTicks(bid, ask, 250);
    expect(spreads).toHaveLength(2);
    expect(spreads[0]?.spread).toBeCloseTo(0.0002);
    expect(spreads[1]?.spread).toBeCloseTo(0.0003);
  });

  it('spread tickをバー単位でavg/max/p95に集計する', () => {
    const ticks = [
      { timestamp: new Date(0), bid: 1, ask: 1.1, spread: 0.1 },
      { timestamp: new Date(10_000), bid: 1, ask: 1.3, spread: 0.3 },
      { timestamp: new Date(20_000), bid: 1, ask: 1.2, spread: 0.2 },
      { timestamp: new Date(70_000), bid: 1, ask: 1.5, spread: 0.5 },
    ];
    const bars = aggregateSpreadTicks(ticks, 60_000);
    expect(bars).toHaveLength(2);
    expect(bars[0]?.avgSpread).toBeCloseTo(0.2);
    expect(bars[0]?.maxSpread).toBeCloseTo(0.3);
    expect(bars[0]?.p95Spread).toBeCloseTo(0.3);
    expect(bars[0]?.tickCount).toBe(3);
    expect(bars[1]?.avgSpread).toBeCloseTo(0.5);
  });
});
