/**
 * TradeDefinition 型定義
 * 
 * 目的:
 * - Trade + MarketSnapshot + IndicatorSet + ルール派生情報を統合した「特徴量」型
 * - TradeNote 生成の中間データ構造として使用
 * - 一致判定（マッチング）の基準データ
 * 
 * 設計方針:
 * - すべてのフィールドは正規化済み
 * - AI要約生成に必要な情報を網羅
 * - pgvector 用の特徴量ベクトルを含む
 */

import { Trade } from './types';
import { IndicatorConfig, IndicatorId } from './indicatorConfig';

/**
 * 市場データスナップショット
 * 
 * トレード時点の市場状態を記録
 */
export interface MarketSnapshot {
  // スナップショット取得時刻（UTC）
  timestamp: Date;
  // 時間足（例: '15m', '1h', '4h'）
  timeframe: string;
  // OHLCV データ
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 単一インジケーターの計算結果
 * 
 * 設定IDと紐づけて複数期間の同一インジケーターを区別
 */
export interface IndicatorValue {
  // IndicatorConfig.configId と対応
  configId: string;
  // インジケーターID
  indicatorId: IndicatorId;
  // カスタムラベル（UI表示用）
  label: string;
  // 計算結果値（スカラー値の場合）
  value?: number;
  // 複数値を持つ場合（MACD, BB, Stochastic 等）
  values?: Record<string, number | number[]>;
  // 計算成功フラグ（データ不足などで失敗した場合 false）
  calculated: boolean;
  // エラーメッセージ（失敗時）
  error?: string;
}

/**
 * 全インジケーターの計算結果セット
 */
export interface IndicatorSnapshot {
  // 計算に使用した IndicatorConfig のコピー
  configs: IndicatorConfig[];
  // 各インジケーターの計算結果
  results: IndicatorValue[];
  // 計算完了時刻
  calculatedAt: Date;
}

/**
 * トレンド判定結果
 * 
 * 複数のインジケーターから総合的にトレンドを判定
 */
export type TrendDirection = 'uptrend' | 'downtrend' | 'neutral';

/**
 * ルール派生情報
 * 
 * インジケーターから導出される補助的なカテゴリ情報
 */
export interface DerivedContext {
  // 総合トレンド判定
  trend: TrendDirection;
  // トレンド強度（0-100）
  trendStrength: number;
  // ボラティリティ状態
  volatility: 'low' | 'medium' | 'high';
  // 買われ過ぎ/売られ過ぎ
  momentum: 'overbought' | 'oversold' | 'neutral';
  // 出来高状態
  volumeCondition: 'above_average' | 'below_average' | 'average';
}

/**
 * TradeDefinition
 * 
 * トレード + 市場スナップショット + インジケーター + 派生情報の統合型
 * 
 * このデータ構造が:
 * 1. AI 要約生成の入力となる
 * 2. TradeNote に変換される
 * 3. 一致判定の基準データとなる
 */
export interface TradeDefinition {
  // === 基本情報 ===
  // 一意識別子
  id: string;
  // 元のTradeデータ（正規化済み）
  trade: NormalizedTrade;
  
  // === 市場データ ===
  // トレード時点のスナップショット
  marketSnapshot: MarketSnapshot;
  
  // === インジケーター ===
  // 計算されたインジケーター値
  indicatorSnapshot: IndicatorSnapshot;
  
  // === 派生情報 ===
  // ルールベースで導出されたコンテキスト
  derivedContext: DerivedContext;
  
  // === 特徴量ベクトル ===
  // 一致判定（pgvector）用の正規化ベクトル
  featureVector: number[];
  // ベクトルの次元数
  vectorDimension: number;
  
  // === メタデータ ===
  // 生成日時
  createdAt: Date;
  // 生成に使用した設定バージョン
  configVersion: string;
}

/**
 * 正規化されたトレードデータ
 * 
 * CSV インポート時に正規化処理を経た Trade
 */
export interface NormalizedTrade extends Trade {
  // 正規化済みシンボル（例: "BTCUSD" → "BTC/USD"）
  normalizedSymbol: string;
  // 元のシンボル（正規化前）
  originalSymbol: string;
  // タイムゾーン変換情報
  originalTimezone?: string;
  // 正規化フラグ
  normalized: true;
}

/**
 * TradeDefinition 生成リクエスト
 * 
 * パイプラインへの入力パラメータ
 */
export interface TradeDefinitionRequest {
  // インポートされたトレード
  trade: Trade;
  // 使用するインジケーター設定
  indicatorConfigs: IndicatorConfig[];
  // 市場データの時間足
  timeframe: string;
  // 市場データの前後ウィンドウ（分）
  windowMinutes?: number;
}

/**
 * TradeDefinition 生成結果
 */
export interface TradeDefinitionResult {
  // 成功フラグ
  success: boolean;
  // 生成された TradeDefinition（成功時）
  definition?: TradeDefinition;
  // エラーメッセージ（失敗時）
  errors?: string[];
  // 警告メッセージ（部分的な問題）
  warnings?: string[];
}

/**
 * バッチ処理結果
 * 
 * 複数トレードの一括処理結果
 */
export interface BatchDefinitionResult {
  // 処理された件数
  total: number;
  // 成功件数
  succeeded: number;
  // 失敗件数
  failed: number;
  // 各トレードの結果
  results: TradeDefinitionResult[];
  // 処理時間（ミリ秒）
  processingTime: number;
}

/**
 * トレンド強度を計算するためのスコアリング基準
 */
export interface TrendScoreWeights {
  // RSI の重み
  rsi: number;
  // 移動平均との乖離の重み
  maDeviation: number;
  // MACD ヒストグラムの重み
  macdHistogram: number;
  // ストキャスティクスの重み
  stochastic: number;
}

/**
 * デフォルトのトレンドスコア重み
 */
export const DEFAULT_TREND_WEIGHTS: TrendScoreWeights = {
  rsi: 0.25,
  maDeviation: 0.30,
  macdHistogram: 0.25,
  stochastic: 0.20,
};
