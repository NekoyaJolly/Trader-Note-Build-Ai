/**
 * Promotion Gate / EvolutionCandidateStage v1 (Critical-4 PR #101)
 *
 * 目的: 進化ループ内の候補がどの検証段階にいるかを `EvolutionCandidateStage` で
 *   一意に表現し、`PromotionGatePolicy` で deterministic に状態遷移を判定する。
 *
 * 設計書 §基本方針:
 *   1. EdgeStatus と EvolutionCandidateStage を分ける (= 仮説の業務状態 vs 進化候補の検証段階)
 *   2. DB 保存しない v1 (in-memory / GenerationReport / smoke のみ)
 *   3. formal_bt_passed != production_ready
 *   4. rescue は昇格ではなく「正式 BT で確認する価値がある」だけ
 *   5. repairHint は昇格ではなく次世代 mutation の補助情報
 *
 * スコープ外:
 *   - DB migration / EdgeStatus 拡張 / StatusManager 変更
 *   - production_ready 自動昇格 / OOS / walk-forward
 *   - mutation budget 自動調整 / outcome telemetry (= PR #102)
 *
 * @see docs/design/pr_101_promotion_gate_evolution_candidate_stage_agent_prompt.md
 */

// =================================================================
// 型定義 (設計書 §型定義)
// =================================================================

/**
 * 進化候補としての検証段階。
 *
 * `EdgeStatus` (= EdgeHypothesis の業務状態) とは別軸で、進化ループ内の
 * 「どこまで検証が進んだか」だけを表す。
 */
export type EvolutionCandidateStage =
  | 'generated'
  | 'parent_eligible'
  | 'surrogate_candidate'
  | 'formal_bt_candidate'
  | 'formal_bt_passed'
  | 'formal_bt_failed'
  | 'repairable'
  | 'repair_excluded'
  | 'validation_candidate'
  | 'validation_confirmed'
  | 'production_candidate'
  | 'rejected';

/** PromotionGate の判定結果。 */
export type PromotionGateDecisionKind =
  | 'hold'
  | 'promote_to_parent_eligible'
  | 'promote_to_formal_bt_candidate'
  | 'promote_to_formal_bt_passed'
  | 'promote_to_repairable'
  | 'promote_to_validation_candidate'
  | 'mark_repair_excluded'
  | 'mark_rejected';

/** 判定理由 (複数積み上がる)。 */
export type PromotionGateReason =
  | 'source_parent_pool'
  | 'normal_pass'
  | 'rescue_lane'
  | 'formal_bt_passed'
  | 'formal_bt_failed'
  | 'repair_hint_available'
  | 'repair_hint_fatal'
  | 'dsl_missing'
  | 'schema_validation_failed'
  | 'analysis_engine_error'
  | 'insufficient_metrics'
  | 'validation_not_run'
  | 'oos_not_run'
  | 'manual_hold'
  | 'unknown';

/** 候補ごとの PromotionGate 判定。 */
export interface PromotionGateDecision {
  candidateId: string;
  dslId?: string;
  fromStage: EvolutionCandidateStage | null;
  toStage: EvolutionCandidateStage;
  decision: PromotionGateDecisionKind;
  reasons: PromotionGateReason[];
  route?: string;
  source?: string;
  failureReason?: string | null;
  formalBtPassed?: boolean | null;
  repairable?: boolean;
  productionEligible: boolean;
  warnings: string[];
}

/** GenerationReport / smoke に出す集計。 */
export interface PromotionGateSummary {
  totalCandidates: number;
  byStage: Record<EvolutionCandidateStage, number>;
  byDecision: Record<PromotionGateDecisionKind, number>;
  byReason: Record<PromotionGateReason, number>;
  productionEligible: number;
  repairable: number;
  repairExcluded: number;
  warnings: string[];
}

// =================================================================
// 入力契約
// =================================================================

/**
 * `decidePromotionGateV1` の入力。
 *
 * - `repairHint` は PR #100 `RepairHint` の必要部分のみを構造的に受け取る
 *   (= 完全な型依存を避けて単体テストしやすくする)
 * - `source` は parentPoolPolicy の `ParentPoolSource` を文字列で受ける
 *   (例: `'formal_bt_passed'`, `'edge_confirmed'`, `'edge_screening_passed'`,
 *    `'current_population'`, `'novelty_seed'`, `'edge_unverified'`)
 * - `route` は surrogateRescuePolicy の `SurrogateRoute` を文字列で受ける
 *   (例: `'normal_pass'`, `'near_miss_rescue'`, `'novelty_rescue'`,
 *    `'low_drawdown_rescue'`, `'trade_count_rescue'`, `'kill'`)
 */
