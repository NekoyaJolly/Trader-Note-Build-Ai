/**
 * shared/marketdata の単体テスト (PR ⑤)。
 *
 * `OhlcvSource` interface の挙動 + `fetchMultiTimeframeBars` helper の並列取得 +
 * 重複排除を確認する。`HttpOhlcvSource` 自体は `fetchHistoricalData` (DB cache +
 * cTrader API) に依存するためここではモック実装でテスト。
 */

import {
  fetchMultiTimeframeBars,
  type OhlcvBar,
  type OhlcvFetchRequest,
  type OhlcvSource,
} from '../../shared/marketdata';
import type { CanonicalTimeframe } from '../../shared/timeframes';

class FakeOhlcvSource implements OhlcvSource {
  public readonly calls: OhlcvFetchRequest[] = [];

  constructor(private readonly bars: Map<string, OhlcvBar[]> = new Map()) {}

  async fetchBars(req: OhlcvFetchRequest): Promise<OhlcvBar[]> {
    this.calls.push(req);
    const key = `${req.symbol}/${req.timeframe}`;
    return Promise.resolve(this.bars.get(key) ?? []);
  }
}

function bar(t: number, o: number = 1, h: number = 2, l: number = 0.5, c: number = 1.5): OhlcvBar {
  return { timestamp: new Date(t), open: o, high: h, low: l, close: c, volume: 1 };
}

describe('shared/marketdata: fetchMultiTimeframeBars', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-02T00:00:00Z');

  it('指定 timeframes の bars を Map で返す', async () => {
    const src = new FakeOhlcvSource(
      new Map([
        ['EURUSD/15m', [bar(1), bar(2), bar(3)]],
        ['EURUSD/1h', [bar(1), bar(2)]],
      ]),
    );
    const result = await fetchMultiTimeframeBars(src, 'EURUSD', ['15m', '1h'], start, end);
    expect(result.get('15m')).toHaveLength(3);
    expect(result.get('1h')).toHaveLength(2);
  });

  it('重複 timeframe は内部で重複排除して 1 回だけ呼ぶ', async () => {
    const src = new FakeOhlcvSource(new Map([['EURUSD/1h', [bar(1)]]]));
    await fetchMultiTimeframeBars(src, 'EURUSD', ['1h', '1h', '1h'], start, end);
    expect(src.calls).toHaveLength(1);
  });

  it('該当 timeframe のデータが無くても空配列で返る (= 例外なし)', async () => {
    const src = new FakeOhlcvSource(new Map());
    const result = await fetchMultiTimeframeBars(
      src,
      'EURUSD',
      ['15m', '1h'] as CanonicalTimeframe[],
      start,
      end,
    );
    expect(result.get('15m')).toEqual([]);
    expect(result.get('1h')).toEqual([]);
  });

  it('並列取得 (= 各 timeframe を Promise.all で発行)', async () => {
    let activeCalls = 0;
    let maxConcurrent = 0;
    const src: OhlcvSource = {
      async fetchBars() {
        activeCalls += 1;
        maxConcurrent = Math.max(maxConcurrent, activeCalls);
        await new Promise((r) => setTimeout(r, 10));
        activeCalls -= 1;
        return [];
      },
    };
    await fetchMultiTimeframeBars(
      src,
      'EURUSD',
      ['15m', '1h', '4h'] as CanonicalTimeframe[],
      start,
      end,
    );
    // 並列実行されていれば maxConcurrent は 2 以上 (= 直列なら 1)
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
  });
});
