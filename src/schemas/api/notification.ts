/**
 * 通知API用 Zodスキーマ定義
 * 
 * notificationRoutes.ts で使用するリクエストバリデーション
 */
import { z } from 'zod';

// ========================================
// 共通スキーマ
// ========================================

/** 通知ID パラメータ */
export const NotificationIdParamSchema = z.object({
  id: z.string().min(1, '通知IDは必須です'),
});

export type NotificationIdParam = z.infer<typeof NotificationIdParamSchema>;

// ========================================
// GET /api/notifications クエリ
// ========================================

/** 通知一覧取得クエリ */
export const GetNotificationsQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
  limit: z.string().regex(/^\d+$/, '数値を指定してください').optional(),
  offset: z.string().regex(/^\d+$/, '数値を指定してください').optional(),
});

export type GetNotificationsQuery = z.infer<typeof GetNotificationsQuerySchema>;

// ========================================
// POST /api/notifications/check
// ========================================

/** 通知チェックリクエスト */
export const CheckNotificationRequestSchema = z.object({
  matchResultId: z.string().uuid('有効なUUIDを指定してください'),
  channel: z.enum(['in_app', 'push', 'webhook']).optional(),
});

export type CheckNotificationRequest = z.infer<typeof CheckNotificationRequestSchema>;

// ========================================
// GET /api/notifications/logs クエリ
// ========================================

/** 通知ログ取得クエリ */
export const GetNotificationLogsQuerySchema = z.object({
  symbol: z.string().optional(),
  noteId: z.string().uuid('有効なUUIDを指定してください').optional(),
  status: z.enum(['sent', 'skipped', 'failed']).optional(),
  limit: z.string().regex(/^\d+$/, '数値を指定してください').optional(),
  offset: z.string().regex(/^\d+$/, '数値を指定してください').optional(),
});

export type GetNotificationLogsQuery = z.infer<typeof GetNotificationLogsQuerySchema>;

// ========================================
// GET/DELETE /api/notifications/logs/:id
// ========================================

/** 通知ログID パラメータ */
export const NotificationLogIdParamSchema = z.object({
  id: z.string().min(1, '通知ログIDは必須です'),
});

export type NotificationLogIdParam = z.infer<typeof NotificationLogIdParamSchema>;
