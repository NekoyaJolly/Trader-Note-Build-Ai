/**
 * 統一特徴量ベクトルサービス
 * 
 * 目的:
 * - 12次元特徴量ベクトルの生成を一元化
 * - コサイン類似度計算の統一
 * - TradeNote / StrategyNote 両方で使用可能な共通基盤
 * 
 * 12次元構成:
 * - トレンド系 (0-2): trendDirection, trendStrength, trendAlignment
 * - モメンタム系 (3-4): macdHistogram, macdCrossover
 * - 過熱度系 (5-6): rsiValue, rsiZone
 * - ボラティリティ系 (7-8): bbPosition, bbWidth
 * - ローソク足構造 (9-10): candleBody, candleDirection
 * - 時間軸 (11): sessionFlag
 * 
 * 類似度閾値:
 * - 0.90 以上: 強マッチ（高い信頼度）
 * - 0.80 以上: 中マッチ（参考レベル）
 * - 0.70 以上: 弱マッチ（注意が必要）
 * 
 * @module featureVectorService
 */

// ============================================
// 型定義
// ============================================

/**
 * 12次元特徴量ベクトル配列型
 */
export type FeatureVector12D = [
  number, number, number,  // トレンド系 (0-2)
  number, number,          // モメンタム系 (3-4)
  number, number,          // 過熱度系 (5-6)
  number, number,          // ボラティリティ系 (7-8)
  number, number,          // ローソク足構造 (9-10)
  number                   // 時間軸 (11)
];

/**
 * OHLCV データ型
 */
export interface OHLCV {
  timestamp: Date | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * インジケーター計算済みデータ
 * indicatorService.ts の FeatureSnapshot と互換
 */
export interface IndicatorData {
  // RSI 関連
  rsi?: number;
  rsiDirection?: 'rising' | 'falling' | 'flat';
  rsiZone?: 'overbought' | 'oversold' | 'neutral';
  
  // MACD 関連
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;
  macdCrossover?: 'bullish' | 'bearish' | 'none';
  
  // SMA/EMA 関連
  sma?: number;
  ema?: number;
  smaSlope?: 'up' | 'down' | 'flat';
  emaSlope?: 'up' | 'down' | 'flat';
  priceVsSma?: 'above' | 'below' | 'at';
  priceVsEma?: 'above' | 'below' | 'at';
  
  // ボリンジャーバンド関連
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  bbPosition?: number;      // %B (0-1 範囲、上限超え/下限割れあり)
  bbWidth?: number;         // バンド幅（相対値）
  
  // ATR 関連
  atr?: number;
  atrRelative?: number;     // 価格に対する相対値
  
