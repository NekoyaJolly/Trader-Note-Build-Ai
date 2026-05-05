/**
 * PR #107: Adaptive Repair / Mutation Budget v1 のテスト。
 *
 * 設計書 §テスト要件 (15 項目):
 *   1. improved rate 高い target は weight が上がる
 *   2. worsened rate 高い target は weight が下がる
 *   3. attempted が少ない target は大きく変更しない
 *   4. unknown が多い target は失敗扱いしない
 *   5. repair_guided_mutation が repairMaxShare を超えない
 *   6. novelty_seed が noveltyFloor を下回らない
 *   7. explorationFloor が守られる
 *   8. standard_mutation が 0 にならない
 *   9. 合計 budget が totalBudget に正規化される
 *   10. stagnation 時に novelty / exploration が小さく増える
 *   11. OOS confirmed 増加時に productionEligible は変わらない
 *   12. productionEligibleChanged は常に false
 *   13. adaptive disabled 時は baseline allocation を維持する
 *   14. warnings が必要な場合に出る
 *   15. LLM入力なしで deterministic に同じ decision が返る
 */

import {
  adaptiveRepairBudgetThresholdsV1,
  decideAdaptiveRepairBudgetV1,
  defaultMutationBudgetAllocationV1,
  extractRepairSignalsV1,
  summarizeAdaptiveRepairBudgetDecisionsV1,
  type MutationBudgetAllocation,
} from '../../evolution/adaptiveRepairBudgetPolicy';
import type {
  AdaptiveRepairBudgetDecision,
} from '../../evolution/adaptiveRepairBudgetPolicy';
import type { GenerationReport } from '../../evolution/EvolutionLoop';
import type { RepairOutcomeSummary } from '../../evolution/repairOutcomeTelemetry';
import type { MultiGenerationTrendSummary } from '../../evolution/multiGenerationRunner';

// =================================================================
// fixtures
// =================================================================

function makeRepairOutcomeSummary(
  byActionTarget: Record<
    string,
    { attempted: number; improved: number; worsened: number; unchanged: number; unknown: number }
  >,
): RepairOutcomeSummary {
  let attempted = 0;
  let improved = 0;
  let worsened = 0;
  let unchanged = 0;
  let unknown = 0;
  for (const v of Object.values(byActionTarget)) {
    attempted += v.attempted;
    improved += v.improved;
    worsened += v.worsened;
    unchanged += v.unchanged;
    unknown += v.unknown;
  }
  return {
    attempted,
    improved,
    worsened,
    unchanged,
    unknown,
    byFailureReason: {},
    byActionTarget,
    byRoute: {},
    warnings: [],
  };
}

