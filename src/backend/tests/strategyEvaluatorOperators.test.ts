/**
 * 共通比較演算子ライブラリのテスト。
 *
 * Side-A `strategyConditionEvaluator` と Side-B `DSLEvaluator` の両方が同じ評価を
 * するために本ライブラリを共有する。drift 防止のため挙動を pin する。
 */

import {
  compareValues,
  isWithinBarRange,
  operatorNeedsPreviousValues,
} from '../../shared/strategy-evaluator/operators';

describe('shared/strategy-evaluator/operators: compareValues', () => {
  describe('基本数値比較 (<, <=, >, >=, ==, !=, =)', () => {
    it('<: 厳密に小さい場合 true', () => {
      expect(compareValues(1, 2, '<')).toBe(true);
      expect(compareValues(2, 2, '<')).toBe(false);
      expect(compareValues(3, 2, '<')).toBe(false);
    });

    it('<=: 等しい / 小さい場合 true', () => {
      expect(compareValues(1, 2, '<=')).toBe(true);
      expect(compareValues(2, 2, '<=')).toBe(true);
      expect(compareValues(3, 2, '<=')).toBe(false);
    });

    it('>: 厳密に大きい場合 true', () => {
      expect(compareValues(3, 2, '>')).toBe(true);
      expect(compareValues(2, 2, '>')).toBe(false);
    });

    it('>=: 等しい / 大きい場合 true', () => {
      expect(compareValues(2, 2, '>=')).toBe(true);
      expect(compareValues(3, 2, '>=')).toBe(true);
      expect(compareValues(1, 2, '>=')).toBe(false);
    });

    it('=: 数値の誤差許容 (Side-A 互換)', () => {
      expect(compareValues(1.0, 1.0, '=')).toBe(true);
      expect(compareValues(1.0, 1.00005, '=')).toBe(true);
      expect(compareValues(1.0, 1.001, '=')).toBe(false);
    });

    it('==: strict equality (string でも動く)', () => {
      expect(compareValues('foo', 'foo', '==')).toBe(true);
      expect(compareValues('foo', 'bar', '==')).toBe(false);
      expect(compareValues(true, true, '==')).toBe(true);
    });

    it('!=: 不一致で true', () => {
      expect(compareValues(1, 2, '!=')).toBe(true);
      expect(compareValues(1, 1, '!=')).toBe(false);
    });

    it('null / undefined left は false', () => {
      expect(compareValues(null, 1, '>')).toBe(false);
      expect(compareValues(undefined, 1, '>')).toBe(false);
    });
  });

  describe('between / in', () => {
    it('between: tuple [lo, hi] 内なら true', () => {
      expect(compareValues(50, [40, 60], 'between')).toBe(true);
      expect(compareValues(40, [40, 60], 'between')).toBe(true);
      expect(compareValues(60, [40, 60], 'between')).toBe(true);
      expect(compareValues(39, [40, 60], 'between')).toBe(false);
      expect(compareValues(61, [40, 60], 'between')).toBe(false);
    });

    it('between: tuple 不正なら false', () => {
      expect(compareValues(50, 60, 'between')).toBe(false);
      expect(compareValues(50, [40], 'between')).toBe(false);
      expect(compareValues(50, ['a', 'b'], 'between')).toBe(false);
    });

    it('in: 配列に含まれていれば true', () => {
      expect(compareValues('foo', ['foo', 'bar'], 'in')).toBe(true);
      expect(compareValues(1, [1, 2, 3], 'in')).toBe(true);
      expect(compareValues('baz', ['foo', 'bar'], 'in')).toBe(false);
    });

    it('in: 文字列正規化 (Side-A 互換)', () => {
      expect(compareValues(1, ['1', '2'], 'in')).toBe(true);
    });
  });

  describe('cross_above / cross_below (= 状態変化)', () => {
    it('cross_above: 前回 left < right → 今回 left > right で true', () => {
      expect(compareValues(11, 10, 'cross_above', 9, 10)).toBe(true);
    });

    it('cross_above: 前バー値が無いと false (= 先頭バー)', () => {
      expect(compareValues(11, 10, 'cross_above')).toBe(false);
    });

    it('cross_above: 既に上にあるだけでは false (= 状態変化が必要)', () => {
      expect(compareValues(11, 10, 'cross_above', 11, 10)).toBe(false);
    });

    it('cross_below: 前回 left > right → 今回 left < right で true', () => {
      expect(compareValues(9, 10, 'cross_below', 11, 10)).toBe(true);
    });

    it('cross_below: 前バー値無しなら false', () => {
      expect(compareValues(9, 10, 'cross_below')).toBe(false);
    });

    it('GC は cross_above のエイリアス (Side-A 後方互換)', () => {
      expect(compareValues(11, 10, 'GC', 9, 10)).toBe(true);
      expect(compareValues(11, 10, 'GC')).toBe(false);
    });

    it('DC は cross_below のエイリアス', () => {
      expect(compareValues(9, 10, 'DC', 11, 10)).toBe(true);
    });
  });

  describe('touch_close / Touch / touch (= タッチ系)', () => {
    it('touch_close: 値が誤差内で一致 (epsilon=1e-6)', () => {
      expect(compareValues(10.0, 10.0, 'touch_close')).toBe(true);
      expect(compareValues(10.0, 10.0000001, 'touch_close')).toBe(true);
      expect(compareValues(10.0, 10.001, 'touch_close')).toBe(false);
    });

    it('Touch: 同一足で接触または符号反転で true', () => {
      // 前バー: prevLeft > prevRight、今バー: left < right (= 上から下へ)
      expect(compareValues(9, 10, 'Touch', 11, 10)).toBe(true);
      // 前バー: prevLeft < prevRight、今バー: left > right (= 下から上へ)
      expect(compareValues(11, 10, 'Touch', 9, 10)).toBe(true);
    });

    it('Touch: 前バー値無し + 値も誤差外 → false', () => {
      expect(compareValues(9, 10, 'Touch')).toBe(false);
    });

    it('touch_wick: compareValues 本体では false (= 別関数 isWithinBarRange を使う)', () => {
      expect(compareValues(10, 10, 'touch_wick')).toBe(false);
    });
  });

  describe('is_true / is_false (= boolean 評価、pattern 用)', () => {
    it('is_true: truthy なら true', () => {
      expect(compareValues(true, undefined, 'is_true')).toBe(true);
      expect(compareValues(1, undefined, 'is_true')).toBe(true);
      expect(compareValues(false, undefined, 'is_true')).toBe(false);
      expect(compareValues(0, undefined, 'is_true')).toBe(false);
    });

    it('is_false: falsy なら true', () => {
      expect(compareValues(false, undefined, 'is_false')).toBe(true);
      expect(compareValues(0, undefined, 'is_false')).toBe(true);
      expect(compareValues(true, undefined, 'is_false')).toBe(false);
    });
  });
});

