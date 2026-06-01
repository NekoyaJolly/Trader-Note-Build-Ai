/**
 * 進化ループ再設計 Phase 3: 決定論 Crossover オーケストレータ（インジ追加エッジ発見）。
 *
 * 設計（docs/diagnostics/evolution_loop_redesign_plan_2026-06-02.html §2-2）:
 *   registry の python 対応インジを系統的に 1 つずつ親へ AND 追加して BT し、
 *   「負けトレードが減り、勝ちトレードが維持される」組合せ＝そのインジは当該戦略にエッジあり、
 *   として採用する。2 段（スイープで候補発見 → 確定）:
 *     stage-0: 親の baseline screening BT（負け/勝ち数の基準）。
 *     stage-1: 各 variant（親 + 追加 1 条件）を screening BT し、負け減・勝ち維持で評価ランク。
 *     stage-2: 上位 K に WF 過学習ガード（/v1/optimize, SL/TP は触らない）→ ベスト確定。
 *
 * Mutation との責務分離: Crossover は **追加したインジだけ**を扱い、既存条件・SL/TP は不変。
 * LLM は候補インジの事前絞り込み（多すぎる場合）に限定（本関数は indicatorIds で受け取る）。
 */

import { randomUUID } from 'crypto';
import { getExecutionCostProfile, getPipSize } from '../strategy_dsl/executionSimulation';
import {
  generateCrossoverIndicatorVariants,
  type CrossoverVariantOptions,
} from '../strategy_dsl/crossoverVariants';
import { dslToBacktestNotePayload } from '../strategy_dsl/dslToBacktestNotePayload';
import { defaultParameterValues } from '../strategy_dsl/dslParameterUtils';
import type { StrategyDSL } from '../strategy_dsl/schema';
import { normalizeTimeframe } from '../constants/timeframes';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';
import type {
  AnalysisEngineOptimizeRequestInput,
  AnalysisEngineOptimizeResponse,
  AnalysisEngineOverfitGuard,
  AnalysisEngineScreeningBacktestRequest,
  AnalysisEngineScreeningBacktestResponse,
  ScreeningBacktestSummary,
} from '../../schemas/external/analysisEngine';

export interface DeterministicCrossoverDeps {
  runScreeningBacktest: (
    input: AnalysisEngineScreeningBacktestRequest,
  ) => Promise<AnalysisEngineScreeningBacktestResponse>;
  runOptimize: (
    input: AnalysisEngineOptimizeRequestInput,
  ) => Promise<AnalysisEngineOptimizeResponse>;
}

export interface DeterministicCrossoverParams {
  /** 親プール DSL（surrogate スコア降順で上位 count 件をエッジ探索対象にする）。 */
  parents: StrategyDSL[];
  scores: Map<string, number>;
  /** 生成する子の数（= エッジ探索する親の数）。 */
  count: number;
  startDate: string;
  endDate: string;
  /** variant 生成オプション（indicatorIds 絞り込み・per/total 上限）。 */
  variantOptions?: CrossoverVariantOptions;
  /** stage-2 WF 設定。 */
  walkForward?: { windows?: number; minTradesPerWindow?: number };
  /**
   * 勝ち維持の許容比（variant の勝ちトレード数 / 親の勝ちトレード数 の下限）。既定 0.7。
   * これ未満は「勝ちを壊した」として不採用。
   */
  minWinRetention?: number;
  /** stage-1 で評価対象にする最低トレード数。既定 30。 */
  minTrades?: number;
  log?: (message: string) => void;
}

interface ParentCostContext {
  symbol: string;
  timeframe: string;
  config: AnalysisEngineScreeningBacktestRequest['config'];
}

const DEFAULT_MIN_WIN_RETENTION = 0.7;
const DEFAULT_MIN_TRADES = 30;
const VERDICT_RANK: Record<string, number> = {
  robust: 2,
  overfit_suspected: 1,
  not_evaluated: 0,
};

/** summary から勝ち/負けトレード数の近似を出す（winRate×tradeCount）。 */
function winLossCounts(s: ScreeningBacktestSummary): { wins: number; losses: number } {
  const wins = s.winRate * s.tradeCount;
  const losses = (1 - s.winRate) * s.tradeCount;
  return { wins, losses };
}

function costContextFor(parent: StrategyDSL): ParentCostContext {
  const symbol = normalizeCTraderSymbol(parent.symbol);
  const timeframe = normalizeTimeframe(parent.timeframe);
  const costProfile = getExecutionCostProfile(symbol);
  return {
    symbol,
    timeframe,
    config: {
      initialCapital: 10_000,
      leverage: 1,
      tradingCost: 0,
      spreadPips: costProfile.roundTripCostPips,
      pipSize: getPipSize(symbol),
    },
  };
}

function screeningRequest(
  dsl: StrategyDSL,
  ctx: ParentCostContext,
  hypothesisId: string,
  startDate: string,
  endDate: string,
): AnalysisEngineScreeningBacktestRequest {
  return {
    hypothesisId,
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    startDate,
    endDate,
    notePayload: dslToBacktestNotePayload(dsl, defaultParameterValues(dsl)),
    config: ctx.config,
  };
}

/**
 * 親 1 件に対しエッジインジを探索して最良の「親 + 追加条件」を返す（見つからなければ null）。
 */
