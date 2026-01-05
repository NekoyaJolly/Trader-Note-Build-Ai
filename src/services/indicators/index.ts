/**
 * インジケーターモジュール エクスポート
 * 
 * 目的: インジケーター計算サービスを一元的にエクスポート
 * 
 * Phase 1 対応: 20種類のインジケーターをサポート
 */

export {
  IndicatorService,
  indicatorService,
  // 基本データ型
  type OHLCVData,
  type IndicatorResult,
  // 既存インジケーター結果型（9種）
  type MACDResult,
  type BollingerBandsResult,
  type StochasticResult,
  type ATRResultType,
  // 新規追加インジケーター結果型（11種）
  type AroonResult,
  type KeltnerChannelResult,
  type ParabolicSARResult,
  type IchimokuCloudResult,
  // 特徴量型
  type FeatureSnapshot,
} from './indicatorService';

// 正規化サービス（リアルタイム類似度計算用）
export {
  IndicatorNormalizationService,
  indicatorNormalizationService,
  // 型定義
  type IndicatorCategory,
  type NormalizationConfig,
  type NormalizationInput,
  type NormalizedValue,
  // スキーマ
  IndicatorCategorySchema,
  NormalizationConfigSchema,
  NormalizationInputSchema,
  NormalizedValueSchema,
  // 定数
  INDICATOR_CONFIGS,
  // ユーティリティ
  calculateStatistics,
  calculateZScore,
} from './indicatorNormalizationService';
