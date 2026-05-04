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

import { createHash, randomUUID } from 'crypto';

import type { CrossoverAgent } from '../agents/CrossoverAgent';
import type { MutationAgent } from '../agents/MutationAgent';
import type { SurrogateFitnessSimulator, BacktestPeriod, SurrogateFitnessAggregate } from '../strategy_dsl/SurrogateFitnessSimulator';
import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
import type { DiversityEnforcer } from './DiversityEnforcer';
import { scoreFromValidationSummary } from './evolutionScore';
// PR #96: 旧 extractPromotionCandidates が直接参照していた閾値は surrogateRescuePolicy
// (= isNormalPass / isNearMiss) に集約されたため、本ファイルからは import 不要になった。
// 閾値定義そのものは evolutionPromotionThresholds で一元管理を継続する。
import type { StrategyPopulation } from './StrategyPopulation';
import { runScreeningBacktest as defaultRunScreeningBacktest } from '../../backend/services/analysisEngineClient';
import { dslToBacktestNotePayload } from '../strategy_dsl/dslToBacktestNotePayload';
import { defaultParameterValues } from '../strategy_dsl/dslParameterUtils';
import { VALIDATION_THRESHOLDS } from '../config/validationThresholds';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';
import { normalizeTimeframe } from '../constants/timeframes';
import type { AnalysisEngineScreeningBacktestResponse } from '../../schemas/external/analysisEngine';
import {
  evolutionBacktestRunRepository as defaultEvolutionBacktestRepo,
  type EvolutionBacktestRunRepository,
} from '../../backend/repositories/evolutionBacktestRunRepository';
import {
  buildParentPool,
  type EdgeHypothesisLoader,
  type ParentPoolSummary,
} from './parentPoolPolicy';
import { edgeLedger as defaultEdgeLedger } from '../ledger';
import {
  selectFormalBtCandidatesWithRescue,
  type FormalBtCandidateSummary,
  type SurrogateRoute,
} from './surrogateRescuePolicy';
import {
  createRepairHintV1,
  summarizeRepairHints,
  type RepairHint,
  type RepairHintSummary,
} from './repairHintPolicy';
import type { RepairHintMap } from '../agents/MutationAgent';
import {
  decidePromotionGateV1,
  summarizePromotionGateDecisions,
  type PromotionGateDecision,
  type PromotionGateSummary,
} from './promotionGatePolicy';
import {
  buildRepairAppliedTrace,
  evaluateRepairOutcome,
  summarizeRepairOutcomes,
  type RepairAppliedTrace,
  type RepairOutcome,
  type RepairOutcomeBaseline,
  type RepairOutcomeSummary,
} from './repairOutcomeTelemetry';

/**
 * EvolutionLoop が repository に求める最小契約。
 *   - `createMany`: 4a.4 で 1 世代分の formal BT 結果を永続化
 *   - `findRecentFormalBtPassed`: PR #95 で親個体プールが過去合格戦略を再利用
 * テストで実 DB を介さない型付きモックを書けるように切り出す。
 * 既定実装の `EvolutionBacktestRunRepository` はこの形を満たす。
 */
export type EvolutionBacktestPersister = Pick<
  EvolutionBacktestRunRepository,
  'createMany' | 'findRecentFormalBtPassed'
>;

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
  /**
   * 段階 4a.4: 正式 BT 履歴を永続化する書き込み口 (createMany のみ要求)。
   * 省略時は EvolutionBacktestRun テーブルへの書き込みクライアント。
   * `null` を渡すと永続化をスキップする (テスト用 / DB 切り離し運用)。
   */
  evolutionBacktestRepo?: EvolutionBacktestPersister | null;
  /**
   * 段階 4a.4: 進化ループ実行単位 ID。1 サイクル = 1 evolutionRunId。
   * 省略時は EvolutionLoop インスタンスごとに自動生成 (cron 起動毎に new するため)。
   */
  evolutionRunId?: string;
  /**
   * PR #98: 親プール統合用の EdgeHypothesis ロード口。
   *   - undefined: 既定の `edgeLedger` を使う (= 本番経路)
   *   - null:      EdgeHypothesis 経路を完全に skip (= v1 互換、テスト用 / DB 切り離し運用)
   *   - 値を指定:  そのオブジェクトの `findByStatus` を使う (= モック注入)
   */
  edgeHypothesisLoader?: EdgeHypothesisLoader | null;
}

/**
 * 段階 4a.3: 正式 BT (analysis-engine) で得られたメトリクス。
 * surrogate fitness とは別軸で、analysis-engine + backtesting.py が返す値を持つ。
 *
 * PR #100: `maxDrawdown` を optional で追加。RepairHint v1 の metrics 補強で
 *   risk action を発火させるために必要。analysis-engine `summary.maxDD` を埋める。
 *   既存読み出し側との互換性維持のため optional とする。
 */