export interface PromotionGateInput {
  candidateId: string;
  dslId?: string;
  currentStage?: EvolutionCandidateStage | null;
  source?: string;
  route?: string;
  formalBtPassed?: boolean | null;
  formalBtFailureReason?: string | null;
  repairHint?: {
    shouldUseForRepairMutation: boolean;
    shouldExcludeFromParentPool: boolean;
    severity: string;
  } | null;
  hasValidDsl?: boolean;
  schemaValidationPassed?: boolean;
  metrics?: {
    pf?: number | null;
    tradeCount?: number | null;
    maxDrawdown?: number | null;
    expectancy?: number | null;
  };
}

// =================================================================
// 既知の集合
// =================================================================

const RESCUE_ROUTES = new Set<string>([
  'near_miss_rescue',
  'novelty_rescue',
  'low_drawdown_rescue',
  'trade_count_rescue',
]);

// `parentPoolPolicy.ParentPoolSource` の全 6 系統を網羅する。novelty_seed を
// 落とすと、親プールが novelty fallback に寄った世代で parentPoolSummary と
// promotionGateSummary の集計が食い違う (PR #101 review #1)。
const PARENT_SOURCES = new Set<string>([
  'formal_bt_passed',
  'edge_confirmed',
  'edge_screening_passed',
  'edge_unverified',
  'current_population',
  'novelty_seed',
]);

// =================================================================
// 判定ロジック (設計書 §優先順位 順)
// =================================================================

/**
 * PromotionGate v1 の deterministic 判定。
 *
 * 優先順位 (設計書 §優先順位):
 *   1. DSL missing / schema validation failed
 *   2. fatal repairHint
 *   3. formalBtPassed=true
 *   4. formalBtPassed=false + repairable
 *   5. route normal_pass / rescue lane
 *   6. parent source
 *   7. generated / hold
 *
 * `productionEligible` は v1 では常に `false`。設計書 §基本方針.3 に従い、
 * formal_bt_passed であっても production 扱いしない。
 */
export function decidePromotionGateV1(input: PromotionGateInput): PromotionGateDecision {
  const base = {
    candidateId: input.candidateId,
    dslId: input.dslId,
    fromStage: input.currentStage ?? null,
    route: input.route,
    source: input.source,
    failureReason: input.formalBtFailureReason ?? null,
    formalBtPassed: input.formalBtPassed ?? null,
    productionEligible: false,
    warnings: [] as string[],
  };

  // (1a) DSL 不在 → repair_excluded
  if (input.hasValidDsl === false) {
    return {
      ...base,
      toStage: 'repair_excluded',
      decision: 'mark_repair_excluded',
      reasons: ['dsl_missing'],
      repairable: false,
    };
  }

  // (1b) schema validation 失敗 → rejected
  if (input.schemaValidationPassed === false) {
    return {
      ...base,
      toStage: 'rejected',
      decision: 'mark_rejected',
      reasons: ['schema_validation_failed'],
      repairable: false,
    };
  }

  // (2) fatal repairHint → repair_excluded
  if (input.repairHint && input.repairHint.shouldExcludeFromParentPool) {
    const reasons: PromotionGateReason[] = ['repair_hint_fatal'];
    if (input.formalBtPassed === false) reasons.unshift('formal_bt_failed');
    return {
      ...base,
      toStage: 'repair_excluded',
      decision: 'mark_repair_excluded',
      reasons,
      repairable: false,
    };
  }

  // (3) formal BT passed → validation_candidate (production_candidate にしない)
  if (input.formalBtPassed === true) {
    return {
      ...base,
      toStage: 'validation_candidate',
      decision: 'promote_to_validation_candidate',
      reasons: ['formal_bt_passed', 'oos_not_run'],
      repairable: false,
    };
  }

  // (4) formal BT failed + repairable hint → repairable
  if (
    input.formalBtPassed === false &&
    input.repairHint &&
    input.repairHint.shouldUseForRepairMutation &&
    !input.repairHint.shouldExcludeFromParentPool
  ) {
    return {
      ...base,
      toStage: 'repairable',
      decision: 'promote_to_repairable',
      reasons: ['formal_bt_failed', 'repair_hint_available'],
      repairable: true,
    };
  }

  // formal BT failed だが hint がない / 使えない → repair_excluded (修復素材外)
  if (input.formalBtPassed === false) {
    return {
      ...base,
      toStage: 'repair_excluded',
      decision: 'mark_repair_excluded',
      reasons: ['formal_bt_failed'],
      repairable: false,
    };
  }

  // (5) route 判定 (formalBtPassed 未確定で正式 BT 候補化中)
  if (input.route === 'normal_pass') {
    return {
      ...base,
      toStage: 'formal_bt_candidate',
      decision: 'promote_to_formal_bt_candidate',
      reasons: ['normal_pass'],
      repairable: false,
    };
  }
  if (input.route && RESCUE_ROUTES.has(input.route)) {
    return {
      ...base,
      toStage: 'formal_bt_candidate',
      decision: 'promote_to_formal_bt_candidate',
      reasons: ['rescue_lane'],
      repairable: false,
    };
  }
  if (input.route === 'kill') {
    return {
      ...base,
      toStage: 'rejected',
      decision: 'mark_rejected',
      reasons: ['unknown'],
      repairable: false,
    };
  }

  // (6) parent source
  if (input.source && PARENT_SOURCES.has(input.source)) {
    return {
      ...base,
      toStage: 'parent_eligible',
      decision: 'promote_to_parent_eligible',
      reasons: ['source_parent_pool'],
      repairable: false,
    };
  }

  // (7) hold (generated 直後 / 不明)
  return {
    ...base,
    toStage: input.currentStage ?? 'generated',
    decision: 'hold',
    reasons: ['manual_hold'],
    repairable: false,
  };
}