function makeReport(
  o: { repairOutcomeSummary?: RepairOutcomeSummary } = {},
): GenerationReport {
  // policy は repairOutcomeSummary しか読まないので最小限の stub で良い
  return {
    regime: 'breakout',
    scores: {},
    eliteIds: [],
    mutantsReceived: 0,
    crossoversReceived: 0,
    addedToPopulation: 0,
    formalBtVerifiedCandidates: [],
    promotionCandidates: [],
    lowDiversityBoost: false,
    errors: [],
    parentPoolSummary: {
      requested: {} as never,
      selected: {} as never,
      fallbackApplied: false,
      fallbackReason: null,
      totalSelected: 0,
    },
    formalBtCandidateSummary: {
      normalPass: 0,
      nearMissRescue: 0,
      noveltyRescue: 0,
      lowDrawdownRescue: 0,
      tradeCountRescue: 0,
      killed: 0,
      uniqueCandidates: 0,
      duplicateRemoved: 0,
      fallbackApplied: false,
      fallbackReason: null,
    },
    repairHintSummary: {
      totalFailures: 0,
      repairable: 0,
      excluded: 0,
      byFailureReason: {},
      bySeverity: { low: 0, medium: 0, high: 0, fatal: 0 },
      byRoute: {},
      warnings: [],
    },
    promotionGateSummary: {
      totalCandidates: 0,
      byStage: {
        generated: 0,
        parent_eligible: 0,
        surrogate_candidate: 0,
        formal_bt_candidate: 0,
        formal_bt_passed: 0,
        formal_bt_failed: 0,
        repairable: 0,
        repair_excluded: 0,
        validation_candidate: 0,
        validation_confirmed: 0,
        production_candidate: 0,
        rejected: 0,
      },
      byDecision: {
        hold: 0,
        promote_to_parent_eligible: 0,
        promote_to_formal_bt_candidate: 0,
        promote_to_formal_bt_passed: 0,
        promote_to_repairable: 0,
        promote_to_validation_candidate: 0,
        mark_repair_excluded: 0,
        mark_rejected: 0,
      },
      byReason: {
        source_parent_pool: 0,
        normal_pass: 0,
        rescue_lane: 0,
        formal_bt_passed: 0,
        formal_bt_failed: 0,
        repair_hint_available: 0,
        repair_hint_fatal: 0,
        dsl_missing: 0,
        schema_validation_failed: 0,
        analysis_engine_error: 0,
        insufficient_metrics: 0,
        validation_not_run: 0,
        oos_not_run: 0,
        manual_hold: 0,
        unknown: 0,
      },
      productionEligible: 0,
      repairable: 0,
      repairExcluded: 0,
      warnings: [],
    },
    promotionGateDecisions: [],
    repairOutcomeSummary: o.repairOutcomeSummary ?? makeRepairOutcomeSummary({}),
    repairOutcomes: [],
    oosValidationSummary: {
      attempted: 0,
      passed: 0,
      failed: 0,
      notEvaluated: 0,
      unknown: 0,
      byStatus: {
        oos_passed: 0,
        oos_failed: 0,
        walk_forward_passed: 0,
        walk_forward_failed: 0,
        insufficient_oos_data: 0,
        not_evaluated: 0,
        unknown: 0,
      },
      byFailureReason: {
        low_oos_pf: 0,
        insufficient_oos_trades: 0,
        high_oos_drawdown: 0,
        oos_expectancy_degraded: 0,
        fold_instability: 0,
        insample_oos_divergence: 0,
        oos_engine_error: 0,
        oos_timeout: 0,
        insufficient_oos_data: 0,
        unknown: 0,
      },
      byRoute: {},
      bySourceStage: {},
      warnings: [],
    },
    oosValidationResults: [],
    oosAwarePromotionSummary: {
      totalCandidates: 0,
      validationCandidatesEvaluated: 0,
      validationConfirmed: 0,
      heldOnValidation: 0,
      byKind: {
        confirmed_by_oos: 0,
        confirmed_by_walk_forward: 0,
        hold_on_oos_failed: 0,
        hold_on_unknown: 0,
        hold_on_not_evaluated: 0,
        unchanged: 0,
      },
      productionEligible: 0,
      warnings: [],
    },
    oosAwarePromotionDecisions: [],
  };
}

function emptyTrend(): MultiGenerationTrendSummary {
  return {
    generationsRequested: 0,
    generationsCompleted: 0,
    generationsFailed: 0,
    stoppedEarly: false,
    stopReason: null,
    formalBtCandidatesByGeneration: [],
    formalBtPassedByGeneration: [],
    repairHintsByGeneration: [],
    repairOutcomeImprovedByGeneration: [],
    validationCandidatesByGeneration: [],
    validationConfirmedByGeneration: [],
    oosPassedByGeneration: [],
    oosFailedByGeneration: [],
    productionEligibleByGeneration: [],
    warnings: [],
  };
}

// =================================================================
// extractRepairSignalsV1
// =================================================================

