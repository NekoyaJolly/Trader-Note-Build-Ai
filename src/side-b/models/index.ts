/**
 * Side-B 型定義のエクスポート
 * 
 * すべての型定義・バリデーション関数をここから re-export する。
 * 
 * 設計思想:
 * - Market Analyst AI: 市場を「読む」— リッチ分析+推論テキスト
 * - Strategy Thinker AI: 戦略を「考える」— 条件付きエントリー戦略
 * - PDCA循環ループで自律的にトレード
 */

// 市場分析（新: リッチ分析）
export {
  type MarketAnalysis,
  type MarketRegimeType,
  type KeyLevel,
  type MarketReasoning,
  validateMarketAnalysis,
  safeValidateMarketAnalysis,
  regimeToJapaneseV2,
  summarizeMarketAnalysis,
  analysisToLegacyFeatureVector,
} from './marketAnalysis';

// 12次元特徴量（レガシー互換）
export {
  type FeatureVector12D,
  validateFeatureVector,
  safeValidateFeatureVector,
  featureVectorToArray,
  calculateCosineSimilarity,
  createEmptyFeatureVector,
  summarizeFeatureVector,
} from './featureVector';

// 市場リサーチ（シンプル化: 12次元特徴量のみ）
export {
  type MarketResearch,
  type OHLCVSnapshot,
  type GenerateResearchRequest,
  type GenerateResearchResponse,
  type ResearchAIOutput,
  validateResearchAIOutput,
  RESEARCH_EXPIRY_HOURS,
  isResearchValid,
  calculateExpiryDate,
} from './marketResearch';

// トレードプラン（解釈の責務を含む）
export {
  // Plan AIが判定する型
  type MarketRegime,
  type KeyLevels,
  // シナリオ関連
  type EntryCondition,
  type StopLoss,
  type TakeProfit,
  type ScenarioPriority,
  type AITradeScenario,
  type PlanMarketAnalysis,
  type AITradePlan,
  type GeneratePlanRequest,
  type GeneratePlanResponse,
  type PlanAIOutput,
  validatePlanAIOutput,
  getPrimaryScenario,
  calculateRiskAmount,
  confidenceToJapanese,
  priorityToJapanese,
  directionToJapanese,
  directionToEmoji,
  regimeToJapanese,
  regimeToEmoji,
} from './tradePlan';

// 仮想トレード（Phase B）
export {
  type VirtualTradeStatus,
  type ExitReason,
  type TradeDirection,
  type VirtualTradeEntry,
  type VirtualTradeExit,
  type VirtualTradePnL,
  type VirtualTrade,
  type CreateVirtualTradeInput,
  type CloseVirtualTradeInput,
  type UpdateVirtualTradeInput,
  checkExitCondition,
  checkEntryCondition,
  calculatePnL,
  isActiveTrade,
  isClosedTrade,
} from './virtualTrade';

// 仮想ポートフォリオ（Phase B）
export {
  type PortfolioStats,
  type PortfolioSettings,
  type VirtualPortfolio,
  type UpdatePortfolioSettings,
  type CreatePortfolioInput,
  DEFAULT_PORTFOLIO_STATS,
  DEFAULT_PORTFOLIO_SETTINGS,
  calculateStats,
  canOpenNewTrade,
  calculateRiskAmount as calculatePortfolioRiskAmount,
} from './virtualPortfolio';

// エッジ仮説（Phase 4a + 4b）
export {
  type EdgeCategory,
  type EdgeStatus,
  type EdgeSource,
  type ConditionOp,
  type MachineReadableCondition,
  type BacktestSummary,
  type WalkForwardSummary,
  type EdgeHypothesis,
  type CreateEdgeHypothesisInput,
  // Phase 4b
  type StopLossSpec,
  type TakeProfitSpec,
  type DefaultRiskManagement,
  DEFAULT_RISK_MANAGEMENT,
  EDGE_CATEGORIES,
  EDGE_STATUSES,
  EDGE_SOURCES,
  isEdgeCategory,
  isEdgeStatus,
  isEdgeSource,
  isConditionOp,
  validateCondition,
} from './edgeHypothesis';

// AIトレードノート（Phase C）
export {
  // 列挙型
  type TradeOutcome,
  type TimingEvaluation,
  type ExitTimingEvaluation,
  type AccuracyEvaluation,
  type ExitType,
  type SummaryPeriod,
  // サブ型
  type TradeResult,
  type EntryAnalysis,
  type ExitAnalysis,
  type PlanEvaluation,
  type MarketReview,
  type Learnings,
  type SimilarPattern,
  // メイン型
  type AITradeNote,
  type CreateAITradeNoteInput,
  // サマリー型
  type RegimePerformance,
  type TimeOfDayPerformance,
  type SummaryStatistics,
  type SummaryAnalysis,
  type SummarySummary,
  type AINoteSummary,
  type CreateAINoteSummaryInput,
  // ユーティリティ
  outcomeToJapanese,
  timingToJapanese,
  exitTimingToJapanese,
  accuracyToJapanese,
  exitTypeToJapanese,
  periodToJapanese,
  determineOutcome,
  calculateHoldingDuration,
  calculateActualRR,
  createDefaultLearnings,
  createDefaultStatistics,
  calculateStatisticsFromNotes,
  calculateNoteSimilarity,
} from './aiTradeNote';
