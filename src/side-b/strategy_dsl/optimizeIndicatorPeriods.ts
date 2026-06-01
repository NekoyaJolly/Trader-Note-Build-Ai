/**
 * 進化ループ再設計 Phase 1c: インジケーター期間の最適化オーケストレータ。
 *
 * generateIndicatorPeriodVariants（決定論 variant 生成）と analysis-engine の BT/WF を
 * つなぎ、ベストな期間構成を選ぶ。backtesting.py の optimize()（スカラー sweep）とは別
 * メカニズム = variant DSL を 1 つずつ評価する経路（period は構造的で snapshot key が変わるため）。
 *
 * 既定は **2 段階**（コスト制御）:
 *   stage-1: 全 variant を軽い全期間 screening BT でランク（リスク調整後 = sharpe）。
 *   stage-2: 上位 K（既定 1）にだけ WF 過学習ガード（/v1/optimize）をかけ、verdict と
 *            集計 OOS でベストを確定する。
 * 実測（6000 本）で単発 BT ≈ 0.2s / WF ≈ 7s のため、2 段階で「全 variant×WF」(~14倍) を回避。
 *
 * `strategy='wf_all'` を指定すると全 variant に WF をかける（最も頑健だが重い）。
 *
 * 数値最適化は決定論（variant 生成 + 決定論 BT）で LLM を使わない（AGENTS.md 原則#3）。
 */

import type {
  AnalysisEngineOptimizeRequestInput,
  AnalysisEngineOptimizeResponse,
  AnalysisEngineOverfitGuard,
  AnalysisEngineScreeningBacktestRequest,
  AnalysisEngineScreeningBacktestResponse,
} from '../../schemas/external/analysisEngine';
import { defaultParameterValues } from './dslParameterUtils';
import { dslToBacktestNotePayload } from './dslToBacktestNotePayload';
import {
  generateIndicatorPeriodVariants,
  type IndicatorVariantOptions,
} from './indicatorParamVariants';
import type { StrategyDSL } from './schema';

/** analysis-engine クライアント（テストで stub 注入できるよう DI）。 */
export interface OptimizeIndicatorPeriodsDeps {
  runScreeningBacktest: (
    input: AnalysisEngineScreeningBacktestRequest,
  ) => Promise<AnalysisEngineScreeningBacktestResponse>;
  runOptimize: (
    input: AnalysisEngineOptimizeRequestInput,
  ) => Promise<AnalysisEngineOptimizeResponse>;
}

export interface OptimizeIndicatorPeriodsParams {
  dsl: StrategyDSL;
  hypothesisId: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  config: AnalysisEngineScreeningBacktestRequest['config'];
  /** stage-2 WF / optimize に渡す SL/TP 候補（空なら SL/TP は最適化せず WF だけ）。 */
  slValues?: number[];
  tpValues?: number[];
  /** variant 生成オプション（±N% / points / maxCombos）。 */
  variantOptions?: IndicatorVariantOptions;
  /** stage-2 で WF をかける上位件数。既定 1。 */
  topK?: number;
  /** stage-1 でランク対象にする最低トレード数（未満は ineligible）。既定 30。 */
  minScreeningTrades?: number;
  /** 評価戦略。既定 'two_stage'。 */
  strategy?: 'two_stage' | 'wf_all';
  /** stage-2 の WF 設定（未指定なら /v1/optimize の既定 windows=4 / floor=25）。 */
  walkForward?: { windows?: number; minTradesPerWindow?: number };
}

export interface IndicatorPeriodScreeningEntry {
  variantIndex: number;
  isBase: boolean;
  summary: AnalysisEngineScreeningBacktestResponse['summary'];
  /** ランクに使う適応度（sharpe）。floor 未満 / トレード無しは null（ineligible）。 */
  fitness: number | null;
  eligible: boolean;
}

export interface IndicatorPeriodWfEntry {
  variantIndex: number;
  bestParams: Record<string, number>;
  overfitGuard: AnalysisEngineOverfitGuard | null;
  summary: AnalysisEngineOptimizeResponse['summary'];
}

export interface OptimizeIndicatorPeriodsResult {
  /** 選ばれたベスト variant DSL（期間が適用済み）。 */
  bestVariant: StrategyDSL;
  /** stage-2 が返した SL/TP 等の最適パラメータ。 */
  bestParams: Record<string, number>;
  /** ベスト variant の WF 過学習ガード（WF を回せた場合）。 */
  overfitGuard: AnalysisEngineOverfitGuard | null;
  strategyUsed: 'two_stage' | 'wf_all';
  variantMeta: {
    axisCount: number;
    totalCombos: number;
    truncated: boolean;
    returnedCount: number;
  };
  /** stage-1 のランク結果（fitness 降順）。wf_all では空。 */
  screening: IndicatorPeriodScreeningEntry[];
  /** stage-2 で WF を回した variant 群。 */
  evaluated: IndicatorPeriodWfEntry[];
}

const DEFAULT_TOP_K = 1;
const DEFAULT_MIN_SCREENING_TRADES = 30;

const VERDICT_RANK: Record<string, number> = {
  robust: 2,
  overfit_suspected: 1,
  not_evaluated: 0,
};

/** stage-1 ランクキー: sharpe 降順、null は最下位。tie は pf 降順。 */
function compareScreening(
  a: IndicatorPeriodScreeningEntry,
  b: IndicatorPeriodScreeningEntry,
): number {
  const fa = a.fitness;
  const fb = b.fitness;
  if (fa === null && fb === null) return b.summary.pf - a.summary.pf;
  if (fa === null) return 1;
  if (fb === null) return -1;
  if (fb !== fa) return fb - fa;
  return b.summary.pf - a.summary.pf;
}