export interface FormalBtMetrics {
  pf: number;
  winRate: number;
  tradeCount: number;
  maxDrawdown?: number;
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
  /**
   * PR #96 Surrogate Rescue Lane: 候補が正式 BT に送られた経路。
   *
   * - `normal_pass`: surrogate 主要 3 条件をすべて通過 (= 旧来の昇格候補)
   * - `near_miss_rescue` 等: rescue lane で救済された候補 (= surrogate 通過していない、
   *   ただし rescue 条件 (惜しい / 低 DD / 取引数十分 / 構造的に新しい) を満たす)
   *
   * `normal_pass` 以外は **「正式 BT で確認する価値がある」** という意味でしかなく、
   * promotion / production 採用とは無関係。`formalBtPassed === true` でも rescue 出身は
   * Phase 4c 検証で改めて昇格可否を判定する。
   *
   * 互換性のため optional。PR #96 以降は EvolutionLoop 経路で常に埋まる。
   */
  route?: SurrogateRoute;
  /**
   * PR #100: 正式 BT 失敗時に deterministic 生成される RepairHint v1。
   * `formalBtPassed === false` の候補のみ非 undefined。次世代 mutation の入力文脈に使う。
   * 候補の評価・昇格・採用を意味しない (= mutation 補助情報)。
   */
  repairHint?: RepairHint;
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
   * 段階 4a.3: 正式 BT を **実際に呼び出した** 候補全件 (passed/failed どちらも含む)。
   * `formalBtFailureReason` を観測したい運用ログ用途のためにここに残す。
   * Phase 5A では EdgeLedger には書き込まない。
   */
  formalBtVerifiedCandidates: EvolutionPromotionCandidate[];
  /**
   * 段階 4a.3: 正式 BT を **通過した** 候補のみ (= `formalBtPassed === true`)。
   * Phase 5B 以降で StrategistAgent / Phase 4c 検証に流す対象はこちら。
   */
  promotionCandidates: EvolutionPromotionCandidate[];
  lowDiversityBoost: boolean;
  errors: string[];
  /**
   * PR #95: 親個体プール v1 のソース別取得件数 + fallback 状態。
   * mutation/crossover の親選抜が単一ソース (population.getElites) から
   * 3 系統 (formal_bt_passed / current_population / novelty_seed) のミックスへ
   * 拡張されたため、観測経路として残す。
   */
  parentPoolSummary: ParentPoolSummary;
  /**
   * PR #96: Surrogate Rescue Lane の選抜結果。
   * route 別件数 / kill 数 / 重複排除 / fallback 状態を 1 オブジェクトに集約。
   * `normal_pass=0` でも rescue lane で uniqueCandidates>0 を観測できれば成功シグナル。
   */
  formalBtCandidateSummary: FormalBtCandidateSummary;
  /**
   * PR #102: RepairHint Outcome Telemetry v1 の集計。
   * 前世代の failed candidate (= baseline) と当世代 mutation child の formal BT 結果を
   * 比較し、`improved / worsened / unchanged / unknown` を集計する。
   *
   * - 観測のみ。candidate の stage / promotion には絶対に影響させない (PR #101 と独立)
   * - dslId 単位で一意化、同一 child を二重計上しない
   * - baseline がない / 比較不能な場合は `unknown` (0 補完しない)
   *
   * 個別の `RepairOutcome` は `repairOutcomes` に格納される。
   */
  repairOutcomeSummary: RepairOutcomeSummary;
  /** PR #102: child 単位の個別 outcome (debug / smoke 用)。 */
  repairOutcomes: RepairOutcome[];
  /**
   * PR #100: FailureReason → RepairHint v1 の集計。
   * 正式 BT で `formalBtPassed=false` の候補のみが対象。失敗が 0 件の世代では
   * `totalFailures=0` で空集計が入る。
   *
   * 個別の RepairHint は `formalBtVerifiedCandidates[i].repairHint` で参照可能。
   * これは mutation の補助情報であり、候補の評価・昇格・採用を意味しない。
   */
  repairHintSummary: RepairHintSummary;
  /**
   * PR #101: PromotionGate v1 の集計。
   * 候補ごとの `EvolutionCandidateStage` 判定を stage / decision / reason 軸で集計する。
   *
   * - rescue は `formal_bt_candidate` までで止まる (= 昇格扱いしない)
   * - `formal_bt_passed` は `validation_candidate` までで止まる (= production 扱いしない)
   * - `productionEligible` は v1 では常に 0
   *
   * `EdgeStatus` / `StatusManager` には触らない (DB-free in-memory only)。
   */
  promotionGateSummary: PromotionGateSummary;
  /**
   * PR #101: 候補ごとの個別 PromotionGate 判定。debug / smoke で使う。
   * 件数が多い世代では summary 経由の参照を推奨。
   */
  promotionGateDecisions: PromotionGateDecision[];
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

/**
 * PR #100 / PR #102: `runOneGeneration` の任意オプション。
 *
 * - `repairHintsForMutation` (PR #100): 前世代の正式 BT 失敗から生成した RepairHint を
 *   mutation の入力文脈として渡す。未指定時は同インスタンスが直前世代で保持した
 *   値 (= `lastRepairHints`) にフォールバック。
 * - `repairBaselinesForOutcome` (PR #102): 前世代の failed candidate metrics を
 *   `RepairOutcomeBaseline` として渡す。outcome 判定で「親より改善したか」の比較元になる。
 *   未指定時は `lastRepairBaselines` にフォールバック。
 *
 * 本番 scheduler が毎回新しい `EvolutionLoop` を作る運用でも、scheduler 側で
 * report から repairHints / baselines を集めて次回呼び出し時に渡せば、
 * 「修復ヒント・効果測定」の経路が世代をまたいで成立する。
 */
export interface RunOneGenerationOptions {
  repairHintsForMutation?: RepairHintMap;
  repairBaselinesForOutcome?: ReadonlyMap<string, RepairOutcomeBaseline>;
}

export class EvolutionLoop {
  private readonly runFormalBacktest: RunScreeningBacktestFn;
  private readonly formalBtTopK: number;
  private readonly evolutionBacktestRepo: EvolutionBacktestPersister | null;
  private readonly evolutionRunId: string;
  private readonly edgeHypothesisLoader: EdgeHypothesisLoader | null;
  /**
   * PR #100: 同インスタンスで連続世代を回す場合の repairHints 保持先。
   * 1 世代目に生成した RepairHint を、2 世代目の mutation に自動的に渡すために使う。
   * 本番 scheduler が毎回 new する運用では `runOneGeneration({ repairHintsForMutation })`
   * を明示注入するのが正規経路。
   */
  private lastRepairHints: RepairHintMap = new Map();
  /**
   * PR #102: 同インスタンスで連続世代を回す場合の RepairOutcomeBaseline 保持先。
   * 前世代の failed candidate metrics を保持し、当世代 mutation child の formal BT 結果と
   * 比較して outcome を判定する。本番 scheduler では options.repairBaselinesForOutcome を
   * 明示注入する経路を使う。
   */
  private lastRepairBaselines: ReadonlyMap<string, RepairOutcomeBaseline> = new Map();

