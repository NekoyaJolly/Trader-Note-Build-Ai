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
