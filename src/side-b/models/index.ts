/**
 * Side-B 型定義のエクスポート
 * 
 * すべての型定義・バリデーション関数をここから re-export する。
 * 
 * 設計思想:
 * - Research AI: 数値変換器（12次元特徴量のみ）
 * - Plan AI: 解釈・戦略立案（レジーム、価格レベル、シナリオ）
 */

// 12次元特徴量
export {
  type FeatureVector12D,
  validateFeatureVector,
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
