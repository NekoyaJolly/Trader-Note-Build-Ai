/**
 * Critical-4 4a-parameters: parameters schema 緩和の挙動テスト
 *
 * Zod は構造のみ、意味は consumer 側 (defaultParameterValues / valuesForParameterField) で
 * 吸収する方針。本テストは:
 *   - LLM が出す raw 値 (number/string/boolean/null) でも StrategyDSLSchema が parse できる
 *   - 浅いオブジェクトでも parse できる
 *   - structured / raw / object が混在していても parse できる
 *   - defaultParameterValues / valuesForParameterField が
 *     新しい形に対して期待通り動く (raw number は採用、文字列/boolean/null は skip、
 *     simple object は warning + skip)
 * を固定する。
 */

import { StrategyDSLSchema } from '../../strategy_dsl/schema';
import {
  countParameterGridCombinations,
  defaultParameterValues,
  enumerateParameterGrid,
  valuesForParameterField,
} from '../../strategy_dsl/dslParameterUtils';
import {
  isLegacyParameterDef,
  isParameterRangeV2,
  isRawParameterValue,
  isSimpleParameterObject,
} from '../../strategy_dsl/types';

function dslWith(parameters: unknown): unknown {
  return {
    id: 'test-1',
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'fixed_pips', value: 30 },
    takeProfit: { type: 'rr_ratio', value: 1.5 },
    parameters,
    metadata: { createdAt: new Date().toISOString(), createdBy: 'mutation' },
  };
}

describe('StrategyDSLSchema.parameters 緩和 (4a-parameters)', () => {
  it('LLM が raw number を入れた parameters でも parse できる', () => {
    const r = StrategyDSLSchema.safeParse(
      dslWith({ minImpulse: 0.5, pullbackTolerance: 0.02, breakoutLookback: 20 }),
    );
    expect(r.success).toBe(true);
  });

  it('raw string / boolean / null も parse できる', () => {
    const r = StrategyDSLSchema.safeParse(
      dslWith({ mode: 'aggressive', enabled: true, threshold: null }),
    );
    expect(r.success).toBe(true);
  });

  it('浅いオブジェクト (kind:range タグ無し) も parse できる', () => {
    const r = StrategyDSLSchema.safeParse(
      dslWith({ atrMultiplier: { min: 1.0, max: 3.0 } }),
    );
    expect(r.success).toBe(true);
  });

  it('structured + raw + object 混在でも parse できる', () => {
    const r = StrategyDSLSchema.safeParse(
      dslWith({
        atrMult: { range: [1.0, 3.0], default: 2.0, type: 'float' }, // legacy
        sweepLen: { kind: 'range', min: 5, max: 50, step: 5, default: 20 }, // V2
        rawNum: 0.5, // raw number
        rawStr: 'fast', // raw string
        loose: { min: 0.5, max: 1.0 }, // simple object
      }),
    );
    expect(r.success).toBe(true);
  });

  it('undefined 値は z.union で全分岐が落ちて弾かれる', () => {
    const r = StrategyDSLSchema.safeParse(dslWith({ k: undefined as unknown }));
    expect(r.success).toBe(false);
  });

  it('関数値も z.union で全分岐が落ちて弾かれる', () => {
    const fn = (() => 42) as unknown;
    const r = StrategyDSLSchema.safeParse(dslWith({ k: fn }));
    expect(r.success).toBe(false);
  });
});

describe('defaultParameterValues (4a-parameters)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('legacy structured は default を採用', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({ atrMult: { range: [1.0, 3.0], default: 2.0, type: 'float' } }),
    );
    expect(defaultParameterValues(dsl)).toEqual({ atrMult: 2.0 });
  });

  it('V2 structured も default を採用', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({ sweepLen: { kind: 'range', min: 5, max: 50, step: 5, default: 20 } }),
    );
    expect(defaultParameterValues(dsl)).toEqual({ sweepLen: 20 });
  });

  it('raw number は値そのまま採用', () => {
    const dsl = StrategyDSLSchema.parse(dslWith({ minImpulse: 0.5, foo: 42 }));
    expect(defaultParameterValues(dsl)).toEqual({ minImpulse: 0.5, foo: 42 });
  });

  it('raw string / boolean / null は skip (warning なし)', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({ mode: 'aggressive', enabled: true, threshold: null, num: 1.5 }),
    );
    expect(defaultParameterValues(dsl)).toEqual({ num: 1.5 });
    // string/bool/null の skip は warning しない (LLM がよく出すパターンで観測価値が低い)
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('simple object は warning + skip', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({ rangeLike: { min: 0.5, max: 1.0 }, num: 1.5 }),
    );
    expect(defaultParameterValues(dsl)).toEqual({ num: 1.5 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('parameters.rangeLike'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('keys=min,max'));
  });
});

