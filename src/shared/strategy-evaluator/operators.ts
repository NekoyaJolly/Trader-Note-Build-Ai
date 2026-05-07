/**
 * 共通比較演算子ライブラリ (Side-A / Side-B 両方が使う、PR #post-122)。
 *
 * Side-A `strategyConditionEvaluator` の `compareValues` を純粋関数として抽出。
 * Side-B `DSLEvaluator` も同じロジックを使うことで、Side-A / Side-B 間の
 * **評価結果の同一性** を保証する (= drift 防止)。
 *
 * クロス系 (`cross_above` / `cross_below`) と Touch 系 (`Touch` / `touch`) は
 * **前バー値** (prevLeft / prevRight) を必要とする。呼び出し側で前バー snapshot を
 * 取得して渡すこと。前バー値が無い場合は false (= 状態遷移が判定できない先頭バー)。
 *
 * `touch_close`: 終値タッチ (= 値の一致 / 近接のみ、クロスは cross_* に任せる)。
 * `touch_wick`: ヒゲタッチ (= 別途 high/low データが必要、本関数では扱わず呼び出し側で判定)。
 *   `touch_wick` はバーの high-low レンジに左辺値が入っているか判定するため、
 *   compareValues の入力に含まれない別経路 (呼び出し側で `bar.low <= left && left <= bar.high`)。
 */

/**
 * 共通比較演算子。
 *
 * Side-A 既存の表記 (`GC` / `DC` / `Touch` / `touch`) も後方互換で受け付ける
 * (= compareValues 内で正規化)。Side-B 新コードは `cross_above` / `cross_below` /
 * `touch_close` / `touch_wick` を使うことを推奨。
 *
 * `is_true` / `is_false` は boolean 値 (= pattern 判定 等) のための専用 op。
 * left は Boolean に評価される値 (= number / boolean / 0/1)、right は無視。
 */
export type ComparisonOperator =
  | '<'
  | '<='
  | '='
  | '=='
  | '!='
  | '>='
  | '>'
  | 'between'
  | 'in'
  | 'cross_above'
  | 'cross_below'
  | 'touch_close'
  | 'touch_wick'
  | 'is_true'
  | 'is_false'
  // Side-A 後方互換 (UI / 旧戦略保存形式)
  | 'GC'
  | 'DC'
  | 'Touch'
  | 'touch';

const TOUCH_EPSILON = 1e-6;

/**
 * 単一比較 leaf の真偽を返す純粋関数。型不整合 / null / 失敗時は false。
 *
 * @param left 左辺値 (= 評価対象の indicator 値、価格、boolean 等)
 * @param right 右辺値 (= 比較対象、固定値 / 別 indicator / 価格)
 * @param op 比較演算子
 * @param prevLeft 前バーの左辺値 (= cross / touch 判定用、無ければ undefined)
 * @param prevRight 前バーの右辺値 (= cross / touch 判定用、無ければ undefined)
 */
export function compareValues(
  left: number | string | boolean | null | undefined,
  right: number | string | boolean | Array<number | string | boolean> | null | undefined,
  op: ComparisonOperator,
  prevLeft?: number,
  prevRight?: number,
): boolean {
  // Side-A 後方互換: UI / 保存形式の別名を正規化
  const normalized: ComparisonOperator =
    op === 'GC' ? 'cross_above' : op === 'DC' ? 'cross_below' : op;

  // is_true / is_false は left を Boolean 評価
  if (normalized === 'is_true') {
    return Boolean(left);
  }
  if (normalized === 'is_false') {
    return !left;
  }

  // 入力検証
  if (left === null || left === undefined) return false;

  // strict equality
  if (normalized === '==' || normalized === '=') {
    if (right === null || right === undefined) return false;
    if (typeof left === 'number' && typeof right === 'number') {
      // 数値同等は誤差許容 (= Side-A の `=` 挙動と整合)
      return Math.abs(left - right) < 0.0001;
    }
    return left === right;
  }
  if (normalized === '!=') {
    return left !== right;
  }

  // between: right は [low, high] tuple
  if (normalized === 'between') {
    if (!Array.isArray(right) || right.length !== 2) return false;
    const [lo, hi] = right;
    if (typeof lo !== 'number' || typeof hi !== 'number') return false;
    const n = Number(left);
    if (!Number.isFinite(n)) return false;
    return n >= lo && n <= hi;
  }

  // in: right は配列、left の包含判定
  if (normalized === 'in') {
    if (!Array.isArray(right)) return false;
    if (right.includes(left)) return true;
    return right.map(String).includes(String(left));
  }

  // touch_wick は呼び出し側で判定すべき (high-low レンジ要)。本関数では false 返し
  if (normalized === 'touch_wick') {
    return false;
  }

  // touch_close: 終値タッチ (値の一致 / 近接のみ)
  if (normalized === 'touch_close') {
    if (typeof left !== 'number' || typeof right !== 'number') return false;
    return Math.abs(left - right) <= TOUCH_EPSILON;
  }

  // Touch / touch (Side-A 後方互換): 「近接 (許容誤差内) または同一足で接触/反転」
  if (normalized === 'Touch' || normalized === 'touch') {
    if (typeof left !== 'number' || typeof right !== 'number') return false;
    if (Math.abs(left - right) <= TOUCH_EPSILON) return true;
    if (prevLeft === undefined || prevRight === undefined) return false;
    const prevDiff = prevLeft - prevRight;
    const currDiff = left - right;
    return (
      prevDiff === 0 ||
      currDiff === 0 ||
      (prevDiff > 0 && currDiff < 0) ||
      (prevDiff < 0 && currDiff > 0)
    );
  }

  // cross_above: 前回は下、今回は上
  if (normalized === 'cross_above') {
    if (typeof left !== 'number' || typeof right !== 'number') return false;
    if (prevLeft === undefined || prevRight === undefined) return false;
    return prevLeft < prevRight && left > right;
  }

  // cross_below: 前回は上、今回は下
  if (normalized === 'cross_below') {
    if (typeof left !== 'number' || typeof right !== 'number') return false;
    if (prevLeft === undefined || prevRight === undefined) return false;
    return prevLeft > prevRight && left < right;
  }

  // 数値比較系 (<, <=, >, >=)
  if (
    normalized === '<' ||
    normalized === '<=' ||
    normalized === '>' ||
    normalized === '>='
  ) {
    const ln = Number(left);
    const rn = Number(right);
    if (!Number.isFinite(ln) || !Number.isFinite(rn)) return false;
    switch (normalized) {
      case '<':
        return ln < rn;
      case '<=':
        return ln <= rn;
      case '>':
        return ln > rn;
      case '>=':
        return ln >= rn;
    }
  }

  return false;
}

/**
 * touch_wick 判定 (= 当該バーの high-low レンジに左辺値が入るか)。
 * `compareValues` 本体では扱えないため、呼び出し側がバー情報を渡して使う。
 */
export function isWithinBarRange(
  leftValue: number,
  bar: { high: number; low: number },
): boolean {
  return bar.low <= leftValue && leftValue <= bar.high;
}

/**
 * 演算子が前バー値 (prevLeft / prevRight) を必要とするかを判定。
 * 呼び出し側で「前バー snapshot を取得すべきか」の判定に使う (= 計算コスト最適化)。
 */
export function operatorNeedsPreviousValues(op: ComparisonOperator): boolean {
  const normalized: ComparisonOperator =
    op === 'GC' ? 'cross_above' : op === 'DC' ? 'cross_below' : op;
  return (
    normalized === 'cross_above' ||
    normalized === 'cross_below' ||
    normalized === 'Touch' ||
    normalized === 'touch'
  );
}
