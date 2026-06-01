/**
 * buildOosResultByCandidate の単体テスト（OOS確証の永続化形式への変換）
 *
 * 検証:
 *  - validation_confirmed → confirmed=true（OOS/WF 通過）
 *  - hold（oos_failed 等）→ confirmed=false
 *  - validation_candidate 以外（OOS対象外）→ 出力に含めない
 *  - OOS メトリクス（pf/winRate）が候補に紐づく
 */

import { buildOosResultByCandidate } from '../../evolution/oosConfirmation';
import type { OosAwarePromotionDecision } from '../../evolution/promotionGatePolicy';
import type { OosValidationResult } from '../../evolution/oosValidationResultMapper';

function decision(
  overrides: Partial<OosAwarePromotionDecision> & Pick<OosAwarePromotionDecision, 'candidateId'>,
): OosAwarePromotionDecision {
  return {
    candidateId: overrides.candidateId,
    dslId: overrides.dslId ?? overrides.candidateId,
    baseStage: overrides.baseStage ?? 'validation_candidate',
    finalStage: overrides.finalStage ?? 'validation_candidate',
    kind: overrides.kind ?? 'unchanged',
    oosStatus: overrides.oosStatus ?? null,
    oosFailureReasons: overrides.oosFailureReasons ?? [],
    warnings: overrides.warnings ?? [],
    productionEligible: false,
  };
}

function oosResult(
  candidateId: string,
  pf: number | null,
  winRate: number | null,
): OosValidationResult {
  return {
    candidateId,
    dslId: candidateId,
    baselineMetrics: null,
    oosMetrics: { pf, tradeCount: 30, maxDrawdown: null, expectancy: null, winRate },
    deltas: { pfDelta: null, tradeCountDelta: null } as OosValidationResult['deltas'],
    status: 'oos_passed',
    failureReasons: [],
    folds: [],
    warnings: [],
  };
}

describe('buildOosResultByCandidate', () => {
  it('validation_confirmed は confirmed=true で OOS メトリクスも紐づく', () => {
    const map = buildOosResultByCandidate(
      [decision({ candidateId: 'c1', finalStage: 'validation_confirmed', oosStatus: 'oos_passed' })],
      [oosResult('c1', 1.45, 0.55)],
    );
    const r = map.get('c1');
    expect(r).toBeDefined();
    expect(r?.confirmed).toBe(true);
    expect(r?.finalStage).toBe('validation_confirmed');
    expect(r?.oosStatus).toBe('oos_passed');
    expect(r?.oosPf).toBeCloseTo(1.45);
    expect(r?.oosWinRate).toBeCloseTo(0.55);
  });

  it('OOS 失敗で hold（validation_candidate のまま）は confirmed=false', () => {
    const map = buildOosResultByCandidate(
      [decision({ candidateId: 'c2', finalStage: 'validation_candidate', oosStatus: 'oos_failed' })],
      [],
    );
    const r = map.get('c2');
    expect(r?.confirmed).toBe(false);
    expect(r?.oosStatus).toBe('oos_failed');
    expect(r?.oosPf).toBeNull();
  });

  it('validation_candidate 以外（OOS対象外）は出力に含めない', () => {
    const map = buildOosResultByCandidate(
      [decision({ candidateId: 'c3', baseStage: 'repairable', finalStage: 'repairable' })],
      [],
    );
    expect(map.has('c3')).toBe(false);
  });
});
