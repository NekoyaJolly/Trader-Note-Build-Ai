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

import type { CrossoverAgent, LossTradeSummary } from '../agents/CrossoverAgent';
import type { MutationAgent } from '../agents/MutationAgent';
import type { SurrogateFitnessSimulator, BacktestPeriod, SurrogateFitnessAggregate } from '../strategy_dsl/SurrogateFitnessSimulator';
import type { StrategyDSL } from '../strategy_dsl/schema';
import type { DiversityEnforcer } from './DiversityEnforcer';
import { scoreFromValidationSummary } from './evolutionScore';
// PR #96: 旧 extractPromotionCandidates が直接参照していた閾値は surrogateRescuePolicy
// (= isNormalPass / isNearMiss) に集約されたため、本ファイルからは import 不要になった。
// 閾値定義そのものは evolutionPromotionThresholds で一元管理を継続する。
import type { StrategyPopulation } from './StrategyPopulation';
import { runScreeningBacktest as defaultRunScreeningBacktest } from '../../backend/services/analysisEngineClient';
import { computeDeflatedSharpeRatio } from '../../shared/statistics/deflatedSharpeRatio';
import { computeWinRateLift } from '../../shared/statistics/winRateLift';
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
// Phase B-2: 既定値は null (= 明示注入なしで副作用ゼロ)。本番 scheduler で
// `evolutionInstanceCarryRepository` を明示注入する。default repo を直接使うことはしない。
import type {
  EvolutionInstanceCarryPersister,
  CarriedTrade,
  CarriedRepairHint,
  CarriedRepairBaseline,
} from '../../backend/repositories/evolutionInstanceCarryRepository';
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
  applyOosAwarePromotion,
  decidePromotionGateV1,
  summarizeOosAwarePromotion,
  summarizePromotionGateDecisions,
  type OosAwarePromotionDecision,
  type OosAwarePromotionSummary,
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
import {
  buildOosSplitWindowV1,
  isOosWindowEmpty,
  type OosBacktestRunnerFn,
  type OosBacktestRunnerResult,
} from './analysisEngineRobustnessAdapter';
import {
  fetchGenerationIndicatorCaches,
  type GenerationIndicatorCaches,
} from './generationIndicatorCache';
import { defaultHttpOhlcvSource } from '../../shared/marketdata';
import { normalizeTimeframe as normalizeCanonicalTimeframe } from '../../shared/timeframes';
import {
  mapAnalysisEngineRobustnessResult,
  type OosMetrics,
  type OosValidationResult,
} from './oosValidationResultMapper';
import {
  summarizeOosValidationResults,
  type OosValidationSummary,
} from './oosValidationSummary';
import {
  getDefaultMutationRouteSharesV1,
  mutationCountBaseV1,
  type MutationBudgetAllocation,
} from './adaptiveRepairBudgetPolicy';

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

// PR #105: OosBacktestRunnerFn は analysisEngineRobustnessAdapter.ts に移動済み。
// analysis-engine の verdict (passed / failed / unknown) を含む runner result を運ぶ vehicle。

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
  /**
   * PR #103: OOS / Walk-forward 評価用の backtest runner (optional)。
   *   - undefined: OOS 評価をスキップし `not_evaluated` で summary に出す (= v1 既定)
   *   - 値を指定:  validation_candidate 候補に対して OOS 評価を実行
   *
   * 既存 formal BT runner の date range を流用するか、専用 adapter を渡す。
   * analysis-engine の大改修を避けるため、本番経路でも明示注入されない限り
   * OOS 評価は走らない (= 観測ゼロでも runOneGeneration は壊れない)。
   */
  oosBacktestRunner?: OosBacktestRunnerFn;
  /**
   * Phase B-2 (2026-05-09): cron 起動を跨いだ in-memory cache の永続化口 (optional)。
   *   - undefined / null: 永続化を完全 skip (= 既定挙動、テスト互換、cron 跨ぎ復元なし)
   *   - 値を指定:         各 regime の `runOneGeneration` で carry の load/save を実行
   *
   * 本番 scheduler では `evolutionInstanceCarryRepository` (DB 接続) を明示注入する経路を取る。
   * `oosBacktestRunner` と同じパターン (= 既定は副作用ゼロ、明示注入で機能 ON)。
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.2
   */
  evolutionInstanceCarryRepo?: EvolutionInstanceCarryPersister | null;
  /**
   * STEP 5 段階 2 Phase C C-1 (2026-05-15): novelty seed を生成する際に
   * 使う運用 symbol / timeframe。未指定時は `buildAllNoveltySeeds` の default
   * (`'EURUSD'` / `'15m'`) が使われる。
   *
   * 本番 scheduler から `config.symbols[0]` / `config.timeframe` を注入することで、
   * 「仮説一覧が EUR/USD 15m 固定」「UI のシンボル設定 (XAU/USD) が無視される」
   * 問題 (C-1) の root cause を解消する。
   *
   * 既存テスト互換のため optional。値が未指定の経路は引き続き default を使うため
   * 本変更は非破壊的。
   */
  symbol?: string;
  /** STEP 5 段階 2 Phase C C-1: novelty seed の timeframe (default '15m')。 */
  timeframe?: string;
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
  sharpe?: number;
  returnPct?: number;
  recoveryFactor?: number;
  riskReward?: number;
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
  /**
   * PR #108: 候補が指す `StrategyDSL` 本体。Quality-Diversity Archive Lite の archive 構築で
   * 必要になるため、本番経路では verify 結果と一緒にここに保持する。互換性のため optional。
   * 既存テスト fixtures は省略可。値の評価軸 (formalBtMetrics 等) には影響させない。
   */
  dsl?: StrategyDSL;
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
  /**
   * PR #103: OOS / Walk-forward v1 集計。
   * `validation_candidate` 候補に対する未知期間評価を観測する (= 観測のみ、production 昇格には使わない)。
   * `oosBacktestRunner` 未指定なら全候補が `not_evaluated` で集計される。
   */
  oosValidationSummary: OosValidationSummary;
  /** PR #103: 候補ごとの個別 OOS 結果 (debug / smoke 用)。 */
  oosValidationResults: OosValidationResult[];
  /**
   * PR #105: OOS-aware Promotion の補助 summary。
   *
   * - `promotionGateSummary` の代替ではない。既存 summary の意味は維持し、本 summary は
   *   OOS-aware 適用後の遷移 (validation_candidate → validation_confirmed / hold) だけを
   *   切り出して観測する。
   * - `productionEligible` は常に 0 (PR #105 不変条件)。
   */
  oosAwarePromotionSummary: OosAwarePromotionSummary;
  /** PR #105: 候補ごとの OOS-aware Promotion 判定 (debug / smoke 用)。 */
  oosAwarePromotionDecisions: OosAwarePromotionDecision[];
}

