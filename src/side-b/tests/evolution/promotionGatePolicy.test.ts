/**
 * PR #101: Promotion Gate / EvolutionCandidateStage v1 単体テスト
 *
 * 設計書 §テスト要件 15 項目:
 *   1. DSL missing → repair_excluded / rejected
 *   2. schema validation failed → rejected
 *   3. normal_pass → formal_bt_candidate
 *   4. rescue route → formal_bt_candidate
 *   5. rescue route → productionEligible=false
 *   6. formalBtPassed=true → validation_candidate
 *   7. formalBtPassed=true でも productionEligible=false
 *   8. formal BT failed + repairable → repairable
 *   9. fatal repairHint → repair_excluded
 *   10. parent source → parent_eligible
 *   11. invalid DSL は parent source より除外判定が優先
 *   12. 判定理由が reasons に含まれる
 *   13-15. summary が stage / decision / reason ごとに集計
 */

import {
  decidePromotionGateV1,
  summarizePromotionGateDecisions,
  type PromotionGateDecision,
} from '../../evolution/promotionGatePolicy';

describe('promotionGatePolicy.decidePromotionGateV1', () => {
  it('1a. DSL missing → repair_excluded + reason=dsl_missing', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c1',
      hasValidDsl: false,
    });
    expect(d.toStage).toBe('repair_excluded');
    expect(d.decision).toBe('mark_repair_excluded');
    expect(d.reasons).toContain('dsl_missing');
    expect(d.productionEligible).toBe(false);
    expect(d.repairable).toBe(false);
  });

  it('2. schema validation failed → rejected', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c2',
      hasValidDsl: true,
      schemaValidationPassed: false,
    });
    expect(d.toStage).toBe('rejected');
    expect(d.decision).toBe('mark_rejected');
    expect(d.reasons).toContain('schema_validation_failed');
  });

  it('3. normal_pass → formal_bt_candidate', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c3',
      route: 'normal_pass',
      hasValidDsl: true,
    });
    expect(d.toStage).toBe('formal_bt_candidate');
    expect(d.decision).toBe('promote_to_formal_bt_candidate');
    expect(d.reasons).toContain('normal_pass');
    expect(d.productionEligible).toBe(false);
  });

  it('4. rescue route (novelty_rescue) → formal_bt_candidate', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c4',
      route: 'novelty_rescue',
      hasValidDsl: true,
    });
    expect(d.toStage).toBe('formal_bt_candidate');
    expect(d.decision).toBe('promote_to_formal_bt_candidate');
    expect(d.reasons).toContain('rescue_lane');
  });

  it('5. rescue route は productionEligible=false', () => {
    for (const route of [
      'near_miss_rescue',
      'novelty_rescue',
      'low_drawdown_rescue',
      'trade_count_rescue',
    ]) {
      const d = decidePromotionGateV1({
        candidateId: `c-${route}`,
        route,
        hasValidDsl: true,
      });
      expect(d.productionEligible).toBe(false);
      expect(d.toStage).toBe('formal_bt_candidate');
    }
  });

  it('6. formalBtPassed=true → validation_candidate', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c6',
      hasValidDsl: true,
      formalBtPassed: true,
      route: 'normal_pass',
      metrics: { pf: 1.5, tradeCount: 30 },
    });
    expect(d.toStage).toBe('validation_candidate');
    expect(d.decision).toBe('promote_to_validation_candidate');
    expect(d.reasons).toContain('formal_bt_passed');
    expect(d.reasons).toContain('oos_not_run');
  });

  it('7. formalBtPassed=true でも productionEligible=false のまま', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c7',
      hasValidDsl: true,
      formalBtPassed: true,
      metrics: { pf: 2.5, tradeCount: 100 },
    });
    expect(d.productionEligible).toBe(false);
    expect(d.toStage).not.toBe('production_candidate');
  });

  it('8. formal BT failed + repairable hint → repairable', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c8',
      hasValidDsl: true,
      formalBtPassed: false,
      formalBtFailureReason: 'tradeCount 0 < 20',
      repairHint: {
        shouldUseForRepairMutation: true,
        shouldExcludeFromParentPool: false,
        severity: 'high',
      },
    });
    expect(d.toStage).toBe('repairable');
    expect(d.decision).toBe('promote_to_repairable');
    expect(d.repairable).toBe(true);
    expect(d.reasons).toEqual(expect.arrayContaining(['formal_bt_failed', 'repair_hint_available']));
  });

  it('9. fatal repairHint → repair_excluded', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c9',
      hasValidDsl: true,
      formalBtPassed: false,
      repairHint: {
        shouldUseForRepairMutation: false,
        shouldExcludeFromParentPool: true,
        severity: 'fatal',
      },
    });
    expect(d.toStage).toBe('repair_excluded');
    expect(d.decision).toBe('mark_repair_excluded');
    expect(d.reasons).toContain('repair_hint_fatal');
    expect(d.repairable).toBe(false);
  });

  it('10. parent source → parent_eligible', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c10',
      source: 'edge_confirmed',
      hasValidDsl: true,
    });
    expect(d.toStage).toBe('parent_eligible');
    expect(d.decision).toBe('promote_to_parent_eligible');
    expect(d.reasons).toContain('source_parent_pool');
  });

  it('10b. parent source の各種 (formal_bt_passed / current_population / edge_screening_passed) も parent_eligible', () => {
    for (const source of ['formal_bt_passed', 'current_population', 'edge_screening_passed']) {
      const d = decidePromotionGateV1({
        candidateId: `c-${source}`,
        source,
        hasValidDsl: true,
      });
      expect(d.toStage).toBe('parent_eligible');
    }
  });

  it('11. invalid DSL は parent source より除外判定が優先される', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c11',
      source: 'edge_confirmed',
      hasValidDsl: false, // 除外
    });
    expect(d.toStage).toBe('repair_excluded');
    expect(d.reasons).toContain('dsl_missing');
    // parent_eligible にならない
    expect(d.toStage).not.toBe('parent_eligible');
  });

  it('11b. fatal repairHint は formal BT passed より優先される (= 復活させない)', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c11b',
      hasValidDsl: true,
      formalBtPassed: true, // 通っているが
      repairHint: {
        shouldUseForRepairMutation: false,
        shouldExcludeFromParentPool: true, // fatal
        severity: 'fatal',
      },
    });
    // 設計書 §優先順位: fatal repairHint は formalBtPassed より上
    expect(d.toStage).toBe('repair_excluded');
  });

  it('12. 判定理由が reasons に含まれる (rescue + 複数 reason)', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c12',
      hasValidDsl: true,
      formalBtPassed: false,
      formalBtFailureReason: 'pf 0.5 < 1',
      repairHint: {
        shouldUseForRepairMutation: true,
        shouldExcludeFromParentPool: false,
        severity: 'medium',
      },
    });
    expect(d.reasons.length).toBeGreaterThanOrEqual(2);
    expect(d.reasons).toContain('formal_bt_failed');
    expect(d.reasons).toContain('repair_hint_available');
  });

  it('formal BT failed で repairHint なし → repair_excluded', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c-fail-no-hint',
      hasValidDsl: true,
      formalBtPassed: false,
      formalBtFailureReason: 'pf 0.5 < 1',
    });
    expect(d.toStage).toBe('repair_excluded');
    expect(d.reasons).toContain('formal_bt_failed');
  });

  it('route=kill → rejected', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c-kill',
      route: 'kill',
      hasValidDsl: true,
    });
    expect(d.toStage).toBe('rejected');
    expect(d.decision).toBe('mark_rejected');
  });

  it('情報なし (生成直後) → hold + currentStage 維持', () => {
    const d = decidePromotionGateV1({
      candidateId: 'c-new',
      hasValidDsl: true,
    });
    expect(d.decision).toBe('hold');
    expect(d.toStage).toBe('generated');
    expect(d.reasons).toContain('manual_hold');
  });
});

