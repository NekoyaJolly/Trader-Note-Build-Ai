/**
 * 類似度計算サービス
 * 
 * 目的:
 * - StrategyNote 間の類似度を計算
 * - インジケーター定義書 Section 12 に基づく重み付け計算
 * - 類似ノート検索機能
 * 
 * 参照: indicators/*.md の Section 12（類似度計算設定）
 */

import { PrismaClient, StrategyNoteStatus } from '@prisma/client';
import {
  IndicatorValues,
  RSIValue,
  MACDValue,
  BBValue,
  SMAValue,
  EMAValue,
} from './strategyNoteService';
import {
  calculateCosineSimilarity,
  SIMILARITY_THRESHOLDS,
} from '../../services/featureVectorService';

const prisma = new PrismaClient();

// ============================================
// 型定義
// ============================================

/**
 * 類似度計算結果
 */
export interface SimilarityResult {
  noteId: string;
  similarity: number;      // 総合類似度（0-1）
  details: {
    indicator: string;
    score: number;
    weight: number;
    weightedScore: number;
  }[];
}

/**
 * 類似ノート検索結果
 */
export interface SimilarNoteSearchResult {
  noteId: string;
  strategyId: string;
  strategyName: string;
  entryTime: Date;
  outcome: string;
  pnl: number | null;
  similarity: number;
  similarityDetails: SimilarityResult['details'];
}

/**
 * 類似検索パラメータ
 */
export interface SimilaritySearchParams {
  targetIndicatorValues: IndicatorValues;
  strategyId?: string;        // 特定のストラテジーに限定
  status?: StrategyNoteStatus; // 状態フィルタ（通常は 'active'）
  threshold?: number;         // 類似度しきい値（デフォルト: 0.7）
  limit?: number;             // 最大件数（デフォルト: 10）
}

// ============================================
// インジケーター定義書に基づく重み設定
// ============================================

/**
 * インジケーターごとの総合重み
 * indicators/*.md の Section 12「総合重み」より
 */
const INDICATOR_WEIGHTS = {
  rsi: 1.0,   // RSI: 主要指標として最高重み
  macd: 0.8,  // MACD: 補助指標
  bb: 0.9,    // BB: ボラティリティ補助
  sma: 1.0,   // SMA: トレンド軸の主要指標
  ema: 0.9,   // EMA: SMA の補助
};

// ============================================
// RSI 類似度計算
// indicators/RSI.md Section 12 より
// ============================================

/**
 * RSI 類似度を計算
 * 比較タイプ: absolute
 * 許容範囲: ±5pt
 */
function calculateRSISimilarity(
  current: RSIValue | undefined,
  reference: RSIValue | undefined
): number {
  if (!current || !reference) return 0;
  
  let score = 0;
  
  // RSI 値の絶対差（50%）
  const valueDiff = Math.abs(current.value - reference.value);
  const valueScore = Math.max(0, 1 - valueDiff / 10);  // 10pt差で0
  score += valueScore * 0.50;
  
  // 方向一致（30%）
  const directionScore = current.direction === reference.direction ? 1 : 0.3;
  score += directionScore * 0.30;
  
  // ゾーン一致（20%）
  const zoneScore = current.zone === reference.zone ? 1 : 0;
  score += zoneScore * 0.20;
  
  return score;
}

// ============================================
// MACD 類似度計算
// indicators/MACD.md Section 12 より
// ============================================

/**
 * MACD 類似度を計算
 * 比較タイプ: directional
 */
function calculateMACDSimilarity(
  current: MACDValue | undefined,
  reference: MACDValue | undefined
): number {
  if (!current || !reference) return 0;
  
  let score = 0;
  
  // ヒストグラム符号一致（30%）
  const signScore = current.histogramSign === reference.histogramSign ? 1 : 0;
  score += signScore * 0.30;
  
  // ヒストグラム傾き一致（25%）
  const slopeScore = current.histogramSlope === reference.histogramSlope ? 1 : 0.3;
  score += slopeScore * 0.25;
  
  // 0ライン位置一致（25%）
  const zeroLineScore = current.zeroLinePosition === reference.zeroLinePosition ? 1 : 0;
  score += zeroLineScore * 0.25;
  
  // MACDライン傾き一致（20%）
  const macdSlopeScore = current.macdSlope === reference.macdSlope ? 1 : 0.3;
  score += macdSlopeScore * 0.20;
  
  return score;
}

// ============================================
// BB 類似度計算
// indicators/BB.md Section 12 より
// ============================================

/**
 * BB ゾーンの類似度を計算
 */
function calculateBBZoneSimilarity(z1: string, z2: string): number {
  const zones = ['lowerStick', 'lowerApproach', 'middle', 'upperApproach', 'upperStick'];
  const idx1 = zones.indexOf(z1);
  const idx2 = zones.indexOf(z2);
  
  if (idx1 === -1 || idx2 === -1) return 0.5;
  
  const diff = Math.abs(idx1 - idx2);
  if (diff === 0) return 1.2;  // 同一ゾーンボーナス
  if (diff === 1) return 1.0;  // 隣接
  return 0.7;                   // 2ゾーン以上離れ
}

