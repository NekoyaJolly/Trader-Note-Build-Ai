/**
 * Side-B リポジトリのエクスポート
 */

export {
  ResearchRepository,
  researchRepository,
  type CreateResearchInput,
  type FindResearchOptions,
  type MarketResearchWithTypes,
} from './researchRepository';

// Phase A 新設: ResearchOutput リポジトリ (researchAIService の永続化先)
export {
  ResearchOutputRepository,
  researchOutputRepository,
  type CreateResearchOutputInput,
  type FindResearchOutputOptions,
  type ResearchOutputWithTypes,
  type ResearchContextSnapshot,
} from './researchOutputRepository';

export {
  PlanRepository,
  planRepository,
  type CreatePlanInput,
  type FindPlanOptions,
  type AITradePlanWithTypes,
  type AITradePlanWithResearch,
} from './planRepository';

// Phase B: 仮想トレード
export {
  type VirtualTradeRecord,
  type FindVirtualTradesOptions,
  createVirtualTrade,
  findVirtualTradeById,
  findVirtualTrades,
  findActiveTrades,
  findOpenTrades,
  findPendingTrades,
  updateTradeToOpen,
  closeTrade,
  expireTrade,
  cancelTrade,
  invalidateTrade,
  updateStopLossTakeProfit,
  findClosedTradesPnL,
  countOpenTrades,
  deleteVirtualTrade,
} from './virtualTradeRepository';

// Phase B: ポートフォリオ
export {
  type PortfolioRecord,
  createPortfolio,
  findPortfolioById,
  getOrCreateDefaultPortfolio,
  findAllPortfolios,
  updatePortfolioSettings,
  updatePortfolioBalance,
  updatePortfolioStats,
  deletePortfolio,
} from './portfolioRepository';

// 本番耐用化: SystemState
export {
  type SystemStateKey,
  type SystemStateRepository,
  createSystemStateRepository,
} from './systemStateRepository';