describe('promotionGatePolicy.summarizePromotionGateDecisions', () => {
  function decisionFor(
    overrides: Partial<PromotionGateDecision> & Pick<PromotionGateDecision, 'toStage' | 'decision'>,
  ): PromotionGateDecision {
    return {
      candidateId: `c-${Math.random()}`,
      fromStage: null,
      reasons: [],
      productionEligible: false,
      warnings: [],
      ...overrides,
    };
  }

  it('13. stage ごとに集計する (未出現 stage も 0 で残る)', () => {
    const summary = summarizePromotionGateDecisions([
      decisionFor({ toStage: 'parent_eligible', decision: 'promote_to_parent_eligible' }),
      decisionFor({ toStage: 'formal_bt_candidate', decision: 'promote_to_formal_bt_candidate' }),
      decisionFor({ toStage: 'formal_bt_candidate', decision: 'promote_to_formal_bt_candidate' }),
    ]);
    expect(summary.totalCandidates).toBe(3);
    expect(summary.byStage.parent_eligible).toBe(1);
    expect(summary.byStage.formal_bt_candidate).toBe(2);
    // 未出現 stage は 0
    expect(summary.byStage.production_candidate).toBe(0);
    expect(summary.byStage.rejected).toBe(0);
  });

  it('14. decision ごとに集計する', () => {
    const summary = summarizePromotionGateDecisions([
      decisionFor({ toStage: 'validation_candidate', decision: 'promote_to_validation_candidate' }),
      decisionFor({ toStage: 'repair_excluded', decision: 'mark_repair_excluded' }),
      decisionFor({ toStage: 'repair_excluded', decision: 'mark_repair_excluded' }),
    ]);
    expect(summary.byDecision.promote_to_validation_candidate).toBe(1);
    expect(summary.byDecision.mark_repair_excluded).toBe(2);
  });

  it('15. reason ごとに集計する (複数 reason は全カウント)', () => {
    const summary = summarizePromotionGateDecisions([
      decisionFor({
        toStage: 'repairable',
        decision: 'promote_to_repairable',
        reasons: ['formal_bt_failed', 'repair_hint_available'],
        repairable: true,
      }),
      decisionFor({
        toStage: 'formal_bt_candidate',
        decision: 'promote_to_formal_bt_candidate',
        reasons: ['rescue_lane'],
      }),
    ]);
    expect(summary.byReason.formal_bt_failed).toBe(1);
    expect(summary.byReason.repair_hint_available).toBe(1);
    expect(summary.byReason.rescue_lane).toBe(1);
    expect(summary.repairable).toBe(1);
    expect(summary.repairExcluded).toBe(0);
    expect(summary.productionEligible).toBe(0);
  });

  it('入力空でも全 stage / decision / reason が 0 で初期化される', () => {
    const summary = summarizePromotionGateDecisions([]);
    expect(summary.totalCandidates).toBe(0);
    expect(summary.byStage.parent_eligible).toBe(0);
    expect(summary.byDecision.hold).toBe(0);
    expect(summary.byReason.unknown).toBe(0);
    expect(summary.productionEligible).toBe(0);
  });
});