describe('extractRepairSignalsV1', () => {
  it('attempted=0 でも target ごとの bucket をそのまま signal に出す', () => {
    const s = extractRepairSignalsV1(
      makeRepairOutcomeSummary({
        exit: { attempted: 0, improved: 0, worsened: 0, unchanged: 0, unknown: 0 },
      }),
    );
    expect(s).toHaveLength(1);
    expect(s[0].actionTarget).toBe('exit');
    expect(s[0].improvementRate).toBeNull();
    expect(s[0].worseningRate).toBeNull();
  });

  it('attempted>0 なら improvementRate / worseningRate を計算', () => {
    const s = extractRepairSignalsV1(
      makeRepairOutcomeSummary({
        exit: { attempted: 4, improved: 2, worsened: 1, unchanged: 1, unknown: 0 },
      }),
    );
    expect(s[0].improvementRate).toBeCloseTo(0.5);
    expect(s[0].worseningRate).toBeCloseTo(0.25);
  });

  it('summary が null/undefined なら空配列', () => {
    expect(extractRepairSignalsV1(null)).toEqual([]);
    expect(extractRepairSignalsV1(undefined)).toEqual([]);
  });
});

// =================================================================
// decideAdaptiveRepairBudgetV1
// =================================================================

describe('decideAdaptiveRepairBudgetV1', () => {
  it('1. improved rate 高い target は weight が上がる + reason=repair_outcome_improved', () => {
    const report = makeReport({
      repairOutcomeSummary: makeRepairOutcomeSummary({
        exit: { attempted: 4, improved: 3, worsened: 0, unchanged: 1, unknown: 0 },
      }),
    });
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: report,
    });
    expect(d.nextAllocation.repairTargetWeights.exit).toBeGreaterThan(1.0);
    expect(d.reasons).toContain('repair_outcome_improved');
  });

  it('2. worsened rate 高い target は weight が下がる + reason=repair_outcome_worsened', () => {
    const report = makeReport({
      repairOutcomeSummary: makeRepairOutcomeSummary({
        exit: { attempted: 4, improved: 0, worsened: 3, unchanged: 1, unknown: 0 },
      }),
    });
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: report,
    });
    expect(d.nextAllocation.repairTargetWeights.exit).toBeLessThan(1.0);
    expect(d.reasons).toContain('repair_outcome_worsened');
  });

  it('3. attempted が minAttemptedForSignal 未満なら weight 変更しない', () => {
    const report = makeReport({
      repairOutcomeSummary: makeRepairOutcomeSummary({
        exit: { attempted: 1, improved: 1, worsened: 0, unchanged: 0, unknown: 0 },
      }),
    });
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: report,
    });
    expect(d.nextAllocation.repairTargetWeights.exit).toBeUndefined();
  });

  it('4. unknown が多い target は失敗扱いせず、reason=repair_outcome_unknown かつ大変更しない', () => {
    const report = makeReport({
      repairOutcomeSummary: makeRepairOutcomeSummary({
        exit: { attempted: 10, improved: 0, worsened: 0, unchanged: 1, unknown: 9 },
      }),
    });
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: report,
    });
    expect(d.reasons).toContain('repair_outcome_unknown');
    // worsened と判定されない (= 0/10 が worseningRate=0.0 なので元々 trigger されないが、
    // 設計書通り unknown 多数では route 配分を変更しない)
    expect(d.nextAllocation.byRoute.repair_guided_mutation).toBe(
      defaultMutationBudgetAllocationV1.byRoute.repair_guided_mutation,
    );
  });

  it('5. repair_guided_mutation が repairMaxShare を超えない (cap)', () => {
    // 既に repair が cap 付近の baseline を渡し、improved 多数で boost を試みる
    const baseline: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: { ...defaultMutationBudgetAllocationV1.byRoute, repair_guided_mutation: 39 },
    };
    const report = makeReport({
      repairOutcomeSummary: makeRepairOutcomeSummary({
        exit: { attempted: 4, improved: 4, worsened: 0, unchanged: 0, unknown: 0 },
      }),
    });
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: report,
      baselineAllocation: baseline,
    });
    expect(d.nextAllocation.byRoute.repair_guided_mutation).toBeLessThanOrEqual(
      baseline.repairMaxShare,
    );
    expect(d.reasons).toContain('bounded_by_cap');
  });

  it('6. novelty_seed が noveltyFloor を下回らない', () => {
    const baseline: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: { ...defaultMutationBudgetAllocationV1.byRoute, novelty_seed: 5 },
    };
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: makeReport(),
      baselineAllocation: baseline,
    });
    expect(d.nextAllocation.byRoute.novelty_seed).toBeGreaterThanOrEqual(baseline.noveltyFloor);
    expect(d.reasons).toContain('bounded_by_floor');
  });

  it('7. explorationFloor (novelty + random) が守られる', () => {
    const baseline: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: {
        ...defaultMutationBudgetAllocationV1.byRoute,
        novelty_seed: 10,
        random_exploration: 0,
      },
    };
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: makeReport(),
      baselineAllocation: baseline,
    });
    const exp =
      d.nextAllocation.byRoute.novelty_seed + d.nextAllocation.byRoute.random_exploration;
    expect(exp).toBeGreaterThanOrEqual(baseline.explorationFloor);
  });

  it('8. standard_mutation が 0 にならない (= 20%pt floor)', () => {
    const baseline: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: { ...defaultMutationBudgetAllocationV1.byRoute, standard_mutation: 0 },
    };
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: makeReport(),
      baselineAllocation: baseline,
    });
    expect(d.nextAllocation.byRoute.standard_mutation).toBeGreaterThanOrEqual(20);
  });

  it('9. 合計 budget が totalBudget=100 に正規化される', () => {
    const report = makeReport({
      repairOutcomeSummary: makeRepairOutcomeSummary({
        exit: { attempted: 4, improved: 3, worsened: 0, unchanged: 1, unknown: 0 },
      }),
    });
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: report,
    });
    const sum = Object.values(d.nextAllocation.byRoute).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('10. stagnation 時に novelty / random が増え reason=stagnation_detected', () => {
    const trend = emptyTrend();
    trend.repairOutcomeImprovedByGeneration = [0, 0];
    trend.validationConfirmedByGeneration = [0, 0];
    trend.oosPassedByGeneration = [0, 0];
    const baseline = defaultMutationBudgetAllocationV1;
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 2,
      previousReport: makeReport(),
      trendSummary: trend,
      baselineAllocation: baseline,
    });
    const baseExp = baseline.byRoute.novelty_seed + baseline.byRoute.random_exploration;
    const nextExp =
      d.nextAllocation.byRoute.novelty_seed + d.nextAllocation.byRoute.random_exploration;
    expect(nextExp).toBeGreaterThan(baseExp);
    expect(d.reasons).toContain('stagnation_detected');
  });

  it('11. OOS confirmed 増加時に reason=oos_validation_confirmed が立ち、productionEligible は触られない', () => {
    const trend = emptyTrend();
    trend.validationConfirmedByGeneration = [0, 1];
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 2,
      previousReport: makeReport(),
      trendSummary: trend,
    });
    expect(d.reasons).toContain('oos_validation_confirmed');
    // productionEligible は allocation に存在しない (= 触りようがない設計)
  });

  it('12. productionEligibleChanged は summary で常に false', () => {
    const decisions: AdaptiveRepairBudgetDecision[] = [
      decideAdaptiveRepairBudgetV1({
        generationIndex: 1,
        previousReport: makeReport({
          repairOutcomeSummary: makeRepairOutcomeSummary({
            exit: { attempted: 4, improved: 4, worsened: 0, unchanged: 0, unknown: 0 },
          }),
        }),
      }),
    ];
    const s = summarizeAdaptiveRepairBudgetDecisionsV1(decisions);
    expect(s.productionEligibleChanged).toBe(false);
  });

  it('13. enabled=false では baseline allocation を完全維持し reason=no_adaptive_change', () => {
    const baseline = defaultMutationBudgetAllocationV1;
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: makeReport({
        repairOutcomeSummary: makeRepairOutcomeSummary({
          exit: { attempted: 4, improved: 4, worsened: 0, unchanged: 0, unknown: 0 },
        }),
      }),
      baselineAllocation: baseline,
      enabled: false,
    });
    expect(d.enabled).toBe(false);
    expect(d.nextAllocation.byRoute).toEqual(baseline.byRoute);
    expect(d.nextAllocation.repairTargetWeights).toEqual(baseline.repairTargetWeights);
    expect(d.reasons).toContain('no_adaptive_change');
  });

  it('14. floor / cap 発火時に warnings が積まれる', () => {
    const baseline: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      byRoute: { ...defaultMutationBudgetAllocationV1.byRoute, novelty_seed: 1 },
    };
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: makeReport(),
      baselineAllocation: baseline,
    });
    expect(d.warnings.some((w) => w.includes('floor'))).toBe(true);
  });

  it('15. LLM 不使用で deterministic: 同入力なら同 nextAllocation が返る', () => {
    const report = makeReport({
      repairOutcomeSummary: makeRepairOutcomeSummary({
        exit: { attempted: 4, improved: 3, worsened: 0, unchanged: 1, unknown: 0 },
        risk: { attempted: 3, improved: 0, worsened: 2, unchanged: 1, unknown: 0 },
      }),
    });
    const d1 = decideAdaptiveRepairBudgetV1({ generationIndex: 1, previousReport: report });
    const d2 = decideAdaptiveRepairBudgetV1({ generationIndex: 1, previousReport: report });
    expect(d1.nextAllocation).toEqual(d2.nextAllocation);
    expect(d1.repairSignals).toEqual(d2.repairSignals);
  });

  it('追加: previousReport が null なら insufficient_signal + no_adaptive_change', () => {
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 0,
      previousReport: null,
    });
    expect(d.reasons).toContain('insufficient_signal');
    expect(d.reasons).toContain('no_adaptive_change');
    expect(d.nextAllocation.byRoute).toEqual(defaultMutationBudgetAllocationV1.byRoute);
  });

  it('追加: weight 上限/下限が weightFloor / weightCap で守られる', () => {
    const baseline: MutationBudgetAllocation = {
      ...defaultMutationBudgetAllocationV1,
      // 既に cap 直前の weight を持つ
      repairTargetWeights: { exit: adaptiveRepairBudgetThresholdsV1.weightCap - 0.05 },
    };
    const report = makeReport({
      repairOutcomeSummary: makeRepairOutcomeSummary({
        exit: { attempted: 4, improved: 4, worsened: 0, unchanged: 0, unknown: 0 },
      }),
    });
    const d = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: report,
      baselineAllocation: baseline,
    });
    expect(d.nextAllocation.repairTargetWeights.exit).toBeLessThanOrEqual(
      adaptiveRepairBudgetThresholdsV1.weightCap,
    );
  });
});