describe('shared/strategy-evaluator/operators: isWithinBarRange', () => {
  it('high-low レンジに値が入っていれば true', () => {
    expect(isWithinBarRange(1.05, { high: 1.1, low: 1.0 })).toBe(true);
    expect(isWithinBarRange(1.0, { high: 1.1, low: 1.0 })).toBe(true);
    expect(isWithinBarRange(1.1, { high: 1.1, low: 1.0 })).toBe(true);
  });

  it('レンジ外なら false', () => {
    expect(isWithinBarRange(0.99, { high: 1.1, low: 1.0 })).toBe(false);
    expect(isWithinBarRange(1.11, { high: 1.1, low: 1.0 })).toBe(false);
  });
});

describe('shared/strategy-evaluator/operators: operatorNeedsPreviousValues', () => {
  it('cross / Touch 系は true', () => {
    expect(operatorNeedsPreviousValues('cross_above')).toBe(true);
    expect(operatorNeedsPreviousValues('cross_below')).toBe(true);
    expect(operatorNeedsPreviousValues('Touch')).toBe(true);
    expect(operatorNeedsPreviousValues('touch')).toBe(true);
    expect(operatorNeedsPreviousValues('GC')).toBe(true);
    expect(operatorNeedsPreviousValues('DC')).toBe(true);
  });

  it('単純比較 / touch_close / pattern 系は false', () => {
    expect(operatorNeedsPreviousValues('<')).toBe(false);
    expect(operatorNeedsPreviousValues('>')).toBe(false);
    expect(operatorNeedsPreviousValues('==')).toBe(false);
    expect(operatorNeedsPreviousValues('touch_close')).toBe(false);
    expect(operatorNeedsPreviousValues('touch_wick')).toBe(false);
    expect(operatorNeedsPreviousValues('is_true')).toBe(false);
    expect(operatorNeedsPreviousValues('between')).toBe(false);
  });
});
