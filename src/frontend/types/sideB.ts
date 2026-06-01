/**
 * Side-B 仮説検証システム (Phase 4a〜4c) の型定義
 *
 * バックエンドの型定義と厳密に一致させる。元定義のソース:
 * - src/side-b/models/edgeHypothesis.ts
 * - src/side-b/validation/tools/types.ts
 * - src/side-b/validation/reports.ts
 * - src/side-b/agents/StrategistAgent.ts
 *
 * 重要な差分:
 * - バックエンド側は Date 型だが、HTTP 経由では ISO8601 文字列になる。
 *   よって UI 側では全て string として受け取り、必要に応じて new Date() する。
 */

// ===========================================
// ライフサイクル列挙
// ===========================================

export type EdgeStatus =
  | "unverified"
  | "screening_passed"
  | "testing"
  | "confirmed"
  | "stale"
  | "rejected"
  | "insufficient_data"
  | "not_testable";

export const EDGE_STATUSES: EdgeStatus[] = [
  "unverified",
  "screening_passed",
  "testing",
  "confirmed",
  "stale",
  "rejected",
  "insufficient_data",
  "not_testable",
];

export type EdgeCategory =
  | "time"
  | "level"
  | "event"
  | "correlation"
  | "positioning"
  | "volatility"
  | "structure"
  | "other";

export const EDGE_CATEGORIES: EdgeCategory[] = [
  "time",
  "level",
  "event",
  "correlation",
  "positioning",
  "volatility",
  "structure",
  "other",
];

export type EdgeSource =
  | "ai_generated"
  | "reflection"
  | "user_input"
  | "backtest"
  | "discovery";

export const EDGE_SOURCES: EdgeSource[] = [
  "ai_generated",
  "reflection",
  "user_input",
  "backtest",
  "discovery",
];

// ===========================================
// 条件 / リスク管理
// ===========================================

export type ConditionOp =
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "between"
  | "in";

export interface MachineReadableCondition {
  lensName: string;
  featureKey: string;
  op: ConditionOp;
  value: number | string | boolean | [number, number] | string[];
}

export type StopLossSpec =
  | { type: "atr_multiple"; value: number }
  | { type: "fixed_pips"; value: number }
  | { type: "swing_point"; lookbackBars: number };

export type TakeProfitSpec =
  | { type: "rr_ratio"; value: number }
  | { type: "fixed_pips"; value: number }
  | { type: "atr_multiple"; value: number };

export interface DefaultRiskManagement {
  stopLoss: StopLossSpec;
  takeProfit: TakeProfitSpec;
  maxHoldingBars?: number;
}

// ===========================================
// 検証結果サマリー (Phase 4a/4b)
// ===========================================

export interface BacktestSummary {
  pf: number;
  winRate: number;
  tradeCount: number;
  /** ISO8601 */
  runAt: string;
  runId?: string;
}

export interface WalkForwardSummary {
  overfitScore: number;
  avgInSampleWinRate: number;
  avgOutOfSampleWinRate: number;
  /** ISO8601 */
  runAt: string;
  runId?: string;
  avgInSamplePF?: number;
  avgOutOfSamplePF?: number;
  totalTradeCount?: number;
}

export interface ScreeningMetrics {
  pf: number;
  /** 0-1 または 0-100 表記、Side-A が返す形式に準拠 */
  winRate: number;
  tradeCount: number;
}

export interface ScreeningResult {
  /** ISO8601 */
  executedAt: string;
  tradeNoteId: string;
  passed: boolean;
  metrics: ScreeningMetrics;
  reasons?: string[];
  backtestRunId?: string;
}

// ===========================================
// 検証ツール結果 (Phase 4c)
// ===========================================

export type ValidationToolImplementation = "native_ts" | "python_bridge";

/**
 * 個別ツールの実行結果。
 * `metrics` はツールによって内容が異なるため緩いバッグ。
 * UI 側で特定のキー (overfitScore, p5FinalPnl, outperformance 等) を
 * 取り出すときは `typeof x === 'number'` でガードすること。
 */
