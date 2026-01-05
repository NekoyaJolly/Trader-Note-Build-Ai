/**
 * Side-B サービスのエクスポート
 */

export {
  ResearchAIService,
  researchAIService,
  type ResearchAIInput,
  type ResearchAIResult,
  type OHLCVData,
  type IndicatorData,
} from './researchAIService';

export {
  PlanAIService,
  planAIService,
  type PlanAIInput,
  type PlanAIResult,
  type UserTradingPreferences,
} from './planAIService';

// Phase B: 仮想トレード
export {
  type CreateTradeResult,
  type MonitoringResult,
  type PortfolioSummary,
  createTradeFromPlan,
  getTrade,
  listTrades,
  closeTradeManually,
  cancelPendingTrade,
  monitorEntryConditions,
  monitorPositions,
  expirePendingTrades,
  refreshPortfolioStats,
  getPortfolioSummary,
} from './virtualTradeService';

// 高安値ベース検証
export {
  verifyEntryCondition,
  verifyExitCondition,
  verifyTradeState,
  sortOHLCVChronological,
  summarizeVerificationResult,
  type MinuteOHLCV,
  type EntryVerificationResult,
  type ExitVerificationResult,
  type TradeVerificationResult,
} from './tradeVerificationService';

// Phase D: 比較分析
export {
  getComparisonAnalysis,
  getTimeSeriesData,
  getComparisonDashboard,
  type ComparisonPeriod,
  type PerformanceStats,
  type ComparisonResult,
  type TimeSeriesData,
  type ComparisonDashboardData,
} from './comparisonService';

// Phase D: サマリー生成スケジューラー
export {
  summarySchedulerService,
  type SchedulerSummaryPeriod,
  type GeneratedSummary,
  type SchedulerConfig,
  type SummarySchedulerStatus,
} from './summarySchedulerService';

// データクリーンアップ
export {
  executeCleanup,
  getStorageStats,
  dataCleanupService,
  type CleanupConfig,
  type CleanupResult,
} from './dataCleanupService';