// =================================================================
// summary 集計
// =================================================================

const ALL_STAGES: EvolutionCandidateStage[] = [
  'generated',
  'parent_eligible',
  'surrogate_candidate',
  'formal_bt_candidate',
  'formal_bt_passed',
  'formal_bt_failed',
  'repairable',
  'repair_excluded',
  'validation_candidate',
  'validation_confirmed',
  'production_candidate',
  'rejected',
];

const ALL_DECISIONS: PromotionGateDecisionKind[] = [
  'hold',
  'promote_to_parent_eligible',
  'promote_to_formal_bt_candidate',
  'promote_to_formal_bt_passed',
  'promote_to_repairable',
  'promote_to_validation_candidate',
  'mark_repair_excluded',
  'mark_rejected',
];

const ALL_REASONS: PromotionGateReason[] = [
  'source_parent_pool',
  'normal_pass',
  'rescue_lane',
  'formal_bt_passed',
  'formal_bt_failed',
  'repair_hint_available',
  'repair_hint_fatal',
  'dsl_missing',
  'schema_validation_failed',
  'analysis_engine_error',
  'insufficient_metrics',
  'validation_not_run',
  'oos_not_run',
  'manual_hold',
  'unknown',
];

/**
 * 候補ごとの decision を stage / decision / reason 軸で集計する。
 *
 * - `byStage` / `byDecision` / `byReason` は全キーを 0 で初期化する (未出現キーが
 *   undefined にならないため、ダッシュボード側で `?? 0` が不要になる)
 * - `productionEligible` / `repairable` / `repairExcluded` は決定の集計値
 */
export function summarizePromotionGateDecisions(
  decisions: ReadonlyArray<PromotionGateDecision>,
): PromotionGateSummary {
  const byStage = Object.fromEntries(ALL_STAGES.map((s) => [s, 0])) as Record<
    EvolutionCandidateStage,
    number
  >;
  const byDecision = Object.fromEntries(ALL_DECISIONS.map((d) => [d, 0])) as Record<
    PromotionGateDecisionKind,
    number
  >;
  const byReason = Object.fromEntries(ALL_REASONS.map((r) => [r, 0])) as Record<
    PromotionGateReason,
    number
  >;

  let productionEligible = 0;
  let repairable = 0;
  let repairExcluded = 0;
  const warnings: string[] = [];

  for (const d of decisions) {
    byStage[d.toStage] += 1;
    byDecision[d.decision] += 1;
    for (const r of d.reasons) byReason[r] += 1;
    if (d.productionEligible) productionEligible += 1;
    if (d.repairable === true) repairable += 1;
    if (d.toStage === 'repair_excluded') repairExcluded += 1;
    if (d.warnings.length > 0) {
      for (const w of d.warnings) warnings.push(w);
    }
  }

  return {
    totalCandidates: decisions.length,
    byStage,
    byDecision,
    byReason,
    productionEligible,
    repairable,
    repairExcluded,
    warnings,
  };
}
