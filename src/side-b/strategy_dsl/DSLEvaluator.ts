/**
 * DSL 条件を LensFeatureSnapshot 上で評価する（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.2
 *
 * PR #116b: `Condition.params` (動的 indicator パラメータ) と
 * `Condition.compareTarget` (indicator operand 比較) に対応。
 * - params 付き leaf は snapshot から `feature(stable_params)` 形式の key で lookup
 * - compareTarget 付き leaf は right operand を別 indicator series から取得
 */

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
  /** 条件グループを再帰的に評価 */
  evaluateConditions(
    group: ConditionGroup,
    snapshot: LensFeatureSnapshot,
    paramValues: Record<string, number>,
  ): boolean {
    const results = group.conditions.map((c) =>
      'logic' in c
        ? this.evaluateConditions(c, snapshot, paramValues)
        : this.evaluateLeaf(c, snapshot, paramValues),
    );
    return group.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
  }

  private evaluateLeaf(c: Condition, snapshot: LensFeatureSnapshot, paramValues: Record<string, number>): boolean {
    const left = this.lookupOperand(c.lens, c.feature, c.params, snapshot);
    if (left === null) return false;

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

    return this.compare(left, c.op, right);
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

  private compare(
    left: number | string | boolean,
    op: Condition['op'],
    right: EvaluatorOperand,
  ): boolean {
    switch (op) {
      case '==':
        return left === right;
      case '!=':
        return left !== right;
      case '<':
        return Number(left) < Number(right);
      case '<=':
        return Number(left) <= Number(right);
      case '>':
        return Number(left) > Number(right);
      case '>=':
        return Number(left) >= Number(right);
      case 'between': {
        if (
          !Array.isArray(right) ||
          right.length !== 2 ||
          typeof right[0] !== 'number' ||
          typeof right[1] !== 'number'
        ) {
          return false;
        }
        const n = Number(left);
        return n >= right[0] && n <= right[1];
      }
      case 'in': {
        if (!Array.isArray(right)) return false;
        return right.includes(left) || right.map(String).includes(String(left));
      }
      default:
        return false;
    }
  }
}