  // 終値（正規化用）
  close?: number;
}

/**
 * ローソク足パターン情報
 */
export interface CandlePattern {
  bodyRatio: number;        // 実体/全体の比率 (0-1)
  direction: 'bullish' | 'bearish' | 'doji';
  upperWickRatio: number;   // 上ヒゲ/全体 (0-1)
  lowerWickRatio: number;   // 下ヒゲ/全体 (0-1)
}

/**
 * 特徴量生成入力
 */
export interface FeatureGenerationInput {
  ohlcv: OHLCV;
  indicators: IndicatorData;
  timestamp?: Date;
}

/**
 * 類似度計算結果
 */
export interface SimilarityResult {
  /** コサイン類似度 (0-1) */
  similarity: number;
  /** マッチ強度 */
  matchStrength: 'strong' | 'medium' | 'weak' | 'none';
  /** 各次元の寄与度 */
  breakdown: DimensionBreakdown;
}

/**
 * 次元別の寄与度詳細
 */
export interface DimensionBreakdown {
  trend: { value: number; contribution: number };
  momentum: { value: number; contribution: number };
  overbought: { value: number; contribution: number };
  volatility: { value: number; contribution: number };
  candle: { value: number; contribution: number };
  time: { value: number; contribution: number };
}

// ============================================
// 定数
// ============================================

/** 類似度閾値定義 */
export const SIMILARITY_THRESHOLDS = {
  STRONG: 0.90,   // 強マッチ
  MEDIUM: 0.80,   // 中マッチ
  WEAK: 0.70,     // 弱マッチ
} as const;

/** ベクトル次元数 */
export const VECTOR_DIMENSION = 12;

/** 各次元のインデックス定義 */
export const DIMENSION_INDEX = {
  // トレンド系
  TREND_DIRECTION: 0,
  TREND_STRENGTH: 1,
  TREND_ALIGNMENT: 2,
  // モメンタム系
  MACD_HISTOGRAM: 3,
  MACD_CROSSOVER: 4,
  // 過熱度系
  RSI_VALUE: 5,
  RSI_ZONE: 6,
  // ボラティリティ系
  BB_POSITION: 7,
  BB_WIDTH: 8,
  // ローソク足構造
  CANDLE_BODY: 9,
  CANDLE_DIRECTION: 10,
  // 時間軸
  SESSION_FLAG: 11,
} as const;

// ============================================
// 特徴量生成関数
// ============================================

/**
 * 12次元特徴量ベクトルを生成
 * 
 * @param input - 特徴量生成入力
 * @returns 12次元ベクトル
 */
export function generateFeatureVector(input: FeatureGenerationInput): FeatureVector12D {
  const { ohlcv, indicators, timestamp } = input;
  
  // ローソク足パターンを計算
  const candle = calculateCandlePattern(ohlcv);
  
  // 各次元を計算
  const vector: FeatureVector12D = [
    // === トレンド系 (0-2) ===
    calculateTrendDirection(indicators),
    calculateTrendStrength(indicators),
    calculateTrendAlignment(indicators),
    
    // === モメンタム系 (3-4) ===
    calculateMacdHistogram(indicators),
    calculateMacdCrossover(indicators),
    
    // === 過熱度系 (5-6) ===
    calculateRsiValue(indicators),
    calculateRsiZone(indicators),
    
    // === ボラティリティ系 (7-8) ===
    calculateBbPosition(indicators),
    calculateBbWidth(indicators),
    
    // === ローソク足構造 (9-10) ===
    candle.bodyRatio,
    calculateCandleDirectionValue(candle),
    
    // === 時間軸 (11) ===
    calculateSessionFlag(timestamp),
  ];
  
  return vector;
}

/**
 * IndicatorData から直接12次元ベクトルを生成（簡易版）
 * OHLCV がない場合に使用
 * 
 * @param indicators - インジケーターデータ
 * @param timestamp - オプションのタイムスタンプ
 * @returns 12次元ベクトル
 */
export function generateFeatureVectorFromIndicators(
  indicators: IndicatorData,
  timestamp?: Date
): FeatureVector12D {
  // ローソク足データがない場合はデフォルト値を使用
  const defaultCandle: CandlePattern = {
    bodyRatio: 0.5,
    direction: 'doji',
    upperWickRatio: 0.25,
    lowerWickRatio: 0.25,
  };
  
  return [
    calculateTrendDirection(indicators),
    calculateTrendStrength(indicators),
    calculateTrendAlignment(indicators),
    calculateMacdHistogram(indicators),
    calculateMacdCrossover(indicators),
    calculateRsiValue(indicators),
    calculateRsiZone(indicators),
    calculateBbPosition(indicators),
    calculateBbWidth(indicators),
    defaultCandle.bodyRatio,
    calculateCandleDirectionValue(defaultCandle),
    calculateSessionFlag(timestamp),
  ];
}

// ============================================
// 次元別計算関数
// ============================================

/**
 * [0] トレンド方向を計算
 * SMA/EMA 傾きから -1（下降）〜 1（上昇）
 */
function calculateTrendDirection(ind: IndicatorData): number {
  // SMA と EMA の傾きを組み合わせ
  let score = 0;
  let count = 0;
  
  if (ind.smaSlope) {
    score += ind.smaSlope === 'up' ? 1 : ind.smaSlope === 'down' ? -1 : 0;
    count++;
  }
  
  if (ind.emaSlope) {
    score += ind.emaSlope === 'up' ? 1 : ind.emaSlope === 'down' ? -1 : 0;
    count++;
  }
  
  // 価格位置も考慮
  if (ind.priceVsSma) {
    score += ind.priceVsSma === 'above' ? 0.5 : ind.priceVsSma === 'below' ? -0.5 : 0;
    count++;
  }
  
  // -1 〜 1 の範囲に正規化
  return count > 0 ? Math.max(-1, Math.min(1, score / count)) : 0;
}

/**
 * [1] トレンド強度を計算
 * 0（弱い）〜 1（強い）
 */
function calculateTrendStrength(ind: IndicatorData): number {
  // ATR の相対値から推定（ボラティリティと相関）
  if (ind.atrRelative !== undefined) {
    // ATR が大きいほどトレンドが強い傾向
    return Math.min(1, ind.atrRelative * 5);
  }
  
  // SMA/EMA の価格乖離から推定
  if (ind.sma !== undefined && ind.close !== undefined && ind.close > 0) {
    const deviation = Math.abs(ind.close - ind.sma) / ind.close;
    return Math.min(1, deviation * 10);
  }
  
  return 0.5; // デフォルト
}

/**
 * [2] トレンド整合性を計算
 * SMA/EMA/価格の方向一致度 (0〜1)
 */
function calculateTrendAlignment(ind: IndicatorData): number {
  let alignment = 0;
  
  // SMA と EMA の整合性
  if (ind.smaSlope && ind.emaSlope) {
    if (ind.smaSlope === ind.emaSlope) {
      alignment += 0.5;
    } else if (ind.smaSlope === 'flat' || ind.emaSlope === 'flat') {
      alignment += 0.25;
    }
  } else {
    alignment += 0.25; // データ不足時はニュートラル
  }
  
  // 価格位置との整合性
  if (ind.priceVsSma && ind.priceVsEma) {
    if (ind.priceVsSma === ind.priceVsEma) {
      alignment += 0.5;
    } else {
      alignment += 0.25;
    }
  } else {
    alignment += 0.25;
  }
  
  return alignment;
}

/**
 * [3] MACD ヒストグラム値を計算
 * -1（強い下降モメンタム）〜 1（強い上昇モメンタム）
 */
function calculateMacdHistogram(ind: IndicatorData): number {
  if (ind.macdHistogram === undefined) return 0;
  
  // tanh で -1 〜 1 に正規化（スケール調整）
  return Math.tanh(ind.macdHistogram / 50);
}

/**
 * [4] MACD クロスオーバー状態を計算
 * 0（ベアリッシュ）, 0.5（なし）, 1（ブリッシュ）
 */
function calculateMacdCrossover(ind: IndicatorData): number {
  if (ind.macdCrossover === undefined) return 0.5;
  
  switch (ind.macdCrossover) {
    case 'bullish': return 1;
    case 'bearish': return 0;
    case 'none': return 0.5;
    default: return 0.5;
  }
}

/**
 * [5] RSI 値を計算
 * 0〜1 に正規化
 */
function calculateRsiValue(ind: IndicatorData): number {
  if (ind.rsi === undefined) return 0.5;
  
  // 0-100 を 0-1 に正規化
  return Math.max(0, Math.min(1, ind.rsi / 100));
}

/**
 * [6] RSI ゾーンを計算
 * 0（売られすぎ）, 0.5（ニュートラル）, 1（買われすぎ）
 */
function calculateRsiZone(ind: IndicatorData): number {
  if (ind.rsiZone === undefined) {
    // RSI 値から推定
    if (ind.rsi !== undefined) {
      if (ind.rsi >= 70) return 1;
      if (ind.rsi <= 30) return 0;
      return 0.5;
    }
    return 0.5;
  }
  
  switch (ind.rsiZone) {
    case 'overbought': return 1;
    case 'oversold': return 0;
    case 'neutral': return 0.5;
    default: return 0.5;
  }
}

/**
 * [7] BB ポジションを計算
 * 0（下限）〜 1（上限）
 */
function calculateBbPosition(ind: IndicatorData): number {
  if (ind.bbPosition !== undefined) {
    // 既に計算済みの %B を使用
    return Math.max(0, Math.min(1, ind.bbPosition));
  }
  
  // BB 値から計算
  if (ind.bbUpper !== undefined && ind.bbLower !== undefined && ind.close !== undefined) {
    const width = ind.bbUpper - ind.bbLower;
    if (width > 0) {
      const position = (ind.close - ind.bbLower) / width;
      return Math.max(0, Math.min(1, position));
    }
  }
  
  return 0.5;
}

/**
 * [8] BB バンド幅を計算
 * 0（狭い）〜 1（広い）
 */
function calculateBbWidth(ind: IndicatorData): number {
  if (ind.bbWidth !== undefined) {
    // 0-1 に正規化（5% を最大と仮定）
    return Math.min(1, ind.bbWidth / 0.05);
  }
  
  // BB 値から計算
  if (ind.bbUpper !== undefined && ind.bbLower !== undefined && ind.bbMiddle !== undefined && ind.bbMiddle > 0) {
    const width = (ind.bbUpper - ind.bbLower) / ind.bbMiddle;
    return Math.min(1, width / 0.05);
  }
  
  return 0.5;
}

/**
 * ローソク足パターンを計算
 */
function calculateCandlePattern(ohlcv: OHLCV): CandlePattern {
  const { open, high, low, close } = ohlcv;
  const range = high - low;
  
  if (range === 0) {
    return {
      bodyRatio: 0,
      direction: 'doji',
      upperWickRatio: 0,
      lowerWickRatio: 0,
    };
  }
  
  const body = Math.abs(close - open);
  const bodyRatio = body / range;
  
  // 方向判定
  let direction: CandlePattern['direction'];
  if (bodyRatio < 0.1) {
    direction = 'doji';
  } else if (close > open) {
    direction = 'bullish';
  } else {
    direction = 'bearish';
  }
  
  // ヒゲ計算
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  
  return {
    bodyRatio,
    direction,
    upperWickRatio: upperWick / range,
    lowerWickRatio: lowerWick / range,
  };
}

/**
 * [10] ローソク足方向値を計算
 * 0（弱気）, 0.5（同事）, 1（強気）
 */
function calculateCandleDirectionValue(candle: CandlePattern): number {
  switch (candle.direction) {
    case 'bullish': return 1;
    case 'bearish': return 0;
    case 'doji': return 0.5;
    default: return 0.5;
  }
}

/**
 * [11] セッションフラグを計算
 * 東京: 0.2, ロンドン: 0.5, NY: 0.8, クローズ/不明: 0.5
 */
function calculateSessionFlag(timestamp?: Date): number {
  if (!timestamp) return 0.5;
  
  const hour = timestamp.getUTCHours();
  
  // 東京セッション（0:00-9:00 UTC = 9:00-18:00 JST）
  if (hour >= 0 && hour < 9) return 0.2;
  
  // ロンドンセッション（7:00-16:00 UTC）
  if (hour >= 7 && hour < 16) return 0.5;
  
  // NYセッション（13:00-22:00 UTC）
  if (hour >= 13 && hour < 22) return 0.8;
  
  return 0.5;
}

// ============================================
// 類似度計算関数
// ============================================

/**
 * コサイン類似度を計算
 * 
 * @param vecA - ベクトル A
 * @param vecB - ベクトル B
 * @returns 類似度 (-1 〜 1、通常は 0 〜 1)
 */
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  // 次元数が異なる場合は 0 を返す
  if (vecA.length !== vecB.length || vecA.length === 0) {
    console.warn(`ベクトル次元数が一致しません: ${vecA.length} vs ${vecB.length}`);
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }
  
