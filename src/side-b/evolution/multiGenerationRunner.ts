/**
 * Multi-generation Evolution Run v1 (Critical-4 PR #106)
 *
 * 目的: 既存の単世代 `runOneGeneration` を **sequential に複数世代実行** し、世代間で
 *   RepairHint / RepairOutcome baseline を引き継ぎ、`MultiGenerationTrendSummary` で
 *   regression / stagnation / explosion を観測できるようにする。
 *
 * 設計方針 (docs/design/pr_106_multi_generation_evolution_run_agent_prompt.md):
 *   - 単世代ロジックを再実装しない (= EvolutionLoop.runOneGeneration を呼ぶ orchestration のみ)
 *   - 並列世代実行しない (= 引き継ぎ順序を明確化)
 *   - mutation budget / parent pool 比率 / repair weight を自動変更しない (= PR #107 責務)
 *   - production_candidate へ自動昇格しない / productionEligible は常に 0 を期待
 *   - analysis-engine を評価正本のまま (Walk Forward / Monte Carlo / Backtest を再実装しない)
 *   - Surrogate Rescue Lane / formalBtCandidateSummary は壊さない
 *
 * @see docs/design/pr_106_multi_generation_evolution_run_agent_prompt.md
 */

import type { GenerationReport } from './EvolutionLoop';
import type { RepairHintMap } from '../agents/MutationAgent';
import type { RepairHint } from './repairHintPolicy';
import type { RepairOutcomeBaseline } from './repairOutcomeTelemetry';
import type { OosValidationResult } from './oosValidationResultMapper';
import type { PromotionGateDecision } from './promotionGatePolicy';

// =================================================================
// 設定
// =================================================================

/** PR #106 default / 上限。設計書 §generations limit。 */
export const MULTI_GENERATION_DEFAULTS = {
  defaultGenerations: 2,
  maxGenerations: 5,
} as const;

// =================================================================
// 型定義
// =================================================================

export interface MultiGenerationRunOptions {
  /** 実行世代数。default 2、上限 5。範囲外は clamp + warning。 */
  generations: number;
  /** 対象 regime (smoke / 本番経路で必須)。型としては optional だが runner 呼び出し側で渡す。 */
  regime: string;
  /**
   * 世代実行例外時に runner を停止するか。
   * - `true` (default): 例外世代を failed として記録し、以降を実行しない
   * - `false`: failed 記録のみ、次世代を継続 (state 引き継ぎは前回成功世代の値を維持)
   */
  stopOnGenerationError?: boolean;
  /** `formalBtCandidateSummary.uniqueCandidates === 0` で停止するか。default false。 */
  stopOnNoFormalBtCandidates?: boolean;
  /** `parentPoolSummary.totalSelected === 0` で停止するか。default false。 */
  stopOnNoParentCandidates?: boolean;
  /**
   * 連続で「improved=0 / validation_confirmed=0 / oos_passed=0」が続いたら停止する閾値。
   * default `undefined` (= 無効)。設計書 §no improvement に従い保守的にのみ作動。
   */
  maxConsecutiveNoImprovement?: number;
  /** Generation N の RepairHint を Generation N+1 mutation に渡すか。default true。 */
  carryRepairHints?: boolean;
  /** Generation N の RepairOutcomeBaseline を Generation N+1 outcome 比較に渡すか。default true。 */
  carryRepairBaselines?: boolean;
  /** 互換用フラグ (PromotionGate 状態の引き継ぎは v1 では observation のみ)。default true。 */
  carryPromotionState?: boolean;
  /** 互換用フラグ (OOS 状態の引き継ぎは v1 では observation のみ)。default true。 */
  carryOosState?: boolean;
}

/**
 * 世代間引き継ぎ state。
 *
 * - `lastRepairHints`: PR #100 経路で Generation N+1 の mutation 入力に渡す
 * - `lastRepairBaselines`: PR #102 経路で Generation N+1 outcome 比較に渡す
 * - `lastPromotionGateDecisions` / `lastOosValidationResults`: 観測のみ (= trend 用に保持)
 */
export interface MultiGenerationRunState {
  lastRepairHints: RepairHintMap;
  lastRepairBaselines: ReadonlyMap<string, RepairOutcomeBaseline>;
  lastPromotionGateDecisions: PromotionGateDecision[];
  lastOosValidationResults: OosValidationResult[];
  warnings: string[];
}

export type MultiGenerationStatus = 'completed' | 'failed' | 'skipped';

