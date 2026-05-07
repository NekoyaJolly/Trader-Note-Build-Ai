/**
 * DSL 条件を LensFeatureSnapshot 上で評価する（Phase 5）
 *
 * @see docs/design/archive/phase_5_specification.md §4.2
 *
 * PR #116b: `Condition.params` (動的 indicator パラメータ) と
 * `Condition.compareTarget` (indicator operand 比較) に対応。
 * - params 付き leaf は snapshot から `feature(stable_params)` 形式の key で lookup
 * - compareTarget 付き leaf は right operand を別 indicator series から取得
 *
 * PR ①-B (post-Phase 5A): cross_above / cross_below / touch_close / touch_wick /
 * is_true / is_false に対応。比較ロジックは `src/shared/strategy-evaluator/operators`
 * の `compareValues` に委譲し、Side-A `strategyConditionEvaluator` と評価結果が
 * **必ず一致** する (= drift 防止)。状態遷移系 (cross / Touch) のため、
 * `evaluateConditions` に **`prevSnapshot`** (= 前バーの LensFeatureSnapshot) を
 * 任意引数で受け取れるようにした。
 */

import { compareValues, isWithinBarRange } from '../../shared/strategy-evaluator/operators';
import type { LensFeatureSnapshot } from '../lenses/types';
import type { ConditionGroup, Condition, ConditionValue, IndicatorOperand } from './schema';
import { formatStableParams } from './snapshotKey';

/**
 * Evaluator が扱う operand の concrete 型。
 * `compare` の left / right に入る値の許容形を明示し、unknown を使わない。
 *
 * - `number | string | boolean`: scalar (snapshot から取り出した feature 値、
 *   ParamRef を解決した数値、literal value)
 * - `(number | string | boolean)[]`: between/in 用の配列 (resolveParam で recursive map)
 */
type EvaluatorOperand =
  | number
  | string
  | boolean
  | Array<number | string | boolean>;

/** 条件評価 */
export class DSLEvaluator {
  /**
   * 条件グループを再帰的に評価。
   *
   * PR ①-B: `prevSnapshot` 任意引数を追加。cross / Touch 系 op の判定で前バー値が
   * 必要なため、呼び出し側で前バー snapshot を構築して渡す。未指定なら状態遷移
   * 判定不能 → 該当 leaf は false (= 先頭バー扱い)。
   */
  evaluateConditions(
    group: ConditionGroup,
    snapshot: LensFeatureSnapshot,
    paramValues: Record<string, number>,
    prevSnapshot?: LensFeatureSnapshot,
  ): boolean {
    const results = group.conditions.map((c) =>
      'logic' in c
        ? this.evaluateConditions(c, snapshot, paramValues, prevSnapshot)
        : this.evaluateLeaf(c, snapshot, paramValues, prevSnapshot),
    );
    return group.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
  }

  private evaluateLeaf(
    c: Condition,
    snapshot: LensFeatureSnapshot,
    paramValues: Record<string, number>,
    prevSnapshot?: LensFeatureSnapshot,
  ): boolean {
    const left = this.lookupOperand(c.lens, c.feature, c.params, snapshot);
    if (left === null) return false;

    // is_true / is_false は left の Boolean 評価のみ、right 不要
    if (c.op === 'is_true' || c.op === 'is_false') {
      return compareValues(left, undefined, c.op);
    }

    let right: EvaluatorOperand | undefined;
    if (c.compareTarget) {
      // PR #116b: compareTarget は別 indicator series を operand にする (例: close > ema(20))
      const target = this.lookupOperand(
        c.compareTarget.lens,
        c.compareTarget.feature,
        c.compareTarget.params,
        snapshot,
      );
      if (target === null) return false;
      right = target;
    } else if (c.value !== undefined) {
      // 従来経路: value (literal / ParamRef / range / set)
      right = this.resolveParam(c.value, paramValues);
    } else {
      return false;
    }

    // PR ①-B: touch_wick は呼び出し側で「左辺値が現バーの high-low レンジ内か」判定
    if (c.op === 'touch_wick') {
      if (typeof left !== 'number') return false;
      const high = this.lookupOperand('ohlcv', 'high', undefined, snapshot);
      const low = this.lookupOperand('ohlcv', 'low', undefined, snapshot);
      if (typeof high !== 'number' || typeof low !== 'number') return false;
      return isWithinBarRange(left, { high, low });
    }

    // PR ①-B: cross 系は前バー値も取得 (Side-B DSL は Touch/touch を含めず、
    // shared 側の後方互換 alias は Side-A 専用)
    let prevLeft: number | undefined;
    let prevRight: number | undefined;
    if (prevSnapshot && (c.op === 'cross_above' || c.op === 'cross_below')) {
      const pl = this.lookupOperand(c.lens, c.feature, c.params, prevSnapshot);
      if (typeof pl === 'number') prevLeft = pl;
      if (c.compareTarget) {
        const pr = this.lookupOperand(
          c.compareTarget.lens,
          c.compareTarget.feature,
          c.compareTarget.params,
          prevSnapshot,
        );
        if (typeof pr === 'number') prevRight = pr;
      } else if (typeof right === 'number') {
        // 固定値 right は前バーでも同じ
        prevRight = right;
      }
    }

    return compareValues(left, right ?? null, c.op, prevLeft, prevRight);
  }

  /**
   * snapshot から `lens.feature(params)` の値を取り出す。
   *
   * - params なし or 空: 既存挙動と同じく `lf.features[feature]` で lookup (例: `'rsi'`)
   * - params あり: snapshot key の feature 部分 `feature(stable_params)` で lookup
   *   (例: `'ema(period=20)'`)
   *
   * 値が見つからない / 数値・文字列・boolean 以外の場合は null。
   */
  private lookupOperand(
    lens: string,
    feature: string,
    params: IndicatorOperand['params'],
    snapshot: LensFeatureSnapshot,
  ): number | string | boolean | null {
    const lf = snapshot.features.get(lens);
    if (!lf) return null;
    const featureKey =
      params && Object.keys(params).length > 0
        ? `${feature}(${formatStableParams(params)})`
        : feature;
    const raw = lf.features[featureKey];
    if (raw === undefined) return null;
    if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') {
      return raw;
    }
    return null;
  }

  /**
   * パラメーター置換（再帰的にタプル・配列にも対応）。
   *
   * - `value` が `$xxx` 形式の string なら paramValues[xxx] を返す (= number)
   * - 配列なら各要素を再帰的に解決した配列を返す
   * - それ以外はそのまま返す
   */
  resolveParam(
    value: ConditionValue,
    paramValues: Record<string, number>,
  ): EvaluatorOperand {
    if (typeof value === 'string' && value.startsWith('$')) {
      const key = value.slice(1);
      if (!(key in paramValues)) {
        throw new Error(`未定義パラメータ: ${value}`);
      }
      return paramValues[key];
    }
    if (Array.isArray(value)) {
      // value 配列の要素は number | string なので、resolveParam で number/string/boolean が返る
      return value.map((v): number | string | boolean => {
        if (typeof v === 'string' && v.startsWith('$')) {
          const key = v.slice(1);
          if (!(key in paramValues)) {
            throw new Error(`未定義パラメータ: ${v}`);
          }
          return paramValues[key];
        }
        return v;
      });
    }
    return value;
  }
}
