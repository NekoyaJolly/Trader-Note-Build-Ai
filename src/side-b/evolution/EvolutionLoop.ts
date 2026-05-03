/**
 * 1 世代分の進化ループ (Phase 5A: 候補生成のみ / Critical-4 段階 4a.3: 正式 BT ゲート)
 *
 * -------------------------------------------------------------------
 * 設計方針
 *
 * - 本ループは `SurrogateFitnessSimulator` (= 進化計算用の **近似 fitness 評価**) を
 *   使って population を高速評価する。これは **正式な BT 結果ではない** (Critical-4 §13)。
 * - **EdgeLedger への自動登録・自動 `confirmed` 昇格は行わない**。
 *   confirmed の意味論は「Phase 4c の Python WF/MC/BH を通過したもの」 = analysis-engine
 *   の正式 BT を経由した仮説のみ。
 * - **段階 4a.3**: surrogate 厳格 3 条件を満たした候補 (top K) を analysis-engine に
 *   送って **正式 BT で再検証** する。`formalBtPassed === true` のものだけが
 *   `promotionCandidates` に残る。surrogate fitness だけでは絶対に昇格しない。
 *
 * 段階 4a.3 のスコープ外 (4a.4 以降):
 *   - ScreeningBacktestRun への永続化 (専用テーブル設計とセットで実施)
 *   - 親個体プール戦略 (confirmed 50%, screening_passed 25%, unverified 5-10%)
 * -------------------------------------------------------------------
 *
 * @see docs/design/phase_5a_specification.md (Phase 5A 進化探索基盤)
 * @see docs/design/critical_4_bt_unification.md §13 (BT エンジン抽象 / 段階 4a)
 */

import { randomUUID } from 'crypto';

import type { CrossoverAgent } from '../agents/CrossoverAgent';
import type { MutationAgent } from '../agents/MutationAgent';
import type { SurrogateFitnessSimulator, BacktestPeriod, SurrogateFitnessAggregate } from '../strategy_dsl/SurrogateFitnessSimulator';
import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
import type { DiversityEnforcer } from './DiversityEnforcer';
import { scoreFromValidationSummary } from './evolutionScore';
import {
  MAX_OVERFIT_SCORE,
  MIN_TRAIN_PROFIT_FACTOR,
  MIN_VALIDATION_PROFIT_FACTOR,
} from './evolutionPromotionThresholds';
import type { StrategyPopulation } from './StrategyPopulation';
import { runScreeningBacktest as defaultRunScreeningBacktest } from '../../backend/services/analysisEngineClient';
import { dslToBacktestNotePayload } from '../strategy_dsl/dslToBacktestNotePayload';
import { defaultParameterValues } from '../strategy_dsl/dslParameterUtils';
import { VALIDATION_THRESHOLDS } from '../config/validationThresholds';

/**
 * analysis-engine の正式 BT を呼ぶ関数 (DI 用)。
 * 既定では `analysisEngineClient.runScreeningBacktest` (HTTP)。テストではモックを差し替える。
 */
export type RunScreeningBacktestFn = typeof defaultRunScreeningBacktest;

export interface EvolutionLoopDeps {
  population: StrategyPopulation;
  adapter: SurrogateFitnessSimulator;
  mutationAgent: MutationAgent;
  crossoverAgent: CrossoverAgent;
  enforcer: DiversityEnforcer;
  /** 既定のバックテスト期間（ISO 日付） */
  defaultPeriod: BacktestPeriod;
  /**
   * 段階 4a.3: 正式 BT 関数。省略時は analysis-engine の HTTP クライアント。
   * surrogate 厳格条件を満たした候補のみが呼び出される。
   */
  runFormalBacktest?: RunScreeningBacktestFn;
  /**
   * 段階 4a.3: 正式 BT を行う候補数の上限 (top K)。省略時は 5。
   * surrogate スコア降順で top K のみ analysis-engine に送る。
   */
  formalBtTopK?: number;
}

/**
 * 段階 4a.3: 正式 BT (analysis-engine) で得られたメトリクス。
 * surrogate fitness とは別軸で、analysis-engine + backtesting.py が返す値を持つ。
 */
export interface FormalBtMetrics {
  pf: number;
  winRate: number;
  tradeCount: number;
}

