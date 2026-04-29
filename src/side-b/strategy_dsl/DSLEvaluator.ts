/**
 * DSL 条件を LensFeatureSnapshot 上で評価する（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.2
 */

import type { LensFeatureSnapshot } from '../lenses/types';
import type { ConditionGroup, Condition } from './schema';

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
    const lf = snapshot.features.get(c.lens);
    if (!lf) return false;
    const raw = lf.features[c.feature];
    if (raw === undefined) return false;
    const left = typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean' ? raw : null;
    if (left === null) return false;

    const right = this.resolveParam(c.value, paramValues);
    return this.compare(left, c.op, right);
  }

  /** パラメーター置換（再帰的にタプル・配列にも対応） */
  resolveParam(value: unknown, paramValues: Record<string, number>): unknown {
    if (typeof value === 'string' && value.startsWith('$')) {
      const key = value.slice(1);
      if (!(key in paramValues)) {
        throw new Error(`未定義パラメータ: ${value}`);
      }
      return paramValues[key];
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveParam(v, paramValues));
    }
    return value;
  }

  private compare(left: number | string | boolean, op: Condition['op'], right: unknown): boolean {
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
        const r = right as [number, number];
        const n = Number(left);
        return n >= r[0] && n <= r[1];
      }
      case 'in': {
        const arr = right as unknown[];
        return arr.includes(left) || arr.map(String).includes(String(left));
      }
      default:
        return false;
    }
  }
}
