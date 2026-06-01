/**
 * 進化ループ再設計 Phase 1c: インジケーター期間の variant DSL 生成（決定論）。
 *
 * 設計背景（docs/diagnostics/evolution_loop_redesign_plan_2026-06-02.html）:
 * - インジの期間は DSL condition の `params`（`{ period: 14 }` 等）に住む = **構造的**。
 *   period を振ると snapshot key（`lens.feature(stable_params)`）が変わり、条件評価器が
 *   引く series も変わる。よって backtesting.py の `optimize()`（スカラー class 属性 sweep）
 *   では扱えず、**variant DSL を生成して 1 つずつ BT** する経路が必要。
 * - 本モジュールはその variant 生成のみを担う **純粋・決定論** 関数。LLM は使わない
 *   （AGENTS.md ドメイン原則#3: 数値最適化は決定論コードで）。評価（BT/WF）と
 *   ベスト選択は optimizeIndicatorPeriods.ts が担当する。
 *
 * 探索空間:
 * - 各 period 系 param（INTEGER_PARAM_KEYS）を現在値 ±pct（既定 0.20）で振る。
 * - 型に応じた整数刻み + registry の minPeriod/maxPeriod でクランプ + 重複排除。
 * - 全軸の直積を取り、総組合せが maxCombos（既定 24）を超えたら **決定論的に間引く**
 *   （base = 全 current 値の組合せは必ず残す）。silent な打ち切りは避け、結果に
 *   truncated / totalCombos を載せて呼び出し側がログできるようにする。
 */

import { getIndicatorRegistryEntry } from '../../shared/indicators/registry';
import {
  INTEGER_PARAM_KEYS,
  type Condition,
  type ConditionGroup,
  type StrategyDSL,
} from './schema';

/** variant 生成オプション（すべて呼び出し側で上書き可、既定は Phase 1c 推奨値）。 */
export interface IndicatorVariantOptions {
  /** 現在値からの相対振れ幅。既定 0.20（±20%）。 */
  pct?: number;
  /**
   * 1 軸あたりの探索点数（3 = 下/現/上、5 = ±pct を半分刻み）。既定 3。
   * 現在値を必ず中央点に含めるため内部で **奇数に正規化**する（偶数指定は +1）。
   */
  pointsPerAxis?: number;
  /** 総組合せ数の上限（必須のコスト上限）。既定 24。1 未満は 1 にクランプ。 */
  maxCombos?: number;
}

/** 1 つの最適化軸（= ある condition の ある period param）。 */
interface VariantAxis {
  /** entry trigger group ルートからの index 経路。 */
  path: number[];
  /** params が condition 本体側か compareTarget 側か。 */
  target: 'self' | 'compareTarget';
  paramKey: string;
  indicatorId: string;
  current: number;
  candidates: number[];
}

export interface IndicatorVariantResult {
  /** 生成された variant DSL 群（先頭は必ず base = 無改変）。 */
  variants: StrategyDSL[];
  /** 見つかった最適化軸の数。 */
  axisCount: number;
  /** 間引き前の全直積サイズ（base 含む）。 */
  totalCombos: number;
  /** maxCombos 超過で間引いたか。 */
  truncated: boolean;
  /** 実際に返した variant 数。 */
  returnedCount: number;
}

const DEFAULT_PCT = 0.2;
const DEFAULT_POINTS = 3;
const DEFAULT_MAX_COMBOS = 24;

/** points を 1 以上の奇数に正規化（current を中央点に含めるため）。偶数指定は +1。 */
function normalizePoints(points: number): number {
  const n = Math.max(1, Math.floor(points));
  return n % 2 === 0 ? n + 1 : n;
}

/** entry（immediate / wait_for_trigger）から trigger ConditionGroup を取り出す。 */
function entryTriggerGroup(entry: StrategyDSL['entry']): ConditionGroup {
  return 'type' in entry && entry.type === 'wait_for_trigger'
    ? entry.triggerConditions
    : (entry as { trigger: ConditionGroup }).trigger;
}