export interface ValidationToolResult {
  toolName: string;
  success: boolean;
  passed: boolean;
  metrics: Record<string, number | string | boolean>;
  interpretation?: string;
  error?: string;
  durationMs: number;
}

/**
 * 4 ツール統合レポート。
 * `screening` は Phase 4b の結果流用、他 3 つは Phase 4c で新規実行。
 * いずれか 1 つでも失敗すると allPassed=false になる。
 */
export interface ConsolidatedValidationReport {
  hypothesisId: string;
  periodUsed: { start: string; end: string };
  screening?: ValidationToolResult;
  walkForward?: ValidationToolResult;
  monteCarlo?: ValidationToolResult;
  buyAndHold?: ValidationToolResult;
  allPassed: boolean;
  passedCount: number;
  totalCount: number;
  /** ISO8601 */
  startedAt: string;
  /** ISO8601 */
  completedAt: string;
  totalDurationMs: number;
  errors: string[];
}

// ===========================================
// StrategistAgent の判定結果 (Phase 4c)
// ===========================================

export type PromotionVerdictType =
  | "confirmed"
  | "rejected"
  | "insufficient_data"
  | "not_testable";

export interface PromotionVerdict {
  verdict: PromotionVerdictType;
  hypothesisId: string;
  report?: ConsolidatedValidationReport;
  /** 決定論的判定の理由（棄却時は複数、通過時は空） */
  baseCriteriaReasons: string[];
  /** LLM による自然言語解釈（失敗時は undefined） */
  interpretation?: string;
  /** LLM による改善提案（失敗時は undefined） */
  actionableInsights?: string[];
  /** ISO8601 */
  decidedAt: string;
}

// ===========================================
// EdgeHypothesis 本体
// ===========================================

export interface EdgeHypothesis {
  id: string;
  statement: string;
  category: EdgeCategory;
  conditions: MachineReadableCondition[];
  expectedDirection: "long" | "short" | "either";

  status: EdgeStatus;
  /** ISO8601 */
  statusUpdatedAt: string;

  symbols: string[];
  timeframes: string[];

  observationCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  totalPnlPips: number;
  avgRR: number;

  backtestResults?: BacktestSummary;
  walkForwardResults?: WalkForwardSummary;

  source: EdgeSource;
  lensRelevance?: Record<string, number>;
  statusNote?: string;

  /** ISO8601 */
  firstObservedAt: string;
  /** ISO8601 */
  lastObservedAt: string;
  /** ISO8601 */
  lastTestedAt?: string;
  /** ISO8601 */
  createdAt: string;
  /** ISO8601 */
  updatedAt: string;

  parentIds?: string[];
  relatedNoteIds?: string[];

  // Phase 4b
  defaultRiskManagement?: DefaultRiskManagement;
  materializedTradeNoteIds?: string[];
  invalidationConditions?: MachineReadableCondition[];
  confirmationNote?: string;
  screeningResult?: ScreeningResult;

  // Phase 4c
  fullValidationReport?: ConsolidatedValidationReport;
  confirmationInterpretation?: string;
  rejectionInterpretation?: string;
  actionableInsights?: string[];
}

/**
 * 一覧用の簡易型。
 * バックエンドの `listPendingValidation` が返す形に対応する
 * (EdgeHypothesis の部分集合)。
 */
export type HypothesisListItem = Pick<
  EdgeHypothesis,
  | "id"
  | "statement"
  | "category"
  | "expectedDirection"
  | "symbols"
  | "timeframes"
  | "statusUpdatedAt"
  | "screeningResult"
>;

// ===========================================
// API レスポンス型
// ===========================================

/**
 * GET /api/side-b/hypotheses/pending-validation
 */
export interface PendingValidationResponse {
  success: true;
  total: number;
  hypotheses: HypothesisListItem[];
}

