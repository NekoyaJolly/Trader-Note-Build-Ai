/**
 * 進化ループ Surrogate Rescue Lane (Critical-4 PR #96)
 *
 * 目的: surrogate 主要 3 条件 (PF / validation PF / overfit) をすべて通過しない世代でも、
 *   惜しい候補 / 低 DD 候補 / 取引数十分な候補 / 構造的に新しい候補を rescue lane で
 *   正式 BT に送れるようにする。surrogate 閾値そのものは緩和しない。
 *
 * 設計:
 *   - kill 条件 (取引 0 / NaN / 破綻 DD 等) に該当する候補は rescue 対象外
 *   - normal_pass = 既存 3 条件すべて通過 (= 旧 extractPromotionCandidates の判定)
 *   - rescue は normal_pass で枠が埋まらない時のみ追加候補を提供する
 *   - 同一候補が複数 route に該当する場合は優先順位 (normal_pass > near_miss >
 *     low_drawdown > trade_count > novelty) で重複排除
 *   - 全候補 kill でも例外を投げず、summary に理由を残す
 *
 * @see docs/design/pr_96_surrogate_rescue_lane_agent_prompt.md
 */

import type { SurrogateFitnessAggregate } from '../strategy_dsl/SurrogateFitnessSimulator';
import type { StrategyDSL } from '../strategy_dsl/schema';
import {
  MAX_OVERFIT_SCORE,
  MIN_TRAIN_PROFIT_FACTOR,
  MIN_VALIDATION_PROFIT_FACTOR,
} from './evolutionPromotionThresholds';
import { scoreNoveltyAgainstSelected } from './behaviorDescriptorLite';

// =================================================================
// 型定義
// =================================================================

/**
 * 候補が正式 BT に送られる経路。
 * `kill` は除外マーク (= 正式 BT に送らない)。
 */
export type SurrogateRoute =
  | 'normal_pass'
  | 'near_miss_rescue'
  | 'novelty_rescue'
  | 'low_drawdown_rescue'
  | 'trade_count_rescue'
  | 'kill';

/**
 * 各 route から正式 BT に送る候補数の上限。
 * v1: overall(normal_pass) 3 件 + 各 rescue lane 1 件 = 最大 7 候補。
 * 重複排除されるため実際の `uniqueCandidates` はこれ以下になる。
 */
export const formalBtCandidatePolicyV1 = {
  overallTopK: 3,
  nearMissTopK: 1,
  noveltyTopK: 1,
  lowDrawdownTopK: 1,
  tradeCountSufficientTopK: 1,
} as const;

export interface FormalBtCandidateSummary {
  /** route 別の最終選抜件数 (重複排除後) */
  normalPass: number;
  nearMissRescue: number;
  noveltyRescue: number;
  lowDrawdownRescue: number;
  tradeCountRescue: number;
  /** 分類段階で kill となった候補数 (選抜には含まれない) */
  killed: number;
  /** 重複排除後の最終ユニーク候補数 */
  uniqueCandidates: number;
  /** 重複排除で落とされた件数 (= 同一候補が複数 route に該当した数) */
  duplicateRemoved: number;
  /** rescue lane を 1 つでも使用した場合 true */
  fallbackApplied: boolean;
  /** fallback 状況 / 全候補 kill 等の理由 */
  fallbackReason: string | null;
}

/**
 * rescue 経路情報を含む候補。`route` 以外は既存
 * `EvolutionPromotionCandidate` のスーパーセット (= candidate 構築側で route を後付け可能)。
 */
export interface ClassifiedCandidate {
  dsl: StrategyDSL;
  /** 候補が分類された route (kill は選抜から除外) */
  route: SurrogateRoute;
  /** v1 の選抜順序計算用スコア (normal_pass は surrogate score、rescue は route 固有指標) */
  score: number;
  /** 人間可読の理由 (debug / smoke 出力用) */
  reason: string;
  aggregate: SurrogateFitnessAggregate;
}

// =================================================================
// 分類 helpers
// =================================================================

/**
 * kill: 救済しない候補。validation summary が破綻している / 取引 0 / NaN を含む 等。
 */
