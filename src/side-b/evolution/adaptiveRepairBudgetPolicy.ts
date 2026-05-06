/**
 * Adaptive Repair / Mutation Budget v1 (Critical-4 PR #107)
 *
 * 目的: PR #102 の RepairOutcome / PR #105 の OOS-aware Promotion / PR #106 の
 *   multi-generation trend を入力に、次世代の mutation / repair 配分を **conservative に**
 *   調整できるようにする。設計書 §最重要判断基準: 「観測から制御への第一歩」。
 *
 * 設計書 docs/design/pr_107_adaptive_repair_mutation_budget_agent_prompt.md の
 * 方針通り、本ファイルは以下を担う:
 *   - RepairOutcome から target ごとの効果シグナル抽出 (= 既存
 *     `repairOutcomeSummary.byActionTarget` を読むだけ、再計算しない)
 *   - improved/worsened/unknown/stagnation/oos-confirmed の分類を deterministic に行う
 *   - bounded な weight 調整 (= ±0.2 が上限) と route 配分の clamp/floor/cap/normalize
 *   - production 自動昇格には絶対に使わない (= productionEligibleChanged は常に false)
 *
 * 非責務:
 *   - mutation / BT / OOS / PromotionGate の判定ロジック再実装
 *   - 大幅な parent pool 比率変更 (= PR #108 / 後続)
 *   - Quality-Diversity Archive (= PR #108)
 *   - LLM judgement
 *
 * @see docs/design/pr_107_adaptive_repair_mutation_budget_agent_prompt.md
 */

import type { GenerationReport } from './EvolutionLoop';
import type { RepairOutcomeSummary } from './repairOutcomeTelemetry';
import type { MultiGenerationTrendSummary } from './multiGenerationRunner';

// =================================================================
// 型定義
// =================================================================

/** mutation / generation の配分対象 route。設計書 §型定義 §MutationRoute。 */
export type MutationRoute =
  | 'repair_guided_mutation'
  | 'standard_mutation'
  | 'crossover'
  | 'novelty_seed'
  | 'indicator_augmentation'
  | 'random_exploration';

/** RepairOutcome.byActionTarget から抽出した target 単位の効果シグナル。 */
export interface AdaptiveRepairSignal {
  actionTarget: string;
  failureReason?: string | null;
  attempted: number;
  improved: number;
  worsened: number;
  unchanged: number;
  unknown: number;
  /** improved / attempted (attempted=0 なら null)。 */
  improvementRate: number | null;
  /** worsened / attempted (attempted=0 なら null)。 */
  worseningRate: number | null;
}

/** 次世代に渡す mutation / repair 配分。totalBudget は割合 (default 100)。 */
export interface MutationBudgetAllocation {
  totalBudget: number;
  byRoute: Record<MutationRoute, number>;
  /** target 単位の重み (default 1.0)。±0.2 までを v1 で許容。 */
  repairTargetWeights: Record<string, number>;
  explorationFloor: number;
  noveltyFloor: number;
  repairMaxShare: number;
  warnings: string[];
}

export type AdaptiveRepairBudgetDecisionReason =
  | 'repair_outcome_improved'
  | 'repair_outcome_worsened'
  | 'repair_outcome_unknown'
  | 'stagnation_detected'
  | 'oos_validation_confirmed'
  | 'oos_failed_or_held'
  | 'insufficient_signal'
  | 'bounded_by_floor'
  | 'bounded_by_cap'
  | 'no_adaptive_change'
  | 'unknown';

/** 1 世代分の adaptive budget 判定。 */
export interface AdaptiveRepairBudgetDecision {
  generationIndex: number;
  /** 観測元の世代 (= 通常 generationIndex - 1)。初回 N=0 では null。 */
  previousGenerationIndex: number | null;
  enabled: boolean;
  baselineAllocation: MutationBudgetAllocation;
  nextAllocation: MutationBudgetAllocation;
  repairSignals: AdaptiveRepairSignal[];
  reasons: AdaptiveRepairBudgetDecisionReason[];
  warnings: string[];
}

