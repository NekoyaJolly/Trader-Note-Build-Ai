/**
 * Prisma JSON フィールド用の型定義
 * 
 * 目的: any 型を排除し、型安全な JSON フィールドを提供
 * 
 * 使用箇所:
 * - TradeNote.indicators
 * - TradeNote.marketContext
 * - MatchResult.reasons
 * - その他 JSON フィールド
 * 
 * 設計方針:
 * - Prisma の InputJsonValue / JsonValue と完全互換
 * - アプリケーション層での型安全性を確保
 * - 境界でのキャスト関数を提供
 */

import { Prisma, NoteStatus, NotificationStatus } from '@prisma/client';
import { MarketContext } from './types';

// === 基本的な JSON 値の型（re-export）===

/**
 * Prisma が受け入れる JSON 入力値
 * DB 書き込み時に使用
 */
export type InputJsonValue = Prisma.InputJsonValue;

/**
 * Prisma が返す JSON 値
 * DB 読み取り時に使用
 */
export type JsonValue = Prisma.JsonValue;

// === インジケーター関連の型 ===

/**
 * インジケーターデータの型（アプリケーション層用）
 * TradeNote.indicators フィールドで使用
 */
export interface IndicatorData {
  rsi?: number | null;
  macd?: number | null;
  volume?: number | null;
  sma?: number | null;
  ema?: number | null;
  [key: string]: number | null | undefined;
}

/**
 * IndicatorData を Prisma 互換 JSON に変換
 * 入力時に使用
 */
export function toIndicatorJson(data: IndicatorData): Prisma.InputJsonValue {
  // undefined を除去し、null と値のみを残す
  const clean: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

// === マッチング関連の型 ===

/**
 * スコア内訳の詳細（アプリケーション層用）
 * 各要素がどの程度スコアに寄与したかを示す
 */
export interface MatchScoreBreakdown {
  cosineSimilarity: number;
  trendBonus: number;
  priceRangeBonus: number;
  totalScore: number;
}

/**
 * 一致理由の詳細（アプリケーション層用）
 * MatchResult.reasons フィールドで使用
 */
export interface MatchReasons {
  // 人間が読める形式の理由リスト
  messages: string[];
  // スコア内訳（Phase 3: 説明責任）
  breakdown?: MatchScoreBreakdown | null;
}

/**
 * MatchReasons を Prisma 互換 JSON に変換
 */
export function toMatchReasonsJson(reasons: MatchReasons): Prisma.InputJsonValue {
  const result: Record<string, unknown> = {
    messages: reasons.messages,
  };
  if (reasons.breakdown !== undefined && reasons.breakdown !== null) {
    result.breakdown = {
      cosineSimilarity: reasons.breakdown.cosineSimilarity,
      trendBonus: reasons.breakdown.trendBonus,
      priceRangeBonus: reasons.breakdown.priceRangeBonus,
      totalScore: reasons.breakdown.totalScore,
    };
  }
  return result as Prisma.InputJsonValue;
}

// === 通知関連の型 ===

/**
 * 通知に含まれるマッチング結果の詳細
 */
export interface NotificationMatchData {
  id: string;
  noteId: string;
  symbol: string;
  score: number;
  threshold: number;
  trendMatched: boolean;
  priceRangeMatched: boolean;
  reasons: MatchReasons;
  note?: NotificationNoteData | null;
}

/**
 * 通知に含まれるノート情報
 */
export interface NotificationNoteData {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number | string;  // Prisma Decimal は string として返ることがある
  aiSummary?: { summary: string } | null;
}

// === 市場コンテキストの型（Prisma JSON 用） ===

/**
 * DB に保存する MarketContext の型（アプリケーション層用）
 * MarketContext と互換だが、JSON 保存用に最適化
 */
export interface StoredMarketContext {
  timeframe: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  indicators?: Record<string, number | null>;
  calculatedIndicators?: Record<string, number | null>;
}

/**
 * MarketContext を Prisma 互換 JSON に変換
 */
export function toMarketContextJson(ctx: MarketContext | StoredMarketContext): Prisma.InputJsonValue {
  const result: Record<string, unknown> = {
    timeframe: ctx.timeframe,
    trend: ctx.trend,
  };
  if (ctx.indicators) {
    const cleanIndicators: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(ctx.indicators)) {
      if (value !== undefined) {
        cleanIndicators[key] = value ?? null;
      }
    }
    result.indicators = cleanIndicators;
  }
  if (ctx.calculatedIndicators) {
    const cleanCalc: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(ctx.calculatedIndicators)) {
      if (value !== undefined) {
        cleanCalc[key] = value ?? null;
      }
    }
    result.calculatedIndicators = cleanCalc;
  }
  return result as Prisma.InputJsonValue;
}

// === 型ガード関数 ===

/**
 * 値が MatchReasons 型かどうかを判定
 */
export function isMatchReasons(value: unknown): value is MatchReasons {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.messages);
}

/**
 * 値が StoredMarketContext 型かどうかを判定
 */
export function isStoredMarketContext(value: unknown): value is StoredMarketContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.timeframe === 'string' && typeof obj.trend === 'string';
}

/**
 * JSON 値を安全に MatchReasons に変換
 */
export function toMatchReasons(value: unknown): MatchReasons {
  if (isMatchReasons(value)) {
    return value;
  }
  // デフォルト値を返す
  return { messages: [] };
}

/**
 * JSON 値を安全に MarketContext に変換
 */
export function toMarketContext(value: unknown): MarketContext {
  if (isStoredMarketContext(value)) {
    return {
      timeframe: value.timeframe,
      trend: value.trend,
      indicators: value.indicators,
      calculatedIndicators: value.calculatedIndicators,
    };
  }
  // デフォルト値を返す
  return {
    timeframe: '15m',
    trend: 'neutral',
  };
}

// === Prisma Where 条件の型定義 (参考用) ===
// 実際には Prisma の生成型を使用することを推奨

/**
 * MatchResult の検索条件（参考用）
 * 実際には Prisma.MatchResultWhereInput を使用
 */
export interface MatchResultWhereInput {
  noteId?: string;
  symbol?: string;
  isMatch?: boolean;
  createdAt?: {
    gte?: Date;
    lte?: Date;
  };
}
