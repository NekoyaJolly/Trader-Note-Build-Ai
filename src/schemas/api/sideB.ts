/**
 * Side-B API Zodスキーマ
 * 
 * 目的: Side-B（TradeAssistant-AI）のAPI操作で使用するスキーマ
 * AI出力のパースにも使用
 */

import { z } from 'zod';
import {
  UUIDSchema,
  DateSchema,
  SymbolSchema,
  TimeframeSchema,
  PriceSchema,
  ScoreSchema,
  NonEmptyStringSchema,
  NormalizedValueSchema,
} from '../common';

// ========================================
// OHLCVデータスキーマ（リクエスト共通）
// ========================================

/**
 * OHLCVデータ項目（API入力用）
 */
export const OHLCVInputSchema = z.object({
  timestamp: z.union([z.string(), z.date()]),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});

export type OHLCVInput = z.infer<typeof OHLCVInputSchema>;

/**
 * OHLCVデータ配列
 */
export const OHLCVArraySchema = z.array(OHLCVInputSchema);

// ========================================
// リサーチリクエストスキーマ
// ========================================

/**
 * POST /api/side-b/research リクエストボディ
 */
export const GenerateResearchRequestSchema = z.object({
  symbol: SymbolSchema,
  timeframe: TimeframeSchema.optional().default('15m'),
  ohlcvData: OHLCVArraySchema.optional(),  // 省略時は自動取得
  indicators: z.record(z.string(), z.unknown()).optional(),
  forceRefresh: z.boolean().optional().default(false),
});

export type GenerateResearchRequest = z.infer<typeof GenerateResearchRequestSchema>;

/**
 * GET /api/side-b/research クエリパラメータ
 */
export const ListResearchQuerySchema = z.object({
  symbol: SymbolSchema.optional(),
  validOnly: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
});

export type ListResearchQuery = z.infer<typeof ListResearchQuerySchema>;

// ========================================
// プランリクエストスキーマ
// ========================================

/**
 * POST /api/side-b/plans リクエストボディ
 */
export const GeneratePlanRequestSchema = z.object({
  symbol: SymbolSchema,
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日付はYYYY-MM-DD形式で指定してください' }).optional(),
  researchId: UUIDSchema.optional(),
  userPreferences: z.record(z.string(), z.unknown()).optional(),
  ohlcvData: OHLCVArraySchema.optional(),  // researchIdがない場合に必要
  indicators: z.record(z.string(), z.unknown()).optional(),
  timeframe: TimeframeSchema.optional().default('15m'),
  forceRefresh: z.boolean().optional().default(false),
});

export type GeneratePlanRequest = z.infer<typeof GeneratePlanRequestSchema>;

/**
 * GET /api/side-b/plans クエリパラメータ
 */
export const ListPlansQuerySchema = z.object({
  symbol: SymbolSchema.optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日付はYYYY-MM-DD形式' }).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日付はYYYY-MM-DD形式' }).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日付はYYYY-MM-DD形式' }).optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
});

export type ListPlansQuery = z.infer<typeof ListPlansQuerySchema>;

/**
 * GET /api/side-b/plans/:id クエリパラメータ
 */
export const GetPlanByIdQuerySchema = z.object({
  withResearch: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
});

export type GetPlanByIdQuery = z.infer<typeof GetPlanByIdQuerySchema>;

// ========================================
// プラン生成レスポンス（Phase 6.7b: plan.strategyBacktest 任意）
// ========================================

/**
 * 検証ツール1件（即時BTの toolResults 用）
 */
export const PlanStrategyBacktestToolResultSchema = z.object({
  toolName: z.string(),
  success: z.boolean(),
  passed: z.boolean(),
  metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  interpretation: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
});

/**
 * シナリオ別即時BTサマリー（残りは .passthrough）
 */
export const PerScenarioStrategyBacktestSchema = z
  .object({
    scenario: z
      .object({
        id: z.string(),
        name: z.string(),
        direction: z.enum(['long', 'short']),
      })
      .passthrough(),
    passed: z.boolean(),
    error: z.string().optional(),
    strategistInterpretation: z.string(),
    durationMs: z.number(),
    toolResults: z.array(PlanStrategyBacktestToolResultSchema).optional(),
  })
  .passthrough();

/**
 * `plan.strategyBacktest` ペイロード
 */
export const StrategyBacktestRunPayloadSchema = z.object({
  scenarioResults: z.array(PerScenarioStrategyBacktestSchema),
  overallPassed: z.boolean(),
  period: z.object({ start: z.string(), end: z.string() }),
  totalDurationMs: z.number(),
});

export type StrategyBacktestRunPayload = z.infer<typeof StrategyBacktestRunPayloadSchema>;

// ========================================
// パイプラインリクエストスキーマ
// ========================================

/**
 * POST /api/side-b/pipeline リクエストボディ
 */