/**
 * GET /api/side-b/hypotheses/:id/validation-status
 *
 * バックエンドの `EdgeHypothesis` の検証関連フィールドだけを返す。
 * `fullValidationReport` は検証未実施だと undefined。
 */
export interface ValidationStatusResponse {
  success: true;
  hypothesisId: string;
  status: EdgeStatus;
  /** ISO8601 */
  statusUpdatedAt: string;
  statusNote?: string;
  /** ISO8601 */
  lastTestedAt?: string;
  screeningResult?: ScreeningResult;
  fullValidationReport?: ConsolidatedValidationReport;
  confirmationInterpretation?: string;
  rejectionInterpretation?: string;
  actionableInsights: string[];
}

/**
 * POST /api/side-b/hypotheses/:id/validate
 *
 * 長時間（10〜30秒）かかる。UI 側はローディングで待つ。
 */
export interface ValidateResponse {
  success: true;
  verdict: PromotionVerdictType;
  hypothesisId: string;
  baseCriteriaReasons: string[];
  report?: ConsolidatedValidationReport;
  interpretation?: string;
  actionableInsights?: string[];
  /** ISO8601 */
  decidedAt: string;
}

/**
 * エラーレスポンスの共通型（404 / 500）
 */
export interface ApiErrorResponse {
  success: false;
  error: string;
}

// ===========================================
// Phase 4d: 仮説一覧 API
// ===========================================

/**
 * 一覧ソートキー。
 *
 * NOTE: 仕様書 §4.2 の「確信度順」は EdgeHypothesis 本体に confidence スコアが
 * 存在しないため Phase 4d MVP では未実装。future work として 'confidence' を
 * 追加する前提で enum 設計は拡張可能にしてある（バックエンド
 * `EdgeFindSortKey` と一致）。
 */
export type HypothesisListSortKey = "newest" | "oldest" | "observation";

/**
 * GET /api/side-b/hypotheses のクエリパラメーター。
 * 全て任意。`symbol` / `status` / `category` / `source` はマルチ選択可。
 */
export interface HypothesisListParams {
  statuses?: EdgeStatus[];
  categories?: EdgeCategory[];
  sources?: EdgeSource[];
  symbols?: string[];
  search?: string;
  sortBy?: HypothesisListSortKey;
  /** 1-based。既定 1 */
  page?: number;
  /** 既定 20、上限 100 (超えたらバックエンドで clamp される) */
  limit?: number;
}

/**
 * GET /api/side-b/hypotheses のレスポンス。
 */
export interface HypothesisListResponse {
  success: true;
  /** フィルタ適用後の総件数（ページネーション前） */
  total: number;
  /** 実際に採用された page（バックエンド側で正規化済み） */
  page: number;
  /** 実際に採用された limit（clamp 済み） */
  limit: number;
  hypotheses: EdgeHypothesis[];
}

/**
 * GET /api/side-b/hypotheses/:id のレスポンス。
 */
export interface HypothesisDetailResponse {
  success: true;
  hypothesis: EdgeHypothesis;
}

// ===========================================
// Phase 4d: 検証履歴 API
// ===========================================

/**
 * 仮説の検証履歴エントリ（バックエンド ValidationHistoryEntry と同一）。
 *
 * 現状の情報源:
 *   - 'screening': screeningResult (Phase 4b 縮小版、1 件まで)
 *   - 'full_validation': fullValidationReport (Phase 4c、実データは運用後)
 *
 * UI は配列として扱い、0 件 / 1 件 / 2 件のいずれでも表示破綻しない設計。
 */
export type ValidationHistoryEntry =
  | {
    type: "screening";
    /** ISO8601 */
    executedAt: string;
    passed: boolean;
    result: ScreeningResult;
  }
  | {
    type: "full_validation";
    /** ISO8601 */
    executedAt: string;
    passed: boolean;
    report: ConsolidatedValidationReport;
  };

