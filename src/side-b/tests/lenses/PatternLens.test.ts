/**
 * PatternLens の単体テスト (PR ②-1, PR ④F で挙動変更)。
 *
 * PR ④F: TS で pattern を再計算する経路は撤廃。`LensInput.precomputedPatternFlags`
 * (= 上位層が analysis-engine から取得した flags) を末尾バーで参照する薄い
 * wrapper 化したため、ここでは「cache を渡せば末尾バーの flag を返す / cache が
 * なければ全 false」を確認する。
 */

import { ALL_CANDLE_PATTERN_IDS, type CandlePatternId } from '../../../shared/patterns';
import { PatternLens } from '../../lenses/PatternLens';
import type { LensInput } from '../../lenses/types';
import type { OHLCVBar } from '../../lenses/utils/pivotDetection';

function bar(o: number, h: number, l: number, c: number, t = '2026-05-08T00:00:00.000Z'): OHLCVBar {
  return { timestamp: new Date(t), open: o, high: h, low: l, close: c, volume: 1 };
}

function emptyFlagsForN(n: number): Record<CandlePatternId, boolean[]> {
  const out = {} as Record<CandlePatternId, boolean[]>;
  for (const id of ALL_CANDLE_PATTERN_IDS) out[id] = new Array<boolean>(n).fill(false);
  return out;
}

function makeInput(
  bars: OHLCVBar[],
  precomputedPatternFlags?: Record<CandlePatternId, boolean[]>,
): LensInput {
  return {
    symbol: 'EURUSD',
    timeframe: '1h',
    timestamp: new Date('2026-05-08T00:00:00.000Z'),
    ohlcvBars: bars,
    precomputedPatternFlags,
  };
}

describe('PatternLens', () => {
  const lens = new PatternLens();

  it('name / version / dependencies', () => {
    expect(lens.name).toBe('pattern');
    expect(lens.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lens.dependencies).toEqual(['symbol', 'ohlcvBars']);
  });

  it('ohlcvBars が空なら全 false features + confidence 0', async () => {
    const out = await lens.compute(makeInput([]));
    expect(out.lensName).toBe('pattern');
    expect(out.confidence).toBe(0);
    for (const v of Object.values(out.features)) expect(v).toBe(false);
  });

  it('precomputedPatternFlags が未指定なら全 false + confidence 0 (PR ④F: TS 再計算しない)', async () => {
    const bars = [bar(10, 11, 9, 10), bar(10, 11, 6, 11)];
    const out = await lens.compute(makeInput(bars));
    expect(out.confidence).toBe(0);
    for (const v of Object.values(out.features)) expect(v).toBe(false);
  });

  it('precomputedPatternFlags が指定されていれば末尾バーの flag を返す', async () => {
    const bars = [bar(10, 11.5, 9.5, 11), bar(10, 11, 6, 11)];
    const flags = emptyFlagsForN(bars.length);
    flags.pinbar[1] = true;
    flags.pinbar_bull[1] = true;
    const out = await lens.compute(makeInput(bars, flags));
    expect(out.features.pinbar_bull).toBe(true);
    expect(out.features.pinbar).toBe(true);
    expect(out.features.engulfing_bull).toBe(false);
    expect(out.confidence).toBe(1.0);
  });

  it('cache が部分的に欠けていてもクラッシュせず false で埋める', async () => {
    const bars = [bar(10, 11, 9, 10)];
    const partial = {} as Record<CandlePatternId, boolean[]>;
    partial.engulfing_bull = [false];
    const out = await lens.compute(makeInput(bars, partial));
    expect(out.features.engulfing_bull).toBe(false);
    // 他のパターンは false (= 配列なし扱い)
    expect(out.features.pinbar).toBe(false);
    expect(out.features.doji).toBe(false);
  });

  it('決定性: 同じ cache で 2 回呼んで feature が一致', async () => {
    const bars = [bar(10, 11.5, 9.5, 11), bar(10, 11, 6, 11)];
    const flags = emptyFlagsForN(bars.length);
    flags.engulfing_bull[1] = true;
    const a = await lens.compute(makeInput(bars, flags));
    const b = await lens.compute(makeInput(bars, flags));
    expect(a.features).toEqual(b.features);
  });
});
