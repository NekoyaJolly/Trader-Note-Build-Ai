/**
 * PR #105: OOS-aware PromotionGate 接続のテスト。
 *
 * Addendum §PromotionGate 接続テスト:
 *   1. analysis-engine 由来の oos_passed が validation_confirmed になる
 *   2. analysis-engine 由来の walk_forward_passed が validation_confirmed になる
 *   3. oos_failed は rejected ではなく hold になる
 *   4. walk_forward_failed は rejected ではなく hold になる
 *   5. productionEligible は false のまま
 *   6. invalid / fatal (= validation_candidate ではない base) は OOS passed より優先される
 *   + Summary 集計
 *   + 既存 promotionGateSummary は変更しない (= 別軸)
 */

import {
  applyOosAwarePromotion,
  summarizeOosAwarePromotion,
  type PromotionGateDecision,
} from '../../evolution/promotionGatePolicy';
import type { OosAwarePromotionInputResult } from '../../evolution/promotionGatePolicy';

function makeDecision(
  candidateId: string,
  toStage: PromotionGateDecision['toStage'],
  overrides: Partial<PromotionGateDecision> = {},
): PromotionGateDecision {
  return {
    candidateId,
    dslId: candidateId,
    fromStage: null,
    toStage,
    decision: 'hold',
    reasons: [],
    productionEligible: false,
    warnings: [],
    ...overrides,
  };
}

function makeOos(
  candidateId: string,
  status: string,
  overrides: Partial<OosAwarePromotionInputResult> = {},
): OosAwarePromotionInputResult {
  return {
    candidateId,
    dslId: candidateId,
    status,
    failureReasons: [],
    warnings: [],
    ...overrides,
  };
}

describe('applyOosAwarePromotion', () => {
  it('1. oos_passed → validation_confirmed', () => {
    const decisions = [makeDecision('a', 'validation_candidate')];
    const oos = [makeOos('a', 'oos_passed')];
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('validation_confirmed');
    expect(r[0].kind).toBe('confirmed_by_oos');
    expect(r[0].productionEligible).toBe(false);
  });

  it('2. walk_forward_passed → validation_confirmed', () => {
    const decisions = [makeDecision('a', 'validation_candidate')];
    const oos = [makeOos('a', 'walk_forward_passed')];
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('validation_confirmed');
    expect(r[0].kind).toBe('confirmed_by_walk_forward');
  });

  it('3. oos_failed → hold (rejected ではなく validation_candidate のまま)', () => {
    const decisions = [makeDecision('a', 'validation_candidate')];
    const oos = [makeOos('a', 'oos_failed', { failureReasons: ['low_oos_pf'] })];
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('validation_candidate');
    expect(r[0].kind).toBe('hold_on_oos_failed');
    expect(r[0].oosFailureReasons).toEqual(['low_oos_pf']);
    // 不変条件: rejected には絶対にしない
    expect(r[0].finalStage).not.toBe('rejected');
  });

  it('4. walk_forward_failed → hold', () => {
    const decisions = [makeDecision('a', 'validation_candidate')];
    const oos = [makeOos('a', 'walk_forward_failed', { failureReasons: ['fold_instability'] })];
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('validation_candidate');
    expect(r[0].kind).toBe('hold_on_oos_failed');
    expect(r[0].finalStage).not.toBe('rejected');
  });

  it('5. productionEligible は常に false (= production には絶対に上がらない)', () => {
    const decisions = [
      makeDecision('a', 'validation_candidate'),
      makeDecision('b', 'validation_candidate'),
    ];
    const oos = [makeOos('a', 'oos_passed'), makeOos('b', 'walk_forward_passed')];
    const r = applyOosAwarePromotion(decisions, oos);
    for (const d of r) {
      expect(d.productionEligible).toBe(false);
    }
    const s = summarizeOosAwarePromotion(r);
    expect(s.productionEligible).toBe(0);
  });

  it('6a. base stage が rejected なら OOS passed でも上書きしない (= invalid 優先)', () => {
    const decisions = [makeDecision('a', 'rejected')];
    const oos = [makeOos('a', 'oos_passed')];
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('rejected');
    expect(r[0].kind).toBe('unchanged');
  });

  it('6b. base stage が repair_excluded なら OOS passed でも上書きしない (= fatal 優先)', () => {
    const decisions = [makeDecision('a', 'repair_excluded')];
    const oos = [makeOos('a', 'oos_passed')];
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('repair_excluded');
    expect(r[0].kind).toBe('unchanged');
  });

  it('7. unknown / oos_engine_error → hold_on_unknown', () => {
    const decisions = [makeDecision('a', 'validation_candidate')];
    const oos = [makeOos('a', 'unknown', { failureReasons: ['oos_engine_error'] })];
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('validation_candidate');
    expect(r[0].kind).toBe('hold_on_unknown');
  });

  it('8. not_evaluated → hold_on_not_evaluated', () => {
    const decisions = [makeDecision('a', 'validation_candidate')];
    const oos = [makeOos('a', 'not_evaluated')];
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('validation_candidate');
    expect(r[0].kind).toBe('hold_on_not_evaluated');
  });

  it('9. validation_candidate なのに OOS 結果が無い → hold_on_not_evaluated', () => {
    const decisions = [makeDecision('a', 'validation_candidate')];
    const r = applyOosAwarePromotion(decisions, []);
    expect(r[0].finalStage).toBe('validation_candidate');
    expect(r[0].kind).toBe('hold_on_not_evaluated');
  });

  it('10. dslId と candidateId 両方で OOS 結果を引ける', () => {
    const decisions = [
      makeDecision('cand-1', 'validation_candidate', { dslId: 'dsl-1' }),
    ];
    const oos = [makeOos('dsl-1', 'oos_passed')]; // candidateId='dsl-1' で登録
    const r = applyOosAwarePromotion(decisions, oos);
    expect(r[0].finalStage).toBe('validation_confirmed');
  });
});