/** period param の候補値リストを生成（整数・正・クランプ・重複排除）。current を必ず含む。 */
function buildCandidates(
  current: number,
  indicatorId: string,
  pct: number,
  points: number,
): number[] {
  const entry = getIndicatorRegistryEntry(indicatorId);
  const minP = entry?.paramConstraints.minPeriod ?? 1;
  const maxP = entry?.paramConstraints.maxPeriod ?? Number.MAX_SAFE_INTEGER;

  // points は奇数前提（呼び出し側で正規化済み）。中央 i=0 が factor 1 = current なので
  // current は常に候補に含まれる（base variant 成立の前提）。
  // 例 points=3 → [1-pct, 1, 1+pct]、points=5 → [1-pct, 1-pct/2, 1, 1+pct/2, 1+pct]。
  const half = (points - 1) / 2;
  const factors: number[] = [];
  if (half <= 0) {
    factors.push(1);
  } else {
    for (let i = -half; i <= half; i += 1) {
      factors.push(1 + (pct * i) / half);
    }
  }

  const seen = new Set<number>();
  const out: number[] = [];
  for (const f of factors) {
    let v = Math.round(current * f);
    if (v < minP) v = minP;
    if (v > maxP) v = maxP;
    if (v >= 1 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

/** condition 1 つから period 系の軸を収集（self.params と compareTarget.params）。 */
function collectAxesFromCondition(
  cond: Condition,
  path: number[],
  pct: number,
  points: number,
  acc: VariantAxis[],
): void {
  const scan = (
    params: Record<string, number> | undefined,
    indicatorId: string,
    target: 'self' | 'compareTarget',
  ): void => {
    if (!params) return;
    // ohlcv lens のインジのみ対象（registry に存在するもの）。
    if (!getIndicatorRegistryEntry(indicatorId)) return;
    for (const [key, value] of Object.entries(params)) {
      if (!INTEGER_PARAM_KEYS.has(key)) continue;
      if (!Number.isFinite(value) || value <= 0) continue;
      const candidates = buildCandidates(value, indicatorId, pct, points);
      // 候補が現在値の 1 点しかない軸は探索意味がないので除外。
      if (candidates.length < 2) continue;
      acc.push({ path, target, paramKey: key, indicatorId, current: value, candidates });
    }
  };

  if (cond.lens === 'ohlcv') {
    scan(cond.params, cond.feature, 'self');
  }
  if (cond.compareTarget && cond.compareTarget.lens === 'ohlcv') {
    scan(cond.compareTarget.params, cond.compareTarget.feature, 'compareTarget');
  }
}

/** trigger group を walk して全軸を収集。path は group.conditions の index 経路。 */
function collectAxes(
  group: ConditionGroup,
  prefix: number[],
  pct: number,
  points: number,
  acc: VariantAxis[],
): void {
  group.conditions.forEach((c, i) => {
    const path = [...prefix, i];
    if ('logic' in c) {
      collectAxes(c, path, pct, points, acc);
    } else {
      collectAxesFromCondition(c, path, pct, points, acc);
    }
  });
}

/** path に沿って ConditionGroup を辿り、対象 Condition の params に値を適用する。 */
function applyAxisValue(group: ConditionGroup, axis: VariantAxis, value: number): void {
  let node: ConditionGroup | Condition = group;
  for (const idx of axis.path) {
    if (!('logic' in node)) return; // path 不整合（通常起きない）
    node = node.conditions[idx];
  }
  if ('logic' in node) return;
  const params =
    axis.target === 'self' ? node.params : node.compareTarget?.params;
  if (params) params[axis.paramKey] = value;
}

/**
 * 直積インデックスを生成。combos が maxCombos 以下なら全件、超過時は base（全 current）を
 * 必ず含めつつ均等ストライドで決定論的に間引く。
 */
function selectComboIndices(
  baseFlatIndex: number,
  total: number,
  maxCombos: number,
): number[] {
  if (total <= maxCombos) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const picked = new Set<number>([baseFlatIndex]);
  // base を除いた席数を均等ストライドで埋める。
  const slots = maxCombos - 1;
  if (slots > 0) {
    const stride = total / slots;
    for (let s = 0; s < slots; s += 1) {
      const idx = Math.min(total - 1, Math.floor(s * stride));
      picked.add(idx);
    }
  }
  return Array.from(picked).sort((a, b) => a - b).slice(0, maxCombos);
}

/** flat index → 各軸の候補 index 配列（mixed-radix デコード）。 */
function decodeCombo(flatIndex: number, candidateCounts: number[]): number[] {
  const out: number[] = candidateCounts.map(() => 0);
  let rem = flatIndex;
  for (let a = candidateCounts.length - 1; a >= 0; a -= 1) {
    const count = candidateCounts[a];
    out[a] = rem % count;
    rem = Math.floor(rem / count);
  }
  return out;
}

/**
 * インジケーター期間の variant DSL 群を決定論的に生成する。
 *
 * 戻り値 `variants[0]` は base（無改変）。axisCount=0（period 系 param が無い戦略）なら
 * variants は base 1 件のみ。
 */
export function generateIndicatorPeriodVariants(
  dsl: StrategyDSL,
  options: IndicatorVariantOptions = {},
): IndicatorVariantResult {
  const pct = options.pct ?? DEFAULT_PCT;
  const points = normalizePoints(options.pointsPerAxis ?? DEFAULT_POINTS);
  const maxCombos = Math.max(1, Math.floor(options.maxCombos ?? DEFAULT_MAX_COMBOS));

  const baseGroup = entryTriggerGroup(dsl.entry);
  const axes: VariantAxis[] = [];
  collectAxes(baseGroup, [], pct, points, axes);

  if (axes.length === 0) {
    return {
      variants: [structuredClone(dsl)],
      axisCount: 0,
      totalCombos: 1,
      truncated: false,
      returnedCount: 1,
    };
  }

  const candidateCounts = axes.map((a) => a.candidates.length);
  const total = candidateCounts.reduce((acc, n) => acc * n, 1);

  // base（全 current）の flat index を算出。
  const baseChoice = axes.map((a) => a.candidates.indexOf(a.current));
  let baseFlat = 0;
  for (let a = 0; a < axes.length; a += 1) {
    const choice = baseChoice[a] >= 0 ? baseChoice[a] : 0;
    baseFlat = baseFlat * candidateCounts[a] + choice;
  }

  const indices = selectComboIndices(baseFlat, total, maxCombos);
  // base を先頭に並べ替え（呼び出し側が「無改変」を起点に扱えるように）。
  indices.sort((x, y) => (x === baseFlat ? -1 : y === baseFlat ? 1 : x - y));

  const variants: StrategyDSL[] = indices.map((flat) => {
    const choices = decodeCombo(flat, candidateCounts);
    const variant = structuredClone(dsl);
    const group = entryTriggerGroup(variant.entry);
    axes.forEach((axis, a) => {
      applyAxisValue(group, axis, axis.candidates[choices[a]]);
    });
    return variant;
  });

  return {
    variants,
    axisCount: axes.length,
    totalCombos: total,
    truncated: total > maxCombos,
    returnedCount: variants.length,
  };
}
