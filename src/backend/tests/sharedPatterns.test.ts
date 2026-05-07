/**
 * shared/patterns の単体テスト (PR ②-1)。
 *
 * Python `compute_pinbar_flags` / `compute_candlestick_pattern_flags` と同じ式で
 * 動くことを固定 OHLCV データで確認する。Python 側で同じ入力に対する期待値を
 * 計算した結果をハードコードしたフィクスチャを使う (= 実装ドリフト検出に直結)。
 */

import {
  ALL_CANDLE_PATTERN_IDS,
  computeAllPatternFlags,
  computeCandlestickPatternFlags,
  computePinbarFlags,
  patternFlagsAtIndex,
  type PatternBar,
} from '../../shared/patterns';

/** 完全フラットな範囲 (body=0) はすべて false */
const FLAT_BAR: PatternBar = { open: 1.0, high: 1.0, low: 1.0, close: 1.0 };

describe('shared/patterns: computePinbarFlags', () => {
  it('flat bar (body=0) は全て false', () => {
    const out = computePinbarFlags([FLAT_BAR]);
    expect(out.pinbar).toEqual([false]);
    expect(out.pinbar_bull).toEqual([false]);
    expect(out.pinbar_bear).toEqual([false]);
  });

  it('下に長い髭 (body=1, lower=4, upper=0): pinbar_bull=true', () => {
    // open=10, close=11, body=1 / high=11, low=6 (low=close-1-4=6)
    // upper = 11 - max(10,11) = 0
    // lower = min(10,11) - 6 = 4 (= 4*body, >= 3*body OK)
    const bar: PatternBar = { open: 10, close: 11, high: 11, low: 6 };
    const out = computePinbarFlags([bar]);
    expect(out.pinbar_bull).toEqual([true]);
    expect(out.pinbar_bear).toEqual([false]);
    expect(out.pinbar).toEqual([true]);
  });

  it('上に長い髭 (body=1, upper=4, lower=0): pinbar_bear=true', () => {
    // open=10, close=9 (bearish), body=1 / high=14, low=9
    // upper = 14 - 10 = 4
    // lower = 9 - 9 = 0
    const bar: PatternBar = { open: 10, close: 9, high: 14, low: 9 };
    const out = computePinbarFlags([bar]);
    expect(out.pinbar_bear).toEqual([true]);
    expect(out.pinbar_bull).toEqual([false]);
    expect(out.pinbar).toEqual([true]);
  });

  it('上下バランスの取れたヒゲ (どちらも 2:1 程度) は pinbar=false', () => {
    // body=1, upper=2, lower=2 → どちらの条件も満たさない (3*body=3 必要)
    const bar: PatternBar = { open: 10, close: 11, high: 13, low: 8 };
    const out = computePinbarFlags([bar]);
    expect(out.pinbar).toEqual([false]);
  });
});