/** GenerationReport / MultiGenerationRunReport / smoke に出す summary。 */
export interface AdaptiveRepairBudgetSummary {
  enabled: boolean;
  decisions: number;
  latestAllocation: MutationBudgetAllocation | null;
  byReason: Record<AdaptiveRepairBudgetDecisionReason, number>;
  boostedRepairTargets: string[];
  suppressedRepairTargets: string[];
  explorationIncreased: boolean;
  /** 最新 allocation での repair_guided_mutation の割合 (= byRoute / totalBudget * 100)。 */
  repairShare: number;
  /** 最新 allocation での novelty_seed の割合。 */
  noveltyShare: number;
  /** PR #107 不変条件: 常に false。adaptive で production 昇格はしない。 */
  productionEligibleChanged: false;
  warnings: string[];
}

// =================================================================
// default / 定数
// =================================================================

/**
 * v1 既定 budget。設計書 §デフォルトbudget。
 * `100` は **percentage budget** として扱う (= 既存 mutation count とは独立)。
 */
export const defaultMutationBudgetAllocationV1: MutationBudgetAllocation = {
  totalBudget: 100,
  byRoute: {
    repair_guided_mutation: 20,
    standard_mutation: 35,
    crossover: 20,
    novelty_seed: 15,
    indicator_augmentation: 5,
    random_exploration: 5,
  },
  repairTargetWeights: {},
  explorationFloor: 10,
  noveltyFloor: 10,
  repairMaxShare: 40,
  warnings: [],
};

/**
 * EvolutionLoop が `mutationBudgetAllocation` を渡されたとき、share→count 比例計算で
 * 使う **基準 mutation count** (= adaptive 未指定時の生成数 = 既存挙動)。
 *
 * - mutation: `generateMutants(parents, scores, count, hints)` の count
 * - crossover: `generateCrossovers(parents, scores, count)` の count
 * - diverse: `generateDiverse(regime, count)` の count (lowDiversityBoost 経路)
 *
 * **重要**: 反映式は `next = base * (share / defaultShare)`。base / share の両方を本ファイルで
 * 一元管理することで、`defaultMutationBudgetAllocationV1.byRoute` と drift しないようにする。
 *
 * (PR #111 Copilot review #1 対応)
 */
export const mutationCountBaseV1 = {
  mutation: 10,
  crossover: 5,
  diverse: 5,
} as const;

/**
 * `defaultMutationBudgetAllocationV1.byRoute` から、EvolutionLoop の adaptive 反映で参照する
 * default share を導出する単一ソース。
 *
 * - mutation: `repair_guided_mutation + standard_mutation` (= mutation 系の合計)
 * - crossover: `crossover` 単独
 * - diverse: `novelty_seed` 単独 (lowDiversityBoost 経路で使う)
 *
 * 将来 default 比率を変えても、こちらが自動追随する (= drift 防止)。
 *
 * (PR #111 Copilot review #1 対応)
 */
export function getDefaultMutationRouteSharesV1(
  allocation: MutationBudgetAllocation = defaultMutationBudgetAllocationV1,
): { mutationShare: number; crossoverShare: number; diverseShare: number } {
  return {
    mutationShare:
      allocation.byRoute.repair_guided_mutation + allocation.byRoute.standard_mutation,
    crossoverShare: allocation.byRoute.crossover,
    diverseShare: allocation.byRoute.novelty_seed,
  };
}

/**
 * conservative な調整幅。設計書 §Adaptive 判定ルール。
 * v1 では ±0.2 が上限、route の per-decision 増減も ±5%pt 程度に留める。
 */
export const adaptiveRepairBudgetThresholdsV1 = {
  /** improved/worsened を判定する最低 attempted。 */
  minAttemptedForSignal: 2,
  improvementBoostThreshold: 0.5,
  worseningSuppressThreshold: 0.5,
  /** target weight の per-decision 変動幅 (= ±0.1〜0.2)。 */
  weightDeltaForImproved: 0.15,
  weightDeltaForWorsened: 0.15,
  /** weight の絶対 floor / cap。 */
  weightFloor: 0.5,
  weightCap: 1.5,
  /** route の per-decision 増減 (= ±5%pt 程度)。 */
  repairBoostPctPoints: 3,
  repairSuppressPctPoints: 3,
  stagnationExplorationPctPoints: 5,
  /** unknown 比率がこれを超えたら大変更しない。 */
  unknownDominantRatio: 0.7,
  /** stagnation streak 最低世代数 (連続無改善)。 */
  stagnationMinStreak: 2,
} as const;