/**
 * regime 別の seed (= novelty seed) は `seedDescriptor.ts` に集約。
 *
 * PR ⑤D-2: 旧 `getSeedDescriptor` / `SeedDescriptor` / `SeedConditionLeaf` /
 * `seedStrategy(regime)` (= regime 別 RSI/ATR 単純 seed 1 つ) は撤廃され、
 * **6 カテゴリ × long/short = 12 種** の `buildSeedDsl(kind, regime)` /
 * `buildAllNoveltySeeds(regime)` に置き換えられた。本ファイルは re-export のみ。
 */
export {
  buildSeedDsl,
  buildAllNoveltySeeds,
  ALL_SEED_KINDS,
  type SeedKind,
} from './seedDescriptor';
import { buildAllNoveltySeeds } from './seedDescriptor';

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
  /**
   * PR #107: Adaptive Repair / Mutation Budget v1 の配分情報。
   *
   * v1 では実 mutation count / route quota への反映経路は EvolutionLoop / MutationAgent 側に
   * まだ無いため、**受け取って観測ログに残すだけ** (= 設計書 §代替方針)。本 budget の
   * 反映は後続 PR (= MutationAgent への route 渡し対応) で行う。受け取り経路を先に
   * 確保することで、multi-generation runner の adaptive decision を **silent に握り潰さず**
   * 観測できるようにする。
   *
   * - 値が渡された場合: `GenerationReport.errors` に `[info] adaptive mutation budget 受領: ...`
   *   を 1 行追加 (= 観測ログ。GenerationReport には専用の `warnings` フィールドが無いため
   *   `errors[]` を info ログ用にも流用)
   * - 未指定: 従来挙動と完全に同等
   */
  mutationBudgetAllocation?: MutationBudgetAllocation;
  /**
   * PR #108: Quality-Diversity Archive Lite から少量注入される親候補 (StrategyDSL)。
   *
   * v1 の挙動:
   * - 既存の population に **重複 dsl.id を除外して** 追加するだけ。最大 2 件 (= 設計書 §7)
   * - Surrogate Rescue Lane / formalBtCandidate 選抜には影響させない (= mutation/crossover 親素材)
   * - `parentPoolSummary` は変えない (= 既存集計を保護)
   * - `errors[]` に `[info] quality diversity archive parents injected: N` を 1 行追加
   * - 未指定 / 空: 従来挙動と完全に同等
   */
  qualityDiversityArchiveParents?: ReadonlyArray<StrategyDSL>;
}

export class EvolutionLoop {
  private readonly runFormalBacktest: RunScreeningBacktestFn;
  private readonly formalBtTopK: number;
  private readonly evolutionBacktestRepo: EvolutionBacktestPersister | null;
  private readonly evolutionRunId: string;
  private readonly edgeHypothesisLoader: EdgeHypothesisLoader | null;
  private readonly oosBacktestRunner: OosBacktestRunnerFn | null;
  /** Phase B-2: cron 起動を跨いだ in-memory cache の永続化口 (= null で skip)。 */
  private readonly evolutionInstanceCarryRepo: EvolutionInstanceCarryPersister | null;
  /**
   * Phase B-2: regime 単位で「DB carry を既に load 試行済みか」を記録するフラグ。
   * 同 EvolutionLoop instance 内で同 regime に対して `runOneGeneration` を複数回
   * 呼ばれても DB load は最初の 1 回だけにする (= 後続は in-memory 引き継ぎ)。
   */
  private readonly carryLoadedRegimes: Set<string> = new Set();
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
  /**
   * Filter Evolution M2 + M3: 同インスタンスで連続世代を回す場合の trade list 保持先。
   *
   * 用途:
   * - M2: 親 A の trade list を子 A+F (= 次世代の crossover/mutation child) と比較して
   *   winRateLift を観測ログに残す（entryTime + outcome のみ参照）
   * - M3: 親 A の負けトレード (= outcome === 'loss') を CrossoverAgent に渡し、
   *   filter 設計の文脈材料とする（entryTime + side + pnl を参照）
   *
   * EvolutionBacktestRun テーブルには `trades` 列が存在しないため、in-memory で
   * 保持する設計 (= DB 永続化は別 PR)。
   *
   * - キー: dslId (= candidate.dslId、世代をまたいで一意)
   * - 値: 該当 candidate の formal BT で得られた trade list (entryTime/side/pnl/outcome)
   * - 失敗 candidate も含めて保持 (= 子側 filter が失敗 trade を除去できているかの観察用)
   * - インスタンス削除で消える (= cron/smoke 1 回ごとに揮発、設計通り)
   */
  private tradesByDslId: Map<
    string,
    ReadonlyArray<{
      entryTime: string;
      side: 'long' | 'short';
      pnl: number;
      outcome: 'win' | 'loss' | 'timeout';
    }>
  > = new Map();