export interface MultiGenerationGenerationEntry {
  generationIndex: number;
  startedAt: string;
  finishedAt: string;
  status: MultiGenerationStatus;
  report: GenerationReport | null;
  errorMessage?: string;
  warnings: string[];
}

export interface MultiGenerationTrendSummary {
  generationsRequested: number;
  generationsCompleted: number;
  generationsFailed: number;
  stoppedEarly: boolean;
  stopReason: string | null;
  formalBtCandidatesByGeneration: number[];
  formalBtPassedByGeneration: number[];
  repairHintsByGeneration: number[];
  repairOutcomeImprovedByGeneration: number[];
  validationCandidatesByGeneration: number[];
  validationConfirmedByGeneration: number[];
  oosPassedByGeneration: number[];
  oosFailedByGeneration: number[];
  productionEligibleByGeneration: number[];
  warnings: string[];
}

export interface MultiGenerationRunReport {
  startedAt: string;
  finishedAt: string;
  options: MultiGenerationRunOptions;
  generations: MultiGenerationGenerationEntry[];
  trendSummary: MultiGenerationTrendSummary;
  finalState: MultiGenerationRunState;
  warnings: string[];
}

/**
 * runner が単世代実行関数に渡す引数。
 *
 * 既存 `EvolutionLoop.runOneGeneration(regime, options)` の signature と互換になるよう、
 * 引数は名前付き object 1 つで受け取る形に揃える (= 呼び出し側で adapter 化する)。
 */
export interface RunOneGenerationCall {
  generationIndex: number;
  regime: string;
  repairHintsForMutation?: RepairHintMap;
  repairBaselinesForOutcome?: ReadonlyMap<string, RepairOutcomeBaseline>;
  /** 観測専用 (v1 では実行に影響させない、将来 PR の adaptive 制御用フック)。 */
  previousPromotionGateDecisions?: PromotionGateDecision[];
  previousOosValidationResults?: OosValidationResult[];
}

export type MultiGenerationRunOneGenerationFn = (
  call: RunOneGenerationCall,
) => Promise<GenerationReport>;

// =================================================================
// helpers
// =================================================================

function emptyState(): MultiGenerationRunState {
  return {
    lastRepairHints: new Map(),
    lastRepairBaselines: new Map(),
    lastPromotionGateDecisions: [],
    lastOosValidationResults: [],
    warnings: [],
  };
}

