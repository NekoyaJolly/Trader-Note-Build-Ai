/**
 * DSL パラメータ既定値の展開とグリッド生成（Phase 5 + 6.7b + Critical-4 4a-parameters）
 *
 * Critical-4 4a-parameters: LLM が出す raw 値 / 浅いオブジェクトも parameters に
 * 入りうるため、structured 以外の形は consumer 側で「単一値として扱う」または
 * 「unsupported として skip」する。Zod の責務は構造のみ、意味はここで吸収する。
 */

import type { StrategyDSL } from './schema';
import {
  isLegacyParameterDef,
  isParameterRangeV2,
  isRawParameterValue,
  isSimpleParameterObject,
} from './types';

/** Phase 6.7b: パラメータ組み合わせの安全上限（設計書既定 500） */
export const MAX_PARAMETER_GRID_COMBINATIONS = 500;

/**
 * 既定値解決:
 *   - legacy / V2 structured  → `.default` を採用
 *   - raw number              → そのまま採用
 *   - raw string/boolean/null → surrogate は数値しか扱わないため skip (warning なし、よくあるパターン)
 *   - simple object           → unsupported、該当キーごとに警告ログを出して skip
 *     (= 1 generation 内で同 DSL が複数キーで該当すれば各キー分ログが出る。
 *      抑制実装はせず、観測しやすい方向に倒す)
 */
export function defaultParameterValues(dsl: StrategyDSL): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, def] of Object.entries(dsl.parameters)) {
    if (isLegacyParameterDef(def)) {
      out[k] = def.default;
    } else if (isParameterRangeV2(def)) {
      out[k] = def.default;
    } else if (isRawParameterValue(def)) {
      if (typeof def === 'number' && Number.isFinite(def)) {
        out[k] = def;
      }
      // 非数値の raw 値は surrogate fitness で利用できないため skip
    } else if (isSimpleParameterObject(def)) {
      // 構造化されていない自由オブジェクトは現状 surrogate に渡せない (legacy/V2 へ正規化する仕組みは将来検討)
      console.warn(
        `[dslParameterUtils] parameters.${k}: 自由オブジェクトは現状サポート外、skip (keys=${Object.keys(def).join(',')})`,
      );
    }
  }
  return out;
}

/**
 * range フィールドに対する離散値列（min〜max、step 刻み）
 *
 * Critical-4 4a-parameters: raw number は単一値、それ以外の raw / object は空配列。
 *   `enumerateParameterGrid` 側で空配列に対しては grid 展開対象外とする扱いに揃える。
 */
export function valuesForParameterField(_key: string, def: StrategyDSL['parameters'][string]): number[] {
  if (isLegacyParameterDef(def)) {
    return [def.default];
  }
  if (isParameterRangeV2(def)) {
    const { min, max, step } = def;
    const useInt = [min, max, step].every((n) => Number.isInteger(n));
    const out: number[] = [];
    for (let x = min; x <= max + 1e-9; x += step) {
      out.push(useInt ? Math.round(x) : x);
    }
    // float 誤差で重複し得るので簡易潰し
    const seen = new Set<number>();
    const uniq: number[] = [];
    for (const v of out) {
      const k2 = Math.round(v * 1e8) / 1e8;
      if (!seen.has(k2)) {
        seen.add(k2);
        uniq.push(v);
      }
    }
    return uniq;
  }
  if (isRawParameterValue(def)) {
    return typeof def === 'number' && Number.isFinite(def) ? [def] : [];
  }
  return [];
}

/**
 * グリッド対象キー (= valuesForParameterField が非空配列を返すキー) のみを抽出する。
 *
 * Critical-4 4a-parameters: raw 非数値 / simple object は valuesForParameterField が
 * 空配列を返すため、grid 展開対象から外す。grid に乗らないキーは
 * `defaultParameterValues` 経由で base に含まれているため、最終的に欠損しない。
 */
function gridSweepKeys(dsl: StrategyDSL): Array<{ key: string; values: number[] }> {
  const out: Array<{ key: string; values: number[] }> = [];
  for (const k of Object.keys(dsl.parameters)) {
    const vals = valuesForParameterField(k, dsl.parameters[k]);
    if (vals.length > 0) {
      out.push({ key: k, values: vals });
    }
  }
  return out;
}

/**
 * グリッドの総組み合わせ数（カーテシアン積の要素数）
 *
 * Critical-4 4a-parameters: 空 valueList のキーは grid 対象外として除外し、
 * 残りキーのカーテシアン積を返す。全キーが除外された場合は 1 (= base のみ)。
 */
export function countParameterGridCombinations(dsl: StrategyDSL): number {
  const sweep = gridSweepKeys(dsl);
  if (sweep.length === 0) return 1;
  let n = 1;
  for (const s of sweep) {
    n *= s.values.length;
  }
  return n;
}

/**
 * 全パラメータの組み合わせ列挙。件数は MAX 超で例外。
 *
 * Critical-4 4a-parameters: grid 対象外キー (raw 非数値 / simple object) は row に含めない。
 * 呼び出し側 (SurrogateFitnessSimulator) は `{ ...base, ...g }` で merge するため、
 * grid 対象外キーは base からの数値既定値で補完される。
 */
export function enumerateParameterGrid(dsl: StrategyDSL): Array<Record<string, number>> {
  const c = countParameterGridCombinations(dsl);
  if (c > MAX_PARAMETER_GRID_COMBINATIONS) {
    throw new Error(
      `パラメータグリッドが ${c} 通り（上限 ${MAX_PARAMETER_GRID_COMBINATIONS} 超）`,
    );
  }
  const sweep = gridSweepKeys(dsl);
  if (sweep.length === 0) {
    return [{}];
  }
  const out: Array<Record<string, number>> = [];
  // `new Array(n).fill(0)` の戻り値は any[] と推論されるため、明示的に number[] を生成する
  const stack: number[] = Array.from({ length: sweep.length }, () => 0);

  for (;;) {
    const row: Record<string, number> = {};
    for (let i = 0; i < sweep.length; i++) {
      row[sweep[i].key] = sweep[i].values[stack[i]]!;
    }
    out.push(row);
    let j = sweep.length - 1;
    while (j >= 0) {
      stack[j]++;
      if (stack[j] < sweep[j].values.length) break;
      stack[j] = 0;
      j--;
    }
    if (j < 0) break;
  }
  return out;
}