describe('valuesForParameterField (4a-parameters)', () => {
  it('legacy → [default] 単一値', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({ x: { range: [1, 3], default: 2, type: 'int' } }),
    );
    expect(valuesForParameterField('x', dsl.parameters.x)).toEqual([2]);
  });

  it('V2 → range 展開 (既存挙動を維持)', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({ x: { kind: 'range', min: 1, max: 3, step: 1, default: 2 } }),
    );
    expect(valuesForParameterField('x', dsl.parameters.x)).toEqual([1, 2, 3]);
  });

  it('raw number → 単一値の配列', () => {
    const dsl = StrategyDSLSchema.parse(dslWith({ x: 0.7 }));
    expect(valuesForParameterField('x', dsl.parameters.x)).toEqual([0.7]);
  });

  it('raw string / boolean / null → 空配列 (grid 対象外)', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({ a: 'fast', b: true, c: null }),
    );
    expect(valuesForParameterField('a', dsl.parameters.a)).toEqual([]);
    expect(valuesForParameterField('b', dsl.parameters.b)).toEqual([]);
    expect(valuesForParameterField('c', dsl.parameters.c)).toEqual([]);
  });

  it('simple object → 空配列 (grid 対象外)', () => {
    const dsl = StrategyDSLSchema.parse(dslWith({ x: { min: 0.5, max: 1.0 } }));
    expect(valuesForParameterField('x', dsl.parameters.x)).toEqual([]);
  });
});

describe('enumerateParameterGrid / countParameterGridCombinations (4a-parameters)', () => {
  it('grid 対象キーが無ければ [{}] (= base のみ) を返す', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({ raw1: 'fast', raw2: true, obj: { min: 0.5 } }),
    );
    expect(countParameterGridCombinations(dsl)).toBe(1);
    expect(enumerateParameterGrid(dsl)).toEqual([{}]);
  });

  it('raw number 単一値は grid 1 通り (key を含む)', () => {
    const dsl = StrategyDSLSchema.parse(dslWith({ x: 1.5 }));
    expect(countParameterGridCombinations(dsl)).toBe(1);
    expect(enumerateParameterGrid(dsl)).toEqual([{ x: 1.5 }]);
  });

  it('V2 + raw 非数値が混在しても grid 対象は V2 のみ (空配列キーは row に含まない)', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({
        sweep: { kind: 'range', min: 1, max: 3, step: 1, default: 2 },
        ignored: 'fast',
      }),
    );
    expect(countParameterGridCombinations(dsl)).toBe(3);
    const grid = enumerateParameterGrid(dsl);
    expect(grid).toEqual([{ sweep: 1 }, { sweep: 2 }, { sweep: 3 }]);
    // grid row に undefined / "ignored" キーが混入しないことを確認
    for (const row of grid) {
      expect(Object.keys(row)).toEqual(['sweep']);
      expect(Object.values(row).every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('V2 × V2 のカーテシアン積は対象キーのみで構成される', () => {
    const dsl = StrategyDSLSchema.parse(
      dslWith({
        a: { kind: 'range', min: 1, max: 2, step: 1, default: 1 },
        b: { kind: 'range', min: 10, max: 20, step: 10, default: 10 },
      }),
    );
    expect(countParameterGridCombinations(dsl)).toBe(4);
    expect(enumerateParameterGrid(dsl).length).toBe(4);
  });
});

