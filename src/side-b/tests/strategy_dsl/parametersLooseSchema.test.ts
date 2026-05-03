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
  defaultParameterValues,
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
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
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

  it('JSON でない値 (関数 / undefined) は弾かれる', () => {
    // undefined は z.union で全分岐が落ちる
    const r1 = StrategyDSLSchema.safeParse(dslWith({ k: undefined as unknown }));
    expect(r1.success).toBe(false);
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

describe('parameter type guards (4a-parameters)', () => {
  it('isLegacyParameterDef は raw 値を弾く', () => {
    expect(isLegacyParameterDef(0.5 as never)).toBe(false);
    expect(isLegacyParameterDef('foo' as never)).toBe(false);
    expect(isLegacyParameterDef(null as never)).toBe(false);
  });

  it('isParameterRangeV2 は raw 値を弾く', () => {
    expect(isParameterRangeV2(0.5 as never)).toBe(false);
    expect(isParameterRangeV2(null as never)).toBe(false);
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
    expect(isSimpleParameterObject(0.5 as never)).toBe(false);
  });
});