const ALL_REASONS: AdaptiveRepairBudgetDecisionReason[] = [
  'repair_outcome_improved',
  'repair_outcome_worsened',
  'repair_outcome_unknown',
  'stagnation_detected',
  'oos_validation_confirmed',
  'oos_failed_or_held',
  'insufficient_signal',
  'bounded_by_floor',
  'bounded_by_cap',
  'no_adaptive_change',
  'unknown',
];

// =================================================================
// signal 抽出
// =================================================================

/**
 * `repairOutcomeSummary.byActionTarget` から target 単位の AdaptiveRepairSignal を作る。
 * 既存集計をそのまま読み replay するだけ (= 再計算しない、設計書 §基本方針 §2)。
 */
export function extractRepairSignalsV1(
  summary: RepairOutcomeSummary | null | undefined,
): AdaptiveRepairSignal[] {
  if (!summary) return [];
  const signals: AdaptiveRepairSignal[] = [];
  for (const [target, bucket] of Object.entries(summary.byActionTarget ?? {})) {
    const attempted = bucket.attempted;
    signals.push({
      actionTarget: target,
      attempted,
      improved: bucket.improved,
      worsened: bucket.worsened,
      unchanged: bucket.unchanged,
      unknown: bucket.unknown,
      improvementRate: attempted > 0 ? bucket.improved / attempted : null,
      worseningRate: attempted > 0 ? bucket.worsened / attempted : null,
    });
  }
  return signals;
}

// =================================================================
// allocation 操作 (clamp / floor / cap / normalize)
// =================================================================

function cloneAllocation(a: MutationBudgetAllocation): MutationBudgetAllocation {
  return {
    totalBudget: a.totalBudget,
    byRoute: { ...a.byRoute },
    repairTargetWeights: { ...a.repairTargetWeights },
    explorationFloor: a.explorationFloor,
    noveltyFloor: a.noveltyFloor,
    repairMaxShare: a.repairMaxShare,
    warnings: [...a.warnings],
  };
}

/**
 * floor / cap / 0 禁止 / 合計を totalBudget に正規化する。設計書 §budget clamp。
 *
 * - repair_guided_mutation <= repairMaxShare
 * - novelty_seed >= noveltyFloor
 * - novelty_seed + random_exploration >= explorationFloor
 * - standard_mutation >= 20% (= 0 にしない)
 * - どの route も 1%pt 未満にしない (= 完全 0 禁止)
 * - 合計を totalBudget に正規化 — 丸め誤差は **常に standard_mutation で明示吸収** し、
 *   key-order 依存や負数化を起こさない (PR #107 Copilot review #1)
 *
 * 注意 (PR #107 Copilot review #2):
 *   floor/cap 適用とスケーリング/正規化を 1 パスで行うと、後段の処理が前段の制約を
 *   再び破る可能性がある (例: standard_mutation に差分を吸収させた結果、再び floor 20 を
 *   下回る)。本関数では reduce/clamp/normalize の各処理を **fixpoint 反復** にして、
 *   制約が常に成立した allocation だけを返す。
 *
 * 注意 (PR #107 Copilot review #3):
 *   出力 allocation の `warnings` は本関数内で生成された警告だけを含む。baseline からは
 *   引き継がない (= 世代をまたいで warnings が累積するのを防ぐ)。
 */
