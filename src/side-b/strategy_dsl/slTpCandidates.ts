/**
 * 進化ループ再設計 Phase 2: 親 DSL の現在 SL/TP 値から ±N% の候補リストを生成する。
 *
 * /v1/optimize（Phase 1b）の slValues / tpValues に渡す探索候補を、インジ期間 variant と
 * 同じ「現在値 ±pct を対称点で振る」決定論ロジックで作る。SL/TP は浮動小数なので整数化せず
 * 小数 2 桁に丸める。swing_point の SL（value を持たない）は候補なし。
 */

import { defaultParameterValues } from './dslParameterUtils';
import type { StrategyDSL } from './schema';

export interface SlTpCandidateOptions {
  /** 現在値からの相対振れ幅。既定 0.20（±20%）。 */
  pct?: number;
  /** 探索点数（奇数に正規化、current を中央に含む）。既定 3。 */
  points?: number;
}

export interface SlTpCandidates {
  slValues: number[];
  tpValues: number[];
}

const DEFAULT_PCT = 0.2;
const DEFAULT_POINTS = 3;

/** points を 1 以上の奇数に正規化（current を中央点に含めるため）。非 finite は既定にフォールバック。 */
function normalizePoints(points: number): number {
  if (!Number.isFinite(points)) return DEFAULT_POINTS;
  const n = Math.max(1, Math.floor(points));
  return n % 2 === 0 ? n + 1 : n;
}

/** pct を有限かつ 0 以上にクランプ（NaN/Infinity/負値による Infinity 混入・反転レンジを防ぐ）。 */
function normalizePct(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0) return DEFAULT_PCT;
  return pct;
}

/** number | ParamRef('$x') を resolvedParams で解決。数値でなければ null。 */
function resolveNumeric(
  raw: number | string,
  resolvedParams: Record<string, number>,
): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.startsWith('$')) {
    const v = resolvedParams[raw.substring(1)];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return null;
}

/** current ±pct の対称候補（小数 2 桁・正・重複排除・current 必ず含む）。 */
function buildFloatCandidates(current: number, pct: number, points: number): number[] {
  if (current <= 0) return [];
  const half = (normalizePoints(points) - 1) / 2;
  const factors: number[] = [];
  if (half <= 0) {
    factors.push(1);
  } else {
    for (let i = -half; i <= half; i += 1) factors.push(1 + (pct * i) / half);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const f of factors) {
    const v = Math.round(current * f * 100) / 100;
    if (v > 0 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * 親 DSL の SL/TP 現在値から探索候補を生成する。
 *
 * - stopLoss: atr_multiple / fixed_pips のみ value を持つ → 候補生成。swing_point は空。
 * - takeProfit: rr_ratio / atr_multiple / fixed_pips いずれも value あり → 候補生成。
 * - 候補が 1 点（= 現在値のみ）になる場合はそのまま 1 件（最適化はスキップ相当）。
 */
export function slTpCandidatesFromDsl(
  dsl: StrategyDSL,
  options: SlTpCandidateOptions = {},
): SlTpCandidates {
  const pct = normalizePct(options.pct ?? DEFAULT_PCT);
  const points = options.points ?? DEFAULT_POINTS;
  const resolved = defaultParameterValues(dsl);

  let slValues: number[] = [];
  if (dsl.stopLoss.type === 'atr_multiple' || dsl.stopLoss.type === 'fixed_pips') {
    const cur = resolveNumeric(dsl.stopLoss.value, resolved);
    if (cur !== null) slValues = buildFloatCandidates(cur, pct, points);
  }

  let tpValues: number[] = [];
  if (
    dsl.takeProfit.type === 'rr_ratio' ||
    dsl.takeProfit.type === 'atr_multiple' ||
    dsl.takeProfit.type === 'fixed_pips'
  ) {
    const cur = resolveNumeric(dsl.takeProfit.value, resolved);
    if (cur !== null) tpValues = buildFloatCandidates(cur, pct, points);
  }

  return { slValues, tpValues };
}