/**
 * 「Phase 4c の精密検証に回すべき」と進化ループが判定した候補のメタ。
 *
 * Phase 5A では EdgeLedger に書き込まない（= confirmed にしない）。
 * 段階 4a.3 から: surrogate 厳格 3 条件 **かつ** analysis-engine 正式 BT でも
 * PF 閾値を満たした候補だけが残る (`formalBtPassed === true`)。
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
  /**
   * 段階 4a.3: 正式 BT 結果。
   * `formalBtPassed === true` の候補のみ `promotionCandidates` に残る (= surrogate のみでは昇格不可)。
   */
  formalBtPassed: boolean;
  /** 段階 4a.3: 正式 BT メトリクス (analysis-engine 成功時のみ非 null) */
  formalBtMetrics: FormalBtMetrics | null;
  /** 段階 4a.3: 正式 BT 失敗 / null 結果 / PF 未達などの理由 (passed=true の場合 undefined) */
  formalBtFailureReason?: string;
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

/**
 * 段階 4a.3: 正式 BT の合格 PF 下限。
 * StatusManager.canPromoteToScreeningPassed の `minPf` (= 1.0) と揃える。
 * surrogate の MIN_TRAIN_PROFIT_FACTOR (1.5) や MIN_VALIDATION_PROFIT_FACTOR (1.3) は
 * 別軸の判定 (高速近似) で、ここは「analysis-engine 経由で実際に取引が成立し PF>1」を最低条件とする。
 */
const FORMAL_BT_MIN_PF = 1.0;

/** 段階 4a.3: 正式 BT の最低トレード数。VALIDATION_THRESHOLDS の共通値を流用。 */
const FORMAL_BT_MIN_TRADES = VALIDATION_THRESHOLDS.common.minTradeCount;

export class EvolutionLoop {
  private readonly runFormalBacktest: RunScreeningBacktestFn;
  private readonly formalBtTopK: number;

  constructor(private readonly deps: EvolutionLoopDeps) {
    this.runFormalBacktest = deps.runFormalBacktest ?? defaultRunScreeningBacktest;
    this.formalBtTopK = deps.formalBtTopK ?? 5;
  }