export const RunPipelineBodyRequestSchema = z.object({
  symbol: SymbolSchema,
  ohlcvData: OHLCVArraySchema.optional(),  // 省略時は自動取得
  indicators: z.record(z.string(), z.unknown()).optional(),
  userPreferences: z.record(z.string(), z.unknown()).optional(),
  forceRefresh: z.boolean().optional().default(false),
  timeframe: TimeframeSchema.optional().default('15m'),
});

export type RunPipelineBodyRequest = z.infer<typeof RunPipelineBodyRequestSchema>;

// ========================================
// 仮想トレードリクエストスキーマ
// ========================================

/**
 * POST /api/side-b/trades リクエストボディ
 */
export const CreateVirtualTradeRequestSchema = z.object({
  planId: UUIDSchema,
  scenarioId: z.string().optional(),
});

export type CreateVirtualTradeRequest = z.infer<typeof CreateVirtualTradeRequestSchema>;

/**
 * GET /api/side-b/trades クエリパラメータ
 */
export const ListVirtualTradesQuerySchema = z.object({
  status: z.enum(['pending', 'open', 'closed', 'expired', 'cancelled']).optional(),
  planId: UUIDSchema.optional(),
  symbol: SymbolSchema.optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
});

export type ListVirtualTradesQuery = z.infer<typeof ListVirtualTradesQuerySchema>;

/**
 * POST /api/side-b/trades/:id/close リクエストボディ
 */
export const CloseVirtualTradeRequestSchema = z.object({
  exitPrice: z.number().positive('決済価格は正の数を指定してください'),
  reason: z.enum(['manual', 'invalidation']).optional().default('manual'),
  note: z.string().optional(),
});

export type CloseVirtualTradeRequest = z.infer<typeof CloseVirtualTradeRequestSchema>;

// ========================================
// ポートフォリオリクエストスキーマ
// ========================================

/**
 * PUT /api/side-b/portfolio/settings リクエストボディ
 */
export const UpdatePortfolioSettingsRequestSchema = z.object({
  maxOpenPositions: z.number().int().min(1).max(10).optional(),
  riskPercentPerTrade: z.number().min(0.1).max(10).optional(),
  enableSpread: z.boolean().optional(),
  spreadPips: z.number().min(0).optional(),
});

export type UpdatePortfolioSettingsRequest = z.infer<typeof UpdatePortfolioSettingsRequestSchema>;

// ========================================
// AIノートリクエストスキーマ
// ========================================

/**
 * GET /api/side-b/ai-notes クエリパラメータ
 */
export const ListAINotesQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日付はYYYY-MM-DD形式' }).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日付はYYYY-MM-DD形式' }).optional(),
  outcome: z.enum(['win', 'loss', 'breakeven']).optional(),
  symbol: SymbolSchema.optional(),
  // 本番運用フラグでの絞り込み（「本番運用」タブ）。クエリ文字列なので 'true'/'false' を boolean に変換。
  usedForMatching: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
});

export type ListAINotesQuery = z.infer<typeof ListAINotesQuerySchema>;

/**
 * GET /api/side-b/ai-notes/summaries クエリパラメータ
 */
export const ListAINoteSummariesQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
});

export type ListAINoteSummariesQuery = z.infer<typeof ListAINoteSummariesQuerySchema>;

/**
 * POST /api/side-b/ai-notes/summaries/generate リクエストボディ
 */
export const GenerateAINoteSummaryRequestSchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '開始日はYYYY-MM-DD形式で指定してください' }),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '終了日はYYYY-MM-DD形式で指定してください' }),
});

export type GenerateAINoteSummaryRequest = z.infer<typeof GenerateAINoteSummaryRequestSchema>;

// ========================================
// スケジューラーリクエストスキーマ
// ========================================

/**
 * PUT /api/side-b/scheduler/config リクエストボディ
 */
export const UpdateSchedulerConfigRequestSchema = z.object({
  enabled: z.boolean().optional(),
  symbols: z.array(SymbolSchema).optional(),
  timeframe: TimeframeSchema.optional(),
  monitorIntervalMs: z.number().int().min(1000).optional(),
  dailyPlanTimeUTC: z.string().regex(/^\d{2}:\d{2}$/, { message: '時刻はHH:MM形式で指定してください' }).optional(),
  autoGenerateNote: z.boolean().optional(),
});

export type UpdateSchedulerConfigRequest = z.infer<typeof UpdateSchedulerConfigRequestSchema>;

// ========================================
// URLパラメータスキーマ
// ========================================

/**
 * /api/side-b/research/:id など、IDパラメータ
 */
export const IdParamSchema = z.object({
  id: UUIDSchema,
});

export type IdParam = z.infer<typeof IdParamSchema>;

/**
 * PATCH /api/side-b/ai-notes/:id/matching リクエストボディ
 * 本番運用フラグ（実行時照合の対象集合）の手動トグル
 */
export const UpdateAINoteMatchingRequestSchema = z.object({
  usedForMatching: z.boolean(),
});