describe('summarizeOosAwarePromotion', () => {
  it('validation_candidate 起点だけを評価対象にカウントする', () => {
    const decisions = [
      makeDecision('a', 'validation_candidate'),
      makeDecision('b', 'validation_candidate'),
      makeDecision('c', 'validation_candidate'),
      makeDecision('d', 'validation_candidate'),
      makeDecision('e', 'parent_eligible'), // 評価対象外
      makeDecision('f', 'rejected'), // 評価対象外
    ];
    const oos = [
      makeOos('a', 'oos_passed'),
      makeOos('b', 'walk_forward_passed'),
      makeOos('c', 'oos_failed'),
      makeOos('d', 'unknown'),
    ];
    const r = applyOosAwarePromotion(decisions, oos);
    const s = summarizeOosAwarePromotion(r);

    expect(s.totalCandidates).toBe(6);
    expect(s.validationCandidatesEvaluated).toBe(4);
    expect(s.validationConfirmed).toBe(2);
    expect(s.heldOnValidation).toBe(2);
    expect(s.byKind.confirmed_by_oos).toBe(1);
    expect(s.byKind.confirmed_by_walk_forward).toBe(1);
    expect(s.byKind.hold_on_oos_failed).toBe(1);
    expect(s.byKind.hold_on_unknown).toBe(1);
    expect(s.byKind.unchanged).toBe(2);
    expect(s.productionEligible).toBe(0);
  });

  it('全 byKind キーが 0 で初期化される', () => {
    const s = summarizeOosAwarePromotion([]);
    expect(s.byKind.confirmed_by_oos).toBe(0);
    expect(s.byKind.confirmed_by_walk_forward).toBe(0);
    expect(s.byKind.hold_on_oos_failed).toBe(0);
    expect(s.byKind.hold_on_unknown).toBe(0);
    expect(s.byKind.hold_on_not_evaluated).toBe(0);
    expect(s.byKind.unchanged).toBe(0);
  });
});