async function discoverEdgeForParent(
  parent: StrategyDSL,
  params: DeterministicCrossoverParams,
  deps: DeterministicCrossoverDeps,
): Promise<StrategyDSL | null> {
  const ctx = costContextFor(parent);
  const minWinRetention = params.minWinRetention ?? DEFAULT_MIN_WIN_RETENTION;
  const minTrades = params.minTrades ?? DEFAULT_MIN_TRADES;

  // stage-0: 親 baseline。
  let baseline: ScreeningBacktestSummary;
  try {
    const baseResp = await deps.runScreeningBacktest(
      screeningRequest(parent, ctx, parent.id, params.startDate, params.endDate),
    );
    baseline = baseResp.summary;
  } catch (err) {
    params.log?.(
      `[warn] crossover baseline BT failed parent=${parent.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
  const baseCounts = winLossCounts(baseline);

  const gen = generateCrossoverIndicatorVariants(parent, params.variantOptions);
  if (gen.skippedIndicators.length > 0) {
    params.log?.(
      `[info] crossover skipped non-templated indicators: ${gen.skippedIndicators.join(',')}`,
    );
  }
  if (gen.truncated) {
    params.log?.(
      `[info] crossover variants truncated parent=${parent.id}: combos=${gen.totalCombos} → ${gen.variants.length}`,
    );
  }

  // stage-1: 各 variant を screening し、負け減 + 勝ち維持で評価。
  interface Scored {
    variant: StrategyDSL;
    indicatorId: string;
    label: string;
    summary: ScreeningBacktestSummary;
    lossReduction: number;
    winRetention: number;
    eligible: boolean;
  }
  const scored: Scored[] = [];
  for (const cv of gen.variants) {
    let summary: ScreeningBacktestSummary;
    try {
      const resp = await deps.runScreeningBacktest(
        screeningRequest(cv.variant, ctx, parent.id, params.startDate, params.endDate),
      );
      summary = resp.summary;
    } catch (err) {
      params.log?.(
        `[warn] crossover variant BT failed parent=${parent.id} add=${cv.label}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }
    const counts = winLossCounts(summary);
    // 負け減 = baseline 負け数 - variant 負け数（正なら改善）。
    const lossReduction = baseCounts.losses - counts.losses;
    // 勝ち維持 = variant 勝ち数 / baseline 勝ち数（baseline 0 勝ちは維持比 1 扱い）。
    const winRetention = baseCounts.wins > 0 ? counts.wins / baseCounts.wins : 1;
    const eligible =
      summary.tradeCount >= minTrades && lossReduction > 0 && winRetention >= minWinRetention;
    scored.push({
      variant: cv.variant,
      indicatorId: cv.indicatorId,
      label: cv.label,
      summary,
      lossReduction,
      winRetention,
      eligible,
    });
  }

  const eligible = scored.filter((s) => s.eligible);
  if (eligible.length === 0) {
    params.log?.(
      `[info] crossover: no edge found for parent=${parent.id} (variants=${scored.length})`,
    );
    return null;
  }
  // 負け減が大きい順、tie は勝ち維持が高い順。
  eligible.sort((a, b) => b.lossReduction - a.lossReduction || b.winRetention - a.winRetention);

  // stage-2: 上位 1 を WF 過学習ガードで確定（SL/TP は触らない = slValues/tpValues 空）。
  const best = eligible[0];
  let overfitGuard: AnalysisEngineOverfitGuard | null = null;
  try {
    const optResp = await deps.runOptimize({
      hypothesisId: parent.id,
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      startDate: params.startDate,
      endDate: params.endDate,
      notePayload: dslToBacktestNotePayload(best.variant, defaultParameterValues(best.variant)),
      config: ctx.config,
      slValues: [],
      tpValues: [],
      ...(params.walkForward ? { walkForward: params.walkForward } : {}),
    });
    overfitGuard = optResp.overfitGuard;
  } catch (err) {
    params.log?.(
      `[warn] crossover WF failed parent=${parent.id} add=${best.label}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  // WF が not_evaluated でも候補は採用（観測のみ・合否強制は Side-B 確証ゲート Phase 4）。
  const verdict = overfitGuard?.verdict ?? 'not_evaluated';
  params.log?.(
    `[info] crossover edge adopted parent=${parent.id} add=${best.label} ` +
      `lossReduction=${best.lossReduction.toFixed(1)} winRetention=${best.winRetention.toFixed(2)} ` +
      `verdict=${verdict} (rank=${VERDICT_RANK[verdict] ?? 0})`,
  );

  return {
    ...best.variant,
    id: `x-det-${randomUUID()}`,
    generation: parent.generation + 1,
    parentIds: [parent.id],
    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: 'crossover',
      description: `deterministic edge-discovery: add ${best.label} to ${parent.id}`,
    },
  };
}

/**
 * 決定論 Crossover を生成する。スコア降順 top count の親についてエッジインジを探索し、
 * 採用できた親ぶんの子 DSL を返す（エッジ無し / 失敗の親はスキップ）。
 */
export async function generateDeterministicCrossovers(
  params: DeterministicCrossoverParams,
  deps: DeterministicCrossoverDeps,
): Promise<StrategyDSL[]> {
  const ranked = [...params.parents].sort(
    (a, b) => (params.scores.get(b.id) ?? 0) - (params.scores.get(a.id) ?? 0),
  );
  const targets = ranked.slice(0, Math.max(0, params.count));

  const children: StrategyDSL[] = [];
  for (const parent of targets) {
    const child = await discoverEdgeForParent(parent, params, deps);
    if (child) children.push(child);
  }
  return children;
}