  /**
   * 1 世代分: 評価 → 選抜 → 淘汰 → 変異・交配 → 多様性 → surrogate 候補抽出 → 正式 BT ゲート
   *
   * Phase 5A: EdgeLedger には一切書き込まない。
   * 段階 4a.3: surrogate を通った候補だけ analysis-engine の正式 BT に送り、
   *   `formalBtPassed === true` のもののみ `promotionCandidates` に残る。
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

    const metrics = new Map<string, SurrogateFitnessAggregate>();
    const scores = new Map<string, number>();
    const dslById = new Map<string, StrategyDSL>();

    for (const strategy of list) {
      dslById.set(strategy.id, strategy);
      try {
        const agg = await adapter.evaluateFitness(strategy, {}, period);
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

    // surrogate 厳格 3 条件を通った candidate を抽出し、surrogate スコア降順で top K に絞る。
    const surrogateCandidates = this.extractPromotionCandidates(elites, metrics, dslById);
    const ranked = surrogateCandidates
      .slice()
      .sort((a, b) => (scores.get(b.dslId) ?? -Infinity) - (scores.get(a.dslId) ?? -Infinity))
      .slice(0, this.formalBtTopK);

    // 段階 4a.3: top K のみ analysis-engine 正式 BT で再検証。formalBtPassed=true のみ残す。
    const verified = await this.verifyCandidatesWithFormalBacktest(ranked, dslById, period);
    const promotionCandidates = verified.filter((c) => c.formalBtPassed);

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
   * surrogate 厳格 3 条件 (学習 PF / 検証 PF / 過学習) を満たすエリートを
   * 「正式 BT 候補」として抽出する。
   *
   * 段階 4a.3 までは: ここでの通過が「最終昇格候補」だった。
   * 段階 4a.3 から: ここを通過した候補は **正式 BT ゲート (verifyCandidatesWithFormalBacktest)
   * で再検証** され、`formalBtPassed === true` のものだけが `promotionCandidates` に残る。
   * surrogate 単独では絶対に昇格しない。
   */
  private extractPromotionCandidates(
    elites: StrategyDSL[],
    metrics: Map<string, SurrogateFitnessAggregate>,
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
        // 正式 BT ゲート前の初期値。verifyCandidatesWithFormalBacktest で必ず上書きされる。
        formalBtPassed: false,
        formalBtMetrics: null,
      });
    }
    return out;
  }

  /**
   * 段階 4a.3: surrogate を通った各候補に対し analysis-engine 正式 BT を実行し、
   * `formalBtPassed` / `formalBtMetrics` / `formalBtFailureReason` を埋める。
   *
   * 失敗ケース (全て formalBtPassed=false):
   * - dslId に対応する DSL が見つからない
   * - analysis-engine HTTP エラー / timeout
   * - レスポンスが空 (summary が null 同等)
   * - PF が `FORMAL_BT_MIN_PF` 未満、または tradeCount が `FORMAL_BT_MIN_TRADES` 未満
   *
   * BT 期間は surrogate 評価と同じ `period` を使う (validation 期間との整合性は将来課題)。
   */
  private async verifyCandidatesWithFormalBacktest(
    candidates: EvolutionPromotionCandidate[],
    dslById: Map<string, StrategyDSL>,
    period: BacktestPeriod,
  ): Promise<EvolutionPromotionCandidate[]> {
    const out: EvolutionPromotionCandidate[] = [];
    for (const cand of candidates) {
      const dsl = dslById.get(cand.dslId);
      if (!dsl) {
        out.push({
          ...cand,
          formalBtPassed: false,
          formalBtMetrics: null,
          formalBtFailureReason: 'DSL not found in current generation map',
        });
        continue;
      }

      const resolvedParams = defaultParameterValues(dsl);
      const notePayload = dslToBacktestNotePayload(dsl, resolvedParams);

      let response;
      try {
        response = await this.runFormalBacktest({
          // hypothesisId は analysis-engine 側でトレース文字列として使われるだけ (UUID 強制なし)。
          // 進化候補は EdgeHypothesis を持たないため、dslId を識別子として渡す。
          hypothesisId: dsl.id,
          symbol: dsl.symbol,
          timeframe: dsl.timeframe,
          startDate: toIsoDateTime(period.start),
          endDate: toIsoDateTime(period.end),
          notePayload,
          config: { initialCapital: 10_000, leverage: 1, tradingCost: 0 },
        });
      } catch (err) {
        out.push({
          ...cand,
          formalBtPassed: false,
          formalBtMetrics: null,
          formalBtFailureReason: `analysis-engine BT failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        continue;
      }

      if (!response || !response.summary) {
        out.push({
          ...cand,
          formalBtPassed: false,
          formalBtMetrics: null,
          formalBtFailureReason: 'analysis-engine returned empty summary',
        });
        continue;
      }

      const formalBtMetrics: FormalBtMetrics = {
        pf: response.summary.pf,
        winRate: response.summary.winRate,
        tradeCount: response.summary.tradeCount,
      };

      if (formalBtMetrics.tradeCount < FORMAL_BT_MIN_TRADES) {
        out.push({
          ...cand,
          formalBtPassed: false,
          formalBtMetrics,
          formalBtFailureReason: `tradeCount ${formalBtMetrics.tradeCount} < ${FORMAL_BT_MIN_TRADES}`,
        });
        continue;
      }
      if (!Number.isFinite(formalBtMetrics.pf) || formalBtMetrics.pf < FORMAL_BT_MIN_PF) {
        out.push({
          ...cand,
          formalBtPassed: false,
          formalBtMetrics,
          formalBtFailureReason: `pf ${formalBtMetrics.pf} < ${FORMAL_BT_MIN_PF}`,
        });
        continue;
      }

      out.push({
        ...cand,
        formalBtPassed: true,
        formalBtMetrics,
      });
    }
    return out;
  }
}

/**
 * defaultPeriod は ISO 日付 (`2024-01-01`) または ISO datetime のどちらでも来る可能性がある。
 * analysis-engine の Zod schema は `datetime()` 必須なので、足りなければ `T00:00:00.000Z` を補う。
 */
function toIsoDateTime(value: string): string {
  if (value.includes('T')) return value;
  return `${value}T00:00:00.000Z`;
}
