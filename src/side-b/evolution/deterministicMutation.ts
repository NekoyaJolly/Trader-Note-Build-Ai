/**
 * 進化ループ再設計 Phase 2: 決定論 mutation 生成器。
 *
 * MutationAgent（LLM 数値変異）の代替経路。各親 elite に対し
 * `optimizeIndicatorPeriods`（Phase 1c: 2 段階 = screening ランク → 勝者 WF）を適用し、
 * インジ期間 + SL/TP を **決定論的に最適化**した `bestVariant` を mutant として返す
 * （AGENTS.md ドメイン原則#3: 数値最適化は決定論コードで）。LLM は組成（インジ選び）に専念。
 *
 * downstream（surrogate → formal BT → OOS → promotion）は mutant の出自に非依存なので、
 * 返す DSL は LLM mutation と同じ契約（createdBy='mutation' / generation / parentIds）で揃える。
 */

import { randomUUID } from 'crypto';
import { getExecutionCostProfile, getPipSize } from '../strategy_dsl/executionSimulation';
import type { IndicatorVariantOptions } from '../strategy_dsl/indicatorParamVariants';
import {
  optimizeIndicatorPeriods,
  type OptimizeIndicatorPeriodsDeps,
} from '../strategy_dsl/optimizeIndicatorPeriods';
import { slTpCandidatesFromDsl, type SlTpCandidateOptions } from '../strategy_dsl/slTpCandidates';
import type { StrategyDSL } from '../strategy_dsl/schema';
import { normalizeTimeframe } from '../constants/timeframes';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';

export interface DeterministicMutationParams {
  /** 親プール DSL（surrogate スコア降順で上位 count 件を最適化対象にする）。 */
  parents: StrategyDSL[];
  /** 親 dslId → surrogate スコア。上位選抜に使う。 */
  scores: Map<string, number>;
  /** 生成する mutant 数（= 最適化する親の数）。 */
  count: number;
  /** BT 期間（ISO 文字列）。formal BT と同じ window を渡す。 */
  startDate: string;
  endDate: string;
  /** インジ期間 variant 生成オプション（±N% / points / maxCombos）。 */
  variantOptions?: IndicatorVariantOptions;
  /** SL/TP 候補生成オプション。 */
  sltpOptions?: SlTpCandidateOptions;
  /** stage-2 WF 設定（windows / minTradesPerWindow）。 */
  walkForward?: { windows?: number; minTradesPerWindow?: number };
  /**
   * 観測ログ出力口（optional）。個別 optimize 失敗（スキップ）を可視化する。
   * EvolutionLoop からは generation の errors[] に push するコールバックを渡す。
   */
  log?: (message: string) => void;
}

export type DeterministicMutationDeps = OptimizeIndicatorPeriodsDeps;

/** 最適化された SL/TP 値を variant の stopLoss/takeProfit に適用した DSL を返す。 */
function applyBestSlTp(variant: StrategyDSL, bestParams: Record<string, number>): StrategyDSL {
  const out = structuredClone(variant);
  // discriminated union を type で narrow（swing_point は value を持たないので除外）。
  if (
    typeof bestParams.slValue === 'number' &&
    (out.stopLoss.type === 'atr_multiple' || out.stopLoss.type === 'fixed_pips')
  ) {
    out.stopLoss.value = bestParams.slValue;
  }
  if (
    typeof bestParams.tpValue === 'number' &&
    (out.takeProfit.type === 'rr_ratio' ||
      out.takeProfit.type === 'atr_multiple' ||
      out.takeProfit.type === 'fixed_pips')
  ) {
    out.takeProfit.value = bestParams.tpValue;
  }
  return out;
}

/**
 * 決定論 mutation を生成する。親ごとに 1 mutant（最適化済み DSL）を返す。
 * HTTP 失敗等で個別 optimize が throw した親はスキップする（部分結果を返す）。
 */
export async function generateDeterministicMutants(
  params: DeterministicMutationParams,
  deps: DeterministicMutationDeps,
): Promise<StrategyDSL[]> {
  const ranked = [...params.parents].sort(
    (a, b) => (params.scores.get(b.id) ?? 0) - (params.scores.get(a.id) ?? 0),
  );
  const targets = ranked.slice(0, Math.max(0, params.count));

  const mutants: StrategyDSL[] = [];
  for (const parent of targets) {
    const symbol = normalizeCTraderSymbol(parent.symbol);
    const timeframe = normalizeTimeframe(parent.timeframe);
    const costProfile = getExecutionCostProfile(symbol);
    const { slValues, tpValues } = slTpCandidatesFromDsl(parent, params.sltpOptions);

    let bestVariant: StrategyDSL;
    let bestParams: Record<string, number>;
    try {
      const res = await optimizeIndicatorPeriods(
        {
          dsl: parent,
          hypothesisId: parent.id,
          symbol,
          timeframe,
          startDate: params.startDate,
          endDate: params.endDate,
          config: {
            initialCapital: 10_000,
            leverage: 1,
            tradingCost: 0,
            spreadPips: costProfile.roundTripCostPips,
            pipSize: getPipSize(symbol),
          },
          slValues,
          tpValues,
          variantOptions: params.variantOptions,
          topK: 1,
          strategy: 'two_stage',
          ...(params.walkForward ? { walkForward: params.walkForward } : {}),
        },
        deps,
      );
      bestVariant = res.bestVariant;
      bestParams = res.bestParams;
    } catch (err) {
      // 個別 optimize 失敗はスキップ（部分結果を返す）が、黙殺せず親 ID + 理由をログに残す。
      // 本番で deterministic 有効時に mutant がゼロ/減になった原因を追えるようにする。
      params.log?.(
        `[warn] deterministic mutation skipped parent=${parent.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    const optimized = applyBestSlTp(bestVariant, bestParams);
    mutants.push({
      ...optimized,
      id: `mut-det-${randomUUID()}`,
      generation: parent.generation + 1,
      parentIds: [parent.id],
      metadata: {
        createdAt: new Date().toISOString(),
        createdBy: 'mutation',
        description: `deterministic period+SL/TP optimize from ${parent.id}`,
      },
    });
  }

  return mutants;
}