  return dotProduct / denominator;
}

/**
 * 類似度を計算し、詳細結果を返す
 * 
 * @param vecA - ベクトル A（12次元）
 * @param vecB - ベクトル B（12次元）
 * @returns 類似度計算結果
 */
export function calculateSimilarityWithBreakdown(
  vecA: number[],
  vecB: number[]
): SimilarityResult {
  const similarity = calculateCosineSimilarity(vecA, vecB);
  
  // マッチ強度を判定
  let matchStrength: SimilarityResult['matchStrength'];
  if (similarity >= SIMILARITY_THRESHOLDS.STRONG) {
    matchStrength = 'strong';
  } else if (similarity >= SIMILARITY_THRESHOLDS.MEDIUM) {
    matchStrength = 'medium';
  } else if (similarity >= SIMILARITY_THRESHOLDS.WEAK) {
    matchStrength = 'weak';
  } else {
    matchStrength = 'none';
  }
  
  // 次元別寄与度を計算
  const breakdown = calculateDimensionBreakdown(vecA, vecB);
  
  return {
    similarity,
    matchStrength,
    breakdown,
  };
}

/**
 * 次元別の寄与度を計算
 */
function calculateDimensionBreakdown(vecA: number[], vecB: number[]): DimensionBreakdown {
  // 各カテゴリの次元インデックス
  const categories = {
    trend: [0, 1, 2],
    momentum: [3, 4],
    overbought: [5, 6],
    volatility: [7, 8],
    candle: [9, 10],
    time: [11],
  };
  
  const result: DimensionBreakdown = {
    trend: { value: 0, contribution: 0 },
    momentum: { value: 0, contribution: 0 },
    overbought: { value: 0, contribution: 0 },
    volatility: { value: 0, contribution: 0 },
    candle: { value: 0, contribution: 0 },
    time: { value: 0, contribution: 0 },
  };
  
  // 全体の類似度
  const totalSim = calculateCosineSimilarity(vecA, vecB);
  
  // 各カテゴリの部分類似度を計算
  for (const [category, indices] of Object.entries(categories)) {
    const partA = indices.map(i => vecA[i] ?? 0);
    const partB = indices.map(i => vecB[i] ?? 0);
    const partSim = calculateCosineSimilarity(partA, partB);
    
    (result as any)[category] = {
      value: partSim,
      contribution: totalSim > 0 ? (partSim / totalSim) * (indices.length / VECTOR_DIMENSION) : 0,
    };
  }
  
  return result;
}

