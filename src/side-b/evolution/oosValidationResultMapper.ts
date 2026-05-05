/**
 * OOS / Walk-forward 結果 mapper (Critical-4 PR #105)
 *
 * 設計方針 (docs/design/pr_105_analysis_engine_authority_addendum.md):
 *   - 評価の正本は analysis-engine / Python 側
 *   - Evolution layer 側で Walk Forward / Monte Carlo / Backtest を再実装しない
 *   - 本ファイルの責務は **「analysis-engine の raw 結果を OosValidationResult に正規化する」** だけ
 *
 * やる:
 *   - 型定義 (status / failureReason / metrics / 結果)
 *   - analysis-engine 由来の verdict (passed/failed) を `oos_passed` / `oos_failed` にマッピング
 *   - データ欠損 (metrics null / tradeCount null / engine error) を
 *     `insufficient_oos_data` / `not_evaluated` / `unknown` に分類
 *
 * やらない:
 *   - 独自閾値 (minOosPf / maxOosDrawdown 等) で pass / fail を Evolution 側で再判定
 *   - Walk Forward fold の生成・本格安定性判定 (= analysis-engine 側責務)
 *   - Monte Carlo の実行 (= analysis-engine / Python 側責務)
 *   - metrics の再計算
 *
 * @see docs/design/pr_105_analysis_engine_authority_addendum.md
 */

// =================================================================
// 型定義
// =================================================================

/** OOS / Walk-forward の観測結果 status。 */
export type OosValidationStatus =
  | 'oos_passed'
  | 'oos_failed'
  | 'walk_forward_passed'
  | 'walk_forward_failed'
  | 'insufficient_oos_data'
  | 'not_evaluated'
  | 'unknown';

/** OOS 評価で落ちた理由 (analysis-engine 由来 / データ欠損由来 が混在)。 */
export type OosFailureReason =
  | 'low_oos_pf'
  | 'insufficient_oos_trades'
  | 'high_oos_drawdown'
  | 'oos_expectancy_degraded'
  | 'fold_instability'
  | 'insample_oos_divergence'
  | 'oos_engine_error'
  | 'oos_timeout'
  | 'insufficient_oos_data'
  | 'unknown';

/** OOS metrics (analysis-engine 由来をそのまま運ぶ vehicle、Evolution 側では再計算しない)。 */
export interface OosMetrics {
  pf: number | null;
  tradeCount: number | null;
  maxDrawdown: number | null;
  expectancy: number | null;
  winRate?: number | null;
}

/** in-sample / formal BT と OOS の差分 (oos - baseline)。観測専用、判定には使わない。 */
export interface OosMetricDelta {
  pfDelta: number | null;
  tradeCountDelta: number | null;
  maxDrawdownDelta: number | null;
  expectancyDelta: number | null;
}

/** Walk-forward 1 fold の結果 (analysis-engine から運ばれる、Evolution 側で生成しない)。 */
export interface WalkForwardFold {
  foldIndex: number;
  trainStart: string;
  trainEnd: string;
  oosStart: string;
  oosEnd: string;
  metrics: OosMetrics;
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
}

/** 候補ごとの OOS / Walk-forward 結果 (mapper 出力)。 */
export interface OosValidationResult {
  candidateId: string;
  dslId: string;
  sourceStage?: string;
  route?: string;
  baselineMetrics: OosMetrics | null;
  oosMetrics: OosMetrics | null;
  deltas: OosMetricDelta;
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
  folds: WalkForwardFold[];
  warnings: string[];
}

// =================================================================
// 観測限定の閾値 (analysis-engine 結果が無い場合のデータ欠損判定にだけ使う)
// =================================================================

/**
 * 観測限定の最小値。**OOS の pass/fail 判定には絶対に使わない。**
 *
 * 用途:
 *   - `tradeCount < minOosTrades` を `insufficient_oos_data` の警告として観測する
 *
 * 用途外 (PR #105 Addendum §2 で禁止):
 *   - `minOosPf` / `maxOosDrawdown` で oos_passed / oos_failed を Evolution 側で決める
 *   → analysis-engine の verdict をそのまま使うこと
 */