export type UpdateAINoteMatchingRequest = z.infer<typeof UpdateAINoteMatchingRequestSchema>;

/**
 * /api/side-b/research/valid/:symbol など、シンボルパラメータ
 */
export const SymbolParamSchema = z.object({
  symbol: SymbolSchema,
});

export type SymbolParam = z.infer<typeof SymbolParamSchema>;

// ========================================
// 12次元特徴量スキーマ
// ========================================

/**
 * 12次元特徴量ベクトル
 * 各値は0-100の範囲で正規化
 */
export const FeatureVector12DSchema = z.object({
  // トレンド系 (3次元)
  trendDirection: ScoreSchema,      // 0-100: 0=強い下降, 50=横ばい, 100=強い上昇
  trendStrength: ScoreSchema,       // 0-100: トレンドの強さ
  trendAlignment: ScoreSchema,      // 0-100: マルチタイムフレームの一致度

  // モメンタム系 (3次元)
  macdHistogram: ScoreSchema,       // 0-100: MACDヒストグラム正規化
  macdCrossover: ScoreSchema,       // 0-100: クロスオーバー状態
  rsiNormalized: ScoreSchema,       // 0-100: RSI値そのまま

  // ボラティリティ系 (3次元)
  rsiZone: ScoreSchema,             // 0-100: 売られすぎ/買われすぎゾーン
  bbPosition: ScoreSchema,          // 0-100: BB内の位置
  bbWidth: ScoreSchema,             // 0-100: BBバンド幅（ボラティリティ）

  // 価格アクション系 (3次元)
  candleBody: ScoreSchema,          // 0-100: ローソク実体の大きさ
  candleDirection: ScoreSchema,     // 0-100: ローソクの方向性
  sessionFlag: ScoreSchema,         // 0-100: 取引セッション（アジア/欧州/米国）
});

export type FeatureVector12D = z.infer<typeof FeatureVector12DSchema>;

/**
 * 特徴量ベクトルを配列形式に変換
 */
export const FeatureVectorArraySchema = z.array(ScoreSchema).length(12);

// ========================================
// マーケットリサーチスキーマ
// ========================================

/**
 * リサーチセクション（AI出力）
 */
export const ResearchSectionSchema = z.object({
  title: NonEmptyStringSchema,
  content: NonEmptyStringSchema,
  confidence: NormalizedValueSchema,
});

export type ResearchSection = z.infer<typeof ResearchSectionSchema>;

/**
 * マーケットリサーチ（AI出力）
 */
export const MarketResearchAIOutputSchema = z.object({
  symbol: SymbolSchema,
  date: z.string(),
  marketOverview: ResearchSectionSchema,
  technicalAnalysis: ResearchSectionSchema,
  fundamentalFactors: ResearchSectionSchema,
  riskFactors: ResearchSectionSchema,
  summary: NonEmptyStringSchema,
  overallConfidence: NormalizedValueSchema,
});

export type MarketResearchAIOutput = z.infer<typeof MarketResearchAIOutputSchema>;

/**
 * リサーチ作成リクエスト
 */
export const CreateResearchRequestSchema = z.object({
  symbol: SymbolSchema,
  targetDate: z.string().optional(),
  forceRefresh: z.boolean().optional().default(false),
});

export type CreateResearchRequest = z.infer<typeof CreateResearchRequestSchema>;

// ========================================
// トレードプランスキーマ
// ========================================

/**
 * エントリー条件
 */
export const EntryConditionSchema = z.object({
  type: z.enum(['price_level', 'indicator', 'pattern', 'time', 'custom']),
  description: NonEmptyStringSchema,
  value: z.union([z.number(), z.string()]).optional(),
  priority: z.enum(['required', 'optional']).default('required'),
});

export type EntryCondition = z.infer<typeof EntryConditionSchema>;

/**
 * トレードプランエントリー（AI出力）
 */
export const TradePlanEntrySchema = z.object({
  id: z.string(),
  direction: z.enum(['BUY', 'SELL']),
  entryPrice: PriceSchema,
  stopLoss: PriceSchema,
  takeProfit: PriceSchema,
  riskRewardRatio: z.number().positive(),
  confidence: NormalizedValueSchema,
  reasoning: NonEmptyStringSchema,
  entryConditions: z.array(EntryConditionSchema),
  timeframe: TimeframeSchema,
  validUntil: z.string(),
});

export type TradePlanEntry = z.infer<typeof TradePlanEntrySchema>;

/**
 * トレードプラン（AI出力）
 */
export const TradePlanAIOutputSchema = z.object({
  symbol: SymbolSchema,
  date: z.string(),
  marketBias: z.enum(['bullish', 'bearish', 'neutral']),
  entries: z.array(TradePlanEntrySchema),
  overallConfidence: NormalizedValueSchema,
  keyLevels: z.object({
    support: z.array(PriceSchema),
    resistance: z.array(PriceSchema),
  }),
  summary: NonEmptyStringSchema,
});

