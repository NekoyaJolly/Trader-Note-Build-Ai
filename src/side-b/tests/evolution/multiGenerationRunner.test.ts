/**
 * PR #106: Multi-generation Evolution Run v1 のテスト。
 *
 * 設計書 §テスト要件 (15 項目) を pin する:
 *   1. generations=2 で runOneGeneration が 2 回呼ばれる
 *   2. generations=1 で単世代相当
 *   3. generations 上限超過時に clamp + warning
 *   4. Generation 1 の repairHints が Generation 2 に渡される
 *   5. fatal / repair_excluded の repairHint は次世代へ渡されない
 *   6. GenerationReport が世代ごとに保存される
 *   7. 世代エラー時に stopOnGenerationError=true なら停止
 *   8. stopOnGenerationError=false の場合、failed entry が記録され継続される
 *   9. formalBtCandidateSummary が 0 で stop オプション true なら早期停止
 *   10. parentPoolSummary が 0 で stop オプション true なら早期停止
 *   11. trendSummary.formalBtCandidatesByGeneration が集計される
 *   12. trendSummary.repairOutcomeImprovedByGeneration が集計される
 *   13. trendSummary.validationConfirmedByGeneration が集計される
 *   14. trendSummary.productionEligibleByGeneration が集計される
 *   15. productionEligible が 0 のままでも正常完了する
 *
 * 加えて、Rescue Lane / formalBtCandidateSummary の保護も pin する (= summary が
 * trend に必ず流れることを生成軸で保証)。
 */

import {
  MULTI_GENERATION_DEFAULTS,
  runMultiGenerationEvolutionV1,
  type MultiGenerationRunOneGenerationFn,
} from '../../evolution/multiGenerationRunner';
import type {
  EvolutionPromotionCandidate,
  GenerationReport,
} from '../../evolution/EvolutionLoop';
import type { RepairHint } from '../../evolution/repairHintPolicy';

// =================================================================
// Fixture builder
// =================================================================

function emptyOosBuckets() {
  return {
    oos_passed: 0,
    oos_failed: 0,
    walk_forward_passed: 0,
    walk_forward_failed: 0,
    insufficient_oos_data: 0,
    not_evaluated: 0,
    unknown: 0,
  };
}

function emptyFailureReasonBuckets() {
  return {
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
  };
}

interface ReportOverrides {
  formalBtUniqueCandidates?: number;
  formalBtPassedCount?: number;
  parentPoolTotalSelected?: number;
  repairHintTotalFailures?: number;
  repairOutcomeImproved?: number;
  validationCandidates?: number;
  validationConfirmed?: number;
  oosPassed?: number;
  oosFailed?: number;
  productionEligible?: number;
  formalBtVerifiedCandidates?: EvolutionPromotionCandidate[];
}

