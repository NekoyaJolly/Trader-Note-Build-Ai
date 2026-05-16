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
import {
  decideAdaptiveRepairBudgetV1,
  defaultMutationBudgetAllocationV1,
  summarizeAdaptiveRepairBudgetDecisionsV1,
  type AdaptiveRepairBudgetDecision,
  type AdaptiveRepairBudgetSummary,
  type MutationBudgetAllocation,
} from './adaptiveRepairBudgetPolicy';
import {
  buildArchiveCandidatesFromReportV1,
  createEmptyQualityDiversityArchiveV1,
  qualityDiversityArchiveDefaultsV1,
  selectQualityDiversityArchiveParentsV1,
  summarizeQualityDiversityArchiveV1,
  updateQualityDiversityArchiveV1,
  type QualityDiversityArchiveStateV1,
  type QualityDiversityArchiveSummaryV1,
  type QualityDiversityArchiveUpdateSummaryV1,
} from './qualityDiversityArchiveLite';
import type { StrategyDSL } from '../strategy_dsl/schema';
// Filter Evolution Phase D-1b (2026-05-09): 世代単位 reflection エージェント + lesson 永続化。
// runner は agent / repo を optional 引数で受け取り、未指定時は何もしない (= 既存挙動維持)。
import type { GenerationReflectionAgent, GenerationReflectionInput } from '../agents/GenerationReflectionAgent';
import type {
  GenerationLessonInsertData,
  GenerationLessonPersister,
} from '../../backend/repositories/generationLessonRepository';
import { EVOLUTION_TARGETS } from './evolutionTargets';

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
  /**
   * PR #107: Adaptive Repair / Mutation Budget v1 を有効化するか。default false。
   * 有効時は世代ごとに前世代 GenerationReport から `decideAdaptiveRepairBudgetV1` で
   * 次世代の `MutationBudgetAllocation` を deterministic に計算し、`runOneGeneration`
   * へ optional input として渡す。production_candidate 自動昇格には影響させない。
   */
  adaptiveRepairBudget?: boolean;
  /** PR #107: 初期の MutationBudgetAllocation。未指定なら `defaultMutationBudgetAllocationV1`。 */
  initialMutationBudgetAllocation?: MutationBudgetAllocation;
  /**
   * PR #108: Quality-Diversity Archive Lite v1 を有効化するか。default false。
   * 有効時は世代ごとに `formalBtVerifiedCandidates` から archive を更新し、
   * 次世代の `runOneGeneration` に **少量** (default 2 件) の archive elite を
   * `qualityDiversityArchiveParents` として渡す。production_candidate 自動昇格には影響させない。
   */
  qualityDiversityArchive?: boolean;
  /** PR #108: 各世代に注入する archive parent 数の上限。default 2。 */
  qualityDiversityArchiveParentLimit?: number;
  /**
   * Filter Evolution Phase D-1b (2026-05-09): 世代単位 reflection を有効化するか。
   *
   * 有効時は各世代終了直後に `generationReflectionAgent.reflect()` を呼び、
   * 出力 lessons を `generationLessonRepo` に永続化する。
   * 未指定 / agent / repo が両方 undefined なら何もしない (= 既存挙動維持)。
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.D.3
   */
  generationReflectionAgent?: GenerationReflectionAgent;
  /** Phase D-1b: lessons 永続化口。`generationReflectionAgent` と一緒に inject する。 */
  generationLessonRepo?: GenerationLessonPersister;
  /**
   * Phase D-1b: 直前世代の summary 履歴を reflect 時に渡す上限件数 (default 3)。
   * 多すぎると prompt 肥大化、少なすぎると trend 検出が困難。
   */
  reflectionPriorGenerationsLimit?: number;
  /**
   * Phase D-1b (PR #145 Copilot review #5): GenerationLesson 永続化時の evolutionRunId。
   *
   * runner は `EvolutionLoop` の private な evolutionRunId にアクセスできないため、
   * 呼び出し側 (= sideBScheduler / smoke) が明示的に渡す。`generationReflectionAgent` +
   * `generationLessonRepo` を inject する場合は本フィールドも必須 (= 一緒に渡さないと
   * `null` placeholder で永続化されてしまうリスクを排除)。
   */
  evolutionRunIdForLessons?: string;
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
  /** PR #107: adaptive 有効時のみ非空。 */
  adaptiveRepairBudgetDecisions?: AdaptiveRepairBudgetDecision[];
  /** PR #107: adaptive 有効時のみ非 undefined。 */
  adaptiveRepairBudgetSummary?: AdaptiveRepairBudgetSummary;
  /** PR #108: QD archive 有効時のみ非空。 */
  qualityDiversityArchiveUpdates?: QualityDiversityArchiveUpdateSummaryV1[];
  /** PR #108: QD archive 有効時のみ非 undefined。 */
  qualityDiversityArchiveSummary?: QualityDiversityArchiveSummaryV1;
  /**
   * Phase D-1b (2026-05-09): 各世代の reflection 結果サマリ。
   * generationReflectionAgent が指定されているときのみ非空。
   * 各 entry は `{ generationIndex, lessons[], summary, confidence, persistedCount }` で、
   * lessons は LLM 出力そのまま、persistedCount は実際に DB に永続化された件数 (= < lessons.length なら一部失敗)。
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.D
   */
  generationReflections?: ReadonlyArray<{
    readonly generationIndex: number;
    readonly lessons: ReadonlyArray<{
      readonly category: string;
      readonly lesson: string;
    }>;
    readonly summary: string;
    readonly confidence: number;
    readonly persistedCount: number;
  }>;
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
  /**
   * PR #107: 次世代に使う mutation / repair の配分 (= Adaptive Repair Budget)。
   * v1 では実 mutation count への反映は EvolutionLoop / MutationAgent 側に経路が
   * 整うまで warning ベースの観測経路。runOneGeneration 受け側は optional 受領のみ。
   */
  mutationBudgetAllocation?: MutationBudgetAllocation;
  /**
   * PR #108: Quality-Diversity Archive から渡される少量の親候補 (StrategyDSL)。
   * EvolutionLoop は重複 DSL ID を除外して parent pool に少量混合する。未指定 / 空なら
   * 完全に既存挙動。
   */
  qualityDiversityArchiveParents?: StrategyDSL[];
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
    adaptiveRepairBudget: input.options.adaptiveRepairBudget ?? false,
    qualityDiversityArchive: input.options.qualityDiversityArchive ?? false,
    qualityDiversityArchiveParentLimit:
      input.options.qualityDiversityArchiveParentLimit ??
      qualityDiversityArchiveDefaultsV1.defaultParentLimit,
  };

  // PR #107: adaptive policy が ON のとき、世代ごとに decideAdaptiveRepairBudgetV1 を
  // 呼び decision を作る。next allocation を次世代の callArgs.mutationBudgetAllocation に
  // 注入する。OFF のときは decision/summary を出さない (= 既存動作と同等)。
  const adaptiveEnabled = opts.adaptiveRepairBudget === true;
  const adaptiveDecisions: AdaptiveRepairBudgetDecision[] = [];
  let currentBudgetAllocation: MutationBudgetAllocation =
    opts.initialMutationBudgetAllocation ?? defaultMutationBudgetAllocationV1;

  // PR #108: QD archive が ON のとき、archive state を持ち越して世代ごとに更新する。
  // OFF のときは archive 状態を作らず、callArgs に qualityDiversityArchiveParents を
  // 渡さない (= 既存挙動と完全互換)。
  const qdEnabled = opts.qualityDiversityArchive === true;
  const qdParentLimit =
    opts.qualityDiversityArchiveParentLimit ??
    qualityDiversityArchiveDefaultsV1.defaultParentLimit;
  let qdArchiveState: QualityDiversityArchiveStateV1 = createEmptyQualityDiversityArchiveV1();
  const qdUpdates: QualityDiversityArchiveUpdateSummaryV1[] = [];
  let qdTotalSelectedParents = 0;

  // Phase D-1b: GenerationReflectionAgent + repo + evolutionRunId の 3 点が全て揃ったときのみ ON。
  // PR #145 Copilot review #5: evolutionRunId が未指定だと永続化できないため、必須条件に加える。
  const reflectionEnabled =
    opts.generationReflectionAgent !== undefined &&
    opts.generationLessonRepo !== undefined &&
    opts.evolutionRunIdForLessons !== undefined;
  const reflectionPriorLimit = opts.reflectionPriorGenerationsLimit ?? 3;
  // mutable な作業用配列。最終戻り値時に readonly 配列として公開される。
  const generationReflections: Array<{
    generationIndex: number;
    lessons: Array<{ category: string; lesson: string }>;
    summary: string;
    confidence: number;
    persistedCount: number;
  }> = [];
  // Phase D-1b: reflect 入力用の prior generations 履歴 (= 直近 N 世代の summary)。
  const priorGenerationSummaries: Array<{
    generationIndex: number;
    promotionCandidates: number;
    validationConfirmed: number;
    formalBtPassed: number;
  }> = [];

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
      // PR #107: adaptive ON のときだけ mutationBudgetAllocation を注入する。
      // OFF のときは undefined (= 既存挙動と同等、EvolutionLoop は無視可能)。
      if (adaptiveEnabled) {
        callArgs.mutationBudgetAllocation = currentBudgetAllocation;
      }
      // PR #108: QD archive ON のとき、archive から少量の parent DSL を選んで注入する。
      // 初回 generation は archive が空なので空配列 (= 副作用なし)。
      if (qdEnabled) {
        const qdParents = selectQualityDiversityArchiveParentsV1(qdArchiveState, {
          limit: qdParentLimit,
        });
        if (qdParents.length > 0) {
          callArgs.qualityDiversityArchiveParents = qdParents;
          qdTotalSelectedParents += qdParents.length;
        }
      }
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

      // PR #107: 世代終了後、次世代用の adaptive budget decision を作る。
      // これは「Generation N の観測 → Generation N+1 の budget」の経路で、
      // currentBudgetAllocation を bounded に更新するだけ (production 不変)。
      if (adaptiveEnabled) {
        const decision = decideAdaptiveRepairBudgetV1({
          generationIndex: generationIndex + 1,
          previousReport: report,
          trendSummary: trend,
          baselineAllocation: currentBudgetAllocation,
          enabled: true,
        });
        adaptiveDecisions.push(decision);
        currentBudgetAllocation = decision.nextAllocation;
      }

      // PR #108: 世代終了後、archive を更新する。
      // formalBtVerifiedCandidates の各 candidate には PR #108 で dsl が同梱されているため、
      // runner 側で別途 dsl Map を持たなくても archive 構築できる。
      // input は immutable に扱われ、世代をまたいで archive state が成長する。
      if (qdEnabled) {
        const dslById = new Map<string, StrategyDSL>();
        for (const c of report.formalBtVerifiedCandidates) {
          if (c.dsl) dslById.set(c.dslId, c.dsl);
        }
        const candidates = buildArchiveCandidatesFromReportV1(report, dslById);
        const upd = updateQualityDiversityArchiveV1(qdArchiveState, {
          generationIndex,
          candidates,
        });
        qdArchiveState = upd.nextState;
        qdUpdates.push(upd.updateSummary);
      }

      // Phase D-1b (2026-05-09): 当世代終了直後に reflection を実行し、lessons を永続化。
      // 失敗 (LLM API / Zod / DB) は飲んで世代結果に影響させない (= warning ログのみ)。
      // 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.D.3
      //
      // PR #145 Copilot review #3/#4/#5 対応:
      //   - dead code (`evolutionRunIdForLesson` placeholder) を削除
      //   - 矛盾コメント (= 「runner は永続化しない」と書きつつ実装は永続化していた) を整理
      //   - `evolutionRunId` を `opts.evolutionRunIdForLessons` から受け取る形に変更
      //     (= ダミー UUID + wrapper 上書き設計を排除して型 / 引数で事故を防ぐ)
      if (
        reflectionEnabled &&
        opts.generationReflectionAgent !== undefined &&
        opts.generationLessonRepo !== undefined &&
        opts.evolutionRunIdForLessons !== undefined
      ) {
        try {
          const formalBtPassedCount = report.formalBtVerifiedCandidates.filter(
            (c) => c.formalBtPassed,
          ).length;
          const winRateLiftLogs = report.errors.filter((e) => e.includes('win rate lift'));
          const reflectionInput: GenerationReflectionInput = {
            regime: opts.regime,
            generationIndex,
            generationsTotal: generations,
            promotionCandidates: report.promotionCandidates.length,
            validationConfirmed: report.oosAwarePromotionSummary.validationConfirmed,
            formalBtPassed: formalBtPassedCount,
            mutantsReceived: report.mutantsReceived,
            crossoversReceived: report.crossoversReceived,
            winRateLiftLogs,
            priorGenerations: priorGenerationSummaries.slice(-reflectionPriorLimit),
          };
          const reflection = await opts.generationReflectionAgent.reflect(reflectionInput);
          if (reflection) {
            const evolutionRunIdResolved = opts.evolutionRunIdForLessons;
            const insertResults: boolean[] = [];
            for (const l of reflection.lessons) {
              try {
                const insertData: GenerationLessonInsertData = {
                  evolutionRunId: evolutionRunIdResolved,
                  regime: opts.regime,
                  generation: generationIndex,
                  category: l.category,
                  lesson: l.lesson,
                  metrics: l.metrics,
                  confidence: reflection.confidence,
                };
                await opts.generationLessonRepo.create(insertData);
                insertResults.push(true);
              } catch (e) {
                const m = e instanceof Error ? e.message : String(e);
                runWarnings.push(
                  `generation ${generationIndex} reflection lesson 永続化失敗: ${m}`,
                );
                insertResults.push(false);
              }
            }
            generationReflections.push({
              generationIndex,
              lessons: reflection.lessons.map((l) => ({ category: l.category, lesson: l.lesson })),
              summary: reflection.summary,
              confidence: reflection.confidence,
              persistedCount: insertResults.filter((r) => r).length,
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          runWarnings.push(`generation ${generationIndex} reflection 例外: ${msg}`);
        }
      }

      // Phase D-1b: prior generations 履歴を更新 (reflect の入力に使う)
      priorGenerationSummaries.push({
        generationIndex,
        promotionCandidates: report.promotionCandidates.length,
        validationConfirmed: report.oosAwarePromotionSummary.validationConfirmed,
        formalBtPassed: report.formalBtVerifiedCandidates.filter((c) => c.formalBtPassed).length,
      });
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

      // ===== 追加: 本番運用レベルの戦略発見時の早期ストップ（多様性確保） =====
      let foundProductionReady = false;
      let matchedCondition = '';

      for (const c of report.formalBtVerifiedCandidates) {
        if (!c.formalBtPassed || !c.formalBtMetrics) continue;
        const metrics = c.formalBtMetrics;

        // 基本条件: 取引数が少なすぎる場合は信頼性が低いため除外（最低30件）
        if (metrics.tradeCount < 30) continue;
        for (const target of EVOLUTION_TARGETS) {
          let isMatch = true;
          if (target.minPf !== undefined && metrics.pf < target.minPf) isMatch = false;
          if (target.minWinRate !== undefined && metrics.winRate < target.minWinRate) isMatch = false;
          if (target.minRecoveryFactor !== undefined && (metrics.recoveryFactor == null || metrics.recoveryFactor < target.minRecoveryFactor)) isMatch = false;
          if (target.minRiskReward !== undefined && (metrics.riskReward == null || metrics.riskReward < target.minRiskReward)) isMatch = false;
          if (target.maxDrawdown !== undefined && (metrics.maxDrawdown == null || Math.abs(metrics.maxDrawdown) > target.maxDrawdown)) isMatch = false;

          if (isMatch) {
            foundProductionReady = true;
            matchedCondition = `Set: ${target.name} (${target.description})`;
            break;
          }
        }

        if (foundProductionReady) break;
      }

      if (foundProductionReady) {
        stoppedEarly = true;
        stopReason = `generation ${generationIndex}: production-ready strategy found (${matchedCondition})`;
        break;
      }
      // =====================================================================

      if (noImprovementChecker.push(report)) {
        stoppedEarly = true;
        stopReason = `generation ${generationIndex}: no improvement streak >= ${opts.maxConsecutiveNoImprovement}`;
        break;
      }
    }
  }

  trend.stoppedEarly = stoppedEarly;
  trend.stopReason = stopReason;

  const adaptiveSummary = adaptiveEnabled
    ? summarizeAdaptiveRepairBudgetDecisionsV1(adaptiveDecisions, { enabled: true })
    : undefined;
  const qdSummary = qdEnabled
    ? summarizeQualityDiversityArchiveV1(qdArchiveState, {
        enabled: true,
        selectedParents: qdTotalSelectedParents,
      })
    : undefined;

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    options: opts,
    generations: generationEntries,
    trendSummary: trend,
    finalState: state,
    warnings: runWarnings,
    adaptiveRepairBudgetDecisions: adaptiveEnabled ? adaptiveDecisions : undefined,
    adaptiveRepairBudgetSummary: adaptiveSummary,
    qualityDiversityArchiveUpdates: qdEnabled ? qdUpdates : undefined,
    qualityDiversityArchiveSummary: qdSummary,
    generationReflections: reflectionEnabled ? generationReflections : undefined,
  };
}