// =================================================================
// summary
// =================================================================

describe('summarizeAdaptiveRepairBudgetDecisionsV1', () => {
  it('boostedRepairTargets / suppressedRepairTargets を baseline 比較で抽出', () => {
    const d1 = decideAdaptiveRepairBudgetV1({
      generationIndex: 1,
      previousReport: makeReport({
        repairOutcomeSummary: makeRepairOutcomeSummary({
          exit: { attempted: 4, improved: 4, worsened: 0, unchanged: 0, unknown: 0 },
          risk: { attempted: 4, improved: 0, worsened: 4, unchanged: 0, unknown: 0 },
        }),
      }),
    });
    const s = summarizeAdaptiveRepairBudgetDecisionsV1([d1]);
    expect(s.boostedRepairTargets).toContain('exit');
    expect(s.suppressedRepairTargets).toContain('risk');
    expect(s.productionEligibleChanged).toBe(false);
    expect(s.repairShare).toBeGreaterThanOrEqual(0);
    expect(s.noveltyShare).toBeGreaterThanOrEqual(0);
  });

  it('空配列 → enabled=opts.enabled, decisions=0, latestAllocation=null', () => {
    const s = summarizeAdaptiveRepairBudgetDecisionsV1([], { enabled: false });
    expect(s.enabled).toBe(false);
    expect(s.decisions).toBe(0);
    expect(s.latestAllocation).toBeNull();
    expect(s.productionEligibleChanged).toBe(false);
  });
});