export function classifyKill(agg: SurrogateFitnessAggregate): { isKill: boolean; reason: string } {
  const v = agg.validation.summary;
  const t = agg.train.summary;
  // 取引が 0 件 (= 何も発火しなかった戦略)
  if (v.totalTrades === 0) return { isKill: true, reason: 'validation totalTrades=0' };
  // NaN / Infinity 含む値
  if (!Number.isFinite(agg.trainPf) || !Number.isFinite(agg.validationPf)) {
    return { isKill: true, reason: `pf not finite (train=${agg.trainPf} val=${agg.validationPf})` };
  }
  if (!Number.isFinite(agg.overfitScore)) {
    return { isKill: true, reason: `overfitScore not finite (${agg.overfitScore})` };
  }
  // 破綻レベル DD: validation の DD 率が 80% 超 (= 元本の 4/5 を失う)
  if (Number.isFinite(v.maxDrawdownRate) && v.maxDrawdownRate > 0.8) {
    return { isKill: true, reason: `maxDrawdownRate=${v.maxDrawdownRate.toFixed(3)} > 0.8` };
  }
  // train 側も同様
  if (Number.isFinite(t.maxDrawdownRate) && t.maxDrawdownRate > 0.8) {
    return { isKill: true, reason: `train maxDrawdownRate=${t.maxDrawdownRate.toFixed(3)} > 0.8` };
  }
  return { isKill: false, reason: '' };
}

/**
 * normal_pass: 既存 3 条件 (trainPf > 1.5 / validationPf > 1.3 / overfit < 0.3) すべて満たす。
 */
export function isNormalPass(agg: SurrogateFitnessAggregate): boolean {
  return (
    agg.trainPf > MIN_TRAIN_PROFIT_FACTOR &&
    agg.validationPf > MIN_VALIDATION_PROFIT_FACTOR &&
    agg.overfitScore < MAX_OVERFIT_SCORE
  );
}

/**
 * near_miss: 3 条件のうち **ちょうど 1 つ** が未達 (惜しい)。
 * v1 では「2 条件は満たしている」ことを救済の根拠にする。
 */
export function isNearMiss(agg: SurrogateFitnessAggregate): { yes: boolean; failedCondition: string | null } {
  const passes = [
    agg.trainPf > MIN_TRAIN_PROFIT_FACTOR,
    agg.validationPf > MIN_VALIDATION_PROFIT_FACTOR,
    agg.overfitScore < MAX_OVERFIT_SCORE,
  ];
  const passedCount = passes.filter((p) => p).length;
  if (passedCount !== 2) return { yes: false, failedCondition: null };
  // どの条件が未達かを文字列で返す (smoke ログ用)。3 分岐すべてで必ず代入される
  let failedCondition: string;
  if (!passes[0]) failedCondition = `trainPf=${agg.trainPf.toFixed(2)} <= ${MIN_TRAIN_PROFIT_FACTOR}`;
  else if (!passes[1])
    failedCondition = `validationPf=${agg.validationPf.toFixed(2)} <= ${MIN_VALIDATION_PROFIT_FACTOR}`;
  else failedCondition = `overfitScore=${agg.overfitScore.toFixed(2)} >= ${MAX_OVERFIT_SCORE}`;
  return { yes: true, failedCondition };
}

// =================================================================
// 選抜本体
// =================================================================

interface CandidateInput {
  dsl: StrategyDSL;
  aggregate: SurrogateFitnessAggregate;
  surrogateScore: number;
}

/**
 * `selectFormalBtCandidatesWithRescue` のオーバーライド可能な policy 値。
 * 全フィールド optional で、未指定は `formalBtCandidatePolicyV1` を使う。
 */
export interface RescueSelectionOverrides {
  /** normal_pass 上限。EvolutionLoopDeps.formalBtTopK から流す想定 */
  overallTopK?: number;
  /** trade_count_rescue で要求する最小 totalTrades (これ未満は rescue 対象外) */
  minTradesForTradeCountRescue?: number;
}

/**
 * elites + metrics + scores から正式 BT 候補を rescue lane 込みで選抜する。
 *
 * 戦略:
 *   1. 全候補を kill / normal_pass / その他 に分類
 *   2. normal_pass を surrogate score 降順で `overallTopK` 件取得
 *      (overrides.overallTopK で外部から差し替え可能)
 *   3. 残り (= rescue 候補プール) から各 lane の上位 1 件を取得:
 *      - near_miss: passedCount=2 のうち surrogate score 上位
 *      - low_drawdown: validation maxDrawdownRate が最小 (低 DD ほど良)
 *      - trade_count: validation totalTrades が **最低基準を満たす中で** 最大
 *        (基準未満を救済すると後段の正式 BT で insufficient_trades 即落ちになるため)
 *      - novelty: 上記 lane で選ばれていない残りから surrogate score 上位以外を 1 件
 *   4. 同一候補 (dsl.id) が複数 lane で選ばれていたら、優先順位の高い route を採用
 *      (normal_pass > near_miss > low_drawdown > trade_count > novelty)
 *
 * 全候補が kill でも例外は投げず、summary.fallbackReason に理由を残す。
 */
