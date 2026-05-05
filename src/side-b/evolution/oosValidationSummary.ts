/**
 * OOS / Walk-forward Summary builder (Critical-4 PR #105)
 *
 * 設計方針 (docs/design/pr_105_analysis_engine_authority_addendum.md):
 *   - `OosValidationResult[]` を status / failureReason / route / sourceStage 軸で集計
 *   - metrics の再計算 / OOS / WF / MC の実行は一切行わない
 *
 * @see docs/design/pr_105_analysis_engine_authority_addendum.md
 */

import type {
  OosFailureReason,
  OosValidationResult,
  OosValidationStatus,
} from './oosValidationResultMapper';

// =================================================================
// 型定義
// =================================================================

/** status / reason / route / sourceStage ごとの集計バケット。 */
export interface OosValidationSummaryBucket {
  attempted: number;
  passed: number;
  failed: number;
  unknown: number;
}

/** GenerationReport / smoke に出す summary。 */
export interface OosValidationSummary {
  attempted: number;
  passed: number;
  failed: number;
  notEvaluated: number;
  unknown: number;
  byStatus: Record<OosValidationStatus, number>;
  byFailureReason: Record<OosFailureReason, number>;
  byRoute: Record<string, OosValidationSummaryBucket>;
  bySourceStage: Record<string, OosValidationSummaryBucket>;
  warnings: string[];
}

// =================================================================
// 集計
// =================================================================

const ALL_STATUSES: OosValidationStatus[] = [
  'oos_passed',
  'oos_failed',
  'walk_forward_passed',
  'walk_forward_failed',
  'insufficient_oos_data',
  'not_evaluated',
  'unknown',
];

const ALL_FAILURE_REASONS: OosFailureReason[] = [
  'low_oos_pf',
  'insufficient_oos_trades',
  'high_oos_drawdown',
  'oos_expectancy_degraded',
  'fold_instability',
  'insample_oos_divergence',
  'oos_engine_error',
  'oos_timeout',
  'insufficient_oos_data',
  'unknown',
];

function emptyBucket(): OosValidationSummaryBucket {
  return { attempted: 0, passed: 0, failed: 0, unknown: 0 };
}

function bumpBucket(
  map: Record<string, OosValidationSummaryBucket>,
  key: string,
  status: OosValidationStatus,
): void {
  const k = key.length > 0 ? key : 'unknown';
  if (!map[k]) map[k] = emptyBucket();
  map[k].attempted += 1;
  if (status === 'oos_passed' || status === 'walk_forward_passed') map[k].passed += 1;
  else if (status === 'oos_failed' || status === 'walk_forward_failed') map[k].failed += 1;
  else map[k].unknown += 1;
}

/**
 * OOS / Walk-forward 結果を status / failureReason / route / sourceStage 軸で集計。
 *
 * - 未出現 status / reason は 0 で初期化 (caller 側 `?? 0` 不要)
 * - route / sourceStage が空文字 / undefined なら `'unknown'` バケット
 * - **集計のみ。metrics 再計算 / pass/fail 再判定は一切しない**
 */
export function summarizeOosValidationResults(
  results: ReadonlyArray<OosValidationResult>,
): OosValidationSummary {
  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
    OosValidationStatus,
    number
  >;
  const byFailureReason = Object.fromEntries(ALL_FAILURE_REASONS.map((r) => [r, 0])) as Record<
    OosFailureReason,
    number
  >;
  const byRoute: Record<string, OosValidationSummaryBucket> = {};
  const bySourceStage: Record<string, OosValidationSummaryBucket> = {};

  let passed = 0;
  let failed = 0;
  let notEvaluated = 0;
  let unknown = 0;
  const warnings: string[] = [];

  for (const r of results) {
    byStatus[r.status] += 1;
    for (const reason of r.failureReasons) byFailureReason[reason] += 1;
    if (r.status === 'oos_passed' || r.status === 'walk_forward_passed') passed += 1;
    else if (r.status === 'oos_failed' || r.status === 'walk_forward_failed') failed += 1;
    else if (r.status === 'not_evaluated') notEvaluated += 1;
    else unknown += 1;

    bumpBucket(byRoute, r.route ?? '', r.status);
    bumpBucket(bySourceStage, r.sourceStage ?? '', r.status);
    if (r.warnings.length > 0) for (const w of r.warnings) warnings.push(w);
  }

  return {
    attempted: results.length,
    passed,
    failed,
    notEvaluated,
    unknown,
    byStatus,
    byFailureReason,
    byRoute,
    bySourceStage,
    warnings,
  };
}
