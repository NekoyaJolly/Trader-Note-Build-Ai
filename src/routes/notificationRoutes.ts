import { Router } from 'express';
import { NotificationController } from '../controllers/notificationController';
import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest';
import {
  NotificationIdParamSchema,
  GetNotificationsQuerySchema,
  CheckNotificationRequestSchema,
  GetNotificationLogsQuerySchema,
  NotificationLogIdParamSchema,
} from '../schemas/api/notification';

const router = Router();
const notificationController = new NotificationController();

// ========================================
// 既存エンドポイント（Phase0-Phase3）
// ========================================

/**
 * GET /api/notifications
 * すべての通知を取得（オプション: unreadOnly=true で未読のみ）
 */
router.get(
  '/',
  validateQuery(GetNotificationsQuerySchema),
  notificationController.getNotifications
);

/**
 * GET /api/notifications/unread-count
 * 未読通知数を取得
 * 注意: /:id より前に定義する必要がある（固定パス優先）
 */
router.get('/unread-count', notificationController.getUnreadCount);

/**
 * PUT /api/notifications/read-all
 * すべての通知を既読にマーク
 * 注意: /:id より前に定義する必要がある（固定パス優先）
 */
router.put('/read-all', notificationController.markAllAsRead);

/**
 * GET /api/notifications/:id
 * 通知の詳細を取得
 */
router.get(
  '/:id',
  validateParams(NotificationIdParamSchema),
  notificationController.getNotificationById
);

/**
 * PUT /api/notifications/:id/read
 * 通知を既読にマーク
 */
router.put(
  '/:id/read',
  validateParams(NotificationIdParamSchema),
  notificationController.markAsRead
);

/**
 * DELETE /api/notifications/:id
 * 通知を削除
 */
router.delete(
  '/:id',
  validateParams(NotificationIdParamSchema),
  notificationController.deleteNotification
);

/**
 * DELETE /api/notifications
 * すべての通知をクリア
 */
router.delete('/', notificationController.clearAll);

// ========================================
// Phase4 新規エンドポイント（通知トリガ・ログ）
// ========================================

/**
 * POST /api/notifications/check
 * MatchResult をもとに通知を評価・配信
 * 
 * リクエストボディ:
 * {
 *   "matchResultId": "uuid",
 *   "channel": "in_app" | "push" | "webhook"  // オプション
 * }
 */
router.post(
  '/check',
  validateBody(CheckNotificationRequestSchema),
  notificationController.checkAndNotify
);

/**
 * GET /api/notifications/logs
 * 通知ログを取得
 * 
 * クエリパラメータ:
 * - symbol?: string
 * - noteId?: string
 * - status?: 'sent' | 'skipped' | 'failed'
 * - limit?: number
 */
router.get(
  '/logs',
  validateQuery(GetNotificationLogsQuerySchema),
  notificationController.getNotificationLogs
);

/**
 * GET /api/notifications/logs/:id
 * 通知ログを ID で取得
 */
router.get(
  '/logs/:id',
  validateParams(NotificationLogIdParamSchema),
  notificationController.getNotificationLogById
);

/**
 * DELETE /api/notifications/logs/:id
 * 通知ログを削除
 */
router.delete(
  '/logs/:id',
  validateParams(NotificationLogIdParamSchema),
  notificationController.deleteNotificationLog
);

export default router;