/**
 * BB 類似度を計算
 * 比較タイプ: absolute（%B）
 * 許容範囲: ±10
 */
function calculateBBSimilarity(
  current: BBValue | undefined,
  reference: BBValue | undefined
): number {
  if (!current || !reference) return 0;
  
  let score = 0;
  
  // %B 絶対差（50%）
  const percentBDiff = Math.abs(current.percentB - reference.percentB);
  const percentBScore = Math.max(0, 1 - percentBDiff / 20);  // 20pt差で0
  score += percentBScore * 0.50;
  
  // バンド幅傾向一致（30%）
  const trendScore = current.bandWidthTrend === reference.bandWidthTrend ? 1 : 0.3;
  score += trendScore * 0.30;
  
  // ゾーン一致（20%）
  const zoneSimilarity = calculateBBZoneSimilarity(current.zone, reference.zone);
  score += Math.min(1, zoneSimilarity) * 0.20;
  
  return score;
}

// ============================================
// SMA 類似度計算
// indicators/SMA.md Section 12 より
// ============================================

/**
 * 傾き方向の類似度を計算
 */
function calculateSlopeMatch(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1 === 'flat' || s2 === 'flat') return 0.5;
  return 0;  // up ↔ down
}

/**
 * SMA 類似度を計算
 * 比較タイプ: relative
 * 許容範囲: 乖離率 ±1.0%
 */
function calculateSMASimilarity(
  current: SMAValue | undefined,
  reference: SMAValue | undefined
): number {
  if (!current || !reference) return 0;
  
  let score = 0;
  
  // 乖離率の類似度（35%）
  const devDiff = Math.abs(current.deviationRate - reference.deviationRate);
  const devScore = Math.max(0, 1 - devDiff / 2.0);  // 2%差で0
  score += devScore * 0.35;
  
  // 傾き方向一致（35%）
  const slopeScore = calculateSlopeMatch(current.slopeDirection, reference.slopeDirection);
  score += slopeScore * 0.35;
  
  // トレンド強度（20%）
  const strengthDiff = Math.abs(current.trendStrength - reference.trendStrength);
  const strengthScore = Math.max(0, 1 - strengthDiff / 0.4);  // 0.4差で0
  score += strengthScore * 0.20;
  
  // 価格位置一致（10%）
  const positionScore = current.pricePosition === reference.pricePosition ? 1 : 0;
  score += positionScore * 0.10;
  
  return score;
}

// ============================================
// EMA 類似度計算
// indicators/EMA.md Section 12 より
// ============================================

/**
 * EMA 類似度を計算
 * 比較タイプ: relative
 * 許容範囲: 乖離率 ±0.8%
 */
function calculateEMASimilarity(
  current: EMAValue | undefined,
  reference: EMAValue | undefined
): number {
  if (!current || !reference) return 0;
  
  let score = 0;
  
  // 乖離率の類似度（30%）
  const devDiff = Math.abs(current.deviationRate - reference.deviationRate);
  const devScore = Math.max(0, 1 - devDiff / 1.6);  // 1.6%差で0
  score += devScore * 0.30;
  
  // 傾き方向一致（35%）
  const slopeScore = calculateSlopeMatch(current.slopeDirection, reference.slopeDirection);
  score += slopeScore * 0.35;
  
  // EMA vs SMA 位置一致（20%）
  const positionScore = current.emaVsSmaPosition === reference.emaVsSmaPosition ? 1 : 0;
  score += positionScore * 0.20;
  
  // トレンド強度（15%）
  const strengthDiff = Math.abs(current.trendStrength - reference.trendStrength);
  const strengthScore = Math.max(0, 1 - strengthDiff / 0.3);
  score += strengthScore * 0.15;
  
  return score;
}

// ============================================
// 総合類似度計算
// ============================================

/**
 * 2つのインジケーター値セットの類似度を計算
 * 
 * @param current - 比較元のインジケーター値
 * @param reference - 比較先のインジケーター値
 * @returns 類似度計算結果
 */
