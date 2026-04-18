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