/** stage-2 選択キー: verdict 優先 → 集計 OOS sharpe → pf。 */
function compareWf(a: IndicatorPeriodWfEntry, b: IndicatorPeriodWfEntry): number {
  const va = a.overfitGuard ? VERDICT_RANK[a.overfitGuard.verdict] ?? 0 : 0;
  const vb = b.overfitGuard ? VERDICT_RANK[b.overfitGuard.verdict] ?? 0 : 0;
  if (vb !== va) return vb - va;
  const sa = a.overfitGuard?.aggregateOos.sharpe ?? Number.NEGATIVE_INFINITY;
  const sb = b.overfitGuard?.aggregateOos.sharpe ?? Number.NEGATIVE_INFINITY;
  if (sb !== sa) return sb - sa;
  const pa = a.overfitGuard?.aggregateOos.pf ?? a.summary.pf;
  const pb = b.overfitGuard?.aggregateOos.pf ?? b.summary.pf;
  return pb - pa;
}

/**
 * インジ期間を variant 生成 + BT/WF で最適化する。
 *
 * 戻り値の bestVariant が「期間を最適化済みの DSL」。overfitGuard は WF を回した結果
 * （観測用 verdict 付き）。実際の昇格合否は Side-B 確証ゲート（Phase 4）が判断する。
 */
export async function optimizeIndicatorPeriods(
  params: OptimizeIndicatorPeriodsParams,
  deps: OptimizeIndicatorPeriodsDeps,
): Promise<OptimizeIndicatorPeriodsResult> {
  // topK は 1 未満だと stage-2 が一度も走らず無評価になるため 1 にクランプ。
  const topK = Math.max(1, Math.floor(params.topK ?? DEFAULT_TOP_K));
  const minTrades = params.minScreeningTrades ?? DEFAULT_MIN_SCREENING_TRADES;
  const strategyUsed = params.strategy ?? 'two_stage';

  const gen = generateIndicatorPeriodVariants(params.dsl, params.variantOptions);
  const variantMeta = {
    axisCount: gen.axisCount,
    totalCombos: gen.totalCombos,
    truncated: gen.truncated,
    returnedCount: gen.returnedCount,
  };

  const buildScreeningRequest = (variant: StrategyDSL): AnalysisEngineScreeningBacktestRequest => ({
    hypothesisId: params.hypothesisId,
    symbol: params.symbol,
    timeframe: params.timeframe,
    startDate: params.startDate,
    endDate: params.endDate,
    notePayload: dslToBacktestNotePayload(variant, defaultParameterValues(variant)),
    config: params.config,
  });

  const buildOptimizeRequest = (variant: StrategyDSL): AnalysisEngineOptimizeRequestInput => ({
    hypothesisId: params.hypothesisId,
    symbol: params.symbol,
    timeframe: params.timeframe,
    startDate: params.startDate,
    endDate: params.endDate,
    notePayload: dslToBacktestNotePayload(variant, defaultParameterValues(variant)),
    config: params.config,
    slValues: params.slValues ?? [],
    tpValues: params.tpValues ?? [],
    walkForward: {
      enabled: true,
      ...(params.walkForward?.windows !== undefined ? { windows: params.walkForward.windows } : {}),
      ...(params.walkForward?.minTradesPerWindow !== undefined
        ? { minTradesPerWindow: params.walkForward.minTradesPerWindow }
        : {}),
    },
  });

  // どの variant index を stage-2（WF）にかけるか決める。
  let screening: IndicatorPeriodScreeningEntry[] = [];
  let wfIndices: number[];

  if (strategyUsed === 'wf_all') {
    wfIndices = gen.variants.map((_, i) => i);
  } else {
    // stage-1: 全 variant を screening BT でランク。
    for (let i = 0; i < gen.variants.length; i += 1) {
      const resp = await deps.runScreeningBacktest(buildScreeningRequest(gen.variants[i]));
      const eligible = resp.summary.tradeCount >= minTrades;
      screening.push({
        variantIndex: i,
        isBase: i === 0,
        summary: resp.summary,
        fitness: eligible ? resp.summary.sharpe ?? null : null,
        eligible,
      });
    }
    screening = [...screening].sort(compareScreening);
    const eligibleRanked = screening.filter((e) => e.eligible);
    const ranked = eligibleRanked.length > 0 ? eligibleRanked : screening;
    // eligible が皆無なら base にフォールバックして必ず WF を 1 本は回す。
    wfIndices =
      eligibleRanked.length > 0 ? ranked.slice(0, topK).map((e) => e.variantIndex) : [0];
  }

  // stage-2: 選抜 variant に WF。
  const evaluated: IndicatorPeriodWfEntry[] = [];
  for (const idx of wfIndices) {
    const resp = await deps.runOptimize(buildOptimizeRequest(gen.variants[idx]));
    evaluated.push({
      variantIndex: idx,
      bestParams: resp.bestParams,
      overfitGuard: resp.overfitGuard,
      summary: resp.summary,
    });
  }

  const bestEntry = [...evaluated].sort(compareWf)[0];
  const bestIndex = bestEntry?.variantIndex ?? 0;

  return {
    bestVariant: gen.variants[bestIndex],
    bestParams: bestEntry?.bestParams ?? {},
    overfitGuard: bestEntry?.overfitGuard ?? null,
    strategyUsed,
    variantMeta,
    screening,
    evaluated,
  };
}
