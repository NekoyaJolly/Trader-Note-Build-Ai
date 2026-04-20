/**
 * 1 世代分の進化ループ（Phase 5A: 候補生成のみ）
 *
 * -------------------------------------------------------------------
 * Phase 5A での方針（重要）
 *
 * - TS シミュレーション（`DSLBacktestAdapter` + `dslBacktestSimulation`）
 *   は **高速スクリーニング** にとどめる。
 * - **EdgeLedger への自動登録・自動 `confirmed` 昇格は行わない**（完全撤退）。
 *   confirmed の意味論は「Phase 4c の Python WF/MC/BH を通過したもの」に
 *   戻す。
 * - 本ループは代わりに `GenerationReport.promotionCandidates` に
 *   「Phase 4c に流すべき候補」を出力するだけにする。
 * - 候補メタには `dslId` と `source: 'evolution'` を **必ず含める**。
 *   Phase 5B で「昇格候補 → Phase 4c（StrategistAgent/Python）接続」を
 *   設計する際に、この識別子を手掛かりに使う。
 * -------------------------------------------------------------------
 *
 * @see docs/design/phase_5_specification.md §4.8
 */

import { randomUUID } from 'crypto';

import { CrossoverAgent } from '../agents/CrossoverAgent';
import { MutationAgent } from '../agents/MutationAgent';
import type { DSLBacktestAdapter, BacktestPeriod, DslBacktestAggregate } from '../strategy_dsl/DSLBacktestAdapter';
import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
import { DiversityEnforcer } from './DiversityEnforcer';
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
  /** 既定のバックテスト期間（ISO 日付） */
  defaultPeriod: BacktestPeriod;
}

/**
 * 「Phase 4c の精密検証に回すべき」と進化ループが判定した候補のメタ。
 *
 * Phase 5A では EdgeLedger に書き込まない（= confirmed にしない）。
 * Phase 5B で Phase 4c への橋渡しを設計するため、
 * `dslId` / `source='evolution'` はこの構造に保持しておく。
 */
export interface EvolutionPromotionCandidate {
  /** 戦略 DSL の一意 ID（Phase 5B 接続用の識別子） */
  dslId: string;
  /** 由来の識別子（常に 'evolution'。Phase 5B で source として使用） */
  source: 'evolution';
  regime: string;
  symbol: string;
  timeframe: string;
  trainPf: number;
  validationPf: number;
  overfitScore: number;
  validationTradeCount: number;
  description?: string;
}

export interface GenerationReport {
  regime: string;
  /** 検証スコア（戦略 ID → 合成スコア） */
  scores: Record<string, number>;
  eliteIds: string[];
  mutantsReceived: number;
  crossoversReceived: number;
  addedToPopulation: number;
  /**
   * Phase 4c 接続候補のメタ。
   * Phase 5A では EdgeLedger に登録しない（本フィールドに残すだけ）。
   */
  promotionCandidates: EvolutionPromotionCandidate[];
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
      description: '最小シード戦略（Phase5A）',
    },
  };
  return StrategyDSLSchema.parse(raw);
}

export class EvolutionLoop {
  constructor(private readonly deps: EvolutionLoopDeps) {}

  /**
   * 1 世代分: 評価 → 選抜 → 淘汰 → 変異・交配 → 多様性 → 候補抽出
   *
   * Phase 5A では「候補抽出」までで止め、EdgeLedger には一切書き込まない。
   */
  async runOneGeneration(regime: string): Promise<GenerationReport> {
    const errors: string[] = [];
    const { population, adapter, mutationAgent, crossoverAgent, enforcer } = this.deps;
    const period = this.deps.defaultPeriod;

    let list = population.getByRegime(regime);
    if (list.length === 0) {
      population.add(regime, seedStrategy(regime));
      list = population.getByRegime(regime);
    }

    const metrics = new Map<string, DslBacktestAggregate>();
    const scores = new Map<string, number>();
    const dslById = new Map<string, StrategyDSL>();

    for (const strategy of list) {
      dslById.set(strategy.id, strategy);
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

    // Phase 5A: 台帳書き込みはしない。候補メタだけ GenerationReport に載せる。
    const promotionCandidates = this.extractPromotionCandidates(elites, metrics, dslById);

    await population.save().catch(() => undefined);

    const report: GenerationReport = {
      regime,
      scores: Object.fromEntries(scores.entries()),
      eliteIds: elites.map((e) => e.id),
      mutantsReceived: mutants.length,
      crossoversReceived: crosses.length,
      addedToPopulation: merged.length,
      promotionCandidates,
      lowDiversityBoost,
      errors,
    };
    return report;
  }

  /**
   * 厳格 3 条件（学習 PF / 検証 PF / 過学習）を満たすエリートを
   * 「Phase 4c に流すべき候補」として抽出する。
   *
   * Phase 5A: EdgeLedger への create / markConfirmed は呼ばない。
   * Phase 5B: ここで抽出したメタを StrategistAgent / Python 検証に渡す
   *          配線を別途設計する。
   */
  private extractPromotionCandidates(
    elites: StrategyDSL[],
    metrics: Map<string, DslBacktestAggregate>,
    dslById: Map<string, StrategyDSL>,
  ): EvolutionPromotionCandidate[] {
    const out: EvolutionPromotionCandidate[] = [];
    for (const dsl of elites) {
      const agg = metrics.get(dsl.id);
      if (!agg) continue;
      if (agg.trainPf <= MIN_TRAIN_PROFIT_FACTOR) continue;
      if (agg.validationPf <= MIN_VALIDATION_PROFIT_FACTOR) continue;
      if (agg.overfitScore >= MAX_OVERFIT_SCORE) continue;

      const fromPop = dslById.get(dsl.id) ?? dsl;
      out.push({
        dslId: fromPop.id,
        source: 'evolution',
        regime: fromPop.regimeTarget,
        symbol: fromPop.symbol,
        timeframe: fromPop.timeframe,
        trainPf: agg.trainPf,
        validationPf: agg.validationPf,
        overfitScore: agg.overfitScore,
        validationTradeCount: agg.validation.summary.totalTrades,
        description: fromPop.metadata.description,
      });
    }
    return out;
  }
}
