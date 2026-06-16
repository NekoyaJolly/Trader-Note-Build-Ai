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

// ========================================
// GET/PUT/DELETE /api/notifications/preferences (Phase β-2a)
// ========================================

/**
 * 通知粒度設定の upsert リクエスト。
 * user / note スコープ (β-2a) に加え、strategy スコープ (Phase γ: 条件アラート粒度) を受け付ける。
 * null は「この項目の設定を消して上位スコープ / システム既定に戻す」を意味する。
 */
export const UpsertNotificationPreferenceSchema = z
  .object({
    scope: z.enum(['user', 'note', 'strategy']),
    noteId: z.string().uuid('有効なUUIDを指定してください').optional(),
    strategyId: z.string().uuid('有効なUUIDを指定してください').optional(),
    threshold: z.number().min(0, '0以上で指定してください').max(1, '1以下で指定してください').nullable().optional(),
    minMatchLevel: z.enum(['strong', 'medium', 'weak']).nullable().optional(),
    weightPreset: z.enum(['indicator_focused', 'balanced', 'state_focused']).nullable().optional(),
    cooldownMinutes: z.number().int().min(1, '1分以上で指定してください').max(10080, '1週間以内で指定してください').nullable().optional(),
    maxPerDay: z.number().int('整数で指定してください').min(1, '1件以上で指定してください').max(1000, '1000件以下で指定してください').nullable().optional(),
  })
  .strict()
  .refine((d) => d.scope !== 'note' || d.noteId !== undefined, {
    message: 'scope=note では noteId が必須です',
    path: ['noteId'],
  })
  .refine((d) => d.scope !== 'strategy' || d.strategyId !== undefined, {
    message: 'scope=strategy では strategyId が必須です',
    path: ['strategyId'],
  })
  .refine((d) => d.scope === 'note' || d.noteId === undefined, {
    message: 'noteId は scope=note のときのみ指定できます',
    path: ['noteId'],
  })
  .refine((d) => d.scope === 'strategy' || d.strategyId === undefined, {
    message: 'strategyId は scope=strategy のときのみ指定できます',
    path: ['strategyId'],
  });

export type UpsertNotificationPreferenceRequest = z.infer<typeof UpsertNotificationPreferenceSchema>;

/** 通知粒度設定の削除パラメータ */
export const NotificationPreferenceIdParamSchema = z.object({
  id: z.string().uuid('有効なUUIDを指定してください'),
});

export type NotificationPreferenceIdParam = z.infer<typeof NotificationPreferenceIdParamSchema>;