function applyBudgetGuards(
  alloc: MutationBudgetAllocation,
): { allocation: MutationBudgetAllocation; boundedReasons: AdaptiveRepairBudgetDecisionReason[] } {
  const out = cloneAllocation(alloc);
  // PR #107 Copilot review #3: warnings は当該 guard 適用で生まれたものだけにする。
  // baseline から `[...a.warnings]` で持ち上がってきたものは破棄する。
  out.warnings = [];
  const boundedReasons = new Set<AdaptiveRepairBudgetDecisionReason>();

  const MIN_PER_ROUTE = 1;
  const STANDARD_MUTATION_FLOOR = 20;
  const MAX_ITERATIONS = 5;

  /** 「standard_mutation 以外」の合計が cap を超えないように削る (= standard_mutation の
   *  正規化で 20%pt floor が破れないようにする)。 */
  const drainOthersUntilStandardFits = (target: number): boolean => {
    // 削る順序: 影響度の大きい route から。novelty_seed は noveltyFloor を尊重、
    // 他は MIN_PER_ROUTE まで削れる。
    const drainOrder: MutationRoute[] = [
      'repair_guided_mutation',
      'crossover',
      'random_exploration',
      'indicator_augmentation',
      'novelty_seed',
    ];
    let othersSum =
      drainOrder.reduce((a, k) => a + out.byRoute[k], 0);
    let need = othersSum - target; // 他 route 合計をこのぶん減らす必要がある
    if (need <= 0) return false;
    let drained = false;
    for (const k of drainOrder) {
      if (need <= 0) break;
      const minK = k === 'novelty_seed' ? out.noveltyFloor : MIN_PER_ROUTE;
      const removable = Math.max(0, out.byRoute[k] - minK);
      const drain = Math.min(need, removable);
      if (drain > 0) {
        out.byRoute[k] -= drain;
        need -= drain;
        othersSum -= drain;
        drained = true;
      }
    }
    return drained;
  };

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    let changed = false;

    // (a) 完全 0 禁止
    for (const k of Object.keys(out.byRoute) as MutationRoute[]) {
      if (out.byRoute[k] < MIN_PER_ROUTE) {
        out.warnings.push(`route ${k} を ${out.byRoute[k]}%pt → ${MIN_PER_ROUTE}%pt に floor`);
        out.byRoute[k] = MIN_PER_ROUTE;
        boundedReasons.add('bounded_by_floor');
        changed = true;
      }
    }

    // (b) novelty_seed >= noveltyFloor
    if (out.byRoute.novelty_seed < out.noveltyFloor) {
      out.warnings.push(
        `novelty_seed を ${out.byRoute.novelty_seed}%pt → ${out.noveltyFloor}%pt に floor`,
      );
      out.byRoute.novelty_seed = out.noveltyFloor;
      boundedReasons.add('bounded_by_floor');
      changed = true;
    }

    // (c) novelty + random >= explorationFloor
    const explorationCurrent = out.byRoute.novelty_seed + out.byRoute.random_exploration;
    if (explorationCurrent < out.explorationFloor) {
      const need = out.explorationFloor - explorationCurrent;
      out.warnings.push(
        `exploration (novelty+random) を ${explorationCurrent}%pt → ${out.explorationFloor}%pt に floor (random_exploration +${need})`,
      );
      out.byRoute.random_exploration += need;
      boundedReasons.add('bounded_by_floor');
      changed = true;
    }

    // (d) repair_guided_mutation <= repairMaxShare
    if (out.byRoute.repair_guided_mutation > out.repairMaxShare) {
      out.warnings.push(
        `repair_guided_mutation を ${out.byRoute.repair_guided_mutation}%pt → ${out.repairMaxShare}%pt に cap`,
      );
      out.byRoute.repair_guided_mutation = out.repairMaxShare;
      boundedReasons.add('bounded_by_cap');
      changed = true;
    }

    // (e) 合計を totalBudget に正規化。丸め誤差は **常に standard_mutation で明示吸収**。
    //     standard_mutation 以外の route の合計を計算し、残りを standard_mutation に割り当てる。
    const otherRoutes: MutationRoute[] = [
      'repair_guided_mutation',
      'crossover',
      'novelty_seed',
      'indicator_augmentation',
      'random_exploration',
    ];
    const otherSum = otherRoutes.reduce((a, k) => a + out.byRoute[k], 0);
    let newStandard = out.totalBudget - otherSum;

    // standard_mutation が 20%pt floor を割る場合、他 route から削って 20 を確保する。
    if (newStandard < STANDARD_MUTATION_FLOOR) {
      // 他 route 合計が `totalBudget - 20` を超えているので、その差分を drain
      const targetOtherSum = out.totalBudget - STANDARD_MUTATION_FLOOR;
      const drained = drainOthersUntilStandardFits(targetOtherSum);
      // drain 後に再計算
      const otherSum2 = otherRoutes.reduce((a, k) => a + out.byRoute[k], 0);
      newStandard = out.totalBudget - otherSum2;
      if (drained || newStandard !== out.byRoute.standard_mutation) {
        out.warnings.push(
          `standard_mutation を ${out.byRoute.standard_mutation}%pt → ${newStandard}%pt に正規化 (他 route から ${otherSum - otherSum2}%pt を drain して 20%pt floor を確保)`,
        );
        boundedReasons.add('bounded_by_floor');
      }
    }
    if (newStandard !== out.byRoute.standard_mutation) {
      // 通常の正規化 (= 丸め誤差吸収)。warning を毎回出すと冗長なのでスキップ。
      out.byRoute.standard_mutation = newStandard;
      changed = true;
    }

    if (!changed) break;
  }

  // weight floor / cap (allocation 正規化とは独立)
  for (const [target, w] of Object.entries(out.repairTargetWeights)) {
    if (w < adaptiveRepairBudgetThresholdsV1.weightFloor) {
      out.warnings.push(
        `repairTargetWeights[${target}] を ${w.toFixed(2)} → ${adaptiveRepairBudgetThresholdsV1.weightFloor} に floor`,
      );
      out.repairTargetWeights[target] = adaptiveRepairBudgetThresholdsV1.weightFloor;
      boundedReasons.add('bounded_by_floor');
    } else if (w > adaptiveRepairBudgetThresholdsV1.weightCap) {
      out.warnings.push(
        `repairTargetWeights[${target}] を ${w.toFixed(2)} → ${adaptiveRepairBudgetThresholdsV1.weightCap} に cap`,
      );
      out.repairTargetWeights[target] = adaptiveRepairBudgetThresholdsV1.weightCap;
      boundedReasons.add('bounded_by_cap');
    }
  }

  return { allocation: out, boundedReasons: [...boundedReasons] };
}

