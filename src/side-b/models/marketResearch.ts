/**
 * 市場リサーチ（MarketResearch）型定義
 * 
 * Research AIが生成する中間データ。
 * 
 * 設計思想:
 * Research AI = 「数値変換器」
 * - OHLCVデータを12次元特徴量に変換するだけ
 * - 解釈（トレンド判断、価格レベル判定）はPlan AIに委ねる
 * - gpt-4o-miniの能力範囲内に収める
 */

import { FeatureVector12D, validateFeatureVector } from './featureVector';

// ===========================================
// 型定義（シンプル化）
// ===========================================

/**
 * 市場リサーチ結果
 * 
 * Research AIの出力は12次元特徴量のみ。
 * OHLCVデータはリクエスト時に渡され、Plan AI呼び出し時に再利用される。
 */
export interface MarketResearch {
  id: string;
  symbol: string;
  timeframe: string;
  createdAt: Date;
  expiresAt: Date;

  // 12次元特徴量（Research AIの唯一の出力）
  featureVector: FeatureVector12D;

  // メタ情報
  aiModel: string;
  tokenUsage: number;
  
  // OHLCVスナップショット（Plan AI用にキャッシュ）
  ohlcvSnapshot?: OHLCVSnapshot;
}

/**
 * OHLCVスナップショット（Plan AI用）
 * Research生成時のOHLCVデータを保存
 */
export interface OHLCVSnapshot {
  /** 直近価格 */
  latestPrice: number;
  /** 直近高値（分析期間内） */
  recentHigh: number;
  /** 直近安値（分析期間内） */
  recentLow: number;
  /** データ数 */
  dataPoints: number;
  /** 直近10本の終値 */
  recentCloses: number[];
}

/**
 * リサーチ生成リクエスト
 */
export interface GenerateResearchRequest {
  symbol: string;
  timeframe?: string;
  forceRefresh?: boolean;
}

/**
 * リサーチ生成レスポンス
 */
export interface GenerateResearchResponse {
  success: boolean;
  research: MarketResearch;
  cached: boolean;
}

/**
 * Research AI出力型（AIからのレスポンス）
 * 
 * 注意: 12次元特徴量のみ出力
 * - トレンド解釈、価格レベルはPlan AIに委ねる
 * - gpt-4o-miniに適切なタスク量
 */
export interface ResearchAIOutput {
  featureVector: FeatureVector12D;
}

// ===========================================
// バリデーション
// ===========================================

/**
 * Research AI出力のバリデーション（シンプル化）
 */
export function validateResearchAIOutput(data: unknown): ResearchAIOutput {
  const obj = data as Record<string, unknown>;

  // 特徴量ベクトルの存在チェック
  if (!obj.featureVector) {
    throw new Error('featureVector is required in Research AI output');
  }

  // 特徴量ベクトルのバリデーション
  const featureVector = validateFeatureVector(obj.featureVector);

  return {
    featureVector,
  };
}

// ===========================================
// ユーティリティ関数
// ===========================================

/**
 * リサーチのデフォルト有効期限（4時間）
 */
export const RESEARCH_EXPIRY_HOURS = 4;

/**
 * リサーチが有効期限内かどうかを判定
 */
export function isResearchValid(research: MarketResearch): boolean {
  return new Date() < research.expiresAt;
}

/**
 * 有効期限を計算
 */
export function calculateExpiryDate(hours: number = RESEARCH_EXPIRY_HOURS): Date {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + hours);
  return expiry;
}

// ===========================================
// 削除した型（Plan AIに移動）
// ===========================================
// 以下はPlan AIの責務に移動:
// - MarketRegime (レジーム判定)
// - TrendAnalysis (トレンド解釈)
// - VolatilityAnalysis (ボラティリティ解釈)
// - KeyLevels (価格レベル判定)
// - summary (市場サマリー)