/**
 * マッチ強度を判定
 * 
 * @param similarity - 類似度 (0-1)
 * @returns マッチ強度
 */
export function getMatchStrength(similarity: number): SimilarityResult['matchStrength'] {
  if (similarity >= SIMILARITY_THRESHOLDS.STRONG) return 'strong';
  if (similarity >= SIMILARITY_THRESHOLDS.MEDIUM) return 'medium';
  if (similarity >= SIMILARITY_THRESHOLDS.WEAK) return 'weak';
  return 'none';
}

// ============================================
// ユーティリティ関数
// ============================================

/**
 * ベクトルが有効な12次元かチェック
 * 
 * @param vector - チェック対象
 * @returns 有効な12次元ベクトルかどうか
 */
export function isValid12DVector(vector: unknown): vector is FeatureVector12D {
  if (!Array.isArray(vector)) return false;
  if (vector.length !== VECTOR_DIMENSION) return false;
  return vector.every(v => typeof v === 'number' && !isNaN(v));
}

/**
 * 旧フォーマットベクトルを12次元に変換
 * 互換性維持のための変換関数
 * 
 * @param oldVector - 旧フォーマット（7次元 or 8次元 or 18次元）
 * @param format - 旧フォーマットタイプ
 * @returns 12次元ベクトル
 */
