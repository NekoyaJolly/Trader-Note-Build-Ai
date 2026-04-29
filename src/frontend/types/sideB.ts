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

/** GET /system/health */
export interface SystemHealthResponse {
  success: true;
  database: "ok" | "error";
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

export interface AITradePlanPayload {
  id: string;
  researchId: string;
  targetDate: string;
  symbol: string;
  marketAnalysis: PlanMarketAnalysisPayload;
  scenarios: AITradeScenarioPayload[];
  overallConfidence: number | null;
  warnings: string[];
  aiModel: string | null;
  tokenUsage: number | null;
  createdAt: string;
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
  dslResult?: {
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