  constructor(private readonly deps: EvolutionLoopDeps) {
    this.runFormalBacktest = deps.runFormalBacktest ?? defaultRunScreeningBacktest;
    this.formalBtTopK = deps.formalBtTopK ?? 5;
    // null が明示された場合は永続化スキップ、undefined なら既定の repo を使う。
    this.evolutionBacktestRepo =
      deps.evolutionBacktestRepo === null
        ? null
        : (deps.evolutionBacktestRepo ?? defaultEvolutionBacktestRepo);
    this.evolutionRunId = deps.evolutionRunId ?? randomUUID();
    // PR #98: edgeHypothesisLoader 同様の挙動 (null 明示で skip、undefined なら既定の edgeLedger)
    this.edgeHypothesisLoader =
      deps.edgeHypothesisLoader === null
        ? null
        : (deps.edgeHypothesisLoader ?? defaultEdgeLedger);
  }

  /**
   * 1 世代分: 評価 → 選抜 → 淘汰 → 変異・交配 → 多様性 → surrogate 候補抽出 → 正式 BT ゲート
   *
   * Phase 5A: EdgeLedger には一切書き込まない。
   * 段階 4a.3: surrogate を通った候補だけ analysis-engine の正式 BT に送り、
   *   `formalBtPassed === true` のもののみ `promotionCandidates` に残る。
   *
   * PR #100: `options.repairHintsForMutation` で前世代の RepairHint を渡せる。
   *   未指定時は同インスタンスが直前世代で生成した `lastRepairHints` を使う。
   *   末尾で当世代の repairHint を `lastRepairHints` に保存し、次回呼び出しに繋ぐ。
   */
  async runOneGeneration(
    regime: string,
    options?: RunOneGenerationOptions,
  ): Promise<GenerationReport> {
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

    // PR #95: 親個体プール v1 — mutation/crossover の親を 3 系統 (formal_bt_passed /
    // current_population / novelty_seed) のミックスから取得する。
    // - elites (= surrogate 上位、promotion 候補) は `extractPromotionCandidates` で別途使う
    // - 親プール = 「次世代を産むための材料」、elites = 「正式 BT に送る候補」、と役割分離
    //
    // 注: `removeWorst()` を **後** に呼ぶ。removeWorst を先にすると初期世代 (population
    //     1〜5 個体) で current_population が空になり、親プールが novelty_seed に偏る。
    const parentPoolResult = await buildParentPool(regime, 5, scores, {
      population,
      evolutionBacktestRepo: this.evolutionBacktestRepo,
      edgeHypothesisLoader: this.edgeHypothesisLoader,
    });
    population.removeWorst(regime, 5, scores);
    const parentPool = parentPoolResult.entries;
    const parentDsls = parentPool.map((e) => e.dsl);
    // mutation/crossover は score Map を期待するため、parent pool 側のスコアをマージ。
    // formal_bt_passed / novelty_seed は surrogate score を持たないため 0 を仮置きする。
    const parentScores = new Map(scores);
    for (const e of parentPool) {
      if (!parentScores.has(e.dsl.id)) {
        parentScores.set(e.dsl.id, e.surrogateScore ?? 0);
      }
    }

    // PR #100: 前世代の RepairHint を mutation に渡す。優先順位:
    //   1. 引数 options.repairHintsForMutation (本番 scheduler 経路: 毎回 new)
    //   2. インスタンス内部の lastRepairHints (テスト / smoke で同インスタンス連続実行)
    //   どちらも未設定なら従来挙動 (= 修復ヒント無しの mutation)
    const repairHintsForMutation =
      options?.repairHintsForMutation ?? this.lastRepairHints;
    // PR #102: 前世代の failed candidate metrics を baseline として使う。
    //   trace 構築時に sourceDslId / route を補完する用途と、後段の outcome 比較で参照する。
    const repairBaselinesForOutcome =
      options?.repairBaselinesForOutcome ?? this.lastRepairBaselines;

    let mutants: StrategyDSL[] = [];
    let crosses: StrategyDSL[] = [];
    try {
      mutants = await mutationAgent.generateMutants(
        parentDsls,
        parentScores,
        10,
        repairHintsForMutation.size > 0 ? repairHintsForMutation : undefined,
      );
    } catch (e) {
      errors.push(`mutation: ${e instanceof Error ? e.message : String(e)}`);
    }

    // PR #102: mutation child ごとに RepairAppliedTrace を構築する。
    //   - 親 (parentIds) のいずれかが前世代の repairHint を持つ場合のみ trace 化
    //   - dslId をキーにした generation-local map に保持 (= DSL schema は変更しない)
    //   - repairHint がない random mutation child は trace 対象外 (= outcome unknown)
    const repairAppliedTraces = new Map<string, RepairAppliedTrace>();
    if (repairHintsForMutation.size > 0) {
      for (const m of mutants) {
        const t = buildRepairAppliedTrace(
          m.parentIds ?? [],
          repairHintsForMutation,
          repairBaselinesForOutcome,
        );
        if (t) repairAppliedTraces.set(m.id, t);
      }
    }
    try {
      crosses = await crossoverAgent.generateCrossovers(parentDsls, parentScores, 5);
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

    // PR #96: Surrogate Rescue Lane — normal_pass / near_miss / low_drawdown /
    //   trade_count / novelty / kill の 6 分類で正式 BT 候補を選抜する。
    //   surrogate 閾値は緩和せず、normal_pass=0 の世代でも rescue lane で候補を救済する。
    const rescueResult = this.buildRescueCandidates(elites, metrics, dslById, scores);
    const ranked = rescueResult.candidates;

    // 段階 4a.3: top K を analysis-engine 正式 BT で再検証。
    //   - formalBtVerifiedCandidates: 正式 BT を呼んだ全件 (失敗理由付き)、運用ログ用
    //   - promotionCandidates:        formalBtPassed=true のみ、Phase 5B 検証への入力源
    const verifyResults = await this.verifyCandidatesWithFormalBacktest(ranked, scores, period);

    // PR #100: 失敗候補について FailureReason → RepairHint v1 を deterministic 生成。
    //   - 個別 hint は candidate.repairHint に格納 (formalBtPassed=false のみ)
    //   - summary は GenerationReport.repairHintSummary に集約 (smoke / 観測用)
    //   候補の評価・昇格には一切影響しない (= mutation 補助情報のみ)。
    const formalBtVerifiedCandidates = verifyResults.map((r) => {
      if (r.candidate.formalBtPassed) return r.candidate;
      const hint = createRepairHintV1({
        candidateId: r.candidate.dslId,
        dslId: r.candidate.dslId,
        route: r.candidate.route,
        failureReason: r.candidate.formalBtFailureReason ?? 'other',
        metrics: r.candidate.formalBtMetrics
          ? {
              pf: r.candidate.formalBtMetrics.pf,
              tradeCount: r.candidate.formalBtMetrics.tradeCount,
              // PR #100 review: maxDrawdown 補強を本番経路でも発火させるため。
              maxDrawdown: r.candidate.formalBtMetrics.maxDrawdown,
            }
          : undefined,
      });
      return { ...r.candidate, repairHint: hint };
    });
    const promotionCandidates = formalBtVerifiedCandidates.filter((c) => c.formalBtPassed);
    const repairHintSummary = summarizeRepairHints(
      formalBtVerifiedCandidates
        .filter((c): c is typeof c & { repairHint: RepairHint } => Boolean(c.repairHint))
        .map((c) => ({ hint: c.repairHint, route: c.route })),
    );

    // PR #100: 当世代の RepairHint を次世代 mutation 用に内部に保存する。
    // scheduler が毎回 new する運用では `options.repairHintsForMutation` を明示注入する経路を使うこと。
    const nextRepairHints = new Map<string, RepairHint>();
    for (const c of formalBtVerifiedCandidates) {
      if (c.repairHint) nextRepairHints.set(c.dslId, c.repairHint);
    }
    this.lastRepairHints = nextRepairHints;

    // PR #102: 当世代の failed candidate metrics を次世代 baseline 用に保存。
    // outcome 比較時、key は前世代の sourceCandidateId (= 前世代 dslId) になる。
    const nextRepairBaselines = new Map<string, RepairOutcomeBaseline>();
    for (const c of formalBtVerifiedCandidates) {
      if (c.formalBtPassed) continue;
      const m = c.formalBtMetrics;
      nextRepairBaselines.set(c.dslId, {
        candidateId: c.dslId,
        dslId: c.dslId,
        failureReason: c.repairHint?.failureReason ?? c.formalBtFailureReason ?? 'other',
        route: c.route,
        metrics: m
          ? {
              pf: m.pf,
              tradeCount: m.tradeCount,
              maxDrawdown: m.maxDrawdown,
            }
          : {},
      });
    }
    this.lastRepairBaselines = nextRepairBaselines;

    // PR #102: 当世代 mutation child のうち trace を持つものについて outcome を判定。
    //   - dslId 単位で一意化 (= 同 child を二重計上しない)
    //   - trace を持たない child (= 通常 mutation / crossover / noveltySeed) は対象外
    //   - baseline (前世代の failed metrics) と child formal BT 結果を比較
    //   - 観測のみ。candidate の stage / promotion には絶対に影響させない
    const repairOutcomes: RepairOutcome[] = [];
    const outcomeDslIds = new Set<string>();
    for (const c of formalBtVerifiedCandidates) {
      if (outcomeDslIds.has(c.dslId)) continue;
      const trace = repairAppliedTraces.get(c.dslId);
      if (!trace) continue;
      const baseline = repairBaselinesForOutcome.get(trace.sourceCandidateId) ?? null;
      const outcome = evaluateRepairOutcome(baseline, {
        candidateId: c.dslId,
        dslId: c.dslId,
        route: c.route,
        repairApplied: trace,
        metrics: c.formalBtMetrics
          ? {
              pf: c.formalBtMetrics.pf,
              tradeCount: c.formalBtMetrics.tradeCount,
              maxDrawdown: c.formalBtMetrics.maxDrawdown,
            }
          : undefined,
        failureReason: c.formalBtFailureReason ?? undefined,
      });
      repairOutcomes.push(outcome);
      outcomeDslIds.add(c.dslId);
    }
    const repairOutcomeSummary = summarizeRepairOutcomes(repairOutcomes);

    // PR #101: PromotionGate v1 — 候補ごとの EvolutionCandidateStage を deterministic に判定。
    //   PR #101 review #2+#5 対応: 候補は dslId 単位で一意化する。優先順位:
    //     1. 正式 BT 検証済 → 最終 stage (validation_candidate / repairable / repair_excluded)
    //     2. rescue 選抜済だが BT 未送信 → formal_bt_candidate (top-K で落ちた等)
    //     3. それ以外の親プール候補 → parent_eligible
    //   これにより同 dsl が `parent_eligible` と `validation_candidate` に二重計上されず、
    //   `formal_bt_candidate` stage も本番経路で観測可能になる。
    const promotionGateDecisions = this.buildPromotionGateDecisions(
      parentPoolResult.entries,
      ranked,
      formalBtVerifiedCandidates,
    );
    const promotionGateSummary = summarizePromotionGateDecisions(promotionGateDecisions);

    // 段階 4a.4: 正式 BT 履歴を永続化 (passed/failed 全件、DSL 不在分岐は無いので欠損なし)。
    if (this.evolutionBacktestRepo) {
      await this.persistFormalBtHistory(verifyResults).catch(() => undefined);
    }

    await population.save().catch(() => undefined);

    const report: GenerationReport = {
      regime,
      scores: Object.fromEntries(scores.entries()),
      eliteIds: elites.map((e) => e.id),
      mutantsReceived: mutants.length,
      crossoversReceived: crosses.length,
      addedToPopulation: merged.length,
      formalBtVerifiedCandidates,
      promotionCandidates,
      lowDiversityBoost,
      errors,
      parentPoolSummary: parentPoolResult.summary,
      formalBtCandidateSummary: rescueResult.summary,
      repairHintSummary,
      promotionGateSummary,
      promotionGateDecisions,
      repairOutcomeSummary,
      repairOutcomes,
    };
    return report;
  }

  /**
   * PR #101: 親プール候補 / rescue 選抜候補 / 正式 BT 検証済候補から PromotionGate 判定を構築。
   *
   * dslId 単位で一意の最終 stage を持つよう、以下の優先順位で重複を排除する。
   *
   *   1. 正式 BT 検証済 (`formalBtVerifiedCandidates`)
   *      → `validation_candidate` / `repairable` / `repair_excluded` のいずれか
   *   2. rescue 選抜済だが BT 未送信 (`ranked` − `verified`)
   *      → `formal_bt_candidate` (= top-K 制限などで実行されなかった候補)
   *   3. 残りの親プール候補
   *      → `parent_eligible`
   *
   * これにより:
   *   - 同 dsl が `parent_eligible` と `validation_candidate` に二重計上されない (#2)
   *   - `formal_bt_candidate` stage が本番経路で観測される (#5)
   *
   * 状態遷移ロジック本体は `decidePromotionGateV1` に集中させ、
   * EvolutionLoop は入力収集と一意化のみ担当する (設計書 §推奨ファイル構成)。
   */
  private buildPromotionGateDecisions(
    parentPool: ReadonlyArray<{ dsl: StrategyDSL; source: string }>,
    rescueRanked: ReadonlyArray<{ candidate: EvolutionPromotionCandidate; dsl: StrategyDSL }>,
    verified: ReadonlyArray<EvolutionPromotionCandidate>,
  ): PromotionGateDecision[] {
    const decisions: PromotionGateDecision[] = [];
    const decided = new Set<string>();

    // (1) 正式 BT 検証済 → 最終 stage で確定
    for (const c of verified) {
      if (decided.has(c.dslId)) continue;
      decisions.push(
        decidePromotionGateV1({
          candidateId: c.dslId,
          dslId: c.dslId,
          source: c.source,
          route: c.route,
          formalBtPassed: c.formalBtPassed,
          formalBtFailureReason: c.formalBtFailureReason ?? null,
          repairHint: c.repairHint
            ? {
                shouldUseForRepairMutation: c.repairHint.shouldUseForRepairMutation,
                shouldExcludeFromParentPool: c.repairHint.shouldExcludeFromParentPool,
                severity: c.repairHint.severity,
              }
            : null,
          hasValidDsl: true,
          schemaValidationPassed: true,
          metrics: c.formalBtMetrics ?? undefined,
        }),
      );
      decided.add(c.dslId);
    }

    // (2) rescue 選抜済だが BT 未送信 → formal_bt_candidate
    //   `formalBtPassed` を渡さない (= 未確定) ため decidePromotionGateV1 の route 分岐に流れる
    for (const r of rescueRanked) {
      const id = r.candidate.dslId;
      if (decided.has(id)) continue;
      // route='kill' は decidePromotionGateV1 側で rejected に倒れるが、
      // selectFormalBtCandidatesWithRescue の戻り値には kill が含まれないため通常は来ない。
      decisions.push(
        decidePromotionGateV1({
          candidateId: id,
          dslId: id,
          source: r.candidate.source,
          route: r.candidate.route,
          hasValidDsl: true,
          schemaValidationPassed: true,
        }),
      );
      decided.add(id);
    }

    // (3) 残りの親プール候補 → parent_eligible
    for (const e of parentPool) {
      if (decided.has(e.dsl.id)) continue;
      decisions.push(
        decidePromotionGateV1({
          candidateId: e.dsl.id,
          dslId: e.dsl.id,
          source: e.source,
          hasValidDsl: true,
          schemaValidationPassed: true,
        }),
      );
      decided.add(e.dsl.id);
    }

    return decisions;
  }

  /**
   * PR #96: surrogate 結果を rescue policy に渡し、正式 BT 候補と summary を得る。
   *
   * このメソッドは旧 `extractPromotionCandidates` を内部的に置き換える。
   * 旧メソッドは「3 条件すべてを通過したエリート」だけを正式 BT に送っていたが、
   * 新ロジックは:
   *   - normal_pass / near_miss / low_drawdown / trade_count / novelty を 1 つの統一フローで分類
   *   - kill 対象は除外
   *   - formalBtTopK が overallTopK + 各 rescue lane TopK の合計と一致しなくても
   *     重複排除後のユニーク件数で運用 (= 過剰選抜にならない)
   * を行う。`formalBtTopK` の DI は無視せず、normal_pass の上限として尊重する。
   */
  private buildRescueCandidates(
    elites: StrategyDSL[],
    metrics: Map<string, SurrogateFitnessAggregate>,
    dslById: Map<string, StrategyDSL>,
    scores: Map<string, number>,
  ): {
    candidates: Array<{ candidate: EvolutionPromotionCandidate; dsl: StrategyDSL }>;
    summary: FormalBtCandidateSummary;
  } {
    // SurrogateFitnessAggregate を持つ elites のみ rescue policy に渡す
    const inputs = [];
    for (const dsl of elites) {
      const agg = metrics.get(dsl.id);
      if (!agg) continue;
      const fromPop = dslById.get(dsl.id) ?? dsl;
      inputs.push({
        dsl: fromPop,
        aggregate: agg,
        surrogateScore: scores.get(dsl.id) ?? 0,
      });
    }
    // formalBtTopK は overallTopK のオーバーライドとして渡す (= caller が override 可能)。
    // trade_count_rescue は formal BT 段の minTradeCount 閾値と揃え、後段で
    // insufficient_trades で即落ちる候補を rescue 段で除外する。
    const { entries, summary } = selectFormalBtCandidatesWithRescue(inputs, {
      overallTopK: this.formalBtTopK,
      minTradesForTradeCountRescue: FORMAL_BT_MIN_TRADES,
    });

    // 既存の `verifyCandidatesWithFormalBacktest` が期待する形に変換 (candidate に route 付与)
    const candidates = entries.map((e) => {
      const candidate: EvolutionPromotionCandidate = {
        dslId: e.dsl.id,
        source: 'evolution',
        regime: e.dsl.regimeTarget,
        symbol: e.dsl.symbol,
        timeframe: e.dsl.timeframe,
        trainPf: e.aggregate.trainPf,
        validationPf: e.aggregate.validationPf,
        overfitScore: e.aggregate.overfitScore,
        validationTradeCount: e.aggregate.validation.summary.totalTrades,
        description: e.dsl.metadata.description,
        // 正式 BT ゲート前の初期値。verifyCandidatesWithFormalBacktest で必ず上書きされる。
        formalBtPassed: false,
        formalBtMetrics: null,
        route: e.route,
      };
      return { candidate, dsl: e.dsl };
    });

    return { candidates, summary };
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
   *
   * 段階 4a.4: 入力は `extractPromotionCandidates` が返す `{candidate, dsl}` ペアを直接受け取る
   *   ため、内部で `dslById` を再 lookup する必要がない (DSL 不在分岐を削除)。
   *   戻り値には candidate / dsl に加えて engineVersion / surrogateScore を含む (永続化で利用)。
   */
  private async verifyCandidatesWithFormalBacktest(
    candidatesWithDsl: Array<{ candidate: EvolutionPromotionCandidate; dsl: StrategyDSL }>,
    scores: Map<string, number>,
    period: BacktestPeriod,
  ): Promise<
    Array<{
      candidate: EvolutionPromotionCandidate;
      dsl: StrategyDSL;
      engineVersion: string;
      surrogateScore: number;
    }>
  > {
    const out: Array<{
      candidate: EvolutionPromotionCandidate;
      dsl: StrategyDSL;
      engineVersion: string;
      surrogateScore: number;
    }> = [];
    for (const { candidate: cand, dsl } of candidatesWithDsl) {
      const surrogateScore = scores.get(cand.dslId) ?? 0;

      const resolvedParams = defaultParameterValues(dsl);
      const notePayload = dslToBacktestNotePayload(dsl, resolvedParams);

      // 既存正式 BT 経路 (StrategyBacktesterAgent / ScreeningOrchestrator) と同じ正規化を適用。
      // 未正規化のまま送ると DB の OHLCV 表記ゆれ (例: 'EUR/USD' vs 'EURUSD') で読み取り失敗する。
      const symbol = normalizeCTraderSymbol(dsl.symbol);
      const timeframe = normalizeTimeframe(dsl.timeframe);

      let response: AnalysisEngineScreeningBacktestResponse;
      try {
        response = await this.runFormalBacktest({
          // hypothesisId は analysis-engine 側でトレース文字列として使われるだけ (UUID 強制なし)。
          // 進化候補は EdgeHypothesis を持たないため、dslId を識別子として渡す。
          hypothesisId: dsl.id,
          symbol,
          timeframe,
          startDate: toIsoDateTime(period.start),
          endDate: toIsoDateTime(period.end),
          notePayload,
          config: { initialCapital: 10_000, leverage: 1, tradingCost: 0 },
        });
      } catch (err) {
        out.push({
          candidate: {
            ...cand,
            formalBtPassed: false,
            formalBtMetrics: null,
            formalBtFailureReason: `analysis-engine BT failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
          dsl,
          engineVersion: 'unknown',
          surrogateScore,
        });
        continue;
      }

      // response.summary は Zod 契約で必須、ここに来た時点で存在は保証される。
      // PR #100: maxDD を取り込み、RepairHint の risk action 発火条件として下流で利用する。
      // analysis-engine schema は maxDD を `number | null` で返すため、null は埋めない。
      const formalBtMetrics: FormalBtMetrics = {
        pf: response.summary.pf,
        winRate: response.summary.winRate,
        tradeCount: response.summary.tradeCount,
        ...(response.summary.maxDD != null ? { maxDrawdown: response.summary.maxDD } : {}),
      };
      const engineVersion = response.engineVersion;

      if (formalBtMetrics.tradeCount < FORMAL_BT_MIN_TRADES) {
        out.push({
          candidate: {
            ...cand,
            formalBtPassed: false,
            formalBtMetrics,
            formalBtFailureReason: `tradeCount ${formalBtMetrics.tradeCount} < ${FORMAL_BT_MIN_TRADES}`,
          },
          dsl,
          engineVersion,
          surrogateScore,
        });
        continue;
      }
      if (!Number.isFinite(formalBtMetrics.pf) || formalBtMetrics.pf < FORMAL_BT_MIN_PF) {
        out.push({
          candidate: {
            ...cand,
            formalBtPassed: false,
            formalBtMetrics,
            formalBtFailureReason: `pf ${formalBtMetrics.pf} < ${FORMAL_BT_MIN_PF}`,
          },
          dsl,
          engineVersion,
          surrogateScore,
        });
        continue;
      }

      out.push({
        candidate: {
          ...cand,
          formalBtPassed: true,
          formalBtMetrics,
        },
        dsl,
        engineVersion,
        surrogateScore,
      });
    }
    return out;
  }

  /**
   * 段階 4a.4: 正式 BT 履歴を `EvolutionBacktestRun` に永続化する。
   *
   * passed/failed 全件を保存する (運用観察用)。1 件失敗しても他は継続 (repo 側の挙動)。
   * BT エンジンは現状 analysis-engine 固定のため `engine = 'analysis-engine'`。
   * `engineVersion` は HTTP 失敗時のみ `'unknown'` (verify 側で埋める)。
   *
   * verifyResults は `{ candidate, dsl, engineVersion, surrogateScore }` を直接持つため、
   * ここでは追加の lookup を行わない (= DSL 不在による行欠損が起こらない)。
   */
  private async persistFormalBtHistory(
    verifyResults: Array<{
      candidate: EvolutionPromotionCandidate;
      dsl: StrategyDSL;
      engineVersion: string;
      surrogateScore: number;
    }>,
  ): Promise<void> {
    if (!this.evolutionBacktestRepo || verifyResults.length === 0) return;

    const rows = verifyResults.map((r) => ({
      evolutionRunId: this.evolutionRunId,
      generation: r.dsl.generation,
      candidateId: r.candidate.dslId,
      candidateHash: hashStrategyDsl(r.dsl),
      dslSnapshot: r.dsl,
      surrogateScore: r.surrogateScore,
      formalBtPassed: r.candidate.formalBtPassed,
      formalBtMetrics: r.candidate.formalBtMetrics,
      formalBtFailureReason: r.candidate.formalBtFailureReason ?? null,
      engine: 'analysis-engine',
      engineVersion: r.engineVersion,
    }));

    await this.evolutionBacktestRepo.createMany(rows);
  }
}

/**
 * DSL の構造ハッシュ。同一構造の重複検出 / 再評価追跡に使う。
 *
 * - `id` / `metadata.createdAt` のような世代ごとに変わるフィールドは除外
 * - symbol / timeframe は **正規化後** の値でハッシュ化する
 *   (DSL 生成時点の表記ゆれ "EUR/USD" vs "EURUSD" / "1h" vs "60m" で
 *    実質同一戦略の hash が分裂するのを防ぐ)
 * - 残りの戦略構造 (entry / stopLoss / takeProfit / parameters / regimeTarget) は
 *   Zod schema で型が固定されているため、安定 JSON 化して SHA-256
 */
function hashStrategyDsl(dsl: StrategyDSL): string {
  const structural = {
    regimeTarget: dsl.regimeTarget,
    symbol: normalizeCTraderSymbol(dsl.symbol),
    timeframe: normalizeTimeframe(dsl.timeframe),
    entry: dsl.entry,
    stopLoss: dsl.stopLoss,
    takeProfit: dsl.takeProfit,
    parameters: dsl.parameters,
  };
  return createHash('sha256').update(stableStringify(structural)).digest('hex');
}

/**
 * JSON として表現可能な値の型 (`stableStringify` の入力境界)。
 * `unknown` を避けて undefined / function / Symbol などの非 JSON 値の混入を型レベルで弾く。
 */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * キー順固定の安定 JSON 文字列。`JSON.stringify` の挿入順依存を避ける。
 * 同一構造の DSL が常に同じハッシュを生むことを保証する。
 */
function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * defaultPeriod は ISO 日付 (`2024-01-01`) または ISO datetime のどちらでも来る可能性がある。
 * analysis-engine の Zod schema は `datetime()` 必須なので、足りなければ `T00:00:00.000Z` を補う。
 */
function toIsoDateTime(value: string): string {
  if (value.includes('T')) return value;
  return `${value}T00:00:00.000Z`;
}
