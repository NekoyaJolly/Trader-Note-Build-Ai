/**
 * PR #105: oosValidationSummary のテスト。
 *
 * 確認:
 *   1. status / failureReason / route / sourceStage 軸で集計
 *   2. attempted / passed / failed / notEvaluated / unknown のカウントが正確
 *   3. 全 status / 全 failureReason キーが 0 で初期化される (caller `?? 0` 不要)
 *   4. route / sourceStage が空なら 'unknown' バケット
 */

import { summarizeOosValidationResults } from '../../evolution/oosValidationSummary';
import type { OosValidationResult } from '../../evolution/oosValidationResultMapper';

function r(overrides: Partial<OosValidationResult>): OosValidationResult {
  return {
    candidateId: overrides.candidateId ?? 'c1',
    dslId: overrides.dslId ?? 'c1',
    sourceStage: overrides.sourceStage,
    route: overrides.route,
    baselineMetrics: overrides.baselineMetrics ?? null,
    oosMetrics: overrides.oosMetrics ?? null,
    deltas: overrides.deltas ?? {
      pfDelta: null,
      tradeCountDelta: null,
      maxDrawdownDelta: null,
      expectancyDelta: null,
    },
    status: overrides.status ?? 'not_evaluated',
    failureReasons: overrides.failureReasons ?? [],
    folds: overrides.folds ?? [],
    warnings: overrides.warnings ?? [],
  };
}

describe('summarizeOosValidationResults', () => {
  it('1. status / route / sourceStage を集計する', () => {
    const s = summarizeOosValidationResults([
      r({
        candidateId: 'a',
        dslId: 'a',
        status: 'oos_passed',
        route: 'normal_pass',
        sourceStage: 'validation_candidate',
      }),
      r({
        candidateId: 'b',
        dslId: 'b',
        status: 'oos_failed',
        route: 'normal_pass',
        sourceStage: 'validation_candidate',
        failureReasons: ['low_oos_pf'],
      }),
      r({
        candidateId: 'c',
        dslId: 'c',
        status: 'walk_forward_passed',
        route: 'novelty_rescue',
        sourceStage: 'validation_candidate',
      }),
    ]);
    expect(s.attempted).toBe(3);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.byStatus.oos_passed).toBe(1);
    expect(s.byStatus.walk_forward_passed).toBe(1);
    expect(s.byStatus.oos_failed).toBe(1);
    expect(s.byFailureReason.low_oos_pf).toBe(1);
    expect(s.byRoute.normal_pass.attempted).toBe(2);
    expect(s.byRoute.normal_pass.passed).toBe(1);
    expect(s.byRoute.normal_pass.failed).toBe(1);
    expect(s.byRoute.novelty_rescue.passed).toBe(1);
    expect(s.bySourceStage.validation_candidate.attempted).toBe(3);
  });

  it('2. notEvaluated / unknown が status カテゴリに正しく振り分けられる', () => {
    const s = summarizeOosValidationResults([
      r({ status: 'not_evaluated' }),
      r({ status: 'unknown', failureReasons: ['oos_engine_error'] }),
      r({ status: 'insufficient_oos_data', failureReasons: ['insufficient_oos_data'] }),
    ]);
    expect(s.attempted).toBe(3);
    expect(s.notEvaluated).toBe(1);
    expect(s.unknown).toBe(2);
    expect(s.passed).toBe(0);
    expect(s.failed).toBe(0);
    expect(s.byFailureReason.oos_engine_error).toBe(1);
    expect(s.byFailureReason.insufficient_oos_data).toBe(1);
  });

  it('3. 空配列でも全 status / 全 failureReason キーが 0 で初期化される', () => {
    const s = summarizeOosValidationResults([]);
    expect(s.attempted).toBe(0);
    expect(s.byStatus.oos_passed).toBe(0);
    expect(s.byStatus.walk_forward_failed).toBe(0);
    expect(s.byFailureReason.fold_instability).toBe(0);
  });

  it('4. route / sourceStage が空なら "unknown" バケット', () => {
    const s = summarizeOosValidationResults([r({ status: 'oos_passed' })]);
    expect(s.byRoute.unknown).toBeDefined();
    expect(s.byRoute.unknown.passed).toBe(1);
    expect(s.bySourceStage.unknown).toBeDefined();
  });
});
