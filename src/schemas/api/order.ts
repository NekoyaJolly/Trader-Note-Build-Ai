/**
 * 注文API用 Zodスキーマ定義
 * 
 * orderRoutes.ts で使用するリクエストバリデーション
 */
import { z } from 'zod';

// ========================================
// GET /api/orders/preset/:noteId
// ========================================

/** ノートID パラメータ（プリセット生成用） */
export const OrderNoteIdParamSchema = z.object({
  noteId: z.string().uuid('有効なUUIDを指定してください'),
});

export type OrderNoteIdParam = z.infer<typeof OrderNoteIdParamSchema>;

// ========================================
// POST /api/orders/confirmation
// ========================================

/** 注文確認リクエスト */
export const OrderConfirmationRequestSchema = z.object({
  noteId: z.string().uuid('有効なUUIDを指定してください'),
  direction: z.enum(['long', 'short'], { message: 'direction は long または short を指定' }),
  entryPrice: z.number().positive('entryPrice は正の数値を指定'),
  size: z.number().positive('size は正の数値を指定'),
  stopLoss: z.number().positive('stopLoss は正の数値を指定').optional(),
  takeProfit: z.number().positive('takeProfit は正の数値を指定').optional(),
});

export type OrderConfirmationRequest = z.infer<typeof OrderConfirmationRequestSchema>;