export type TradePlanAIOutput = z.infer<typeof TradePlanAIOutputSchema>;

/**
 * プラン作成リクエスト
 */
export const CreatePlanRequestSchema = z.object({
  symbol: SymbolSchema,
  targetDate: z.string().optional(),
  researchId: UUIDSchema.optional(),
  forceRefresh: z.boolean().optional().default(false),
});

export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;

// ========================================
// 仮想トレードスキーマ
// ========================================

/**
 * 仮想トレードステータス
 */
export const VirtualTradeStatusSchema = z.enum([
  'pending',    // エントリー待ち
  'open',       // ポジション保有中
  'closed',     // クローズ済み
  'cancelled',  // キャンセル
  'expired',    // 期限切れ
]);

export type VirtualTradeStatus = z.infer<typeof VirtualTradeStatusSchema>;

/**
 * 仮想トレード
 */
export const VirtualTradeSchema = z.object({
  id: UUIDSchema,
  planEntryId: z.string(),
  symbol: SymbolSchema,
  direction: z.enum(['BUY', 'SELL']),
  status: VirtualTradeStatusSchema,
  entryPrice: PriceSchema,
  currentPrice: PriceSchema.optional(),
  stopLoss: PriceSchema,
  takeProfit: PriceSchema,
  lotSize: z.number().positive(),
  entryTime: DateSchema.optional(),
  exitTime: DateSchema.optional(),
  exitPrice: PriceSchema.optional(),
  profitLoss: z.number().optional(),
  profitLossPips: z.number().optional(),
  exitReason: z.string().optional(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});

export type VirtualTrade = z.infer<typeof VirtualTradeSchema>;

/**
 * 仮想トレード実行リクエスト
 */
export const ExecuteVirtualTradeRequestSchema = z.object({
  planEntryId: z.string().min(1, 'プランエントリーIDは必須です'),
  lotSize: z.number().positive('ロットサイズは正の数を指定してください').optional().default(0.01),
});

export type ExecuteVirtualTradeRequest = z.infer<typeof ExecuteVirtualTradeRequestSchema>;

// ========================================
// AIトレードノートスキーマ
// ========================================

/**
 * AIトレードノート
 */
export const AITradeNoteSchema = z.object({
  id: UUIDSchema,
  virtualTradeId: UUIDSchema,
  featureVector: FeatureVector12DSchema,
  analysis: z.object({
    entryAnalysis: NonEmptyStringSchema,
    exitAnalysis: NonEmptyStringSchema.optional(),
    lessonsLearned: z.array(z.string()),
    improvements: z.array(z.string()),
  }),
  performance: z.object({
    profitLoss: z.number(),
    profitLossPips: z.number(),
    riskRewardAchieved: z.number(),
    holdingPeriod: z.number(), // 分単位
  }),
  similarity: z.object({
    mostSimilarNoteId: UUIDSchema.optional(),
    similarityScore: ScoreSchema.optional(),
  }).optional(),
  createdAt: DateSchema,
});

export type AITradeNote = z.infer<typeof AITradeNoteSchema>;

// ========================================
// ポートフォリオスキーマ
// ========================================

/**
 * ポートフォリオサマリー
 */
export const PortfolioSummarySchema = z.object({
  totalTrades: z.number().int().min(0),
  winRate: NormalizedValueSchema,
  totalProfitLoss: z.number(),
  averageRiskReward: z.number(),
  maxDrawdown: z.number(),
  sharpeRatio: z.number().optional(),
  lastUpdated: DateSchema,
});

export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

/**
 * ポートフォリオ設定更新
 */
export const UpdatePortfolioSettingsSchema = z.object({
  maxOpenPositions: z.number().int().min(1).max(10).optional(),
  riskPerTrade: NormalizedValueSchema.optional(),
  defaultLotSize: z.number().positive().optional(),
});

export type UpdatePortfolioSettings = z.infer<typeof UpdatePortfolioSettingsSchema>;

// ========================================
// パイプラインスキーマ
// ========================================

/**
 * パイプライン実行リクエスト
 */
export const RunPipelineRequestSchema = z.object({
  symbol: SymbolSchema,
  targetDate: z.string().optional(),
  executeVirtualTrades: z.boolean().optional().default(false),
});

export type RunPipelineRequest = z.infer<typeof RunPipelineRequestSchema>;

/**
 * パイプライン実行結果
 */
export const PipelineResultSchema = z.object({
  researchId: UUIDSchema,
  planId: UUIDSchema,
  virtualTradeIds: z.array(UUIDSchema),
  status: z.enum(['success', 'partial', 'failed']),
  message: z.string(),
});

export type PipelineResult = z.infer<typeof PipelineResultSchema>;

// ========================================
// スケジューラースキーマ
// ========================================

/**
 * スケジューラーステータス
 */
export const SchedulerStatusSchema = z.object({
  isRunning: z.boolean(),
  lastRunAt: DateSchema.optional(),
  nextRunAt: DateSchema.optional(),
  activeSymbols: z.array(SymbolSchema),
  config: z.object({
    cronExpression: z.string(),
    timezone: z.string(),
  }),
});

export type SchedulerStatus = z.infer<typeof SchedulerStatusSchema>;

/**
 * スケジューラー設定更新
 */
export const UpdateSchedulerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  cronExpression: z.string().optional(),
  symbols: z.array(SymbolSchema).optional(),
});