export function convertLegacyVector(
  oldVector: number[],
  format: '7d' | '8d' | '18d'
): FeatureVector12D {
  // デフォルト値で初期化
  const result: FeatureVector12D = [
    0, 0.5, 0.5,  // トレンド
    0, 0.5,       // モメンタム
    0.5, 0.5,     // 過熱度
    0.5, 0.5,     // ボラティリティ
    0.5, 0.5,     // ローソク足
    0.5,          // 時間軸
  ];
  
  switch (format) {
    case '7d':
      // 旧7次元: [priceChange, volume, rsi, macd, trend, volatility, timeFlag]
      if (oldVector.length >= 7) {
        result[0] = oldVector[4] ?? 0;           // trend → trendDirection
        result[1] = oldVector[5] ?? 0.5;         // volatility → trendStrength（近似）
        result[3] = oldVector[3] ?? 0;           // macd → macdHistogram
        result[5] = oldVector[2] ?? 0.5;         // rsi → rsiValue
        result[7] = oldVector[5] ?? 0.5;         // volatility → bbPosition（近似）
        result[11] = oldVector[6] ?? 0.5;        // timeFlag
      }
      break;
      
    case '8d':
      // 旧8次元: [RSI, SMA位置, EMA位置, MACDヒスト, BB位置, Stoch%K, ATR相対, OBV方向]
      if (oldVector.length >= 8) {
        result[0] = (oldVector[1] + oldVector[2]) / 2 - 1;  // SMA/EMA位置から方向推定
        result[1] = oldVector[6] ?? 0.5;                     // ATR → strength
        result[3] = oldVector[3] ?? 0;                       // MACDヒスト
        result[5] = oldVector[0] ?? 0.5;                     // RSI
        result[7] = oldVector[4] ?? 0.5;                     // BB位置
        result[8] = oldVector[6] ?? 0.5;                     // ATR → bbWidth（近似）
      }
      break;
      
    case '18d':
      // 旧18次元: StrategyNote 形式
      // [0-2] RSI, [3-6] MACD, [7-9] BB, [10-13] SMA, [14-17] EMA
      if (oldVector.length >= 18) {
        result[0] = (oldVector[11] + oldVector[15]) / 2;    // SMA/EMA slope → direction
        result[1] = (oldVector[12] + oldVector[16]) / 2;    // strength
        result[2] = oldVector[13] ?? 0.5;                   // pricePosition → alignment
        result[3] = oldVector[3] ?? 0;                      // histogramSign → histogram
        result[4] = oldVector[4] ?? 0.5;                    // slope → crossover
        result[5] = oldVector[0] ?? 0.5;                    // RSI value
        result[6] = oldVector[2] ?? 0.5;                    // RSI zone
        result[7] = oldVector[7] ?? 0.5;                    // %B
        result[8] = oldVector[8] ?? 0.5;                    // bandWidth
      }
      break;
  }
  
  return result;
}

/**
 * ゼロベクトルを生成（12次元）
 */
export function createZeroVector(): FeatureVector12D {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * デフォルトベクトルを生成（ニュートラル値、12次元）
 */
export function createDefaultVector(): FeatureVector12D {
  return [0, 0.5, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
}
