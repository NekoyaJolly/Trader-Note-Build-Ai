/**
 * Side-B AITradeNote 用 NoteEvaluator 実装
 *
 * 目的:
 * - Side-B の勝ちパターンノート（AITradeNote）をマッチング対象にする
 * - AITradePlan の marketAnalysis（定性データ）を条件ベクトルに変換
 * - 現在の市場スナップショットから同構造の条件ベクトルを構築し類似度比較
 *
 * 条件ベクトル（8次元）:
 *  [0] trendDirection    : down=0.0, sideways=0.5, up=1.0
 *  [1] regimeConfidence  : 0.0〜1.0（計画の確信度）
 *  [2] volatility        : low=0.3, medium=0.6, high=1.0
 *  [3] directionBias     : short=0.0, long=1.0
 *  [4] priceVsSupport    : 最寄りサポートからの正規化距離 (0=on support, 1=far)
 *  [5] priceVsResistance : 最寄りレジスタンスからの正規化距離 (0=on resistance, 1=far)
 *  [6] rsiZone           : oversold=0.0, neutral=0.5, overbought=1.0 (or estimated)
 *  [7] bbPosition        : 0.0=lower band, 0.5=middle, 1.0=upper band
 *
 * @see src/domain/noteEvaluator.ts - NoteEvaluator インターフェース
 */

import type {
  NoteEvaluator,
  IndicatorSpec,
  MarketSnapshot,
  EvaluationResult} from '../noteEvaluator';
import {
  cosineSimilarity,
  getSimilarityLevel,
  DEFAULT_TRIGGER_THRESHOLD,
} from '../noteEvaluator';
import type { JsonValue } from '../../utils/jsonValue';

// ============================================================================
// 型定義
// ============================================================================

/**
 * Side-B マーケット分析データ（AITradePlan.marketAnalysis の構造）
 */
export interface SideBMarketAnalysis {
  regime: string;
  volatility: string;
  trendDirection: string;
  regimeConfidence: number;  // 0-100
  keyLevels: {
    support: number[];
    resistance: number[];
    strongSupport?: number[];
    strongResistance?: number[];
  };
  summary?: string;
  additionalInsights?: string[];
}

/**
 * Side-B ノートのマッチング用メタデータ
 */
export interface SideBNoteMatchingData {
  /** AITradeNote ID */
  noteId: string;
  /** シンボル */
  symbol: string;
  /** 方向 (long/short) */
  direction: 'long' | 'short';
  /** 結果 */
  outcome: 'win' | 'loss' | 'breakeven';
  /** pips 損益 */
  pnlPips: number;
  /** 実現 RR */
  rrActual: number;
  /** エントリー価格（VirtualTrade.actualEntry） */
  entryPrice: number;
  /** マーケット分析（AITradePlan.marketAnalysis） */
  marketAnalysis: SideBMarketAnalysis;
  /** エントリー分析（AITradeNote.entryAnalysis） */
  entryAnalysis?: Record<string, JsonValue | undefined>;
  /** 時間足（ある場合） */
  timeframe?: string;
}

/** 条件ベクトルの次元数 */
const CONDITION_VECTOR_DIM = 8;

// ============================================================================
// SideBNoteEvaluator 実装
// ============================================================================

export class SideBNoteEvaluator implements NoteEvaluator {
  readonly noteId: string;
  readonly symbol: string;

  private readonly data: SideBNoteMatchingData;
  private readonly storedVector: number[];
  private readonly threshold: number;

  constructor(data: SideBNoteMatchingData, threshold = DEFAULT_TRIGGER_THRESHOLD) {
    this.noteId = data.noteId;
    this.symbol = data.symbol;
    this.data = data;
    this.threshold = threshold;

    // ノート保存時の条件ベクトルを事前計算
    this.storedVector = this.buildConditionVectorFromAnalysis(data);
  }

  // ============================================================================
  // NoteEvaluator インターフェース実装
  // ============================================================================

  requiredIndicators(): IndicatorSpec[] {
    return [
      { indicatorId: 'rsi', params: { period: 14 }, required: true },
      { indicatorId: 'bb', params: { period: 20 }, required: true },
      { indicatorId: 'sma', params: { period: 20 }, required: false },
      { indicatorId: 'sma', params: { period: 50 }, required: false },
      { indicatorId: 'atr', params: { period: 14 }, required: false },
    ];
  }