export type UpdateSchedulerConfig = z.infer<typeof UpdateSchedulerConfigSchema>;

// ========================================
// 比較分析スキーマ（Phase D）
// ========================================

/**
 * 比較分析の期間
 */
export const ComparisonPeriodSchema = z.enum(['week', 'month', 'quarter', 'year', 'all']);

export type ComparisonPeriodType = z.infer<typeof ComparisonPeriodSchema>;

/**
 * GET /api/side-b/comparison クエリパラメータ
 */
export const GetComparisonQuerySchema = z.object({
  period: ComparisonPeriodSchema.optional().default('month'),
  symbol: SymbolSchema.optional(),
});

export type GetComparisonQuery = z.infer<typeof GetComparisonQuerySchema>;

/**
 * パフォーマンス統計
 */
export const PerformanceStatsSchema = z.object({
  totalTrades: z.number().int().min(0),
  winCount: z.number().int().min(0),
  lossCount: z.number().int().min(0),
  winRate: z.number().min(0).max(100),
  profitFactor: z.number().nullable(),
  totalPnL: z.number(),
  averagePnL: z.number(),
  averageWin: z.number(),
  averageLoss: z.number(),
  maxWin: z.number(),
  maxLoss: z.number(),
});

export type PerformanceStats = z.infer<typeof PerformanceStatsSchema>;

/**
 * 比較結果
 */
export const ComparisonResultSchema = z.object({
  period: z.object({
    start: z.string(),
    end: z.string(),
    label: z.string(),
  }),
  human: PerformanceStatsSchema,
  ai: PerformanceStatsSchema,
  comparison: z.object({
    winRateDiff: z.number(),
    profitFactorDiff: z.number().nullable(),
    totalPnLDiff: z.number(),
    winner: z.enum(['human', 'ai', 'tie']),
  }),
  alignmentRate: z.number().min(0).max(100),
});

export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;

/**
 * 時系列データ
 */
export const TimeSeriesDataSchema = z.object({
  date: z.string(),
  humanWinRate: z.number(),
  aiWinRate: z.number(),
  humanPnL: z.number(),
  aiPnL: z.number(),
});

export type TimeSeriesDataType = z.infer<typeof TimeSeriesDataSchema>;

/**
 * 比較ダッシュボードレスポンス
 */
export const ComparisonDashboardResponseSchema = z.object({
  success: z.boolean(),
  summary: ComparisonResultSchema,
  timeSeries: z.array(TimeSeriesDataSchema),
  recentTrades: z.object({
    human: z.array(z.object({
      id: z.string(),
      date: z.string(),
      symbol: z.string(),
      side: z.string(),
      outcome: z.enum(['win', 'loss', 'breakeven']),
      pnlPips: z.number().nullable(),
    })),
    ai: z.array(z.object({
      id: z.string(),
      date: z.string(),
      symbol: z.string(),
      direction: z.string(),
      outcome: z.enum(['win', 'loss', 'breakeven']),
      pnlPips: z.number(),
    })),
  }),
});

export type ComparisonDashboardResponse = z.infer<typeof ComparisonDashboardResponseSchema>;

// ========================================
// サマリースケジューラースキーマ（週次/月次）
// ========================================

/**
 * サマリー期間タイプ
 */
export const SummaryPeriodTypeSchema = z.enum(['weekly', 'monthly']);
export type SummaryPeriodType = z.infer<typeof SummaryPeriodTypeSchema>;

/**
 * GET /api/side-b/summaries クエリパラメータ
 */
export const ListSummariesQuerySchema = z.object({
  period: SummaryPeriodTypeSchema.optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
});

export type ListSummariesQuery = z.infer<typeof ListSummariesQuerySchema>;

/**
 * POST /api/side-b/summaries/generate リクエストボディ
 */
export const GenerateSummaryRequestSchema = z.object({
  period: SummaryPeriodTypeSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '開始日はYYYY-MM-DD形式で指定してください' }).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '終了日はYYYY-MM-DD形式で指定してください' }).optional(),
});

export type GenerateSummaryRequest = z.infer<typeof GenerateSummaryRequestSchema>;

/**
 * サマリースケジューラー設定
 */
export const SummarySchedulerConfigSchema = z.object({
  weeklyEnabled: z.boolean().default(true),
  monthlyEnabled: z.boolean().default(true),
  weeklyCronExpression: z.string().default('0 22 * * 6'), // 土曜 UTC 22:00
  monthlyCronExpression: z.string().default('0 0 1 * *'), // 毎月1日 0:00 UTC
  notifyOnGeneration: z.boolean().default(true),
});