/**
 * GET /api/side-b/hypotheses/:id/validation-history のレスポンス。
 * 新しい順にソート済み。
 */
export interface ValidationHistoryResponse {
  success: true;
  history: ValidationHistoryEntry[];
}

// ===========================================
// Phase 4d Step 5: 検証画面 API
// ===========================================

/** GET /hypotheses/testing */
export interface HypothesesTestingResponse {
  success: true;
  total: number;
  hypotheses: EdgeHypothesis[];
}

/** GET /hypotheses/recently-validated */
export interface RecentlyValidatedResponse {
  success: true;
  hours: number;
  total: number;
  hypotheses: EdgeHypothesis[];
}

export type BatchValidateItemResult =
  | { hypothesisId: string; ok: true; verdict: string }
  | { hypothesisId: string; ok: false; error: string };

/** POST /hypotheses/batch-validate */
export interface BatchValidateResponse {
  success: true;
  results: BatchValidateItemResult[];
}

// ===========================================
// Phase 4d Step 6: ダッシュボード API
// ===========================================

/** GET /stats/overview */
export interface StatsOverviewResponse {
  success: true;
  totalHypotheses: number;
  byStatus: Record<EdgeStatus, number>;
  confirmedCount: number;
  newHypothesesThisWeek: number;
  confirmedThisWeek: number;
  confirmedPrevWeek: number;
  confirmedGrowthRate: number | null;
  lastValidationCompletedAt: string | null;
  recentValidationSuccessRate: number | null;
}

/** GET /stats/time-series */
export interface StatsTimeSeriesResponse {
  success: true;
  period: "daily" | "monthly";
  points: Array<{ periodStart: string; confirmedCount: number }>;
}

/** GET /stats/by-category */
export interface StatsByCategoryResponse {
  success: true;
  categories: Array<{ category: string; confirmedCount: number }>;
}

/** GET /stats/validation-activity */
export interface StatsValidationActivityResponse {
  success: true;
  days: number;
  points: Array<{ date: string; count: number }>;
}

/** GET /hypotheses/recent-confirmed | recent-rejected */
export interface RecentHypothesesResponse {
  success: true;
  total: number;
  hypotheses: EdgeHypothesis[];
}

/** GET /discovery/latest */
export interface DiscoveryLatestResponse {
  success: true;
  hasWeeklyReport: boolean;
  message: string;
  newHypothesesFromDiscovery7d: number;
  sampleHypotheses: Array<{
    id: string;
    statement: string;
    status: string;
    createdAt: string;
  }>;
}

/**
 * GET /discovery/funnel
 *
 * Step D-4b: DiscoveryAgent が組成した仮説 (source='discovery') のライフサイクル funnel。
 * 「組成 (unverified) → screening_passed → confirmed / rejected」の status 分布 + 直近サンプル。
 */
export interface DiscoveryFunnelResponse {
  success: true;
  source: "discovery";
  total: number;
  /** status ごとの件数 (source=discovery 限定)。未出現の status はキー欠落。 */
  byStatus: Partial<Record<EdgeStatus, number>>;
  recent: Array<{
    id: string;
    statement: string;
    status: EdgeStatus;
    symbols: string[];
    timeframes: string[];
    createdAt: string;
  }>;
}

/** GET /system/health */
export interface SystemHealthResponse {
  success: true;
  database: "ok" | "error";
  dbSizeBytes?: number;
  dbWarning?: boolean;
  /**
   * Phase 6.8b: 4値ステータス
   * - 'ok'             : 疎通 OK（http モード: 本番 HTTP service）
   * - 'local_only'     : docker_exec モードで疎通 OK（ローカル専用。本番では使えない）
   * - 'not_configured' : PYTHON_VALIDATION_MODE が未設定（意図的に無効化）
   * - 'error'          : 設定はあるが疎通失敗
   */
  pythonValidator: "ok" | "local_only" | "not_configured" | "error";
  checkedAt: string;
}


