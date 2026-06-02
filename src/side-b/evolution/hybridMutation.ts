/**
 * Hybrid Mutation 生成器。
 *
 * 1 親ごとに baseline BT、構造不変の数値最適化、LLM による構造変異案、
 * その構造案の数値最適化を順に行う。数値評価と合否は analysis-engine 側に寄せ、
 * LLM は構造案の提案に限定する。
 */

import { getExecutionCostProfile, getPipSize } from '../strategy_dsl/executionSimulation';
import { dslToBacktestNotePayload } from '../strategy_dsl/dslToBacktestNotePayload';
import { defaultParameterValues } from '../strategy_dsl/dslParameterUtils';
import type { StrategyDSL } from '../strategy_dsl/schema';
import { normalizeTimeframe } from '../constants/timeframes';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';
import type { MutationAgent, RepairHintMap } from '../agents/MutationAgent';
import type {
  AnalysisEngineScreeningBacktestRequest,
  AnalysisEngineScreeningBacktestResponse,
} from '../../schemas/external/analysisEngine';
import {
  generateDeterministicMutants,
  type DeterministicMutationDeps,
} from './deterministicMutation';

export interface EvolutionMutationBundle {
  /** 起点になった親 DSL。 */
  parentDsl: StrategyDSL;
  /** 親そのものの baseline screening BT。失敗時は null。 */
  baselineResult: AnalysisEngineScreeningBacktestResponse | null;
  /** 構造を変えず、analysis-engine で数値最適化した DSL。 */
  optimizedBase: StrategyDSL | null;
  /** LLM 構造案を analysis-engine で数値最適化した DSL。 */
  structuralVariant: StrategyDSL | null;
  /** 決定論ゲート用の観測値。合否判断は LLM に渡さない。 */
  analysisMetrics: {
    baselinePf: number | null;
    optimizedBaseCreated: boolean;
    structuralVariantCreated: boolean;
  };
  /** LLM 由来の構造案についての観測メモ。 */
  llmRationale: string | null;
}

export interface HybridMutationSummary {
  parentCount: number;
  baselineEvaluated: number;
  optimizedBaseCreated: number;
  structuralVariantCreated: number;
}

export interface HybridMutationParams {
  parents: StrategyDSL[];
  scores: Map<string, number>;
  /** 返却する mutant 数の上限。内部では最大2体/親を作るため親数へ変換して使う。 */
  count: number;
  startDate: string;
  endDate: string;
  mutationAgent: MutationAgent;
  repairHints?: RepairHintMap;
  log?: (message: string) => void;
}

export interface HybridMutationResult {
  mutants: StrategyDSL[];
  bundles: EvolutionMutationBundle[];
  summary: HybridMutationSummary;
}

function screeningRequest(
  dsl: StrategyDSL,
  startDate: string,
  endDate: string,
): AnalysisEngineScreeningBacktestRequest {
  const symbol = normalizeCTraderSymbol(dsl.symbol);
  const timeframe = normalizeTimeframe(dsl.timeframe);
  const costProfile = getExecutionCostProfile(symbol);
  return {
    hypothesisId: dsl.id,
    symbol,
    timeframe,
    startDate,
    endDate,
    notePayload: dslToBacktestNotePayload(dsl, defaultParameterValues(dsl)),
    config: {
      initialCapital: 10_000,
      leverage: 1,
      tradingCost: 0,
      spreadPips: costProfile.roundTripCostPips,
      pipSize: getPipSize(symbol),
    },
  };
}

async function optimizeOne(
  parent: StrategyDSL,
  params: HybridMutationParams,
  deps: DeterministicMutationDeps,
): Promise<StrategyDSL | null> {
  const optimized = await generateDeterministicMutants(
    {
      parents: [parent],
      scores: new Map([[parent.id, params.scores.get(parent.id) ?? 0]]),
      count: 1,
      startDate: params.startDate,
      endDate: params.endDate,
      log: params.log,
    },
    deps,
  );
  return optimized[0] ?? null;
}

export async function generateHybridMutants(
  params: HybridMutationParams,
  deps: DeterministicMutationDeps,
): Promise<HybridMutationResult> {
  const ranked = [...params.parents].sort(
    (a, b) => (params.scores.get(b.id) ?? 0) - (params.scores.get(a.id) ?? 0),
  );
  const maxMutants = Math.max(0, params.count);
  const targetParentCount = Math.ceil(maxMutants / 2);
  const targets = ranked.slice(0, targetParentCount);
  const mutants: StrategyDSL[] = [];
  const bundles: EvolutionMutationBundle[] = [];

  for (const parent of targets) {
    let baselineResult: AnalysisEngineScreeningBacktestResponse | null = null;
    try {
      baselineResult = await deps.runScreeningBacktest(
        screeningRequest(parent, params.startDate, params.endDate),
      );
    } catch (err) {
      params.log?.(
        `[warn] hybrid mutation baseline skipped parent=${parent.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const optimizedBase = await optimizeOne(parent, params, deps);
    if (optimizedBase) mutants.push(optimizedBase);

    const structuralDrafts = await params.mutationAgent.generateMutants(
      [parent],
      new Map([[parent.id, params.scores.get(parent.id) ?? 0]]),
      1,
      params.repairHints,
    );
    const structuralDraft = structuralDrafts[0] ?? null;
    const structuralVariant = structuralDraft
      ? await optimizeOne(structuralDraft, params, deps)
      : null;
    if (structuralVariant) mutants.push(structuralVariant);

    bundles.push({
      parentDsl: parent,
      baselineResult,
      optimizedBase,
      structuralVariant,
      analysisMetrics: {
        baselinePf: baselineResult?.summary.pf ?? null,
        optimizedBaseCreated: optimizedBase !== null,
        structuralVariantCreated: structuralVariant !== null,
      },
      llmRationale: structuralDraft
        ? `LLM 構造案 ${structuralDraft.id} を analysis-engine で数値最適化`
        : null,
    });
  }

  const summary: HybridMutationSummary = {
    parentCount: bundles.length,
    baselineEvaluated: bundles.filter((b) => b.baselineResult !== null).length,
    optimizedBaseCreated: bundles.filter((b) => b.optimizedBase !== null).length,
    structuralVariantCreated: bundles.filter((b) => b.structuralVariant !== null).length,
  };

  return { mutants: mutants.slice(0, maxMutants), bundles, summary };
}