export type SummarySchedulerConfigType = z.infer<typeof SummarySchedulerConfigSchema>;

/**
 * PUT /api/side-b/summaries/scheduler リクエストボディ
 */
export const UpdateSummarySchedulerConfigRequestSchema = SummarySchedulerConfigSchema.partial();

export type UpdateSummarySchedulerConfigRequest = z.infer<typeof UpdateSummarySchedulerConfigRequestSchema>;

/**
 * 生成されたサマリー
 */
export const GeneratedSummarySchema = z.object({
  id: z.string().uuid(),
  period: SummaryPeriodTypeSchema,
  startDate: z.date(),
  endDate: z.date(),
  humanStats: z.object({
    totalTrades: z.number(),
    winRate: z.number(),
    totalPnL: z.number(),
    avgRR: z.number().nullable(),
    bestTrade: z.number().nullable(),
    worstTrade: z.number().nullable(),
  }),
  aiStats: z.object({
    totalTrades: z.number(),
    winRate: z.number(),
    totalPnL: z.number(),
    avgRR: z.number().nullable(),
    bestTrade: z.number().nullable(),
    worstTrade: z.number().nullable(),
  }),
  comparison: z.object({
    winRateDiff: z.number(),
    pnlDiff: z.number(),
    recommendation: z.string(),
  }),
  generatedAt: z.date(),
});

export type GeneratedSummaryType = z.infer<typeof GeneratedSummarySchema>;

/**
 * サマリーリストレスポンス
 */
export const ListSummariesResponseSchema = z.object({
  success: z.boolean(),
  summaries: z.array(GeneratedSummarySchema),
  total: z.number(),
});

export type ListSummariesResponse = z.infer<typeof ListSummariesResponseSchema>;

// ===========================================
// PDCA Agent（Phase 2: 自律エージェント）
// ===========================================

/**
 * POST /api/side-b/agent/start のリクエストボディ
 */
export const StartAgentRequestSchema = z.object({
  symbols: z.array(SymbolSchema).optional(),
  normalIntervalMs: z.number().int().min(60000).optional(),   // 最低1分
  activeIntervalMs: z.number().int().min(30000).optional(),   // 最低30秒
  positionIntervalMs: z.number().int().min(10000).optional(), // 最低10秒
});

export type StartAgentRequest = z.infer<typeof StartAgentRequestSchema>;

/**
 * GET /api/side-b/agent/thinking-log のクエリ
 */
export const ThinkingLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type ThinkingLogQuery = z.infer<typeof ThinkingLogQuerySchema>;

/**
 * GET /api/side-b/agent/reflections のクエリ
 */
export const ReflectionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export type ReflectionsQuery = z.infer<typeof ReflectionsQuerySchema>;

// ===========================================
// Reflection AI（Phase 3: 振り返り AI）
// ===========================================

/**
 * Reflection AI の出力スキーマ
 */
export const ReflectionOutputSchema = z.object({
  /** 勝敗の原因分析 */
  outcomeAnalysis: z.string(),

  /** エントリー判断の評価 */
  entryEvaluation: z.object({
    rating: z.enum(['excellent', 'good', 'neutral', 'poor', 'bad']),
    comment: z.string(),
  }),

  /** 決済判断の評価 */
  exitEvaluation: z.object({
    rating: z.enum(['excellent', 'good', 'neutral', 'poor', 'bad']),
    comment: z.string(),
  }),

  /** 次回に活かすべき学び（1-3件） */
  lessons: z.array(z.string()).min(1).max(3),

  /** 戦略修正の提案（任意） */
  strategyAdjustment: z.string().optional(),

  /** 総合スコア（0-100: 100=完璧なトレード） */
  overallScore: z.number().min(0).max(100),
});

export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

// ===========================================
// API レスポンススキーマ（Phase 3-4: フロントバリデーション用）
// ===========================================

/**
 * GET /api/side-b/agent/status レスポンス
 */
export const AgentStatusResponseSchema = z.object({
  isRunning: z.boolean(),
  state: z.string(),
  cycleCount: z.number(),
  watchSymbols: z.array(z.string()),
  startedAt: z.string().datetime().optional(),
  lastTickAt: z.string().datetime().optional(),
  nextTickAt: z.string().datetime().optional(),
  lastAction: z.string().optional(),
  lastError: z.string().optional(),
  lastTickDurationMs: z.number().optional(),
  memory: z.object({
    currentState: z.string(),
    recentTradeResults: z.array(z.object({
      id: z.string(),
      symbol: z.string(),
      direction: z.enum(['long', 'short']),
      entryPrice: z.number(),
      exitPrice: z.number(),
      pnlPips: z.number(),
      outcome: z.enum(['win', 'loss', 'breakeven']),
      exitReason: z.string(),
      reflection: z.string().optional(),
      tradedAt: z.string(),
      closedAt: z.string(),
    })),
    openPositions: z.array(z.object({
      tradeId: z.string(),
      symbol: z.string(),
      direction: z.enum(['long', 'short']),
      entryPrice: z.number(),
      currentPnlPips: z.number(),
    })),
    lessons: z.array(z.string()),
    cycleCount: z.number(),
  }),
});