// =================================================================
// 判定本体
// =================================================================

/** stagnation 検出: improved=0 / validationConfirmed=0 / oosPassed=0 が連続している。 */
function isStagnant(trend: MultiGenerationTrendSummary | undefined): boolean {
  if (!trend) return false;
  const streakLen = adaptiveRepairBudgetThresholdsV1.stagnationMinStreak;
  const tail = (arr: number[]): number[] => arr.slice(-streakLen);
  const improved = tail(trend.repairOutcomeImprovedByGeneration);
  const confirmed = tail(trend.validationConfirmedByGeneration);
  const passed = tail(trend.oosPassedByGeneration);
  if (improved.length < streakLen) return false;
  return (
    improved.every((v) => v === 0) &&
    confirmed.every((v) => v === 0) &&
    passed.every((v) => v === 0)
  );
}

/** trend の最新 2 世代で validation_confirmed または oos_passed が増えたか。 */
function oosConfirmedIncreased(trend: MultiGenerationTrendSummary | undefined): boolean {
  if (!trend) return false;
  const c = trend.validationConfirmedByGeneration;
  const p = trend.oosPassedByGeneration;
  const cInc = c.length >= 2 && c[c.length - 1] > c[c.length - 2];
  const pInc = p.length >= 2 && p[p.length - 1] > p[p.length - 2];
  return cInc || pInc;
}

export interface DecideAdaptiveRepairBudgetInput {
  generationIndex: number;
  /** 直近 (Generation N) の report。N+1 の budget を決めるための観測元。 */
  previousReport: GenerationReport | null;
  /** これまでに観測した trend (= multi-generation runner が世代ごとに更新)。 */
  trendSummary?: MultiGenerationTrendSummary;
  /** baseline (= 前世代に使った allocation または default)。 */
  baselineAllocation?: MutationBudgetAllocation;
  /** false なら baseline を維持して reason='no_adaptive_change'。 */
  enabled?: boolean;
}

/**
 * Generation N の観測結果から Generation N+1 の budget を deterministic に決める。
 *
 * 設計書 §Adaptive 判定ルール:
 *   1. improved な target → repairTargetWeights += 0.1〜0.2、route 微増
 *   2. worsened な target → repairTargetWeights -= 0.1〜0.2、route 微減
 *   3. unknown 優位 → 大変更しない
 *   4. stagnation → exploration 微増、repair 微減
 *   5. oos confirmed 増加 → 大変更しない (現状維持 / 微優遇)
 *   - すべての変更は floor / cap / normalize で bounded
 *   - productionEligible は触らない
 */
