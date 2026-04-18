/**
 * MachineReadableCondition の評価エンジン（Phase 4a）
 *
 * 設計思想:
 * - LensFeatureSnapshot に対して仮説の条件群を評価する
 * - 全ての条件が AND で成立した場合のみ true
 * - 欠損値（参照先レンズ/特徴量がない）の場合は false（誠実な「不明」）
 * - 副作用なし、決定性あり
 */

import type { MachineReadableCondition } from '../models/edgeHypothesis';
import type { LensFeatureSnapshot } from '../lenses';

/**
 * 1つの条件を LensFeatureSnapshot に対して評価する。
 * 該当レンズや feature が存在しない場合は false。
 */
export function evaluateCondition(
    condition: MachineReadableCondition,
    snapshot: LensFeatureSnapshot,
): boolean {
    const feature = snapshot.features.get(condition.lensName);
    if (!feature) return false;

    const featureValue = feature.features[condition.featureKey];
    if (featureValue === undefined) return false;

    switch (condition.op) {
        case '<': {
            if (typeof featureValue !== 'number' || typeof condition.value !== 'number') return false;
            return featureValue < condition.value;
        }
        case '<=': {
            if (typeof featureValue !== 'number' || typeof condition.value !== 'number') return false;
            return featureValue <= condition.value;
        }
        case '>': {
            if (typeof featureValue !== 'number' || typeof condition.value !== 'number') return false;
            return featureValue > condition.value;
        }
        case '>=': {
            if (typeof featureValue !== 'number' || typeof condition.value !== 'number') return false;
            return featureValue >= condition.value;
        }
        case '==':
            return featureValue === condition.value;
        case '!=':
            return featureValue !== condition.value;
        case 'between': {
            if (
                typeof featureValue !== 'number' ||
                !Array.isArray(condition.value) ||
                condition.value.length !== 2 ||
                typeof condition.value[0] !== 'number' ||
                typeof condition.value[1] !== 'number'
            ) {
                return false;
            }
            const [lo, hi] = condition.value as [number, number];
            return featureValue >= lo && featureValue <= hi;
        }
        case 'in': {
            if (!Array.isArray(condition.value)) return false;
            const arr = condition.value as (string | number | boolean)[];
            return arr.includes(featureValue);
        }
        default:
            return false;
    }
}

/**
 * 条件群が全て成立するか（AND 評価）
 * 条件が空の場合は false（意味のない仮説）
 */
export function evaluateConditions(
    conditions: readonly MachineReadableCondition[],
    snapshot: LensFeatureSnapshot,
): boolean {
    if (conditions.length === 0) return false;
    return conditions.every((c) => evaluateCondition(c, snapshot));
}
