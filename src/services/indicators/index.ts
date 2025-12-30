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