  buildFeatureVector(snapshot: MarketSnapshot): number[] {
    return this.buildConditionVectorFromSnapshot(snapshot);
  }

  similarity(vectorA: number[], vectorB: number[]): number {
    return cosineSimilarity(vectorA, vectorB);
  }

  isTriggered(similarity: number): boolean {
    return similarity >= this.threshold;
  }

  getThresholds(): { strong: number; medium: number; weak: number } {
    return {
      strong: 0.92,
      medium: 0.85,
      weak: this.threshold,
    };
  }

  evaluate(snapshot: MarketSnapshot, noteVector?: number[]): EvaluationResult {
    const stored = noteVector ?? this.storedVector;
    const current = this.buildFeatureVector(snapshot);
    const sim = this.similarity(stored, current);
    const thresholds = this.getThresholds();

    return {
      noteId: this.noteId,
      similarity: sim,
      level: getSimilarityLevel(sim, thresholds),
      triggered: this.isTriggered(sim),
      vectorDimension: CONDITION_VECTOR_DIM,
      usedIndicators: ['regime', 'volatility', 'trend', 'keyLevels', 'RSI', 'BB'],
      evaluatedAt: new Date(),
      diagnostics: {
        noteVector: stored,
        marketVector: current,
      },
    };
  }

  // ============================================================================
  // 条件ベクトル構築
  // ============================================================================

  /**
   * Side-B ノートの marketAnalysis から条件ベクトルを構築
   */
  private buildConditionVectorFromAnalysis(data: SideBNoteMatchingData): number[] {
    const ma = data.marketAnalysis;

    // [0] trendDirection
    const trend = encodeTrendDirection(ma.trendDirection);

    // [1] regimeConfidence (0-100 → 0-1)
    const confidence = Math.min(Math.max((ma.regimeConfidence || 50) / 100, 0), 1);

    // [2] volatility
    const vol = encodeVolatility(ma.volatility);

    // [3] directionBias
    const direction = data.direction === 'long' ? 1.0 : 0.0;

    // [4] priceVsSupport - エントリー価格と最寄りサポートの距離
    const nearestSupport = findNearestLevel(data.entryPrice, ma.keyLevels.support);
    const priceVsSupport = nearestSupport !== null
      ? normalizeDistance(data.entryPrice, nearestSupport)
      : 0.5;

    // [5] priceVsResistance - エントリー価格と最寄りレジスタンスの距離
    const nearestResistance = findNearestLevel(data.entryPrice, ma.keyLevels.resistance);
    const priceVsResistance = nearestResistance !== null
      ? normalizeDistance(data.entryPrice, nearestResistance)
      : 0.5;

    // [6] rsiZone - エントリー分析から推定 (データがない場合は neutral)
    const rsiZone = 0.5; // Side-B ノートには RSI 生値がないため中立

    // [7] bbPosition - エントリー分析から推定
    const bbPosition = estimateBBPositionFromAnalysis(data);

    return [trend, confidence, vol, direction, priceVsSupport, priceVsResistance, rsiZone, bbPosition];
  }