export const oosObservationThresholdsV1 = {
  minOosTrades: 20,
} as const;

// =================================================================
// 共通 helpers
// =================================================================

function emptyDeltas(): OosMetricDelta {
  return {
    pfDelta: null,
    tradeCountDelta: null,
    maxDrawdownDelta: null,
    expectancyDelta: null,
  };
}

function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null;
  if (typeof b !== 'number' || !Number.isFinite(b)) return null;
  return a - b;
}

/** baseline と oos metrics の差分を計算 (観測専用)。 */
export function buildOosMetricDelta(
  baseline: OosMetrics | null,
  oos: OosMetrics | null,
): OosMetricDelta {
  if (!baseline || !oos) return emptyDeltas();
  return {
    pfDelta: diff(oos.pf, baseline.pf),
    tradeCountDelta: diff(oos.tradeCount, baseline.tradeCount),
    maxDrawdownDelta: diff(oos.maxDrawdown, baseline.maxDrawdown),
    expectancyDelta: diff(oos.expectancy, baseline.expectancy),
  };
}

// =================================================================
// raw → OosValidationResult mapper
// =================================================================

/**
 * analysis-engine の robustness 結果を mapper 経由で受け取るための入力型。
 *
 * - `verdict`: analysis-engine 由来の判定 (= 正本)。**Evolution 側で再判定しない**
 *   - `'passed'` / `'failed'`: OOS 評価が走り、analysis-engine が pass/fail を返した
 *   - `'unknown'`: analysis-engine が判定不能 (例: insufficient data)
 *   - `null` / `undefined`: そもそも analysis-engine 側で判定が無い (= mapper は unknown 扱い)
 * - `failureReasons`: analysis-engine が返した失敗理由 (low_oos_pf / fold_instability 等)
 * - `walkForwardFolds`: analysis-engine が返した fold 単位結果 (Evolution 側では生成しない)
 * - `engineError`: adapter / analysis-engine 呼び出し時の例外メッセージ
 * - `evaluationKind`: `'oos'` (単一 OOS) / `'walk_forward'` (WF folds 集計)
 */
export interface AnalysisEngineRobustnessRawResult {
  candidateId: string;
  dslId: string;
  sourceStage?: string;
  route?: string;
  baselineMetrics: OosMetrics | null;
  oosMetrics: OosMetrics | null;
  verdict?: 'passed' | 'failed' | 'unknown' | null;
  failureReasons?: OosFailureReason[];
  walkForwardFolds?: WalkForwardFold[];
  engineError?: string | null;
  evaluationKind?: 'oos' | 'walk_forward';
  warnings?: string[];
  /** 評価対象として選ばれたが runner 未注入 / 期間ゼロで実施できなかった場合に true。 */
  notEvaluated?: boolean;
  /** OOS 期間が自明境界 (期間ゼロ / 1 日未満) で評価不能な場合に true。 */
  insufficientOosWindow?: boolean;
}

/**
 * raw 結果を `OosValidationResult` に正規化する。
 *
 * 優先順位:
 *   1. `engineError` あり → `unknown` + `oos_engine_error`
 *   2. `notEvaluated` true → `not_evaluated`
 *   3. `insufficientOosWindow` true / metrics 欠損 → `insufficient_oos_data`
 *   4. `verdict` で oos_passed / oos_failed / unknown を確定 (= analysis-engine の決定)
 *      - `evaluationKind='walk_forward'` の場合は walk_forward_passed / walk_forward_failed
 *
 * **本関数は analysis-engine 由来の verdict を尊重し、独自閾値での再判定を一切行わない。**
 */