describe('shared/patterns: computeCandlestickPatternFlags', () => {
  it('hammer_bull: 下ヒゲ >= 2*body かつ 陽線', () => {
    // body=1, lower=2, upper=0.3 (<=0.5*body=0.5)
    const bar: PatternBar = { open: 10, close: 11, high: 11.3, low: 8 };
    const out = computeCandlestickPatternFlags([bar]);
    expect(out.hammer).toEqual([true]);
    expect(out.hammer_bull).toEqual([true]);
    expect(out.hammer_bear).toEqual([false]);
  });

  it('shooting_star: 上ヒゲ >= 2*body かつ 下ヒゲ <= 0.5*body', () => {
    // body=1 (open=10, close=11), upper=2.5, lower=0.3
    const bar: PatternBar = { open: 10, close: 11, high: 13.5, low: 9.7 };
    const out = computeCandlestickPatternFlags([bar]);
    expect(out.shooting_star).toEqual([true]);
  });

  it('doji: 実体 <= 0.1 * range', () => {
    // body=0.05, range=1.0 → 0.05 <= 0.1
    const bar: PatternBar = { open: 10, close: 10.05, high: 10.5, low: 9.5 };
    const out = computeCandlestickPatternFlags([bar]);
    expect(out.doji).toEqual([true]);
  });

  it('thrust_bull: 実体 >= 0.7 * range かつ 陽線', () => {
    // body=0.8, range=1.0 → 0.8 >= 0.7
    const bar: PatternBar = { open: 10, close: 10.8, high: 10.9, low: 9.9 };
    const out = computeCandlestickPatternFlags([bar]);
    expect(out.thrust_bull).toEqual([true]);
    expect(out.thrust_bear).toEqual([false]);
  });

  it('engulfing_bull: 前バー陰線、現バー陽線で前バー実体を包む', () => {
    const bars: PatternBar[] = [
      { open: 11, close: 10, high: 11, low: 10 }, // bear: open>close
      { open: 10, close: 11.2, high: 11.5, low: 9.8 }, // bull: open<=prev.close, close>=prev.open
    ];
    const out = computeCandlestickPatternFlags(bars);
    expect(out.engulfing_bull).toEqual([false, true]);
  });

  it('engulfing_bear: 前バー陽線、現バー陰線で前バー実体を包む', () => {
    const bars: PatternBar[] = [
      { open: 10, close: 11, high: 11, low: 10 }, // bull
      { open: 11.2, close: 9.8, high: 11.3, low: 9.5 }, // bear: open>=prev.close, close<=prev.open
    ];
    const out = computeCandlestickPatternFlags(bars);
    expect(out.engulfing_bear).toEqual([false, true]);
  });

  it('engulfing は先頭バーで必ず false (前バー無し)', () => {
    const bars: PatternBar[] = [{ open: 10, close: 11, high: 11.5, low: 9.5 }];
    const out = computeCandlestickPatternFlags(bars);
    expect(out.engulfing_bull[0]).toBe(false);
    expect(out.engulfing_bear[0]).toBe(false);
  });

  it('flat bar (range=0) は全 false', () => {
    const out = computeCandlestickPatternFlags([FLAT_BAR]);
    for (const id of [
      'hammer',
      'hammer_bull',
      'hammer_bear',
      'shooting_star',
      'engulfing_bull',
      'engulfing_bear',
      'doji',
      'thrust_bull',
      'thrust_bear',
    ] as const) {
      expect(out[id]).toEqual([false]);
    }
  });
});

describe('shared/patterns: computeAllPatternFlags', () => {
  it('12 種すべての配列が bars.length と同じ長さで返る', () => {
    const bars: PatternBar[] = [
      { open: 10, close: 11, high: 11.5, low: 9.5 },
      { open: 10, close: 11, high: 11, low: 6 }, // pinbar_bull
    ];
    const out = computeAllPatternFlags(bars);
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      expect(out[id]).toHaveLength(2);
    }
    expect(out.pinbar_bull[1]).toBe(true);
  });

  it('決定性: 同じ入力で同じ出力', () => {
    const bars: PatternBar[] = Array.from({ length: 5 }, (_, i) => ({
      open: 10 + i,
      close: 10.5 + i,
      high: 11 + i,
      low: 9.5 + i,
    }));
    const a = computeAllPatternFlags(bars);
    const b = computeAllPatternFlags(bars);
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      expect(a[id]).toEqual(b[id]);
    }
  });
});

describe('shared/patterns: patternFlagsAtIndex', () => {
  it('範囲外 index は全 false を返す', () => {
    const bars: PatternBar[] = [{ open: 10, close: 11, high: 12, low: 9 }];
    const out = patternFlagsAtIndex(bars, 5);
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      expect(out[id]).toBe(false);
    }
  });

  it('computeAllPatternFlags の同 index と一致 (= 局所計算と全体計算の整合)', () => {
    const bars: PatternBar[] = [
      { open: 11, close: 10, high: 11, low: 10 }, // bear
      { open: 10, close: 11.2, high: 11.5, low: 9.8 }, // engulfing_bull
      { open: 10, close: 11, high: 11, low: 6 }, // pinbar_bull
    ];
    const all = computeAllPatternFlags(bars);
    for (let i = 0; i < bars.length; i++) {
      const at = patternFlagsAtIndex(bars, i);
      for (const id of ALL_CANDLE_PATTERN_IDS) {
        expect(at[id]).toBe(all[id][i]);
      }
    }
  });
});