  constructor(private readonly deps: EvolutionLoopDeps) {
    this.runFormalBacktest = deps.runFormalBacktest ?? defaultRunScreeningBacktest;
    this.formalBtTopK = deps.formalBtTopK ?? 5;
    // null が明示された場合は永続化スキップ、undefined なら既定の repo を使う。
    this.evolutionBacktestRepo =
      deps.evolutionBacktestRepo === null
        ? null
        : (deps.evolutionBacktestRepo ?? defaultEvolutionBacktestRepo);
    this.evolutionRunId = deps.evolutionRunId ?? randomUUID();
    // Phase B-2: 既定は null (= cron 跨ぎ復元スキップ)。scheduler 側で本番 repo を明示注入する経路を取る。
    // この既定値はテスト互換 (= prisma に触らない) と明示性を両立する (= oosBacktestRunner と同じ pattern)。
    this.evolutionInstanceCarryRepo = deps.evolutionInstanceCarryRepo ?? null;
    // PR #98: edgeHypothesisLoader 同様の挙動 (null 明示で skip、undefined なら既定の edgeLedger)
    this.edgeHypothesisLoader =
      deps.edgeHypothesisLoader === null
        ? null
        : (deps.edgeHypothesisLoader ?? defaultEdgeLedger);
    // PR #103: 既定は null (= OOS 評価スキップ → not_evaluated)。明示注入のみ実行。
    this.oosBacktestRunner = deps.oosBacktestRunner ?? null;
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

    // Phase B-2: 同 regime に対する初回呼び出しでのみ DB から carry を load する。
    //   - 2 回目以降の呼び出し (= 同 instance で multi-gen 経路) は in-memory cache を使う
    //   - load 失敗 / 該当 carry 不在 / Zod 不適合は warning ログ + 空 cache 維持
    //   - PR #140 review #1: 同 EvolutionLoop instance を全 regime で使い回す運用 (= sideBScheduler)
    //     では、regime 切替時に前 regime の cache が残留して別 regime の payload に混入する事故が
    //     起こり得る。`loadCarryStateForRegime` 側で必ず cache を一旦初期化してから carry 上書きする。
    //   - PR #140 review #2: load 失敗時 (= DB 一時障害等) は flag を立てない設計に変更し、同 instance
    //     内の 2 世代目以降で再試行余地を残す。
    if (!this.carryLoadedRegimes.has(regime)) {
      const loaded = await this.loadCarryStateForRegime(regime);
      if (loaded !== null) errors.push(loaded);
      // 「成功」または「carry なし (= DB 接続済、永続化スキップでない通常運転)」の場合のみ
      // 再試行を抑制する。一時障害 (= warn ログ) のときは flag 立てず、次世代で再 load を試みる。
      if (loaded === null || !loaded.startsWith('[warn]')) {
        this.carryLoadedRegimes.add(regime);
      }
    }

    // PR #107: adaptive budget を受領した場合、PR #111 で実 mutation count / crossover /
    // diverse の生成数に反映する。未指定なら従来挙動 (= count 10/5/5) を完全維持。
    //
    // 反映方針 (= 控えめ + bounded):
    //   default 比率を基準に各 route の比率を計算し、既定 count に乗算する。
    //   - mutation: default share = repair_guided + standard = 20 + 35 = 55%pt → base count 10
    //   - crossover:                = 20%pt → base count 5
    //   - diverse (= novelty_seed): = 15%pt → base count 5
    //   share / default_share の比率に既定 count を掛けて整数化。Math.max(1, ...) で 0 を防ぐ。
    //
    // 設計書 PR #107 §最重要判断基準 §代替方針:
    //   - parent pool 比率は変えない (= ここで触らない)
    //   - production_candidate 自動昇格は変えない (= 観測軸のみ調整)
    //   - LLM 不使用 (deterministic な乗算)
    let mutationCount: number = mutationCountBaseV1.mutation;
    let crossoverCount: number = mutationCountBaseV1.crossover;
    let diverseCount: number = mutationCountBaseV1.diverse;
    if (options?.mutationBudgetAllocation) {
      const a = options.mutationBudgetAllocation;
      const mutationShare = a.byRoute.repair_guided_mutation + a.byRoute.standard_mutation;
      const crossoverShare = a.byRoute.crossover;
      const diverseShare = a.byRoute.novelty_seed;
      // PR #111 Copilot review #1 対応:
      // default share / base count を adaptiveRepairBudgetPolicy 側の単一ソースから参照する
      // ことで、`defaultMutationBudgetAllocationV1.byRoute` を将来変更しても drift しない。
      const defaults = getDefaultMutationRouteSharesV1();
      mutationCount = Math.max(
        1,
        Math.round(mutationCountBaseV1.mutation * (mutationShare / defaults.mutationShare)),
      );
      crossoverCount = Math.max(
        1,
        Math.round(mutationCountBaseV1.crossover * (crossoverShare / defaults.crossoverShare)),
      );
      diverseCount = Math.max(
        1,
        Math.round(mutationCountBaseV1.diverse * (diverseShare / defaults.diverseShare)),
      );
      errors.push(
        `[info] adaptive mutation budget 適用: mutation=${mutationCount} (share=${mutationShare}%pt) / ` +
          `crossover=${crossoverCount} (share=${crossoverShare}%pt) / diverse=${diverseCount} (share=${diverseShare}%pt) / ` +
          `repair=${a.byRoute.repair_guided_mutation}%pt / novelty=${a.byRoute.novelty_seed}%pt / random=${a.byRoute.random_exploration}%pt`,
      );
    }

    let list = population.getByRegime(regime);
    if (list.length === 0) {
      // PR ⑤D-2: 旧 `seedStrategy(regime)` (= 単一 RSI/ATR seed) を撤廃し、
      // 12 種の novelty seed (6 カテゴリ × long/short) を一括注入する。
      // STEP 5 Phase C C-1 (2026-05-15): symbol / timeframe を deps から渡し、
      // EUR/USD 15m 固定の bug (本番 XAU/USD 運用で seed が EURUSD になる) を解消。
      for (const seed of buildAllNoveltySeeds(regime, this.deps.symbol, this.deps.timeframe)) {
        population.add(regime, seed);
      }
      list = population.getByRegime(regime);
    }

    // PR #108: Quality-Diversity Archive Lite からの親候補を少量だけ population に注入する。
    // - 重複 dsl.id は除外 (= 既存 population に同じ DSL がある場合 skip)
    // - 最大 2 件 (= 設計書 §7、v1 low-volume diversity injection)
    // - Surrogate Rescue Lane / formalBtCandidate 選抜には影響させない (mutation/crossover 親素材)
    // - parentPoolSummary は変えない (既存集計の意味を維持)
    if (options?.qualityDiversityArchiveParents && options.qualityDiversityArchiveParents.length > 0) {
      const QD_INJECT_MAX = 2;
      const existingIds = new Set(list.map((s) => s.id));
      let injected = 0;
      for (const archiveDsl of options.qualityDiversityArchiveParents) {
        if (injected >= QD_INJECT_MAX) break;
        if (existingIds.has(archiveDsl.id)) continue;
        population.add(regime, archiveDsl);
        existingIds.add(archiveDsl.id);
        injected += 1;
      }
      if (injected > 0) {
        errors.push(
          `[info] quality diversity archive parents injected: ${injected} (v1 low-volume diversity injection)`,
        );
        list = population.getByRegime(regime);
      }
    }

    const metrics = new Map<string, SurrogateFitnessAggregate>();
    const scores = new Map<string, number>();
    const dslById = new Map<string, StrategyDSL>();

    // PR ④F + PR ⑤B (MTF): 世代スコープで全候補が必要とする indicator + pattern を
    // 主 timeframe + 上位足それぞれで取得して一括 cache に詰める。各
    // evaluateFitness にキャッシュを渡し、surrogate 内部での TS 再計算を撤廃する
    // (= 真実は pandas_ta 一本化)。MTF: 上位足は主 timeframe バー長に forward fill
    // 済 (= cache 経由で透過的に参照可能)。
    let generationCaches: GenerationIndicatorCaches | undefined = undefined;
    if (list.length > 0) {
      try {
        const symbolNorm = list[0].symbol.replace(/\//g, '');
        const primaryTf = normalizeCanonicalTimeframe(list[0].timeframe);
        if (primaryTf === null) {
          errors.push(
            `[warn] indicator-series 取得スキップ (regime=${regime}): 未知 timeframe '${list[0].timeframe}'`,
          );
        } else {
          const start = new Date(period.start);
          const end = new Date(period.end);
          // PR ⑤B: 主 timeframe の OHLCV を取得 (= 上位足 forward fill のための
          // バーアライメント計算に必要)。surrogate 側でも同じ fetch が走る (=
          // 重複)、後追い PR で primary bars を共有する形に最適化予定。
          const primaryBars = await defaultHttpOhlcvSource.fetchBars({
            symbol: symbolNorm,
            timeframe: primaryTf,
            startDate: start,
            endDate: end,
          });
          generationCaches = await fetchGenerationIndicatorCaches(
            list,
            symbolNorm,
            primaryTf,
            start,
            end,
            primaryBars,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`[warn] indicator-series 一括取得に失敗 (regime=${regime}): ${msg}`);
        generationCaches = undefined;
      }
    }

    for (const strategy of list) {
      dslById.set(strategy.id, strategy);
      try {
        const agg = await adapter.evaluateFitness(strategy, {}, period, {
          indicatorSeriesCache: generationCaches?.indicatorSeriesCache,
          patternFlagsCache: generationCaches?.patternFlagsCache,
        });
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
      // Filter Evolution M4: 1 世代あたり 5 種の ModuleParent (= フィルタ素材) を選別。
      // crossoverAgent に渡す経路は確保するが prompt 接続は M3 で別 PR (= 観測のみ)。
      moduleParentCount: 5,
    });
    population.removeWorst(regime, 5, scores);
    const parentPool = parentPoolResult.entries;
    const moduleParents = parentPoolResult.moduleEntries;
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
        mutationCount,
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
    // Filter Evolution M3: 親 (= parentPool の各 dsl) について、tradesByDslId から
    // 負けトレード (outcome === 'loss') のみを抽出して CrossoverAgent に渡す。
    // 親が tradesByDslId に未登録 (= novelty seed 等で formal BT 履歴なし) の場合は
    // 空配列 ではなく Map から欠落させる（CrossoverAgent 側で「資料なし」として扱われる）。
    const parentLossTrades = new Map<string, ReadonlyArray<LossTradeSummary>>();
    let totalParentLossSamples = 0;
    for (const e of parentPool) {
      const trades = this.tradesByDslId.get(e.dsl.id);
      if (!trades) continue;
      const losses = trades
        .filter((t) => t.outcome === 'loss')
        .map((t) => ({ entryTime: t.entryTime, side: t.side, pnl: t.pnl }));
      if (losses.length === 0) continue;
      parentLossTrades.set(e.dsl.id, losses);
      totalParentLossSamples += losses.length;
    }
    if (parentLossTrades.size > 0) {
      errors.push(
        `[info] M3 parent loss trades collected: parents=${parentLossTrades.size}/${parentPool.length} totalLossSamples=${totalParentLossSamples}`,
      );
    }

    try {
      crosses = await crossoverAgent.generateCrossovers(
        parentDsls,
        parentScores,
        crossoverCount,
        // Filter Evolution M3 + M4: moduleParents (= フィルタ素材) と parentLossTrades
        // (= 親 A の負けトレード一覧) を合わせて渡す。両方 / 片方 / 無しの全パターンが許容される。
        moduleParents.length > 0 || parentLossTrades.size > 0
          ? {
              moduleParents: moduleParents.length > 0 ? moduleParents : undefined,
              parentLossTrades: parentLossTrades.size > 0 ? parentLossTrades : undefined,
            }
          : undefined,
      );
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
        const extra = await mutationAgent.generateDiverse(regime, diverseCount);
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
      // PR #108: dsl 本体を candidate に同梱 (= QD archive 構築に必要)。
      // 既存ロジックの評価軸 (formalBtMetrics 等) には影響させない。
      if (r.candidate.formalBtPassed) return { ...r.candidate, dsl: r.dsl };
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
      return { ...r.candidate, dsl: r.dsl, repairHint: hint };
    });
    const promotionCandidates = formalBtVerifiedCandidates.filter((c) => c.formalBtPassed);

    // PR ⑤E (学術検証 fb): 各 promotion candidate の Deflated Sharpe Ratio (DSR)
    // を計算して観測ログに残す。本 PR では Promotion gate には組み込まず観測のみ。
    // 試行回数 N = formalBtVerifiedCandidates.length (= 同 evolution_run の本格 BT
    // 試行数、local 定義)。Bailey & López de Prado 2014 の式で「N 試行を補正しても
    // 有意か」を評価。本番判定への組み込みは別 PR で対応予定。
    if (promotionCandidates.length > 0) {
      const dsrTrialCount = formalBtVerifiedCandidates.length;
      const tradePnlsByDslId = new Map<string, readonly number[]>();
      for (const r of verifyResults) {
        if (r.tradePnls) tradePnlsByDslId.set(r.candidate.dslId, r.tradePnls);
      }
      for (const c of promotionCandidates) {
        const pnls = tradePnlsByDslId.get(c.dslId) ?? [];
        if (pnls.length === 0) continue;
        const result = computeDeflatedSharpeRatio({ returns: pnls, trialCount: dsrTrialCount });
        const detail = result.notComputable
          ? `notComputable=${result.notComputable}`
          : `dsr=${result.dsr.toFixed(3)} sr=${result.sharpeRatio.toFixed(3)} maxSr=${result.expectedMaxSr.toFixed(3)} skew=${result.skewness.toFixed(3)} kurt=${result.kurtosis.toFixed(3)}`;
        errors.push(
          `[info] DSR observation dslId=${c.dslId} ${detail} T=${result.sampleSize} N=${dsrTrialCount}`,
        );
      }
    }

    // Filter Evolution M2: winRateLift 観測ログ。各 verified candidate (passed/failed
    // 問わず) について、第一親 (= parentIds[0]) の trades と比較して winRateLift を
    // 計算し errors に観測情報として残す。本 PR では Promotion gate には組み込まず観測
    // のみ。設計書: docs/design/phase_filter_evolution_specification.md
    //
    // Gen 1 (= 親が novelty seed の世代) は parent trades が無いため全件 notComputable
    // で正常。Gen 2+ で multi-generation runner 経由なら親の trades が tradesByDslId
    // に乗っていて Lift が計算できる。
    for (const r of verifyResults) {
      const parentIds = r.dsl.parentIds ?? [];
      if (parentIds.length === 0) continue; // seed / hypothesis 由来は親なしで観察対象外
      if (!r.trades) continue; // analysis-engine 自体が失敗 (= response 取得不能) のケースのみ skip
      // 第一親 (= primary parent) を base とする (設計書 §2.3)。crossover の場合、
      // parentIds = [parent_A, parent_B] で parent_A を base、parent_B を filter 素材とする想定。
      // 子の trades が空 (= filter が全 reject) は computeWinRateLift 側で notComputable
      // として記録される重要な観測情報なので、空配列でも計算ループに通す。
      const parentId = parentIds[0];
      const parentTrades = this.tradesByDslId.get(parentId);
      if (!parentTrades) {
        errors.push(
          `[info] win rate lift dslId=${r.candidate.dslId} parentId=${parentId} ` +
            `notComputable=parent has no formal BT result in this evolution run`,
        );
        continue;
      }
      const liftResult = computeWinRateLift({
        parentTrades,
        childTrades: r.trades,
      });
      const liftDetail = liftResult.notComputable
        ? `notComputable=${liftResult.notComputable}`
        : `lift=${liftResult.lift.toFixed(3)} parentWR=${liftResult.parentWinRate.toFixed(3)} ` +
          `childWR=${liftResult.childWinRate.toFixed(3)} preserveWin=${liftResult.preserveWin.toFixed(3)} ` +
          `specificity=${liftResult.specificity.toFixed(3)} filterPrecision=${liftResult.filterPrecision.toFixed(3)}`;
      errors.push(
        `[info] win rate lift dslId=${r.candidate.dslId} parentId=${parentId} ${liftDetail} ` +
          `parentT=${liftResult.parentTradeCount} childT=${liftResult.childTradeCount}`,
      );
    }
    // 当世代 verifyResults の trades を tradesByDslId に保存 (= 次世代の親候補として使う)。
    // passed/failed 問わず保存する (= 失敗 candidate の trade list でも子の filter 効果は
    // 観察できる、ただし safety guard で実質弾かれる可能性は高い)。
    for (const r of verifyResults) {
      if (r.trades) {
        this.tradesByDslId.set(r.candidate.dslId, r.trades);
      }
    }

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

    // PR #103: validation_candidate (= PromotionGate で formal BT passed) を OOS 評価対象にする。
    //   - oosBacktestRunner 未指定なら全候補が `not_evaluated` で集計される
    //   - 観測のみ。productionEligible / promotionGate には影響させない
    //   - 時系列順 split を厳守 (= future leakage 防止)
    const oosValidationResults = await this.evaluateOosForValidationCandidates(
      promotionGateDecisions,
      verifyResults,
      period,
    );
    const oosValidationSummary = summarizeOosValidationResults(oosValidationResults);

    // PR #105: OOS-aware Promotion 接続。
    //   - oos_passed / walk_forward_passed → validation_confirmed
    //   - oos_failed / walk_forward_failed → hold (= validation_candidate のまま、rejected にしない)
    //   - validation_candidate 以外は OOS で上書きしない
    //   - productionEligible は常に false (= production には絶対に上げない)
    //   - 既存 promotionGateSummary の意味は維持し、本判定は補助 summary として並列に出す
    const oosAwarePromotionDecisions = applyOosAwarePromotion(
      promotionGateDecisions,
      oosValidationResults,
    );
    const oosAwarePromotionSummary = summarizeOosAwarePromotion(oosAwarePromotionDecisions);

    // 段階 4a.4: 正式 BT 履歴を永続化 (passed/failed 全件、DSL 不在分岐は無いので欠損なし)。
    if (this.evolutionBacktestRepo) {
      await this.persistFormalBtHistory(verifyResults).catch(() => undefined);
    }

    // --- EdgeLedger への自動登録 (進化・エージェント連携の修正) ---
    for (const c of promotionCandidates) {
      try {
        const dsl = verifyResults.find(r => r.candidate.dslId === c.dslId)?.dsl;
        if (!dsl) continue;
        
        await defaultEdgeLedger.create({
          statement: c.description || `Evolution AI Generated Strategy (${c.regime})`,
          category: 'other',
          conditions: [],
          expectedDirection: dsl.entry.direction === 'long' || dsl.entry.direction === 'short' ? dsl.entry.direction : 'either',
          status: 'screening_passed', // AIダッシュボードや検証フローに乗せるため screening_passed を指定
          source: 'discovery', // evolutionはEdgeSourceに無いため discovery を使用
          symbols: [c.symbol],
          timeframes: [c.timeframe],
          observationCount: 0,
          winCount: 0,
          lossCount: 0,
          breakevenCount: 0,
          totalPnlPips: 0,
          avgRR: 0,
          screeningResult: c.formalBtMetrics ? {
            executedAt: new Date().toISOString(),
            passed: true,
            metrics: {
              pf: c.formalBtMetrics.pf,
              winRate: c.formalBtMetrics.winRate * 100, // 0-100%形式に合わせるか確認
              tradeCount: c.formalBtMetrics.tradeCount,
            }
          } : undefined
        });
      } catch (err) {
        errors.push(`[error] EdgeLedger 自動登録に失敗 (dslId=${c.dslId}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Phase B-2: 当世代の in-memory cache (tradesByDslId / lastRepairHints /
    // lastRepairBaselines) を carry payload として DB に永続化。次回 cron 起動時に
    // `findLatestByRegime(regime)` で復元される。例外は飲んで世代結果には影響させない。
    //
    // PR #140 review #3: generation には当世代 verified 候補の最大世代番号を使う
    // (= debug / 観測軸として正しい値)。verifyResults が空の場合は当 regime population の
    // 最大値、それも空なら 0。
    if (this.evolutionInstanceCarryRepo) {
      const verifiedGen = verifyResults.reduce(
        (max, r) => Math.max(max, r.dsl.generation),
        0,
      );
      const populationGen = population
        .getByRegime(regime)
        .reduce((max, s) => Math.max(max, s.generation), 0);
      const recordedGeneration = Math.max(verifiedGen, populationGen);
      const saveError = await this.saveCarryStateForRegime(regime, recordedGeneration);
      if (saveError !== null) errors.push(saveError);
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
      oosValidationSummary,
      oosValidationResults,
      oosAwarePromotionSummary,
      oosAwarePromotionDecisions,
    };
    return report;
  }

  /**
   * PR #105: PromotionGate で `validation_candidate` になった候補を analysis-engine の
   * robustness 評価に投げ、結果を `OosValidationResult` に正規化して返す。
   *
   * - `oosBacktestRunner` 未指定なら全候補を `not_evaluated` で返す (= 観測ゼロでも壊れない)
   * - `oosBacktestRunner` 例外は `oos_engine_error` として記録し、世代を継続する
   * - 時系列 split は `buildOosSplitWindowV1` (oosRatio=0.2) で算出して analysis-engine に渡す
   * - **pass / fail は analysis-engine の verdict を採用する**。Evolution 側で独自閾値判定しない
   * - production 昇格・stage 変更には一切使わない (観測値として report に積むだけ)
   */
  private async evaluateOosForValidationCandidates(
    decisions: ReadonlyArray<PromotionGateDecision>,
    verifyResults: ReadonlyArray<{
      candidate: EvolutionPromotionCandidate;
      dsl: StrategyDSL;
      engineVersion: string;
      surrogateScore: number;
    }>,
    period: BacktestPeriod,
  ): Promise<OosValidationResult[]> {
    const validationDecisions = decisions.filter((d) => d.toStage === 'validation_candidate');
    if (validationDecisions.length === 0) return [];

    const dslById = new Map(verifyResults.map((r) => [r.candidate.dslId, r.dsl] as const));
    const candById = new Map(
      verifyResults.map((r) => [r.candidate.dslId, r.candidate] as const),
    );

    const splitWindow = buildOosSplitWindowV1({
      startDate: period.start,
      endDate: period.end,
      oosRatio: 0.2,
    });
    const oosWindowEmpty = isOosWindowEmpty(splitWindow);

    const results: OosValidationResult[] = [];
    for (const d of validationDecisions) {
      const dslId = d.dslId ?? d.candidateId;
      const dsl = dslById.get(dslId) ?? dslById.get(d.candidateId);
      const cand = candById.get(dslId) ?? candById.get(d.candidateId);
      const baselineMetrics: OosMetrics | null = cand?.formalBtMetrics
        ? {
            pf: cand.formalBtMetrics.pf,
            tradeCount: cand.formalBtMetrics.tradeCount,
            maxDrawdown: cand.formalBtMetrics.maxDrawdown ?? null,
            expectancy: null,
            winRate: cand.formalBtMetrics.winRate,
          }
        : null;
      const sourceStage = d.toStage;
      const route = d.route;

      // (a) runner 未注入 / DSL 欠損 → not_evaluated
      if (!this.oosBacktestRunner || !dsl) {
        results.push(
          mapAnalysisEngineRobustnessResult({
            candidateId: d.candidateId,
            dslId,
            sourceStage,
            route,
            baselineMetrics,
            oosMetrics: null,
            notEvaluated: true,
            warnings: this.oosBacktestRunner
              ? ['DSL 不在のため OOS 評価をスキップ']
              : ['oosBacktestRunner 未注入 — analysis-engine 呼び出しなし'],
          }),
        );
        continue;
      }

      // (b) OOS 期間が自明境界 → insufficient_oos_data
      if (oosWindowEmpty) {
        results.push(
          mapAnalysisEngineRobustnessResult({
            candidateId: d.candidateId,
            dslId,
            sourceStage,
            route,
            baselineMetrics,
            oosMetrics: null,
            insufficientOosWindow: true,
          }),
        );
        continue;
      }

      // (c) analysis-engine adapter を呼び、verdict 込みの runner result を受け取る
      let runnerResult: OosBacktestRunnerResult;
      try {
        runnerResult = await this.oosBacktestRunner({
          dsl,
          startDate: splitWindow.oosStart,
          endDate: splitWindow.oosEnd,
          splitWindow,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push(
          mapAnalysisEngineRobustnessResult({
            candidateId: d.candidateId,
            dslId,
            sourceStage,
            route,
            baselineMetrics,
            oosMetrics: null,
            engineError: msg,
          }),
        );
        continue;
      }

      // (d) analysis-engine 由来の verdict を尊重して mapper に流す
      results.push(
        mapAnalysisEngineRobustnessResult({
          candidateId: d.candidateId,
          dslId,
          sourceStage,
          route,
          baselineMetrics,
          oosMetrics: runnerResult.metrics,
          verdict: runnerResult.verdict,
          failureReasons: runnerResult.failureReasons,
          walkForwardFolds: runnerResult.walkForwardFolds,
          evaluationKind: runnerResult.evaluationKind,
          warnings: runnerResult.warnings,
        }),
      );
    }
    return results;
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
      /**
       * PR ⑤E: 本格 BT で発生した trade ごとの pnl 配列。
       * Deflated Sharpe Ratio (DSR) の観測ログ計算に使う。failure 時 / 取得不能時は undefined。
       */
      tradePnls?: readonly number[];
      /**
       * Filter Evolution M2 + M3: 本格 BT で発生した trade list。
       * - M2 winRateLift: entryTime + outcome を参照
       * - M3 CrossoverAgent: 負けトレード（outcome=='loss'）から entryTime + side + pnl を参照
       * failure 時 / 取得不能時は undefined。
       */
      trades?: ReadonlyArray<{
        entryTime: string;
        side: 'long' | 'short';
        pnl: number;
        outcome: 'win' | 'loss' | 'timeout';
      }>;
    }>
  > {
    const out: Array<{
      candidate: EvolutionPromotionCandidate;
      dsl: StrategyDSL;
      engineVersion: string;
      surrogateScore: number;
      tradePnls?: readonly number[];
      trades?: ReadonlyArray<{
        entryTime: string;
        side: 'long' | 'short';
        pnl: number;
        outcome: 'win' | 'loss' | 'timeout';
      }>;
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
        ...(response.summary.sharpe != null ? { sharpe: response.summary.sharpe } : {}),
        ...(response.summary.returnPct != null ? { returnPct: response.summary.returnPct } : {}),
        ...(response.summary.recoveryFactor != null ? { recoveryFactor: response.summary.recoveryFactor } : {}),
        ...(response.summary.riskReward != null ? { riskReward: response.summary.riskReward } : {}),
      };
      const engineVersion = response.engineVersion;

      // PR ⑤E: DSR 観測ログ用に trade pnls を保持。response.trades は Zod 契約で
      // 必須、各 entry に pnl が入っている (= analysisEngine schema)。
      // Filter Evolution M2 + M3: winRateLift 観測用 + CrossoverAgent 文脈材料用に
      // entryTime + side + pnl + outcome を抽出。gate 判定 (= tradeCount/pf) より前に
      // 抽出することで、閾値未達 で落ちる候補も観測ログ対象にする
      // (= 失敗ケースでの filter 効果 / 負けパターンも観察したい)。
      const tradePnls = response.trades.map((t) => t.pnl);
      const trades = response.trades.map((t) => ({
        entryTime: t.entryTime,
        side: t.side,
        pnl: t.pnl,
        outcome: t.outcome,
      }));

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
          tradePnls,
          trades,
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
          tradePnls,
          trades,
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
        tradePnls,
        trades,
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
  /**
   * Phase B-2: regime に対する最新 carry を DB から load し、in-memory cache を初期化する。
   *
   * - 該当 carry が存在しない (= 初回 cron 起動 / 別 regime 履歴のみ) なら何もしない
   * - load 成功時は `tradesByDslId` / `lastRepairHints` / `lastRepairBaselines` を上書き
   * - 既存 in-memory に値がある場合 (= 同 instance で 2 回目以降の同 regime 呼び出し) は
   *   `carryLoadedRegimes` フラグで本メソッドが呼ばれない
   * - 例外は飲んで warning 文字列を返し、世代結果に observation log として残す
   *
   * @returns observation 用 errors[] エントリ (= 何もしない / load 成功 / load 失敗のいずれか)、
   *   `null` = ログに残す情報なし (= repo 未注入)
   */
  private async loadCarryStateForRegime(regime: string): Promise<string | null> {
    if (!this.evolutionInstanceCarryRepo) return null;

    // PR #140 review #1: 同 EvolutionLoop instance を全 regime で使い回す運用では、
    // 前 regime の cache が次 regime に残留すると payload 汚染が起きる。
    // load 試行の起点で必ず cache をクリアして「regime 単位の独立性」を保証する。
    // carry が見つかれば即座に上書き、見つからなければ「空 cache で当 regime 開始」になる。
    this.tradesByDslId = new Map();
    this.lastRepairHints = new Map();
    this.lastRepairBaselines = new Map();

    try {
      const carry = await this.evolutionInstanceCarryRepo.findLatestByRegime(regime);
      if (!carry) {
        return `[info] B-2 carry: regime=${regime} 既存 carry なし (= 初回 cron / 該当 regime 履歴なし)`;
      }
      const { tradesByDslId, repairHints, repairBaselines } = carry.payload;

      // tradesByDslId 復元: CarriedTrade は EvolutionLoop の内部 trade 型と structurally 互換
      this.tradesByDslId = new Map(Object.entries(tradesByDslId));

      // RepairHint / RepairBaseline は payload 形を内部型に合わせて復元。
      // Zod schema (CarriedRepairHintSchema / CarriedRepairBaselineSchema) が
      // RepairHint / RepairOutcomeBaseline と structurally 同形になるよう同期されているため、
      // 構造分解 + 再構築で型整合する (= unknown / any cast を避ける)。
      const hintsMap = new Map<string, RepairHint>();
      for (const [dslId, hint] of Object.entries(repairHints)) {
        hintsMap.set(dslId, {
          failureReason: hint.failureReason,
          severity: hint.severity,
          summary: hint.summary,
          actions: hint.actions.map((a) => ({
            target: a.target,
            instruction: a.instruction,
            allowedChangeScope: a.allowedChangeScope,
          })),
          mutationGuidance: hint.mutationGuidance,
          shouldUseForRepairMutation: hint.shouldUseForRepairMutation,
          shouldExcludeFromParentPool: hint.shouldExcludeFromParentPool,
          warnings: [...hint.warnings],
        });
      }
      this.lastRepairHints = hintsMap;

      const baselinesMap = new Map<string, RepairOutcomeBaseline>();
      for (const [dslId, baseline] of Object.entries(repairBaselines)) {
        baselinesMap.set(dslId, {
          candidateId: baseline.candidateId,
          dslId: baseline.dslId,
          failureReason: baseline.failureReason,
          route: baseline.route,
          metrics: {
            pf: baseline.metrics.pf,
            tradeCount: baseline.metrics.tradeCount,
            maxDrawdown: baseline.metrics.maxDrawdown,
            expectancy: baseline.metrics.expectancy,
          },
        });
      }
      this.lastRepairBaselines = baselinesMap;

      return (
        `[info] B-2 carry restored: regime=${regime} carryId=${carry.id} ` +
        `gen=${carry.generation} prevRunId=${carry.evolutionRunId} ` +
        `trades=${this.tradesByDslId.size} hints=${this.lastRepairHints.size} ` +
        `baselines=${this.lastRepairBaselines.size}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[warn] B-2 carry load 失敗: regime=${regime} error=${msg}`;
    }
  }

  /**
   * Phase B-2: 当世代の in-memory cache (tradesByDslId / lastRepairHints /
   * lastRepairBaselines) を carry payload として DB に永続化。
   *
   * - 例外は飲んで warning 文字列を返す (= 世代結果には影響させない)
   * - payload は Zod schema に従って書き込み (= 復元時に Zod 不適合で読み出し不能にならないため)
   *
   * @returns observation 用 errors[] エントリ、`null` = ログに残す情報なし
   */
  private async saveCarryStateForRegime(
    regime: string,
    generation: number,
  ): Promise<string | null> {
    if (!this.evolutionInstanceCarryRepo) return null;
    try {
      // tradesByDslId は EvolutionLoop 内部型 → CarriedTrade に構造的互換 (mutable copy で型整合)
      const tradesPayload: Record<string, CarriedTrade[]> = {};
      for (const [dslId, trades] of this.tradesByDslId.entries()) {
        tradesPayload[dslId] = trades.map((t) => ({
          entryTime: t.entryTime,
          side: t.side,
          pnl: t.pnl,
          outcome: t.outcome,
        }));
      }

      // RepairHint は repairHintPolicy.ts の interface 通りに展開
      const hintsPayload: Record<string, CarriedRepairHint> = {};
      for (const [dslId, hint] of this.lastRepairHints.entries()) {
        hintsPayload[dslId] = {
          failureReason: hint.failureReason,
          severity: hint.severity,
          summary: hint.summary,
          actions: hint.actions.map((a) => ({
            target: a.target,
            instruction: a.instruction,
            allowedChangeScope: a.allowedChangeScope,
          })),
          mutationGuidance: hint.mutationGuidance,
          shouldUseForRepairMutation: hint.shouldUseForRepairMutation,
          shouldExcludeFromParentPool: hint.shouldExcludeFromParentPool,
          warnings: [...hint.warnings],
        };
      }

      const baselinesPayload: Record<string, CarriedRepairBaseline> = {};
      for (const [dslId, baseline] of this.lastRepairBaselines.entries()) {
        baselinesPayload[dslId] = {
          candidateId: baseline.candidateId,
          dslId: baseline.dslId,
          failureReason: baseline.failureReason,
          route: baseline.route,
          metrics: {
            pf: baseline.metrics.pf,
            tradeCount: baseline.metrics.tradeCount,
            maxDrawdown: baseline.metrics.maxDrawdown,
            expectancy: baseline.metrics.expectancy,
          },
        };
      }

      await this.evolutionInstanceCarryRepo.create({
        evolutionRunId: this.evolutionRunId,
        regime,
        // PR #140 review #3: 引数で渡された当世代の実 generation 値を使う (= debug 観測用)
        generation,
        payload: {
          tradesByDslId: tradesPayload,
          repairHints: hintsPayload,
          repairBaselines: baselinesPayload,
        },
      });
      return (
        `[info] B-2 carry saved: regime=${regime} runId=${this.evolutionRunId} ` +
        `trades=${this.tradesByDslId.size} hints=${this.lastRepairHints.size} ` +
        `baselines=${this.lastRepairBaselines.size}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[warn] B-2 carry save 失敗: regime=${regime} error=${msg}`;
    }
  }

  private async persistFormalBtHistory(
    verifyResults: Array<{
      candidate: EvolutionPromotionCandidate;
      dsl: StrategyDSL;
      engineVersion: string;
      surrogateScore: number;
      trades?: ReadonlyArray<{
        entryTime: string;
        side: 'long' | 'short';
        pnl: number;
        outcome: 'win' | 'loss' | 'timeout';
      }>;
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
      // Phase B-1: trades 列に永続化。analysis-engine 例外などで trades が undefined の場合は
      // repo 側で `Prisma.DbNull` (= SQL NULL) に解釈して既存行 (Phase B-1 以前) と同じ意味論にする。
      // `Prisma.JsonNull` (= JSON 値の null) ではない (PR #139 Copilot review 指摘対応)。
      trades: r.trades,
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
  if (Array.isArray(value)) {
    // Array.isArray の type narrowing は JsonValue[] を any[] に広げるため、明示再型付けする。
    return `[${(value as readonly JsonValue[]).map((v) => stableStringify(v)).join(',')}]`;
  }
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
