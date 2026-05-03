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
 *   - simple object           → unsupported、warning ログを 1 度だけ出して skip
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
export function valuesForParameterField(key: string, def: StrategyDSL['parameters'][string]): number[] {
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
 * グリッドの総組み合わせ数（カーテシアン積の要素数）
 */
export function countParameterGridCombinations(dsl: StrategyDSL): number {
  const keys = Object.keys(dsl.parameters);
  if (keys.length === 0) return 1;
  let n = 1;
  for (const k of keys) {
    const vals = valuesForParameterField(k, dsl.parameters[k]);
    const c = Math.max(1, vals.length);
    n *= c;
  }
  return n;
}

/**
 * 全パラメータの組み合わせ列挙。件数は MAX 超で例外。
 */
export function enumerateParameterGrid(dsl: StrategyDSL): Array<Record<string, number>> {
  const c = countParameterGridCombinations(dsl);
  if (c > MAX_PARAMETER_GRID_COMBINATIONS) {
    throw new Error(
      `パラメータグリッドが ${c} 通り（上限 ${MAX_PARAMETER_GRID_COMBINATIONS} 超）`,
    );
  }
  const keys = Object.keys(dsl.parameters);
  if (keys.length === 0) {
    return [{}];
  }
  const valueLists = keys.map((k) => valuesForParameterField(k, dsl.parameters[k]));

  const out: Array<Record<string, number>> = [];
  const stack: number[] = new Array(keys.length).fill(0);

  for (;;) {
    const row: Record<string, number> = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      row[k] = valueLists[i][stack[i]]!;
    }
    out.push(row);
    let j = keys.length - 1;
    while (j >= 0) {
      stack[j]++;
      if (stack[j] < valueLists[j].length) break;
      stack[j] = 0;
      j--;
    }
    if (j < 0) break;
  }
  return out;
}