export function decideAdaptiveRepairBudgetV1(
  input: DecideAdaptiveRepairBudgetInput,
): AdaptiveRepairBudgetDecision {
  const enabled = input.enabled ?? true;
  const baseline = cloneAllocation(input.baselineAllocation ?? defaultMutationBudgetAllocationV1);
  const reasons = new Set<AdaptiveRepairBudgetDecisionReason>();
  const warnings: string[] = [];
  const repairSignals = extractRepairSignalsV1(input.previousReport?.repairOutcomeSummary);

  if (!enabled) {
    return {
      generationIndex: input.generationIndex,
      previousGenerationIndex:
        input.generationIndex > 0 ? input.generationIndex - 1 : null,
      enabled,
      baselineAllocation: baseline,
      nextAllocation: cloneAllocation(baseline),
      repairSignals,
      reasons: ['no_adaptive_change'],
      warnings,
    };
  }

  // 観測元が無い (= 初回 / report なし) → 変更しない
  if (!input.previousReport) {
    return {
      generationIndex: input.generationIndex,
      previousGenerationIndex: null,
      enabled,
      baselineAllocation: baseline,
      nextAllocation: cloneAllocation(baseline),
      repairSignals,
      reasons: ['insufficient_signal', 'no_adaptive_change'],
      warnings,
    };
  }

  const next = cloneAllocation(baseline);
  const t = adaptiveRepairBudgetThresholdsV1;

  // unknown 優位判定 (= 大変更しない)
  const totalAttempted = repairSignals.reduce((a, s) => a + s.attempted, 0);
  const totalUnknown = repairSignals.reduce((a, s) => a + s.unknown, 0);
  const unknownDominant =
    totalAttempted > 0 && totalUnknown / totalAttempted >= t.unknownDominantRatio;
  if (unknownDominant) {
    reasons.add('repair_outcome_unknown');
  }

  // signal 単位での weight 調整 (unknown 優位なら抑制版)
  let improvedTargets = 0;
  let worsenedTargets = 0;
  for (const s of repairSignals) {
    if (s.attempted < t.minAttemptedForSignal) continue;
    if (s.improvementRate === null || s.worseningRate === null) continue;
    const imp = s.improvementRate;
    const wor = s.worseningRate;
    // unknown 優位の場合は weight 変動を半分に
    const dampen = unknownDominant ? 0.5 : 1;
    if (imp >= t.improvementBoostThreshold && wor <= 0.25) {
      const cur = next.repairTargetWeights[s.actionTarget] ?? 1.0;
      next.repairTargetWeights[s.actionTarget] = cur + t.weightDeltaForImproved * dampen;
      improvedTargets += 1;
    } else if (wor >= t.worseningSuppressThreshold && imp <= 0.25) {
      const cur = next.repairTargetWeights[s.actionTarget] ?? 1.0;
      next.repairTargetWeights[s.actionTarget] = cur - t.weightDeltaForWorsened * dampen;
      worsenedTargets += 1;
    }
  }

  // route 配分: improved 優位 → repair_guided 微増 / worsened 優位 → 微減
  if (!unknownDominant) {
    if (improvedTargets > worsenedTargets) {
      const delta = t.repairBoostPctPoints;
      next.byRoute.repair_guided_mutation += delta;
      // standard_mutation から削る (合計は guards で再正規化)
      next.byRoute.standard_mutation = Math.max(
        0,
        next.byRoute.standard_mutation - delta,
      );
      reasons.add('repair_outcome_improved');
    } else if (worsenedTargets > improvedTargets) {
      const delta = t.repairSuppressPctPoints;
      next.byRoute.repair_guided_mutation = Math.max(
        0,
        next.byRoute.repair_guided_mutation - delta,
      );
      // standard_mutation に振り戻す
      next.byRoute.standard_mutation += delta;
      reasons.add('repair_outcome_worsened');
    }
  }

  // stagnation 検出 → novelty / random 微増、repair 微減
  if (isStagnant(input.trendSummary)) {
    const delta = t.stagnationExplorationPctPoints;
    const half = Math.floor(delta / 2);
    next.byRoute.novelty_seed += half;
    next.byRoute.random_exploration += delta - half;
    next.byRoute.repair_guided_mutation = Math.max(
      0,
      next.byRoute.repair_guided_mutation - delta,
    );
    reasons.add('stagnation_detected');
  }

  // oos confirmed 増加 → 維持を観測
  if (oosConfirmedIncreased(input.trendSummary)) {
    reasons.add('oos_validation_confirmed');
  }

  // signal が attempted=0 ばかりだった場合
  if (totalAttempted === 0) {
    reasons.add('insufficient_signal');
  }

  // 何も変わっていない場合
  const unchanged =
    JSON.stringify(next.byRoute) === JSON.stringify(baseline.byRoute) &&
    JSON.stringify(next.repairTargetWeights) === JSON.stringify(baseline.repairTargetWeights);
  if (unchanged) {
    reasons.add('no_adaptive_change');
  }

  // floor / cap / normalize
  const guarded = applyBudgetGuards(next);
  for (const r of guarded.boundedReasons) reasons.add(r);

  if (reasons.size === 0) reasons.add('unknown');
  // 注: 個別 decision レベルでは explorationIncreased 派生値を持たない。
  // summary 側 (`summarizeAdaptiveRepairBudgetDecisionsV1`) で baseline と
  // nextAllocation の novelty+random を比較して計算する (= 単一 source of truth)。

  return {
    generationIndex: input.generationIndex,
    previousGenerationIndex: input.generationIndex > 0 ? input.generationIndex - 1 : null,
    enabled,
    baselineAllocation: baseline,
    nextAllocation: guarded.allocation,
    repairSignals,
    reasons: [...reasons],
    warnings: [...warnings, ...guarded.allocation.warnings],
  };
}

