/**
 * トレーディング関連APIのZodスキーマ
 * 
 * エンドポイント:
 * - GET /api/trading/account - 口座情報取得
 * - GET /api/trading/positions - ポジション一覧取得
 * - GET /api/trading/stream - SSEストリーミング
 */

import { z } from 'zod';

// ========================================
// リクエストスキーマ
// ========================================

// 現時点では特別なリクエストパラメータは不要
// 認証はミドルウェアで処理

// ========================================
// レスポンススキーマ
// ========================================

/**
 * 口座情報レスポンス
 */
export const AccountInfoResponseSchema = z.object({
  accountId: z.string(),
  ctidTraderAccountId: z.number(),
  balance: z.number(),
  equity: z.number(),
  margin: z.number(),
  freeMargin: z.number(),
  marginLevel: z.number(),
  currency: z.string(),
  isLive: z.boolean(),
  leverage: z.number(),
});

export type AccountInfoResponse = z.infer<typeof AccountInfoResponseSchema>;

/**
 * ポジション情報
 */
export const PositionResponseSchema = z.object({
  positionId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  volume: z.number(),
  entryPrice: z.number(),
  currentPrice: z.number(),
  profitLoss: z.number(),
  profitLossPips: z.number(),
  swap: z.number(),
  commission: z.number(),
  takeProfit: z.number().optional(),
  stopLoss: z.number().optional(),
  openTime: z.string(), // ISO 8601文字列
  comment: z.string().optional(),
});

export type PositionResponse = z.infer<typeof PositionResponseSchema>;

/**
 * ポジション一覧レスポンス
 */
export const PositionsResponseSchema = z.array(PositionResponseSchema);

export type PositionsResponse = z.infer<typeof PositionsResponseSchema>;

/**
 * SSEストリーミング更新イベント
 */
export const PositionUpdateEventSchema = z.object({
  type: z.enum(['OPEN', 'MODIFY', 'CLOSE']),
  position: PositionResponseSchema,
  timestamp: z.string(), // ISO 8601文字列
});

export type PositionUpdateEvent = z.infer<typeof PositionUpdateEventSchema>;
