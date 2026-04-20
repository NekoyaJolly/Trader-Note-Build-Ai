/**
 * 1 世代分の進化ループ（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.8
 */

import { randomUUID } from 'crypto';

import type { BacktestSummary, WalkForwardSummary } from '../models/edgeHypothesis';
import type { EdgeLedger } from '../ledger/EdgeLedger';
import { CrossoverAgent } from '../agents/CrossoverAgent';
import { MutationAgent } from '../agents/MutationAgent';
import type { DSLBacktestAdapter, BacktestPeriod, DslBacktestAggregate } from '../strategy_dsl/DSLBacktestAdapter';
import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
import { DiversityEnforcer } from './DiversityEnforcer';
import { dslToMachineConditions } from './dslEdgeMapper';
import { scoreFromValidationSummary } from './evolutionScore';
import {
  MAX_OVERFIT_SCORE,
  MIN_TRAIN_PROFIT_FACTOR,
  MIN_VALIDATION_PROFIT_FACTOR,
} from './evolutionPromotionThresholds';
import type { StrategyPopulation } from './StrategyPopulation';

export interface EvolutionLoopDeps {
  population: StrategyPopulation;
  adapter: DSLBacktestAdapter;
  mutationAgent: MutationAgent;
  crossoverAgent: CrossoverAgent;
  enforcer: DiversityEnforcer;
  edgeLedger: EdgeLedger;
  /** 既定のバックテスト期間（ISO 日付） */
  defaultPeriod: BacktestPeriod;
}

export interface GenerationReport {
  regime: string;
  /** 検証スコア（戦略 ID → 合成スコア） */
  scores: Record<string, number>;
  eliteIds: string[];
  mutantsReceived: number;
  crossoversReceived: number;
  addedToPopulation: number;
  promotedToLedger: number;
  lowDiversityBoost: boolean;
  errors: string[];
}

function seedStrategy(regime: string): StrategyDSL {
  const raw = {
    id: `seed-${regime}-${randomUUID()}`,
    generation: 0,
    parentIds: [] as string[],
    regimeTarget: regime,
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long' as const,
      trigger: {
        logic: 'AND' as const,
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>' as const, value: 0 }],
      },
      orderType: 'market' as const,
    },
    stopLoss: { type: 'atr_multiple' as const, value: 1.5 },
    takeProfit: { type: 'rr_ratio' as const, value: 2 },
    parameters: {},
    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: 'initial_random' as const,
      description: '最小シード戦略（Phase5）',
    },
  };
  return StrategyDSLSchema.parse(raw);
}

export class EvolutionLoop {
  constructor(private readonly deps: EvolutionLoopDeps) {}

  /**
   * 1 世代分: 評価 → 選抜 → 淘汰 → 変異・交配 → 多様性 → 昇格候補の台帳登録
   */
  async runOneGeneration(regime: string): Promise<GenerationReport> {
    const errors: string[] = [];
    const { population, adapter, mutationAgent, crossoverAgent, enforcer, edgeLedger } = this.deps;
    const period = this.deps.defaultPeriod;

    let list = population.getByRegime(regime);
    if (list.length === 0) {
      population.add(regime, seedStrategy(regime));
      list = population.getByRegime(regime);
    }

    const metrics = new Map<string, DslBacktestAggregate>();
    const scores = new Map<string, number>();

    for (const strategy of list) {
      try {
        const agg = await adapter.runBacktest(strategy, {}, period);
        metrics.set(strategy.id, agg);
        scores.set(strategy.id, scoreFromValidationSummary(agg.validation.summary));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${strategy.id}: ${msg}`);
        scores.set(strategy.id, -1);
      }
    }

    const elites = population.getElites(regime, 5, scores);
    population.removeWorst(regime, 5, scores);

    let mutants: StrategyDSL[] = [];
    let crosses: StrategyDSL[] = [];
    try {
      mutants = await mutationAgent.generateMutants(elites, scores, 10);
    } catch (e) {
      errors.push(`mutation: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      crosses = await crossoverAgent.generateCrossovers(elites, scores, 5);
    } catch (e) {
      errors.push(`crossover: ${e instanceof Error ? e.message : String(e)}`);
    }

    const merged = enforcer.filterDiverse([...mutants, ...crosses], 0.85);
    for (const s of merged) {
      population.add(regime, s);
    }

    let lowDiversityBoost = false;
    const div = enforcer.diversityScore(population.getByRegime(regime));
    if (div < 0.3) {
      lowDiversityBoost = true;
      try {
        const extra = await mutationAgent.generateDiverse(regime, 5);
        for (const s of extra) {
          population.add(regime, s);
        }
      } catch (e) {
        errors.push(`diverse: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    let promoted = 0;
    try {
      promoted = await this.promoteEligibleStrategies(elites, metrics, edgeLedger);
    } catch (e) {
      errors.push(`promote: ${e instanceof Error ? e.message : String(e)}`);
    }

    await population.save().catch(() => undefined);

    const report: GenerationReport = {
      regime,
      scores: Object.fromEntries(scores.entries()),
      eliteIds: elites.map((e) => e.id),
      mutantsReceived: mutants.length,
      crossoversReceived: crosses.length,
      addedToPopulation: merged.length,
      promotedToLedger: promoted,
      lowDiversityBoost,
      errors,
    };
    return report;
  }

  /**
   * 厳格 3 条件を満たすエリートを EdgeLedger に confirmed で登録
   */
  private async promoteEligibleStrategies(
    elites: StrategyDSL[],
    metrics: Map<string, DslBacktestAggregate>,
    ledger: EdgeLedger,
  ): Promise<number> {
    let n = 0;
    for (const dsl of elites) {
      const agg = metrics.get(dsl.id);
      if (!agg) continue;
      if (agg.trainPf <= MIN_TRAIN_PROFIT_FACTOR) continue;
      if (agg.validationPf <= MIN_VALIDATION_PROFIT_FACTOR) continue;
      if (agg.overfitScore >= MAX_OVERFIT_SCORE) continue;

      const wf: WalkForwardSummary = {
        overfitScore: agg.overfitScore,
        avgInSampleWinRate: agg.train.summary.winRate,
        avgOutOfSampleWinRate: agg.validation.summary.winRate,
        runAt: new Date(),
        avgInSamplePF: agg.trainPf,
        avgOutOfSamplePF: agg.validationPf,
        totalTradeCount: agg.validation.summary.totalTrades,
      };

      const bt: BacktestSummary = {
        pf: agg.validationPf,
        winRate: agg.validation.summary.winRate,
        tradeCount: agg.validation.summary.totalTrades,
        runAt: new Date(),
      };

      const created = await ledger.create({
        statement: `[DSL:${dsl.id}] ${dsl.metadata.description ?? '進化戦略（Phase5）'}`,
        category: 'structure',
        conditions: dslToMachineConditions(dsl),
        expectedDirection: dsl.entry.direction,
        status: 'unverified',
        symbols: [dsl.symbol.replace(/\//g, '')],
        timeframes: [dsl.timeframe],
        observationCount: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalPnlPips: 0,
        avgRR: agg.validation.summary.riskRewardRatio ?? 0,
        source: 'backtest',
      });

      await ledger.markConfirmed(
        created.id,
        bt,
        wf,
        `Phase5 進化ループ昇格（dsl=${dsl.id}, regime=${dsl.regimeTarget}）`,
      );
      n++;
    }
    return n;
  }
}