export function mapAnalysisEngineRobustnessResult(
  raw: AnalysisEngineRobustnessRawResult,
): OosValidationResult {
  const baselineMetrics = raw.baselineMetrics;
  const oosMetrics = raw.oosMetrics;
  const deltas = buildOosMetricDelta(baselineMetrics, oosMetrics);
  const folds = raw.walkForwardFolds ?? [];
  const warnings = raw.warnings ? [...raw.warnings] : [];

  // (1) engine error
  if (raw.engineError) {
    return {
      candidateId: raw.candidateId,
      dslId: raw.dslId,
      sourceStage: raw.sourceStage,
      route: raw.route,
      baselineMetrics,
      oosMetrics: null,
      deltas: emptyDeltas(),
      status: 'unknown',
      failureReasons: ['oos_engine_error'],
      folds: [],
      warnings: [...warnings, `analysis-engine 例外: ${raw.engineError}`],
    };
  }

  // (2) 未評価 (runner 未注入 / 候補対象外)
  if (raw.notEvaluated) {
    return {
      candidateId: raw.candidateId,
      dslId: raw.dslId,
      sourceStage: raw.sourceStage,
      route: raw.route,
      baselineMetrics,
      oosMetrics: null,
      deltas: emptyDeltas(),
      status: 'not_evaluated',
      failureReasons: [],
      folds: [],
      warnings,
    };
  }

  // (3) データ欠損 / 期間ゼロ
  // PR #105 Copilot review #2: tradeCount は外部 (analysis-engine) 境界の値なので、
  // null だけでなく NaN / Infinity / 負値も `insufficient_oos_data` に倒す。
  // 不正値が verdict 経由で oos_passed / oos_failed に流れると後続判定が壊れるため
  // 明示的に防御する。
  const isTradeCountInvalid = (tc: number | null | undefined): boolean => {
    if (tc === null || tc === undefined) return true;
    if (typeof tc !== 'number') return true;
    if (!Number.isFinite(tc)) return true;
    if (tc < 0) return true;
    return false;
  };
  if (
    raw.insufficientOosWindow ||
    !oosMetrics ||
    isTradeCountInvalid(oosMetrics.tradeCount)
  ) {
    const insufficientWarnings = [...warnings];
    if (
      oosMetrics &&
      oosMetrics.tradeCount !== null &&
      isTradeCountInvalid(oosMetrics.tradeCount)
    ) {
      insufficientWarnings.push(
        `OOS tradeCount=${String(oosMetrics.tradeCount)} は不正値 (NaN / Infinity / 負値) のため insufficient_oos_data に分類`,
      );
    }
    if (!baselineMetrics) {
      insufficientWarnings.push('baseline metrics なし、観測のみ');
    }
    return {
      candidateId: raw.candidateId,
      dslId: raw.dslId,
      sourceStage: raw.sourceStage,
      route: raw.route,
      baselineMetrics,
      oosMetrics,
      deltas,
      status: 'insufficient_oos_data',
      failureReasons: ['insufficient_oos_data'],
      folds,
      warnings: insufficientWarnings,
    };
  }

  // 観測警告: tradeCount が観測下限を下回る (ただし pass/fail 判定には使わない)
  if (
    typeof oosMetrics.tradeCount === 'number' &&
    oosMetrics.tradeCount < oosObservationThresholdsV1.minOosTrades
  ) {
    warnings.push(
      `OOS tradeCount=${oosMetrics.tradeCount} は観測下限 ${oosObservationThresholdsV1.minOosTrades} 未満 (judgement は analysis-engine の verdict を採用)`,
    );
  }

  if (!baselineMetrics) {
    warnings.push('baseline metrics なし、観測のみ');
  }

  const failureReasons = raw.failureReasons ? [...raw.failureReasons] : [];
  const kind = raw.evaluationKind ?? 'oos';

  // (4) analysis-engine の verdict を尊重
  const verdict = raw.verdict ?? 'unknown';
  let status: OosValidationStatus;
  if (verdict === 'passed') {
    status = kind === 'walk_forward' ? 'walk_forward_passed' : 'oos_passed';
  } else if (verdict === 'failed') {
    status = kind === 'walk_forward' ? 'walk_forward_failed' : 'oos_failed';
  } else {
    status = 'unknown';
    if (failureReasons.length === 0) failureReasons.push('unknown');
  }

  return {
    candidateId: raw.candidateId,
    dslId: raw.dslId,
    sourceStage: raw.sourceStage,
    route: raw.route,
    baselineMetrics,
    oosMetrics,
    deltas,
    status,
    failureReasons,
    folds,
    warnings,
  };
}
