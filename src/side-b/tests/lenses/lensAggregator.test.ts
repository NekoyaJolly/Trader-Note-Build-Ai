/**
 * LensAggregator テスト（Phase 1-A）
 *
 * カバレッジ:
 * - レンズ登録・削除・列挙
 * - 並列実行と結果統合
 * - 一部レンズ失敗時の他レンズ結果保持
 * - シリアライズヘルパー
 */

import {
  LensAggregator,
  serializeLensSnapshot,
  type Lens,
  type LensInput,
  type LensFeature,
} from '../../lenses';

const baseInput: LensInput = {
  symbol: 'XAUUSD',
  timeframe: '15m',
  timestamp: new Date('2026-04-17T00:00:00Z'),
};

/** テスト用の決定的なスタブレンズ */
function makeStubLens(name: string, featureValue: number = 42, shouldFail = false): Lens {
  return {
    name,
    version: '1.0.0',
    dependencies: ['symbol'],
    compute: async (input: LensInput): Promise<LensFeature> => {
      if (shouldFail) {
        throw new Error(`${name} intentionally failed`);
      }
      return {
        lensName: name,
        lensVersion: '1.0.0',
        features: { value: featureValue, symbol: input.symbol },
        computedAt: new Date('2026-04-17T00:00:00Z'),
        computeDurationMs: 1,
        confidence: 0.9,
      };
    },
  };
}

describe('LensAggregator - 登録管理', () => {
  it('新規レンズを登録できる', () => {
    const agg = new LensAggregator();
    agg.register(makeStubLens('lens_a'));
    expect(agg.size()).toBe(1);
    expect(agg.getRegisteredLenses()).toEqual(['lens_a']);
  });

  it('同名レンズの二重登録はエラーを投げる', () => {
    const agg = new LensAggregator();
    agg.register(makeStubLens('dup'));
    expect(() => agg.register(makeStubLens('dup'))).toThrow(/already registered/);
  });

  it('複数レンズを登録順に列挙する', () => {
    const agg = new LensAggregator();
    agg.register(makeStubLens('l1'));
    agg.register(makeStubLens('l2'));
    agg.register(makeStubLens('l3'));
    expect(agg.getRegisteredLenses()).toEqual(['l1', 'l2', 'l3']);
  });

  it('unregister でレンズを削除できる', () => {
    const agg = new LensAggregator();
    agg.register(makeStubLens('l1'));
    agg.register(makeStubLens('l2'));
    agg.unregister('l1');
    expect(agg.size()).toBe(1);
    expect(agg.getRegisteredLenses()).toEqual(['l2']);
  });

  it('存在しないレンズの unregister は冪等（エラーなし）', () => {
    const agg = new LensAggregator();
    expect(() => agg.unregister('nothing')).not.toThrow();
  });
});

describe('LensAggregator - computeAll 並列実行', () => {
  it('全レンズの結果を Map に統合して返す', async () => {
    const agg = new LensAggregator();
    agg.register(makeStubLens('a', 1));
    agg.register(makeStubLens('b', 2));

    const snapshot = await agg.computeAll(baseInput);

    expect(snapshot.symbol).toBe('XAUUSD');
    expect(snapshot.timestamp).toEqual(baseInput.timestamp);
    expect(snapshot.features.size).toBe(2);
    expect(snapshot.features.get('a')?.features.value).toBe(1);
    expect(snapshot.features.get('b')?.features.value).toBe(2);
    expect(snapshot.totalComputeDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('1つのレンズが失敗しても他のレンズ結果は保持される', async () => {
    const agg = new LensAggregator();
    agg.register(makeStubLens('ok1', 100));
    agg.register(makeStubLens('bad', 0, true));
    agg.register(makeStubLens('ok2', 200));

    const snapshot = await agg.computeAll(baseInput);

    expect(snapshot.features.size).toBe(2);
    expect(snapshot.features.has('ok1')).toBe(true);
    expect(snapshot.features.has('ok2')).toBe(true);
    expect(snapshot.features.has('bad')).toBe(false);
  });

  it('レンズ未登録の aggregator は空の features を返す', async () => {
    const agg = new LensAggregator();
    const snapshot = await agg.computeAll(baseInput);

    expect(snapshot.features.size).toBe(0);
    expect(snapshot.symbol).toBe('XAUUSD');
  });

  it('同じ入力で同じ結果を返す（決定性）', async () => {
    const agg = new LensAggregator();
    agg.register(makeStubLens('det', 777));

    const s1 = await agg.computeAll(baseInput);
    const s2 = await agg.computeAll(baseInput);

    expect(s1.features.get('det')?.features.value).toBe(
      s2.features.get('det')?.features.value
    );
  });
});

describe('serializeLensSnapshot - JSON 変換', () => {
  it('Map を plain object に変換し timestamp を ISO 文字列化する', async () => {
    const agg = new LensAggregator();
    agg.register(makeStubLens('x', 9));
    const snapshot = await agg.computeAll(baseInput);

    const serialized = serializeLensSnapshot(snapshot);

    expect(serialized.symbol).toBe('XAUUSD');
    expect(serialized.timestamp).toBe('2026-04-17T00:00:00.000Z');
    expect(serialized.features.x.value).toBe(9);
    expect(typeof serialized.features.x.symbol).toBe('string');
  });

  it('空の snapshot も正しくシリアライズできる', async () => {
    const agg = new LensAggregator();
    const snapshot = await agg.computeAll(baseInput);
    const serialized = serializeLensSnapshot(snapshot);

    expect(serialized.features).toEqual({});
  });
});