// ===========================================
// プラン即時BT（Phase 6.7b、POST /api/side-b/plans）
// ===========================================

export type PlanMarketRegime =
  | "strong_uptrend"
  | "uptrend"
  | "range"
  | "downtrend"
  | "strong_downtrend"
  | "volatile";

export interface PlanKeyLevels {
  strongResistance: number[];
  resistance: number[];
  support: number[];
  strongSupport: number[];
}

export interface PlanMarketAnalysisPayload {
  regime: PlanMarketRegime;
  regimeConfidence: number;
  trendDirection: "up" | "down" | "sideways";
  volatility: "low" | "medium" | "high";
  keyLevels: PlanKeyLevels;
  summary: string;
  additionalInsights?: string[];
  macroAssessment?: {
    riskSentiment: "risk_on" | "neutral" | "risk_off";
    volatilityRegime: "low" | "normal" | "elevated" | "crisis";
    yieldCurveSignal: "normal" | "flattening" | "inverted";
    macroSummary: string;
    tradingImpact: string;
  };
  mtfAnalysis?: {
    higherTFTimeframe: string;
    higherTFBias: "long" | "short" | "neutral";
    alignment: "aligned" | "conflicting" | "neutral";
    note: string;
  };
}

export interface AITradeScenarioPayload {
  id: string;
  name: string;
  direction: "long" | "short";
  priority: "primary" | "secondary" | "alternative";
  entry: {
    type: "limit" | "market" | "stop" | "wait_for_trigger";
    price: number;
    condition: string;
    triggerIndicators: string[];
    maxWaitBars?: number;
    executionType?: "market" | "limit";
  };
  stopLoss: {
    price: number;
    pips: number;
    reason: string;
  };
  takeProfit: {
    price: number;
    pips: number;
    reason: string;
  };
  riskReward: number;
  confidence: number;
  rationale: string;
  invalidationConditions: string[];
  indicatorsUsed?: string[];
  indicatorsIgnored?: string[];
  reasonForSelection?: string;
  reasonForIgnoring?: string;
  patternLabel?: string;
  multipleTestingDefense?: string;
  warnings?: string[];
}

/**
 * BullBearDebate の表示用サブセット (P0-a で永続化された debate 列の描画用)。
 * バックエンドの BullBearDebateOutput 全体のうち、UI が描画するフィールドのみを型化する。
 */
export interface PlanDebateSidePayload {
  scenario: string;
  confidence: number;
  rationale: string[];
  keyConditions: string[];
  risks: string[];
}

export interface PlanDebatePayload {
  marketContext: {
    summary: string;
    dominantBias: string;
    biasStrength: number;
  };
  bull: PlanDebateSidePayload;
  bear: PlanDebateSidePayload;
  synthesis: {
    preferredDirection: string;
    preferredConfidence: number;
    reasoning: string;
    consensusPoints: string[];
    divergencePoints: string[];
    actionableInsight: string;
  };
}

/**
 * IndicatorSpecialist の MTF テクニカル統合解釈の表示用サブセット (P0-a)。
 */
export interface PlanIndicatorAnalysisPayload {
  interpretation: string;
  confidence: number;
  current: {
    trendState: string;
    momentum: string;
  };
  mtfAlignment: {
    trendAlignment: string;
    pullbackOpportunity: boolean;
    counterTrendSignal: boolean;
  };
}