function emptyTrend(generationsRequested: number): MultiGenerationTrendSummary {
  return {
    generationsRequested,
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

/** RepairHint を mutation 入力として安全に次世代へ渡せるものだけに絞る。 */
function filterCarriableRepairHints(
  source: ReadonlyArray<{ dslId: string; repairHint: RepairHint }>,
): RepairHintMap {
  const out = new Map<string, RepairHint>();
  for (const { dslId, repairHint } of source) {
    if (!repairHint) continue;
    // 設計書 §RepairHint:
    //   - shouldExcludeFromParentPool=true (fatal / repair_excluded) は次世代に渡さない
    //   - shouldUseForRepairMutation=false は次世代 mutation の修復素材にしない
    if (repairHint.shouldExcludeFromParentPool) continue;
    if (!repairHint.shouldUseForRepairMutation) continue;
    out.set(dslId, repairHint);
  }
  return out;
}

/** Generation N の formalBtVerifiedCandidates から RepairHint を集める。 */
function collectRepairHintsFromReport(report: GenerationReport): RepairHintMap {
  const pairs: { dslId: string; repairHint: RepairHint }[] = [];
  for (const c of report.formalBtVerifiedCandidates) {
    if (c.repairHint) pairs.push({ dslId: c.dslId, repairHint: c.repairHint });
  }
  return filterCarriableRepairHints(pairs);
}

/** Generation N の failed candidate metrics から RepairOutcomeBaseline を集める。 */
function collectRepairBaselinesFromReport(
  report: GenerationReport,
): ReadonlyMap<string, RepairOutcomeBaseline> {
  const out = new Map<string, RepairOutcomeBaseline>();
  for (const c of report.formalBtVerifiedCandidates) {
    if (c.formalBtPassed) continue;
    const m = c.formalBtMetrics;
    out.set(c.dslId, {
      candidateId: c.dslId,
      dslId: c.dslId,
      failureReason: c.repairHint?.failureReason ?? c.formalBtFailureReason ?? 'other',
      route: c.route,
      metrics: m
        ? { pf: m.pf, tradeCount: m.tradeCount, maxDrawdown: m.maxDrawdown }
        : {},
    });
  }
  return out;
}

function clampGenerations(requested: number): { value: number; warning: string | null } {
  const max = MULTI_GENERATION_DEFAULTS.maxGenerations;
  if (!Number.isFinite(requested) || requested < 1) {
    return {
      value: MULTI_GENERATION_DEFAULTS.defaultGenerations,
      warning: `generations=${requested} は不正値、default ${MULTI_GENERATION_DEFAULTS.defaultGenerations} に clamp`,
    };
  }
  const intVal = Math.floor(requested);
  if (intVal > max) {
    return { value: max, warning: `generations=${intVal} は上限 ${max} を超過、clamp` };
  }
  return { value: intVal, warning: null };
}

interface NoImprovementChecker {
  push(report: GenerationReport): boolean;
}

function makeNoImprovementChecker(maxConsecutive: number | undefined): NoImprovementChecker {
  if (!maxConsecutive || maxConsecutive <= 0) {
    return { push: () => false };
  }
  let streak = 0;
  return {
    push(report: GenerationReport): boolean {
      const improved = report.repairOutcomeSummary.improved;
      const validationConfirmed = report.oosAwarePromotionSummary.validationConfirmed;
      const oosPassed =
        report.oosValidationSummary.byStatus.oos_passed +
        report.oosValidationSummary.byStatus.walk_forward_passed;
      if (improved === 0 && validationConfirmed === 0 && oosPassed === 0) {
        streak += 1;
      } else {
        streak = 0;
      }
      return streak >= maxConsecutive;
    },
  };
}

// =================================================================
// runner 本体
// =================================================================

/**
 * 複数世代を sequential に実行する。
 *
 * - 引数 `runOneGeneration` で単世代実行を完全に外注する (= runner 自体は orchestration のみ)
 * - Generation N の RepairHint / Baseline を Generation N+1 の入力に渡す
 *   (= `carryRepairHints` / `carryRepairBaselines` で個別に切れる、default ON)
 * - stop condition は最小限 (no formalBt candidates / no parent / generation error /
 *   no improvement streak)
 * - PromotionGate / OOS 結果の **再判定はしない**。観測のみ (= trend summary に集計)
 */
export async function runMultiGenerationEvolutionV1(input: {
  options: MultiGenerationRunOptions;
  runOneGeneration: MultiGenerationRunOneGenerationFn;
}): Promise<MultiGenerationRunReport> {
  const startedAt = new Date().toISOString();
  const requested = input.options.generations;
  const { value: generations, warning: clampWarning } = clampGenerations(requested);

  const opts: MultiGenerationRunOptions = {
    ...input.options,
    generations,
    stopOnGenerationError: input.options.stopOnGenerationError ?? true,
    stopOnNoFormalBtCandidates: input.options.stopOnNoFormalBtCandidates ?? false,
    stopOnNoParentCandidates: input.options.stopOnNoParentCandidates ?? false,
    carryRepairHints: input.options.carryRepairHints ?? true,
    carryRepairBaselines: input.options.carryRepairBaselines ?? true,
    carryPromotionState: input.options.carryPromotionState ?? true,
    carryOosState: input.options.carryOosState ?? true,
  };

  const trend = emptyTrend(requested);
  const runWarnings: string[] = [];
  if (clampWarning) {
    trend.warnings.push(clampWarning);
    runWarnings.push(clampWarning);
  }

  const generationEntries: MultiGenerationGenerationEntry[] = [];
  let state = emptyState();
  let stoppedEarly = false;
  let stopReason: string | null = null;

  const noImprovementChecker = makeNoImprovementChecker(opts.maxConsecutiveNoImprovement);

  for (let i = 0; i < generations; i += 1) {
    const generationIndex = i;
    const entryStartedAt = new Date().toISOString();
    let report: GenerationReport | null = null;
    let status: MultiGenerationStatus = 'completed';
    let errorMessage: string | undefined;
    const entryWarnings: string[] = [];

    try {
      // PR #106 Copilot review #1:
      // 常に明示的に Map / 配列を渡す。`size>0 のときだけ渡す` にすると、
      // EvolutionLoop 内部の `options?.repairHintsForMutation ?? this.lastRepairHints`
      // フォールバック (PR #100 経路) が発火し、carryRepairHints=false や
      // 「初回は空を明示したい」ケースでも前回実行の hints/baselines が混入する。
      // 空 Map / 空配列は truthy なので `??` に引っかからず、フォールバックを封じられる。
      const callArgs: RunOneGenerationCall = {
        generationIndex,
        regime: opts.regime,
        repairHintsForMutation: opts.carryRepairHints
          ? state.lastRepairHints
          : new Map<string, RepairHint>(),
        repairBaselinesForOutcome: opts.carryRepairBaselines
          ? state.lastRepairBaselines
          : new Map<string, RepairOutcomeBaseline>(),
        previousPromotionGateDecisions: opts.carryPromotionState
          ? state.lastPromotionGateDecisions
          : [],
        previousOosValidationResults: opts.carryOosState
          ? state.lastOosValidationResults
          : [],
      };
      report = await input.runOneGeneration(callArgs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status = 'failed';
      errorMessage = msg;
      entryWarnings.push(`generation ${generationIndex} 例外: ${msg}`);
      runWarnings.push(`generation ${generationIndex} 例外: ${msg}`);
    }

    const finishedAt = new Date().toISOString();
    generationEntries.push({
      generationIndex,
      startedAt: entryStartedAt,
      finishedAt,
      status,
      report,
      errorMessage,
      warnings: entryWarnings,
    });

    if (status === 'completed' && report) {
      // trend 更新
      trend.generationsCompleted += 1;
      trend.formalBtCandidatesByGeneration.push(
        report.formalBtCandidateSummary.uniqueCandidates,
      );
      trend.formalBtPassedByGeneration.push(report.promotionCandidates.length);
      trend.repairHintsByGeneration.push(report.repairHintSummary.totalFailures);
      trend.repairOutcomeImprovedByGeneration.push(report.repairOutcomeSummary.improved);
      trend.validationCandidatesByGeneration.push(
        report.promotionGateSummary.byStage.validation_candidate,
      );
      trend.validationConfirmedByGeneration.push(
        report.oosAwarePromotionSummary.validationConfirmed,
      );
      trend.oosPassedByGeneration.push(
        report.oosValidationSummary.byStatus.oos_passed +
          report.oosValidationSummary.byStatus.walk_forward_passed,
      );
      trend.oosFailedByGeneration.push(
        report.oosValidationSummary.byStatus.oos_failed +
          report.oosValidationSummary.byStatus.walk_forward_failed,
      );
      trend.productionEligibleByGeneration.push(report.promotionGateSummary.productionEligible);

      // state 更新 (= 次世代の入力)
      const nextRepairHints = opts.carryRepairHints
        ? collectRepairHintsFromReport(report)
        : new Map<string, RepairHint>();
      const nextRepairBaselines = opts.carryRepairBaselines
        ? collectRepairBaselinesFromReport(report)
        : new Map<string, RepairOutcomeBaseline>();
      state = {
        lastRepairHints: nextRepairHints,
        lastRepairBaselines: nextRepairBaselines,
        lastPromotionGateDecisions: opts.carryPromotionState
          ? [...report.promotionGateDecisions]
          : [],
        lastOosValidationResults: opts.carryOosState
          ? [...report.oosValidationResults]
          : [],
        warnings: state.warnings,
      };
    } else if (status === 'failed') {
      trend.generationsFailed += 1;
      if (opts.stopOnGenerationError) {
        stoppedEarly = true;
        stopReason = `generation ${generationIndex} で例外: ${errorMessage ?? 'unknown'}`;
        break;
      }
      // 継続する場合: 既存 state を維持 (= 前回成功世代の hints / baselines が残る)
    }

    // stop conditions (= completed 世代の後だけ評価)
    if (status === 'completed' && report) {
      if (
        opts.stopOnNoFormalBtCandidates &&
        report.formalBtCandidateSummary.uniqueCandidates === 0
      ) {
        stoppedEarly = true;
        stopReason = `generation ${generationIndex}: formalBtCandidateSummary.uniqueCandidates=0`;
        break;
      }
      if (
        opts.stopOnNoParentCandidates &&
        report.parentPoolSummary.totalSelected === 0
      ) {
        stoppedEarly = true;
        stopReason = `generation ${generationIndex}: parentPoolSummary.totalSelected=0`;
        break;
      }
      if (noImprovementChecker.push(report)) {
        stoppedEarly = true;
        stopReason = `generation ${generationIndex}: no improvement streak >= ${opts.maxConsecutiveNoImprovement}`;
        break;
      }
    }
  }

  trend.stoppedEarly = stoppedEarly;
  trend.stopReason = stopReason;

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    options: opts,
    generations: generationEntries,
    trendSummary: trend,
    finalState: state,
    warnings: runWarnings,
  };
}