// =================================================================
// summary 集計
// =================================================================

/** 複数 decision を合算した summary を返す。 */
export function summarizeAdaptiveRepairBudgetDecisionsV1(
  decisions: ReadonlyArray<AdaptiveRepairBudgetDecision>,
  opts: { enabled: boolean } = { enabled: true },
): AdaptiveRepairBudgetSummary {
  const byReason = Object.fromEntries(ALL_REASONS.map((r) => [r, 0])) as Record<
    AdaptiveRepairBudgetDecisionReason,
    number
  >;
  const boostedSet = new Set<string>();
  const suppressedSet = new Set<string>();
  let explorationIncreased = false;
  const warnings: string[] = [];

  for (const d of decisions) {
    for (const r of d.reasons) byReason[r] += 1;
    // boosted/suppressed: baseline からの差分で判定
    for (const [target, w] of Object.entries(d.nextAllocation.repairTargetWeights)) {
      const baseW = d.baselineAllocation.repairTargetWeights[target] ?? 1.0;
      if (w > baseW) boostedSet.add(target);
      else if (w < baseW) suppressedSet.add(target);
    }
    const baseExp =
      d.baselineAllocation.byRoute.novelty_seed +
      d.baselineAllocation.byRoute.random_exploration;
    const nextExp =
      d.nextAllocation.byRoute.novelty_seed + d.nextAllocation.byRoute.random_exploration;
    if (nextExp > baseExp) explorationIncreased = true;
    for (const w of d.warnings) warnings.push(w);
  }

  const latest = decisions.length > 0 ? decisions[decisions.length - 1].nextAllocation : null;
  const repairShare = latest
    ? (latest.byRoute.repair_guided_mutation / latest.totalBudget) * 100
    : 0;
  const noveltyShare = latest
    ? (latest.byRoute.novelty_seed / latest.totalBudget) * 100
    : 0;

  return {
    enabled: opts.enabled,
    decisions: decisions.length,
    latestAllocation: latest,
    byReason,
    boostedRepairTargets: [...boostedSet],
    suppressedRepairTargets: [...suppressedSet],
    explorationIncreased,
    repairShare,
    noveltyShare,
    productionEligibleChanged: false,
    warnings,
  };
}