export type AgentStatusResponse = z.infer<typeof AgentStatusResponseSchema>;

/**
 * GET /api/side-b/agent/thinking-log レスポンス
 */
export const ThinkingLogResponseSchema = z.object({
  log: z.array(z.object({
    timestamp: z.string(),
    cycle: z.number(),
    state: z.string(),
    action: z.string(),
    reasoning: z.string(),
  })),
  count: z.number(),
});

export type ThinkingLogResponse = z.infer<typeof ThinkingLogResponseSchema>;

/**
 * 個別の学び
 */
export const LessonEntrySchema = z.object({
  text: z.string(),
  symbol: z.string(),
  tradeId: z.string().optional(),
  addedAt: z.string(),
});

export type LessonEntry = z.infer<typeof LessonEntrySchema>;

/**
 * 確信ルール（繰り返し出現した学び）
 */
export const ConsolidatedLessonSchema = z.object({
  text: z.string(),
  symbol: z.string(),
  count: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  sourceTexts: z.array(z.string()),
});

export type ConsolidatedLessonType = z.infer<typeof ConsolidatedLessonSchema>;

/**
 * シンボル別学習データ
 */
export const SymbolLessonsSchema = z.object({
  entries: z.array(LessonEntrySchema),
  consolidated: z.array(ConsolidatedLessonSchema),
});

/**
 * GET /api/side-b/agent/lessons レスポンス
 */
export const LessonsResponseSchema = z.object({
  lessonsBySymbol: z.record(z.string(), SymbolLessonsSchema),
  totalEntries: z.number(),
  totalConsolidated: z.number(),
  stats: z.object({
    winRate: z.number(),
    totalTrades: z.number(),
    wins: z.number(),
    losses: z.number(),
  }),
});

export type LessonsResponse = z.infer<typeof LessonsResponseSchema>;

// ===========================================
// Phase 4d: 仮説バッチ検証
// ===========================================

/**
 * POST /api/side-b/hypotheses/batch-validate リクエストボディ
 *
 * 仕様: 最大 10 件まで（UI と合わせてサーバー側でも強制）
 */
export const BatchValidateRequestSchema = z.object({
  ids: z
    .array(z.string().uuid('仮説 ID は UUID 形式です'))
    .min(1, '1件以上指定してください')
    .max(10, '一度に検証できるのは最大10件です'),
});

export type BatchValidateRequest = z.infer<typeof BatchValidateRequestSchema>;

// ===========================================
// Phase 7: Bull vs Bear 討論出力スキーマ
// ===========================================

/**
 * 討論の各派（Bull/Bear）出力スキーマ
 *
 * - scenario / confidence / rationale は必須・厳格バリデーション（違反は throw）
 * - keyConditions / risks / timeHorizon はオプション扱いでフォールバックあり
 */
export const DebateSideOutputSchema = z.object({
  scenario: z.string().min(5),
  confidence: z.number().min(0).max(100),
  rationale: z.array(z.string()).min(1),
  keyConditions: z.array(z.string()).catch([]),
  risks: z.array(z.string()).catch([]),
  timeHorizon: z.enum(['short_term', 'medium_term', 'both']).catch('both'),
});

export type DebateSideOutput = z.infer<typeof DebateSideOutputSchema>;

/**
 * 討論のフェーズ分析要素スキーマ
 *
 * preprocess で null/非オブジェクトを空オブジェクトに変換してから内部スキーマを適用する。
 * これにより、AI が phaseAnalysis の要素を null・数値・文字列で出力した場合でも
 * TypeError にならず、各フィールドは catch でデフォルト値にフォールバックする。
 */
export const DebatePhaseAnalysisSchema = z.preprocess(
  (val) => (val !== null && typeof val === 'object' ? val : {}),
  z.object({
    phase: z.string().catch(''),
    direction: z.enum(['long', 'short', 'wait']).catch('wait'),
    condition: z.string().catch(''),
    confidence: z
      .number()
      .transform((v) => Math.max(0, Math.min(100, v)))
      .catch(50),
  }),
);

export type DebatePhaseAnalysis = z.infer<typeof DebatePhaseAnalysisSchema>;

/**
 * 市場コンテキストスキーマ
 *
 * dominantBias は catch で neutral にフォールバック、
 * biasStrength は transform で 0-100 にクランプ。
 */
export const DebateMarketContextSchema = z.object({
  summary: z.string().catch(''),
  dominantBias: z.enum(['bullish', 'bearish', 'neutral']).catch('neutral'),
  biasStrength: z
    .number()
    .transform((v) => Math.max(0, Math.min(100, v)))
    .catch(50),
});