export interface AITradePlanPayload {
  id: string;
  researchId: string;
  targetDate: string;
  symbol: string;
  marketAnalysis: PlanMarketAnalysisPayload;
  scenarios: AITradeScenarioPayload[];
  /** P0-a: 永続化された BullBearDebate 出力。旧プランや debate スキップ時は null。 */
  debate?: PlanDebatePayload | null;
  /** P0-a: 永続化された IndicatorSpecialist 解釈。旧プランや取得失敗時は null。 */
  indicatorAnalysis?: PlanIndicatorAnalysisPayload | null;
  overallConfidence: number | null;
  warnings: string[];
  aiModel: string | null;
  tokenUsage: number | null;
  createdAt: string;
  /**
   * Step A-3: バックエンド側で Plan フェーズから StrategyBacktester を切出済。
   * 本フィールドは新規プランからは付与されない (= 常に undefined)。
   * 既存プラン (旧フォーマット) を表示する経路のために型は optional として残置。
   * 後続 Step D-3 で Action フローに再配置後、別 PR で扱いを再決定する。
   */
  strategyBacktest?: StrategyBacktestRunPayload;
}

export interface ListPlansParams {
  symbol?: string;
  targetDate?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface ListPlansResponse {
  success: true;
  plans: AITradePlanPayload[];
  total: number;
  limit: number;
  offset: number;
}

export interface GetPlanResponse {
  success: true;
  plan: AITradePlanPayload;
}

/**
 * オーケストレーターが付与する DSL 即時BT の集計。
 * バックエンド: `StrategyBacktesterRunResult`（HTTP では JSON）
 */
export interface StrategyBacktestRunPayload {
  scenarioResults: PerScenarioStrategyBacktestPayload[];
  overallPassed: boolean;
  period: { start: string; end: string };
  totalDurationMs: number;
}

export interface PerScenarioStrategyBacktestPayload {
  scenario: { id: string; name: string; direction: "long" | "short" };
  passed: boolean;
  error?: string;
  strategistInterpretation: string;
  durationMs: number;
  // Critical-4 段階 4a: DSLBacktest → SurrogateFitness にリネーム (進化計算用近似 fitness、正式 BT 結果ではない)
  surrogateFitnessResult?: {
    executionModel?: string;
    executionConfigHash?: string;
    dataSource?: string;
    costSummary?: {
      model?: string;
      dataSource?: string;
      roundTripCostPips?: number;
      roundTripCostAtrMult?: number;
      totalCost?: number;
    };
    grossPnls?: number[];
    netPnls?: number[];
  };
  toolResults?: ValidationToolResult[];
}

/**
 * POST /api/side-b/plans 成功時（plan に strategyBacktest が付くのは新規生成時・シナリオあり時に限る）
 */
export interface GeneratePlanResponse {
  success: true;
  plan: AITradePlanPayload;
  cached?: boolean;
  tokenUsage?: number;
}

export type GeneratePlanRequest = {
  symbol: string;
  targetDate?: string;
  researchId?: string;
  userPreferences?: Record<string, unknown>;
  ohlcvData?: unknown[];
  indicators?: Record<string, unknown>;
  timeframe?: string;
  forceRefresh?: boolean;
};

/**
 * GET /api/side-b/evolution/lessons クエリパラメータ
 */
export interface ListGenerationLessonsQuery {
  regime?: string;
  limit?: number;
}

/**
 * GET /api/side-b/evolution/runs クエリパラメータ
 */
export interface ListEvolutionRunsQuery {
  limit?: number;
}

/**
 * 世代単位の振り返り (GenerationLesson) を UI で扱うときの最小形。
 * バックエンドの `GenerationLessonRecord` (src/backend/repositories/generationLessonRepository.ts) のうち、
 * 進化トラッキング画面が参照するフィールドのみを公開する。
 */
export interface EvolutionLesson {
  id: string;
  evolutionRunId: string;
  regime: string;
  generation: number;
  category: string;
  lesson: string;
  recordedAt: string;
  /** 学びの根拠数値（dsr / lift / 親勝率→子勝率 等）。未記録は null。 */
  metrics?: Record<string, number | string | boolean> | null;
  /** LLM が報告した信頼度（0.0-1.0）。未記録は null。 */
  confidence?: number | null;
}

export interface ListEvolutionLessonsResponse {
  success: true;
  lessons: EvolutionLesson[];
}

/**
 * 進化ループ (EvolutionRun) のサマリエントリ。
 * バックエンドは distinct な `evolutionRunId` と最終 `createdAt` のみを返す。
 */
export interface EvolutionRunListItem {
  evolutionRunId: string;
  createdAt: string;
}

export interface ListEvolutionRunsResponse {
  success: true;
  runs: EvolutionRunListItem[];
}

/**
 * 進化ループ 1 件のサマリ。
 * バックエンドの `EvolutionRunSummary` (src/backend/repositories/evolutionBacktestRunRepository.ts) と整合。
 */
export interface EvolutionRunSummary {
  evolutionRunId: string;
  totalCandidates: number;
  passed: number;
  failed: number;
  failureReasonCounts: Record<string, number>;
  generations: Array<{
    generation: number;
    passed: number;
    failed: number;
  }>;
}

export interface GetEvolutionRunSummaryResponse {
  success: true;
  summary: EvolutionRunSummary;
}

/**
 * 進化ループで評価された候補 1 件の UI 表示用形。
 * Prisma の EvolutionBacktestRun のうち、フロントが参照するフィールドのみ公開する。
 */
/**
 * 進化候補の戦略DSLスナップショット（before→action→after 可視化に必要な部分のみ）。
 * candidates API が EvolutionBacktestRun.dslSnapshot を raw で返す。
 */
export interface EvolutionDslSnapshot {
  id: string;
  /** 親個体のDSL ID（mutation=1件 / crossover=2件）。種(seed)は空 or undefined。 */
  parentIds?: string[];
  /** 生成元（'mutation' / 'crossover' / 'seed' 等）。action の識別に使う。 */
  metadata?: { createdBy?: string } | null;
  entry?: { kind?: string } | null;
  stopLoss?: { type?: string; value?: number; lookbackBars?: number } | null;
  takeProfit?: { type?: string; value?: number } | null;
  parameters?: Record<string, number> | null;
}

export interface EvolutionRunCandidate {
  id: string;
  generation: number;
  candidateHash: string;
  surrogateScore: number;
  formalBtPassed: boolean;
  formalBtFailureReason: string | null;
  formalBtMetrics: {
    pf?: number;
    winRate?: number;
    tradeCount?: number;
  } | null;
  /** DSLスナップショット（親→子の差分・由来表示用）。 */
  dslSnapshot?: EvolutionDslSnapshot | null;
  /** 進化候補のDSL ID（= EvolutionBacktestRun.candidateId）。親子の突き合わせに使う。 */
  candidateId?: string;
  /**
   * OOS-aware 確証結果（観測）。in-sample 合格に加え OOS/WF も通過したか。
   * OOS未評価 / 対象外（validation_candidate 以外）は null。
   */
  oosResult?: {
    confirmed: boolean;
    finalStage: string;
    oosStatus: string | null;
    oosPf: number | null;
    oosWinRate: number | null;
  } | null;
}

export interface GetEvolutionRunCandidatesResponse {
  success: true;
  candidates: EvolutionRunCandidate[];
}

// ===========================================
// オーケストレーター実行履歴 (AgentRun / AgentRunStep)
// ===========================================

export interface AgentRunStep {
  id: string;
  runId: string;
  stepName: string;
  attempt: number;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  traceKind: string | null;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  nextAction: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface AgentRun {
  id: string;
  kind: string;
  triggeredBy: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ListOrchestratorRunsResponse {
  status: string | null;
  count: number;
  runs: AgentRun[];
}

export interface GetOrchestratorRunDetailResponse extends AgentRun {
  steps: AgentRunStep[];
}

export interface EmergencyStatusResponse {
  success: true;
  data: {
    isEmergencyStopped: boolean;
    consecutiveErrors: number;
  };
}

export interface EmergencyStopResponse {
  success: true;
  message: string;
  data: {
    closeSummary: string[];
  };
}

export interface EmergencyResumeResponse {
  success: true;
  message: string;
}

