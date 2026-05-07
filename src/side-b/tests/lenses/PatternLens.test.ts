/**
 * PatternLens の単体テスト (PR ②-1)。
 *
 * - shared/patterns に委譲する形なので、ここでは「lens 規約 (副作用なし、
 *   決定性、欠損入力で confidence 0)」と「最終バーで pattern を判定する」
 *   挙動だけを確認する。pattern 判定の式自体は shared/patterns のテストで担保。
 */

import { PatternLens } from '../../lenses/PatternLens';
import type { LensInput } from '../../lenses/types';
import type { OHLCVBar } from '../../lenses/utils/pivotDetection';

function bar(o: number, h: number, l: number, c: number, t = '2026-05-08T00:00:00.000Z'): OHLCVBar {
  return { timestamp: new Date(t), open: o, high: h, low: l, close: c, volume: 1 };
}

function makeInput(bars: OHLCVBar[]): LensInput {
  return {
    symbol: 'EURUSD',
    timeframe: '1h',
    timestamp: new Date('2026-05-08T00:00:00.000Z'),
    ohlcvBars: bars,
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

  it('最終バーが pinbar_bull のとき pattern.pinbar_bull=true', async () => {
    const bars = [bar(10, 11.5, 9.5, 11), bar(10, 11, 6, 11)];
    // 末尾: body=1, lower=4, upper=0 → pinbar_bull (= 3:0.5 比率)
    const out = await lens.compute(makeInput(bars));
    expect(out.features.pinbar_bull).toBe(true);
    expect(out.features.pinbar).toBe(true);
    expect(out.confidence).toBe(1.0);
  });

  it('engulfing_bull は前バー (= bars[i-1]) 依存で末尾バーの判定', async () => {
    const bars = [
      bar(11, 11, 10, 10), // 前バー: bear
      bar(10, 11.5, 9.8, 11.2), // 末尾: bull, 前バー実体を包む
    ];
    const out = await lens.compute(makeInput(bars));
    expect(out.features.engulfing_bull).toBe(true);
  });

  it('決定性: 同じ入力で 2 回呼んで feature が一致', async () => {
    const bars = [bar(10, 11.5, 9.5, 11), bar(10, 11, 6, 11)];
    const a = await lens.compute(makeInput(bars));
    const b = await lens.compute(makeInput(bars));
    expect(a.features).toEqual(b.features);
  });
});