export type DebateMarketContext = z.infer<typeof DebateMarketContextSchema>;

/**
 * 討論統合結果スキーマ
 *
 * phaseAnalysis は catch で空配列にフォールバック。
 * 各確信度は transform でクランプ。
 */
export const DebateSynthesisSchema = z.object({
  preferredDirection: z.enum(['long', 'short', 'neutral']).catch('neutral'),
  preferredConfidence: z
    .number()
    .transform((v) => Math.max(0, Math.min(100, v)))
    .catch(50),
  reasoning: z.string().catch(''),
  phaseAnalysis: z.array(DebatePhaseAnalysisSchema).catch([]),
  consensusPoints: z.array(z.string()).catch([]),
  divergencePoints: z.array(z.string()).catch([]),
  actionableInsight: z.string().catch(''),
});

export type DebateSynthesis = z.infer<typeof DebateSynthesisSchema>;

/**
 * Bull vs Bear 討論出力スキーマ（AI 出力のバリデーション用）
 */
export const BullBearDebateOutputSchema = z.object({
  marketContext: DebateMarketContextSchema,
  bull: DebateSideOutputSchema,
  bear: DebateSideOutputSchema,
  synthesis: DebateSynthesisSchema,
});

export type BullBearDebateOutput = z.infer<typeof BullBearDebateOutputSchema>;

// ========================================
// Cron 操作スキーマ
// ========================================

/**
 * POST /api/cron/side-b/reset-not-testable リクエストボディ
 *
 * not_testable 仮説を unverified に戻す救済操作。
 * statusNotePrefix を指定するとプレフィックスが一致する仮説のみリセット、
 * 省略時は status='not_testable' の全件が対象。
 */
export const ResetNotTestableBodySchema = z.object({
  statusNotePrefix: z.string().min(1).optional(),
});

export type ResetNotTestableBody = z.infer<typeof ResetNotTestableBodySchema>;

// ========================================
// Critical-4 段階 1.6: run-screening のクエリパラメータ
// ========================================

/**
 * YYYY-MM-DD 形式の日付文字列を厳密に検証する。
 *
 * 単純な `new Date(s)` だと "2025-02-30" のような実在しない日付が "2025-03-02" に
 * 正規化されてしまうので、ラウンドトリップで一致確認する。
 */
const StrictDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式である必要があります')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    // ラウンドトリップで「実在する日付」を担保
    return d.toISOString().slice(0, 10) === s;
  }, '存在しない日付です');

/**
 * GET /api/cron/side-b/run-screening のクエリパラメータ。
 *
 * - start / end: BT 期間 (両方ペアまたは両方省略)。省略時は orchestrator のデフォルト
 *   (env SCREENING_PERIOD_DAYS、既定 365 日) で動く。
 * - max: 1 回の実行で処理する上限件数。省略時は config.screeningMaxPerRun。
 */
export const RunScreeningQuerySchema = z
  .object({
    start: StrictDateStringSchema.optional(),
    end: StrictDateStringSchema.optional(),
    max: z.coerce.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    const hasStart = data.start !== undefined;
    const hasEnd = data.end !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasStart ? ['end'] : ['start'],
        message: 'start と end はペアで指定してください (片方だけは無効)',
      });
      return;
    }
    if (data.start && data.end) {
      const s = new Date(`${data.start}T00:00:00Z`).getTime();
      const e = new Date(`${data.end}T00:00:00Z`).getTime();
      if (s >= e) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['end'],
          message: 'start は end より前の日付である必要があります',
        });
      }
    }
  });

// ========================================
// 進化エンジン（Evolution）API スキーマ
// ========================================

/**
 * GET /api/side-b/evolution/lessons クエリ
 */
export const ListGenerationLessonsQuerySchema = z.object({
  regime: z.string().optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
});
export type ListGenerationLessonsQuery = z.infer<typeof ListGenerationLessonsQuerySchema>;

/**
 * GET /api/side-b/evolution/runs クエリ
 */
export const ListEvolutionRunsQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
});
export type ListEvolutionRunsQuery = z.infer<typeof ListEvolutionRunsQuerySchema>;

/**
 * GET /api/side-b/evolution/runs/:runId クエリ
 */
export const GetEvolutionRunQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(1000)).optional(),
});
export type GetEvolutionRunQuery = z.infer<typeof GetEvolutionRunQuerySchema>;


export type RunScreeningQuery = z.infer<typeof RunScreeningQuerySchema>;

// ========================================
// インバウンドメール受信スキーマ
// ========================================

/**
 * POST /api/side-b/mail/receive リクエストボディ
 */
export const InboundMailSchema = z.object({
  from: z.string().email('送信元メールアドレスの形式が正しくありません'),
  subject: z.string().min(1, '件名は必須です'),
  text: z.string().min(1, '本文は必須です'),
});

export type InboundMail = z.infer<typeof InboundMailSchema>;