export function calculateSimilarity(
  current: IndicatorValues,
  reference: IndicatorValues
): SimilarityResult {
  const details: SimilarityResult['details'] = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;
  
  // RSI
  if (current.rsi || reference.rsi) {
    const score = calculateRSISimilarity(current.rsi, reference.rsi);
    const weight = INDICATOR_WEIGHTS.rsi;
    details.push({
      indicator: 'rsi',
      score,
      weight,
      weightedScore: score * weight,
    });
    totalWeightedScore += score * weight;
    totalWeight += weight;
  }
  
  // MACD
  if (current.macd || reference.macd) {
    const score = calculateMACDSimilarity(current.macd, reference.macd);
    const weight = INDICATOR_WEIGHTS.macd;
    details.push({
      indicator: 'macd',
      score,
      weight,
      weightedScore: score * weight,
    });
    totalWeightedScore += score * weight;
    totalWeight += weight;
  }
  
  // BB
  if (current.bb || reference.bb) {
    const score = calculateBBSimilarity(current.bb, reference.bb);
    const weight = INDICATOR_WEIGHTS.bb;
    details.push({
      indicator: 'bb',
      score,
      weight,
      weightedScore: score * weight,
    });
    totalWeightedScore += score * weight;
    totalWeight += weight;
  }
  
  // SMA
  if (current.sma || reference.sma) {
    const score = calculateSMASimilarity(current.sma, reference.sma);
    const weight = INDICATOR_WEIGHTS.sma;
    details.push({
      indicator: 'sma',
      score,
      weight,
      weightedScore: score * weight,
    });
    totalWeightedScore += score * weight;
    totalWeight += weight;
  }
  
  // EMA
  if (current.ema || reference.ema) {
    const score = calculateEMASimilarity(current.ema, reference.ema);
    const weight = INDICATOR_WEIGHTS.ema;
    details.push({
      indicator: 'ema',
      score,
      weight,
      weightedScore: score * weight,
    });
    totalWeightedScore += score * weight;
    totalWeight += weight;
  }
  
  // 総合類似度を計算
  const similarity = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
  
  return {
    noteId: '',  // 呼び出し元で設定
    similarity: Math.min(1, similarity),
    details,
  };
}

// ============================================
// サービス関数
// ============================================

/**
 * 類似ノートを検索
 * 
 * @param params - 検索パラメータ
 * @returns 類似ノートのリスト（類似度降順）
 */
export async function searchSimilarNotes(
  params: SimilaritySearchParams
): Promise<SimilarNoteSearchResult[]> {
  const {
    targetIndicatorValues,
    strategyId,
    status = 'active',
    threshold = 0.7,
    limit = 10,
  } = params;
  
  // フィルタ条件を構築
  const where: {
    status: StrategyNoteStatus;
    strategyId?: string;
  } = { status };
  if (strategyId) where.strategyId = strategyId;
  
  // 対象ノートを取得
  const notes = await prisma.strategyNote.findMany({
    where,
    include: {
      strategy: {
        select: { name: true },
      },
    },
  });
  
  // 類似度を計算
  const results: SimilarNoteSearchResult[] = [];
  
  for (const note of notes) {
    const referenceValues = note.indicatorValues as IndicatorValues;
    const similarityResult = calculateSimilarity(targetIndicatorValues, referenceValues);
    
    // しきい値以上のみ追加
    if (similarityResult.similarity >= threshold) {
      results.push({
        noteId: note.id,
        strategyId: note.strategyId,
        strategyName: note.strategy.name,
        entryTime: note.entryTime,
        outcome: note.outcome,
        pnl: note.pnl ? note.pnl.toNumber() : null,
        similarity: similarityResult.similarity,
        similarityDetails: similarityResult.details,
      });
    }
  }
  
  // 類似度降順でソート
  results.sort((a, b) => b.similarity - a.similarity);
  
  // 件数制限
  return results.slice(0, limit);
}

/**
 * 特徴量ベクトルを使った高速類似検索
 * 
 * 12次元統一ベクトルに対応したコサイン類似度を使用
 * （将来的に pgvector を使う場合のインターフェース）
 * 
 * @param featureVector - 検索対象の特徴量ベクトル
 * @param threshold - 類似度しきい値（デフォルト: 0.70 = WEAK）
 * @param limit - 最大件数
 * @returns 類似ノートIDと距離/類似度のリスト
 */
export async function searchByFeatureVector(
  featureVector: number[],
  threshold: number = SIMILARITY_THRESHOLDS.WEAK,
  limit: number = 10
): Promise<{ noteId: string; distance: number; similarity: number }[]> {
  // 現在はメモリ内でコサイン類似度を計算
  // 将来的に pgvector の <-> 演算子を使用する想定
  
  const notes = await prisma.strategyNote.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      featureVector: true,
    },
  });
  
  const results: { noteId: string; distance: number; similarity: number }[] = [];
  
  for (const note of notes) {
    // 次元が異なる場合はパディングで対応（後方互換用）
    const maxLen = Math.max(featureVector.length, note.featureVector.length);
    const vecA = [...featureVector];
    const vecB = [...note.featureVector];
    while (vecA.length < maxLen) vecA.push(0);
    while (vecB.length < maxLen) vecB.push(0);
    
    // コサイン類似度を計算（featureVectorService の統一実装を使用）
    const similarity = calculateCosineSimilarity(vecA, vecB);
    
    // ユークリッド距離も参考用に計算
    let sumSquares = 0;
    for (let i = 0; i < maxLen; i++) {
      const diff = vecA[i] - vecB[i];
      sumSquares += diff * diff;
    }
    const distance = Math.sqrt(sumSquares);
    
    if (similarity >= threshold) {
      results.push({
        noteId: note.id,
        distance,
        similarity,
      });
    }
  }
  
  // 類似度降順でソート
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}
