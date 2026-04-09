/**
 * トレーディング関連APIのZodスキーマ
 * 
 * エンドポイント:
 * - GET /api/trading/account - 口座情報取得
 * - GET /api/trading/positions - ポジション一覧取得
 * - GET /api/trading/stream - SSEストリーミング
 * - POST /api/trading/orders - 新規注文
 * - PUT /api/trading/orders/:id - 注文変更
 * - DELETE /api/trading/orders/:id - 注文キャンセル
 * - POST /api/trading/positions/:id/close - ポジション決済
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

/**
 * 新規注文リクエスト
 */
export const CreateOrderRequestSchema = z.object({
  symbol: z.string().min(1, 'シンボルは必須です'),
  side: z.enum(['BUY', 'SELL']),
  volume: z.number().positive('ロット数は0より大きい必要があります'),
  takeProfit: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  comment: z.string().max(128).optional(),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

/**
 * 注文変更リクエスト
 */
export const UpdateOrderRequestSchema = z.object({
  takeProfit: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  volume: z.number().positive().optional(),
  comment: z.string().max(128).optional(),
}).refine(
  (value) =>
    value.takeProfit !== undefined ||
    value.stopLoss !== undefined ||
    value.volume !== undefined ||
    value.comment !== undefined,
  {
    message: '更新対象が指定されていません',
  }
);

export type UpdateOrderRequest = z.infer<typeof UpdateOrderRequestSchema>;

/**
 * ポジション決済リクエスト
 */
export const ClosePositionRequestSchema = z.object({
  volume: z.number().positive().optional(),
});

export type ClosePositionRequest = z.infer<typeof ClosePositionRequestSchema>;

/**
 * 注文APIレスポンス
 */
export const TradingOrderResponseSchema = z.object({
  success: z.boolean(),
  action: z.enum(['CREATE', 'UPDATE', 'CANCEL', 'CLOSE']),
  requestId: z.string().optional(),
});

export type TradingOrderResponse = z.infer<typeof TradingOrderResponseSchema>;
