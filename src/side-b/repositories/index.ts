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