export function selectFormalBtCandidatesWithRescue(
  candidates: CandidateInput[],
  overrides: RescueSelectionOverrides = {},
): { entries: ClassifiedCandidate[]; summary: FormalBtCandidateSummary } {
  const overallTopK = overrides.overallTopK ?? formalBtCandidatePolicyV1.overallTopK;
  const minTradesForTradeCountRescue = overrides.minTradesForTradeCountRescue ?? 0;
  // === Step 1: 分類 ===
  const normalPass: ClassifiedCandidate[] = [];
  const nearMiss: ClassifiedCandidate[] = [];
  const nonKill: CandidateInput[] = [];
  let killedCount = 0;
  const killReasons: string[] = [];

  for (const c of candidates) {
    const kill = classifyKill(c.aggregate);
    if (kill.isKill) {
      killedCount++;
      if (killReasons.length < 3) killReasons.push(`${c.dsl.id}: ${kill.reason}`);
      continue;
    }
    nonKill.push(c);
    if (isNormalPass(c.aggregate)) {
      normalPass.push({
        dsl: c.dsl,
        route: 'normal_pass',
        score: c.surrogateScore,
        reason: 'all 3 surrogate conditions passed',
        aggregate: c.aggregate,
      });
    } else {
      const nm = isNearMiss(c.aggregate);
      if (nm.yes && nm.failedCondition !== null) {
        nearMiss.push({
          dsl: c.dsl,
          route: 'near_miss_rescue',
          score: c.surrogateScore,
          reason: `1/3 condition missed: ${nm.failedCondition}`,
          aggregate: c.aggregate,
        });
      }
    }
  }

  // === Step 2: 優先順位付き選抜 ===
  const selected = new Map<string, ClassifiedCandidate>(); // dsl.id → candidate
  const routePriority: Record<SurrogateRoute, number> = {
    normal_pass: 5,
    near_miss_rescue: 4,
    low_drawdown_rescue: 3,
    trade_count_rescue: 2,
    novelty_rescue: 1,
    kill: 0,
  };

  function tryAdd(c: ClassifiedCandidate): boolean {
    const existing = selected.get(c.dsl.id);
    if (!existing) {
      selected.set(c.dsl.id, c);
      return true;
    }
    // 既存より優先順位が高い場合のみ上書き (同 candidate が複数 route で選ばれた場合)
    if (routePriority[c.route] > routePriority[existing.route]) {
      selected.set(c.dsl.id, c);
    }
    return false; // 重複扱い (新規追加でない)
  }

  let duplicateRemoved = 0;

  // 2a. normal_pass top K (score 降順)
  // overallTopK は overrides で外部から差し替え可 (= EvolutionLoopDeps.formalBtTopK 由来)
  const sortedNormal = normalPass.slice().sort((a, b) => b.score - a.score);
  for (const c of sortedNormal.slice(0, overallTopK)) {
    if (!tryAdd(c)) duplicateRemoved++;
  }

  // 2b. near_miss top 1 (score 降順)
  const sortedNearMiss = nearMiss.slice().sort((a, b) => b.score - a.score);
  for (const c of sortedNearMiss.slice(0, formalBtCandidatePolicyV1.nearMissTopK)) {
    if (!tryAdd(c)) duplicateRemoved++;
  }

  // 2c. low_drawdown rescue: nonKill 全体から validation maxDrawdownRate 最小のものを 1 件
  const sortedByDD = nonKill
    .slice()
    .filter((c) => Number.isFinite(c.aggregate.validation.summary.maxDrawdownRate))
    .sort(
      (a, b) =>
        a.aggregate.validation.summary.maxDrawdownRate -
        b.aggregate.validation.summary.maxDrawdownRate,
    );
  for (const c of sortedByDD.slice(0, formalBtCandidatePolicyV1.lowDrawdownTopK)) {
    const cand: ClassifiedCandidate = {
      dsl: c.dsl,
      route: 'low_drawdown_rescue',
      score: c.surrogateScore,
      reason: `lowest validation maxDrawdownRate=${c.aggregate.validation.summary.maxDrawdownRate.toFixed(3)}`,
      aggregate: c.aggregate,
    };
    if (!tryAdd(cand)) duplicateRemoved++;
  }

  // 2d. trade_count rescue: nonKill 全体から validation totalTrades **最低基準以上** で
  //     最大のものを 1 件。基準未満を救済すると後段で insufficient_trades で即落ちになり、
  //     formal BT slot の無駄になるため。
  const sortedByTradeCount = nonKill
    .slice()
    .filter(
      (c) =>
        c.aggregate.validation.summary.totalTrades >= minTradesForTradeCountRescue,
    )
    .sort(
      (a, b) =>
        b.aggregate.validation.summary.totalTrades -
        a.aggregate.validation.summary.totalTrades,
    );
  for (const c of sortedByTradeCount.slice(0, formalBtCandidatePolicyV1.tradeCountSufficientTopK)) {
    const cand: ClassifiedCandidate = {
      dsl: c.dsl,
      route: 'trade_count_rescue',
      score: c.surrogateScore,
      reason:
        `most validation trades=${c.aggregate.validation.summary.totalTrades} ` +
        `(>= min ${minTradesForTradeCountRescue})`,
      aggregate: c.aggregate,
    };
    if (!tryAdd(cand)) duplicateRemoved++;
  }

  // 2e. novelty rescue (PR #97): 既選抜候補との構造的な違い (BehaviorDescriptorLite ベース)
  //     から noveltyScore を計算し、最も「異なる」候補から noveltyTopK 件を採用する。
  //     - selected が空なら全候補が noveltyScore=1 になる (= 最初に来た候補が選ばれる)
  //     - 同点の場合は surrogateScore 降順で安定化
  const noveltyPool = nonKill.filter((c) => !selected.has(c.dsl.id));
  if (noveltyPool.length > 0) {
    const selectedDsls = [...selected.values()].map((s) => s.dsl);
    const selectedTradeCounts = new Map<string, number>();
    for (const s of selected.values()) {
      selectedTradeCounts.set(s.dsl.id, s.aggregate.validation.summary.totalTrades);
    }
    const scored = noveltyPool.map((c) => ({
      input: c,
      novelty: scoreNoveltyAgainstSelected(c.dsl, selectedDsls, {
        candidateValidationTradeCount: c.aggregate.validation.summary.totalTrades,
        selectedValidationTradeCounts: selectedTradeCounts,
      }),
    }));
    scored.sort((a, b) => {
      if (b.novelty.noveltyScore !== a.novelty.noveltyScore) {
        return b.novelty.noveltyScore - a.novelty.noveltyScore;
      }
      return b.input.surrogateScore - a.input.surrogateScore;
    });
    for (const item of scored.slice(0, formalBtCandidatePolicyV1.noveltyTopK)) {
      const cand: ClassifiedCandidate = {
        dsl: item.input.dsl,
        route: 'novelty_rescue',
        score: item.input.surrogateScore,
        reason: item.novelty.reason,
        aggregate: item.input.aggregate,
      };
      if (!tryAdd(cand)) duplicateRemoved++;
    }
  }

  // === Step 3: summary 集計 ===
  const entries = [...selected.values()];
  const counts: Record<SurrogateRoute, number> = {
    normal_pass: 0,
    near_miss_rescue: 0,
    novelty_rescue: 0,
    low_drawdown_rescue: 0,
    trade_count_rescue: 0,
    kill: 0,
  };
  for (const e of entries) counts[e.route]++;

  const rescueLaneUsed =
    counts.near_miss_rescue +
      counts.novelty_rescue +
      counts.low_drawdown_rescue +
      counts.trade_count_rescue >
    0;

  const fallbackReasons: string[] = [];
  if (counts.normal_pass === 0 && rescueLaneUsed) {
    fallbackReasons.push('normal_pass=0; rescue lanes used');
  }
  if (entries.length === 0) {
    if (killedCount > 0) {
      fallbackReasons.push(
        `all candidates killed (n=${killedCount}, examples: ${killReasons.join(' | ')})`,
      );
    } else {
      fallbackReasons.push('no candidates available');
    }
  }
  if (killedCount > 0 && fallbackReasons.length === 0) {
    fallbackReasons.push(`killed=${killedCount}`);
  }

  const summary: FormalBtCandidateSummary = {
    normalPass: counts.normal_pass,
    nearMissRescue: counts.near_miss_rescue,
    noveltyRescue: counts.novelty_rescue,
    lowDrawdownRescue: counts.low_drawdown_rescue,
    tradeCountRescue: counts.trade_count_rescue,
    killed: killedCount,
    uniqueCandidates: entries.length,
    duplicateRemoved,
    fallbackApplied: counts.normal_pass === 0 && rescueLaneUsed,
    fallbackReason: fallbackReasons.length > 0 ? fallbackReasons.join('; ') : null,
  };

  return { entries, summary };
}
