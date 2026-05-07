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
import { normalizeTimeframe } from '../../shared/timeframes';
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
    const left = this.lookupOperand(c.lens, c.feature, c.params, snapshot, c.timeframe);
    if (left === null) return false;

    // is_true / is_false は left の Boolean 評価のみ、right 不要
    if (c.op === 'is_true' || c.op === 'is_false') {
      return compareValues(left, undefined, c.op);
    }

    let right: EvaluatorOperand | undefined;
    if (c.compareTarget) {
      // PR #116b: compareTarget は別 indicator series を operand にする (例: close > ema(20))
      // PR ⑤B (MTF): compareTarget.timeframe (= operand 個別 timeframe) があればそれ、
      //   無ければ親 condition の timeframe を継承して lookup
      const targetTf = c.compareTarget.timeframe ?? c.timeframe;
      const target = this.lookupOperand(
        c.compareTarget.lens,
        c.compareTarget.feature,
        c.compareTarget.params,
        snapshot,
        targetTf,
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
    // PR ⑤B (MTF): 上位足 leaf の touch_wick も「その timeframe の high/low」で判定する
    //   (= ohlcv@1h.close が ohlcv@1h.high/low の範囲内かを見る)
    if (c.op === 'touch_wick') {
      if (typeof left !== 'number') return false;
      const high = this.lookupOperand('ohlcv', 'high', undefined, snapshot, c.timeframe);
      const low = this.lookupOperand('ohlcv', 'low', undefined, snapshot, c.timeframe);
      if (typeof high !== 'number' || typeof low !== 'number') return false;
      return isWithinBarRange(left, { high, low });
    }

    // PR ①-B: cross 系は前バー値も取得
    // PR ⑤B (MTF): 前バーも同じ timeframe で lookup
    let prevLeft: number | undefined;
    let prevRight: number | undefined;
    if (prevSnapshot && (c.op === 'cross_above' || c.op === 'cross_below')) {
      const pl = this.lookupOperand(c.lens, c.feature, c.params, prevSnapshot, c.timeframe);
      if (typeof pl === 'number') prevLeft = pl;
      if (c.compareTarget) {
        const targetTf = c.compareTarget.timeframe ?? c.timeframe;
        const pr = this.lookupOperand(
          c.compareTarget.lens,
          c.compareTarget.feature,
          c.compareTarget.params,
          prevSnapshot,
          targetTf,
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
   * - params なし or 空: `lf.features[feature]` で lookup (例: `'rsi'`)
   * - params あり: `feature(stable_params)` で lookup (例: `'ema(period=20)'`)
   * - PR ⑤B (MTF): `timeframe` 指定があり主 timeframe (= snapshot.primaryTimeframe)
   *   と異なる場合は **上位足 lens key** (`'ohlcv@1h'` 等) で snapshot.features
   *   を引く。一致 / 未指定なら従来の `lens` key で引く (= 後方互換)。
   *
   * 値が見つからない / 数値・文字列・boolean 以外の場合は null。
   */
  private lookupOperand(
    lens: string,
    feature: string,
    params: IndicatorOperand['params'],
    snapshot: LensFeatureSnapshot,
    timeframe?: string,
  ): number | string | boolean | null {
    const lensKey = this.resolveLensKey(lens, timeframe, snapshot.primaryTimeframe);
    const lf = snapshot.features.get(lensKey);
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
   * PR ⑤B (MTF): condition.timeframe / operand.timeframe を解釈して、snapshot.features
   * から引く lens key を返す。
   *
   * - timeframe 未指定 → `lens` (= 主 timeframe 扱い、後方互換)
   * - timeframe が未知 (canonical 化不能) → `lens` (= 後方互換、leaf は false 評価)
   * - PR #130 Copilot review #1: snapshot.primaryTimeframe が未設定 →
   *   **timeframe を無視して `lens`** を返す (= MTF 非対応経路で leaf が常に false に
   *   ならないように後方互換を優先)。`@<tf>` は MTF 経路でのみ意味を持つため、
   *   primaryTimeframe を知らない経路 (= 旧テスト fixture / 単独 evaluator 利用) では
   *   主 timeframe 扱いに倒す。
   * - timeframe = 主 timeframe (canonical 一致) → `lens` (= 接尾なし)
   * - timeframe ≠ 主 timeframe → `${lens}@${canonical}` (例: `ohlcv@1h`)
   */
  private resolveLensKey(
    lens: string,
    timeframe: string | undefined,
    primaryTimeframe: string | undefined,
  ): string {
    if (!timeframe) return lens;
    const ct = normalizeTimeframe(timeframe);
    if (ct === null) return lens;
    if (!primaryTimeframe) return lens;
    const cp = normalizeTimeframe(primaryTimeframe);
    if (cp === null || ct === cp) return lens;
    return `${lens}@${ct}`;
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