describe('isParameterRangeV2 強化 (4a-parameters)', () => {
  it('kind が "range" でも min/max/step が文字列だと false', () => {
    const fakeV2 = { kind: 'range', min: '1', max: '5', step: '1', default: '3' } as never;
    expect(isParameterRangeV2(fakeV2)).toBe(false);
  });

  it('step が 0 や負数だと false', () => {
    expect(
      isParameterRangeV2({ kind: 'range', min: 1, max: 5, step: 0, default: 3 }),
    ).toBe(false);
    expect(
      isParameterRangeV2({ kind: 'range', min: 1, max: 5, step: -1, default: 3 }),
    ).toBe(false);
  });

  it('default が NaN / Infinity だと false', () => {
    expect(
      isParameterRangeV2({ kind: 'range', min: 1, max: 5, step: 1, default: NaN }),
    ).toBe(false);
    expect(
      isParameterRangeV2({
        kind: 'range',
        min: 1,
        max: 5,
        step: 1,
        default: Infinity,
      }),
    ).toBe(false);
  });

  it('全フィールドが finite number なら true', () => {
    expect(
      isParameterRangeV2({ kind: 'range', min: 1, max: 5, step: 1, default: 3 }),
    ).toBe(true);
  });
});

describe('isLegacyParameterDef 強化 (4a-parameters)', () => {
  it('range が文字列タプルだと false', () => {
    const fakeLegacy = { range: ['1', '3'], default: '2', type: 'int' } as never;
    expect(isLegacyParameterDef(fakeLegacy)).toBe(false);
  });

  it('default が文字列だと false', () => {
    expect(
      isLegacyParameterDef({ range: [1, 3], default: '2', type: 'int' } as never),
    ).toBe(false);
  });

  it('type が想定外文字列だと false', () => {
    expect(
      isLegacyParameterDef({ range: [1, 3], default: 2, type: 'string' } as never),
    ).toBe(false);
  });

  it('正常な structured は true', () => {
    expect(isLegacyParameterDef({ range: [1, 3], default: 2, type: 'int' })).toBe(true);
  });
});

describe('parameter type guards (4a-parameters)', () => {
  it('isLegacyParameterDef は raw 値を弾く', () => {
    expect(isLegacyParameterDef(0.5)).toBe(false);
    expect(isLegacyParameterDef('foo')).toBe(false);
    expect(isLegacyParameterDef(null)).toBe(false);
  });

  it('isParameterRangeV2 は raw 値を弾く', () => {
    expect(isParameterRangeV2(0.5)).toBe(false);
    expect(isParameterRangeV2(null)).toBe(false);
  });

  it('isRawParameterValue は number / string / boolean / null を true に', () => {
    expect(isRawParameterValue(0.5)).toBe(true);
    expect(isRawParameterValue('foo')).toBe(true);
    expect(isRawParameterValue(true)).toBe(true);
    expect(isRawParameterValue(null)).toBe(true);
    expect(isRawParameterValue({ range: [1, 2], default: 1, type: 'int' })).toBe(false);
  });

  it('isSimpleParameterObject は structured 以外のオブジェクトを true に', () => {
    expect(isSimpleParameterObject({ min: 0.5, max: 1.0 })).toBe(true);
    expect(isSimpleParameterObject({ range: [1, 2], default: 1, type: 'int' })).toBe(false);
    expect(isSimpleParameterObject({ kind: 'range', min: 1, max: 5, step: 1, default: 3 })).toBe(
      false,
    );
    expect(isSimpleParameterObject(0.5)).toBe(false);
  });

  it('isSimpleParameterObject は value が raw scalar 以外の時は false (型回避経由の不正値を防ぐ)', () => {
    // 通常 Zod が弾くが、`as never` 等で型を回避した場合の防衛線
    expect(isSimpleParameterObject({ a: () => 42 } as never)).toBe(false);
    expect(isSimpleParameterObject({ a: { nested: 1 } } as never)).toBe(false);
    expect(isSimpleParameterObject({ a: [1, 2, 3] } as never)).toBe(false);
    expect(isSimpleParameterObject({ a: undefined } as never)).toBe(false);
    // 全 value が raw scalar なら true
    expect(isSimpleParameterObject({ a: 1, b: 'x', c: true, d: null })).toBe(true);
  });
});