  /**
   * 現在の市場スナップショットから条件ベクトルを構築
   */
  private buildConditionVectorFromSnapshot(snapshot: MarketSnapshot): number[] {
    const ind = snapshot.indicators;
    const close = snapshot.ohlcv.close;

    // [0] trendDirection - SMA20 vs SMA50 で推定
    const sma20 = ind['SMA(20)'] ?? ind['sma'] ?? null;
    const sma50 = ind['SMA(50)'] ?? null;
    let trend = 0.5; // sideways default
    if (sma20 != null && sma50 != null) {
      const diff = (sma20 - sma50) / sma50;
      if (diff > 0.002) trend = 1.0;       // up
      else if (diff < -0.002) trend = 0.0;  // down
      else trend = 0.5;                      // sideways
    } else if (sma20 != null) {
      // SMA20 vs close で簡易判定
      trend = close > sma20 ? 0.75 : 0.25;
    }

    // [1] regimeConfidence - ATR ベースのボラティリティ安定度を代用
    const atr = ind['ATR(14)'] ?? ind['atr'] ?? null;
    let confidence = 0.7; // default
    if (atr != null && close > 0) {
      const atrPct = atr / close;
      // ATR が低い = レジーム安定 = 高確信
      confidence = Math.max(0.3, Math.min(1.0, 1.0 - atrPct * 20));
    }

    // [2] volatility - BB width で推定
    const bbUpper = ind['BB_upper'] ?? ind['bbUpper'] ?? null;
    const bbLower = ind['BB_lower'] ?? ind['bbLower'] ?? null;
    let vol = 0.6; // medium default
    if (bbUpper != null && bbLower != null && close > 0) {
      const bbWidth = (bbUpper - bbLower) / close;
      if (bbWidth < 0.02) vol = 0.3;       // low
      else if (bbWidth > 0.05) vol = 1.0;  // high
      else vol = 0.6;                        // medium
    }

    // [3] directionBias - RSI + トレンドから推定
    const rsi = ind['RSI(14)'] ?? ind['rsi'] ?? null;
    let direction = 0.5; // neutral
    if (rsi != null) {
      if (rsi > 60 && trend > 0.5) direction = 1.0;       // long bias
      else if (rsi < 40 && trend < 0.5) direction = 0.0;  // short bias
      else if (rsi > 50) direction = 0.7;
      else direction = 0.3;
    }

    // [4] priceVsSupport - BB lower からの距離で近似
    let priceVsSupport = 0.5;
    if (bbLower != null && close > 0) {
      priceVsSupport = normalizeDistance(close, bbLower);
    }

    // [5] priceVsResistance - BB upper からの距離で近似
    let priceVsResistance = 0.5;
    if (bbUpper != null && close > 0) {
      priceVsResistance = normalizeDistance(close, bbUpper);
    }

    // [6] rsiZone
    let rsiZone = 0.5;
    if (rsi != null) {
      rsiZone = Math.min(Math.max(rsi / 100, 0), 1);
    }

    // [7] bbPosition
    let bbPosition = 0.5;
    if (bbUpper != null && bbLower != null && bbUpper !== bbLower) {
      bbPosition = Math.min(Math.max((close - bbLower) / (bbUpper - bbLower), 0), 1);
    }

    return [trend, confidence, vol, direction, priceVsSupport, priceVsResistance, rsiZone, bbPosition];
  }
}

// ============================================================================
// ユーティリティ関数
// ============================================================================

function encodeTrendDirection(trend: string): number {
  switch (trend.toLowerCase()) {
    case 'up': case 'uptrend': case 'bullish': return 1.0;
    case 'down': case 'downtrend': case 'bearish': return 0.0;
    case 'sideways': case 'range': case 'neutral': default: return 0.5;
  }
}

function encodeVolatility(vol: string): number {
  switch (vol.toLowerCase()) {
    case 'high': return 1.0;
    case 'medium': return 0.6;
    case 'low': default: return 0.3;
  }
}

/**
 * 配列から最寄りの価格レベルを見つける
 */
function findNearestLevel(price: number, levels: number[]): number | null {
  if (!levels || levels.length === 0) return null;
  let nearest = levels[0];
  let minDist = Math.abs(price - nearest);
  for (let i = 1; i < levels.length; i++) {
    const dist = Math.abs(price - levels[i]);
    if (dist < minDist) {
      minDist = dist;
      nearest = levels[i];
    }
  }
  return nearest;
}

/**
 * 価格とレベル間の距離を 0-1 に正規化
 * 0 = レベル上、1 = 遠い（価格の2%以上離れている）
 */
function normalizeDistance(price: number, level: number): number {
  if (price === 0) return 0.5;
  const pctDist = Math.abs(price - level) / price;
  return Math.min(pctDist / 0.02, 1.0); // 2% = 1.0
}

/**
 * エントリー分析からBBポジションを推定
 */
function estimateBBPositionFromAnalysis(data: SideBNoteMatchingData): number {
  // long でレンジ下限近く → BB lower (0.2)
  // short でレンジ上限近く → BB upper (0.8)
  const regime = data.marketAnalysis.regime;
  if (regime === 'range') {
    return data.direction === 'long' ? 0.3 : 0.7;
  }
  // トレンド時はトレンド方向に寄せる
  if (data.direction === 'long') return 0.6;
  return 0.4;
}