function makeReport(o: ReportOverrides = {}): GenerationReport {
  const oos_passed = o.oosPassed ?? 0;
  const oos_failed = o.oosFailed ?? 0;
  const oosByStatus = { ...emptyOosBuckets(), oos_passed, oos_failed };
  return {
    regime: 'breakout',
    scores: {},
    eliteIds: [],
    mutantsReceived: 0,
    crossoversReceived: 0,
    addedToPopulation: 0,
    formalBtVerifiedCandidates: o.formalBtVerifiedCandidates ?? [],
    promotionCandidates:
      (o.formalBtVerifiedCandidates ?? []).filter((c) => c.formalBtPassed).length > 0
        ? (o.formalBtVerifiedCandidates ?? []).filter((c) => c.formalBtPassed)
        : Array.from({ length: o.formalBtPassedCount ?? 0 }, (_, i) =>
            makePassedCandidate(`pass-${i}`),
          ),
    lowDiversityBoost: false,
    errors: [],
    parentPoolSummary: {
      requested: {} as never,
      selected: {} as never,
      fallbackApplied: false,
      fallbackReason: null,
      totalSelected: o.parentPoolTotalSelected ?? 5,
    },
    formalBtCandidateSummary: {
      normalPass: 0,
      nearMissRescue: 0,
      noveltyRescue: 0,
      lowDrawdownRescue: 0,
      tradeCountRescue: 0,
      killed: 0,
      uniqueCandidates: o.formalBtUniqueCandidates ?? 3,
      duplicateRemoved: 0,
      fallbackApplied: false,
      fallbackReason: null,
    },
    repairHintSummary: {
      totalFailures: o.repairHintTotalFailures ?? 0,
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
        validation_candidate: o.validationCandidates ?? 0,
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
      productionEligible: o.productionEligible ?? 0,
      repairable: 0,
      repairExcluded: 0,
      warnings: [],
    },
    promotionGateDecisions: [],
    repairOutcomeSummary: {
      attempted: 0,
      improved: o.repairOutcomeImproved ?? 0,
      worsened: 0,
      unchanged: 0,
      unknown: 0,
      byFailureReason: {},
      byActionTarget: {},
      byRoute: {},
      warnings: [],
    },
    repairOutcomes: [],
    oosValidationSummary: {
      attempted: oos_passed + oos_failed,
      passed: oos_passed,
      failed: oos_failed,
      notEvaluated: 0,
      unknown: 0,
      byStatus: oosByStatus,
      byFailureReason: emptyFailureReasonBuckets(),
      byRoute: {},
      bySourceStage: {},
      warnings: [],
    },
    oosValidationResults: [],
    oosAwarePromotionSummary: {
      totalCandidates: 0,
      validationCandidatesEvaluated: o.validationCandidates ?? 0,
      validationConfirmed: o.validationConfirmed ?? 0,
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

function makePassedCandidate(id: string): EvolutionPromotionCandidate {
  return {
    dslId: id,
    source: 'evolution',
    regime: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    trainPf: 1.6,
    validationPf: 1.4,
    overfitScore: 0.15,
    validationTradeCount: 30,
    formalBtPassed: true,
    formalBtMetrics: { pf: 1.5, winRate: 0.55, tradeCount: 30, maxDrawdown: 8 },
    route: 'normal_pass',
  };
}

function makeFailedCandidateWithHint(
  id: string,
  hint: RepairHint,
): EvolutionPromotionCandidate {
  return {
    dslId: id,
    source: 'evolution',
    regime: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    trainPf: 1.0,
    validationPf: 0.8,
    overfitScore: 0.4,
    validationTradeCount: 5,
    formalBtPassed: false,
    formalBtMetrics: { pf: 0.7, winRate: 0.3, tradeCount: 5, maxDrawdown: 30 },
    formalBtFailureReason: 'pf 0.7 < 1.0',
    route: 'near_miss_rescue',
    repairHint: hint,
  };
}

const repairableHint: RepairHint = {
  failureReason: 'low_pf',
  severity: 'medium',
  summary: 'PF 不足',
  actions: [
    {
      target: 'exit',
      instruction: 'TP/SL バランスを調整',
      allowedChangeScope: 'medium',
    },
  ],
  mutationGuidance: 'exit 周りを優先的に変異',
  shouldUseForRepairMutation: true,
  shouldExcludeFromParentPool: false,
  warnings: [],
};

const fatalHint: RepairHint = {
  failureReason: 'dsl_missing',
  severity: 'fatal',
  summary: 'DSL 不在',
  actions: [],
  mutationGuidance: '',
  shouldUseForRepairMutation: false,
  shouldExcludeFromParentPool: true,
  warnings: [],
};

// =================================================================
// Tests
// =================================================================

describe('runMultiGenerationEvolutionV1', () => {
  it('1. generations=2 で runOneGeneration が 2 回呼ばれる', async () => {
    const runOneGeneration = jest.fn<
      ReturnType<MultiGenerationRunOneGenerationFn>,
      Parameters<MultiGenerationRunOneGenerationFn>
    >(async ({ generationIndex }) =>
      makeReport({ formalBtUniqueCandidates: generationIndex === 0 ? 2 : 3 }),
    );
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 2, regime: 'breakout' },
      runOneGeneration,
    });
    expect(runOneGeneration).toHaveBeenCalledTimes(2);
    expect(r.generations).toHaveLength(2);
    expect(r.generations.every((g) => g.status === 'completed')).toBe(true);
    expect(r.trendSummary.generationsCompleted).toBe(2);
  });

  it('2. generations=1 で単世代相当', async () => {
    const runOneGeneration = jest.fn(async () => makeReport());
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 1, regime: 'breakout' },
      runOneGeneration,
    });
    expect(runOneGeneration).toHaveBeenCalledTimes(1);
    expect(r.generations).toHaveLength(1);
    expect(r.trendSummary.formalBtCandidatesByGeneration).toHaveLength(1);
  });

  it('3. generations 上限 (=5) を超過すると clamp + warning', async () => {
    const runOneGeneration = jest.fn(async () => makeReport());
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 99, regime: 'breakout' },
      runOneGeneration,
    });
    expect(runOneGeneration).toHaveBeenCalledTimes(MULTI_GENERATION_DEFAULTS.maxGenerations);
    expect(r.trendSummary.warnings.some((w) => w.includes('上限'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('上限'))).toBe(true);
  });

  it('4. Generation 1 の repairHints が Generation 2 mutation に渡される', async () => {
    const calls: Array<{ idx: number; hintsSize: number }> = [];
    const runOneGeneration = jest.fn(async ({ generationIndex, repairHintsForMutation }) => {
      calls.push({ idx: generationIndex, hintsSize: repairHintsForMutation?.size ?? 0 });
      return makeReport({
        formalBtVerifiedCandidates: [
          makeFailedCandidateWithHint('c1', repairableHint),
        ],
      });
    });
    await runMultiGenerationEvolutionV1({
      options: { generations: 2, regime: 'breakout' },
      runOneGeneration,
    });
    expect(calls[0].hintsSize).toBe(0); // 初回は空
    expect(calls[1].hintsSize).toBe(1); // 2 世代目に c1 の hint が渡る
  });

  it('5. fatal / repair_excluded (shouldExcludeFromParentPool=true) は次世代へ渡されない', async () => {
    const calls: Array<{ idx: number; hintsSize: number }> = [];
    const runOneGeneration = jest.fn(async ({ generationIndex, repairHintsForMutation }) => {
      calls.push({ idx: generationIndex, hintsSize: repairHintsForMutation?.size ?? 0 });
      return makeReport({
        formalBtVerifiedCandidates: [
          makeFailedCandidateWithHint('c-repairable', repairableHint),
          makeFailedCandidateWithHint('c-fatal', fatalHint),
        ],
      });
    });
    await runMultiGenerationEvolutionV1({
      options: { generations: 2, regime: 'breakout' },
      runOneGeneration,
    });
    expect(calls[1].hintsSize).toBe(1); // fatal は除外され repairable のみ
  });

  it('6. GenerationReport が世代ごとに保存される', async () => {
    let i = 0;
    const runOneGeneration = jest.fn(async () => {
      i += 1;
      return makeReport({ formalBtUniqueCandidates: i });
    });
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 3, regime: 'breakout' },
      runOneGeneration,
    });
    expect(r.generations.map((g) => g.report?.formalBtCandidateSummary.uniqueCandidates)).toEqual([
      1, 2, 3,
    ]);
  });

  it('7. 世代エラー時に stopOnGenerationError=true (default) なら停止する', async () => {
    let count = 0;
    const runOneGeneration = jest.fn(async () => {
      count += 1;
      if (count === 2) throw new Error('boom');
      return makeReport();
    });
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 5, regime: 'breakout' },
      runOneGeneration,
    });
    expect(runOneGeneration).toHaveBeenCalledTimes(2);
    expect(r.trendSummary.stoppedEarly).toBe(true);
    expect(r.trendSummary.stopReason).toMatch(/generation 1/);
    expect(r.trendSummary.generationsFailed).toBe(1);
    expect(r.generations[1].status).toBe('failed');
    expect(r.generations[1].errorMessage).toBe('boom');
  });

  it('8. stopOnGenerationError=false の場合、failed entry を記録して次世代を継続', async () => {
    let count = 0;
    const runOneGeneration = jest.fn(async () => {
      count += 1;
      if (count === 1) throw new Error('first-fail');
      return makeReport();
    });
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 3, regime: 'breakout', stopOnGenerationError: false },
      runOneGeneration,
    });
    expect(runOneGeneration).toHaveBeenCalledTimes(3);
    expect(r.trendSummary.stoppedEarly).toBe(false);
    expect(r.trendSummary.generationsFailed).toBe(1);
    expect(r.trendSummary.generationsCompleted).toBe(2);
    expect(r.generations[0].status).toBe('failed');
    expect(r.generations[1].status).toBe('completed');
  });

  it('9. formalBtCandidateSummary.uniqueCandidates=0 + stopOnNoFormalBtCandidates=true → 早期停止', async () => {
    const runOneGeneration = jest.fn(async () => makeReport({ formalBtUniqueCandidates: 0 }));
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 3, regime: 'breakout', stopOnNoFormalBtCandidates: true },
      runOneGeneration,
    });
    expect(runOneGeneration).toHaveBeenCalledTimes(1);
    expect(r.trendSummary.stoppedEarly).toBe(true);
    expect(r.trendSummary.stopReason).toMatch(/uniqueCandidates=0/);
  });

  it('10. parentPoolSummary.totalSelected=0 + stopOnNoParentCandidates=true → 早期停止', async () => {
    const runOneGeneration = jest.fn(async () => makeReport({ parentPoolTotalSelected: 0 }));
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 3, regime: 'breakout', stopOnNoParentCandidates: true },
      runOneGeneration,
    });
    expect(runOneGeneration).toHaveBeenCalledTimes(1);
    expect(r.trendSummary.stoppedEarly).toBe(true);
    expect(r.trendSummary.stopReason).toMatch(/totalSelected=0/);
  });

  it('11. trendSummary.formalBtCandidatesByGeneration が世代ごと集計される', async () => {
    const counts = [3, 2, 4];
    let i = 0;
    const runOneGeneration = jest.fn(async () =>
      makeReport({ formalBtUniqueCandidates: counts[i++] }),
    );
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 3, regime: 'breakout' },
      runOneGeneration,
    });
    expect(r.trendSummary.formalBtCandidatesByGeneration).toEqual([3, 2, 4]);
  });

  it('12. trendSummary.repairOutcomeImprovedByGeneration が集計される', async () => {
    const improved = [0, 1, 2];
    let i = 0;
    const runOneGeneration = jest.fn(async () =>
      makeReport({ repairOutcomeImproved: improved[i++] }),
    );
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 3, regime: 'breakout' },
      runOneGeneration,
    });
    expect(r.trendSummary.repairOutcomeImprovedByGeneration).toEqual([0, 1, 2]);
  });

  it('13. trendSummary.validationConfirmedByGeneration が oosAwarePromotionSummary 由来で集計される', async () => {
    const confirmed = [0, 1];
    let i = 0;
    const runOneGeneration = jest.fn(async () =>
      makeReport({ validationConfirmed: confirmed[i++] }),
    );
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 2, regime: 'breakout' },
      runOneGeneration,
    });
    expect(r.trendSummary.validationConfirmedByGeneration).toEqual([0, 1]);
  });

  it('14. trendSummary.productionEligibleByGeneration が集計される', async () => {
    // PR #106 不変条件: productionEligible は常に 0 を期待
    const runOneGeneration = jest.fn(async () => makeReport({ productionEligible: 0 }));
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 2, regime: 'breakout' },
      runOneGeneration,
    });
    expect(r.trendSummary.productionEligibleByGeneration).toEqual([0, 0]);
  });

  it('15. productionEligible が 0 のままでも正常完了する', async () => {
    const runOneGeneration = jest.fn(async () => makeReport({ productionEligible: 0 }));
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 2, regime: 'breakout' },
      runOneGeneration,
    });
    expect(r.trendSummary.stoppedEarly).toBe(false);
    expect(r.trendSummary.generationsCompleted).toBe(2);
    expect(r.trendSummary.productionEligibleByGeneration.every((v) => v === 0)).toBe(true);
  });

  it('16. carryRepairHints=false なら hint を次世代へ渡さない', async () => {
    const calls: number[] = [];
    const runOneGeneration = jest.fn(async ({ repairHintsForMutation }) => {
      calls.push(repairHintsForMutation?.size ?? 0);
      return makeReport({
        formalBtVerifiedCandidates: [makeFailedCandidateWithHint('c1', repairableHint)],
      });
    });
    await runMultiGenerationEvolutionV1({
      options: { generations: 2, regime: 'breakout', carryRepairHints: false },
      runOneGeneration,
    });
    expect(calls).toEqual([0, 0]); // 2 世代目も 0
  });

  it('17. maxConsecutiveNoImprovement で連続無改善時に早期停止', async () => {
    const runOneGeneration = jest.fn(async () => makeReport()); // 何も improved/confirmed なし
    const r = await runMultiGenerationEvolutionV1({
      options: {
        generations: 5,
        regime: 'breakout',
        maxConsecutiveNoImprovement: 2,
      },
      runOneGeneration,
    });
    // 1 世代目: streak=1, 2 世代目: streak=2 → 停止
    expect(runOneGeneration).toHaveBeenCalledTimes(2);
    expect(r.trendSummary.stoppedEarly).toBe(true);
    expect(r.trendSummary.stopReason).toMatch(/no improvement streak/);
  });

  it('18. Rescue Lane / formalBtCandidateSummary.uniqueCandidates が trend に必ず流れる (= 保護 pin)', async () => {
    const runOneGeneration = jest.fn(async () => makeReport({ formalBtUniqueCandidates: 2 }));
    const r = await runMultiGenerationEvolutionV1({
      options: { generations: 2, regime: 'breakout' },
      runOneGeneration,
    });
    expect(r.trendSummary.formalBtCandidatesByGeneration.every((v) => v === 2)).toBe(true);
    // 各世代の report に formalBtCandidateSummary が残る (= 削除されていない)
    for (const g of r.generations) {
      expect(g.report?.formalBtCandidateSummary).toBeDefined();
    }
  });
});
