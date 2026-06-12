import type { Request, Response } from 'express';
import { Router } from 'express';
import { NotificationController } from '../controllers/notificationController';
import { validateBody, validateParams, validateQuery, getValidatedParams } from '../../middleware/validateRequest';
import {
  NotificationIdParamSchema,
  GetNotificationsQuerySchema,
  CheckNotificationRequestSchema,
  GetNotificationLogsQuerySchema,
  NotificationLogIdParamSchema,
  UpsertNotificationPreferenceSchema,
  NotificationPreferenceIdParamSchema,
} from '../../schemas/api/notification';
import type { UpsertNotificationPreferenceRequest, NotificationPreferenceIdParam } from '../../schemas/api/notification';
import { NotificationPreferenceService } from '../../services/notification/notificationPreferenceService';

const router = Router();
const notificationController = new NotificationController();
const preferenceService = new NotificationPreferenceService();

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

// ========================================
// 通知粒度設定 (Phase β-2a)
// 注意: /:id より前に定義する必要がある（固定パス優先）
// ========================================

/**
 * GET /api/notifications/preferences
 * 認証ユーザーの通知粒度設定 (全スコープ) を取得
 */
router.get('/preferences', async (req: Request, res: Response) => {
  try {
    const preferences = await preferenceService.listPreferences(req.user!.userId);
    res.json({ success: true, data: { preferences } });
  } catch (error) {
    console.error('[NotificationPreference] 一覧取得エラー:', error);
    res.status(500).json({ success: false, error: '通知設定の取得に失敗しました' });
  }
});

/**
 * PUT /api/notifications/preferences
 * 通知粒度設定を upsert (scope=user / note)。
 * 項目に null を渡すと「上位スコープ / システム既定に戻す」。
 */
router.put(
  '/preferences',
  validateBody(UpsertNotificationPreferenceSchema),
  async (req: Request, res: Response) => {
    try {
      // validateBody はパース済みデータで req.body を置き換える
      const body = req.body as UpsertNotificationPreferenceRequest;
      const preference = await preferenceService.upsertPreference(req.user!.userId, body);
      res.json({ success: true, data: { preference } });
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知設定の保存に失敗しました';
      if (message.includes('見つかりませんでした')) {
        res.status(404).json({ success: false, error: message });
        return;
      }
      console.error('[NotificationPreference] 保存エラー:', error);
      res.status(500).json({ success: false, error: '通知設定の保存に失敗しました' });
    }
  }
);

/**
 * DELETE /api/notifications/preferences/:id
 * 通知粒度設定の行を削除 (所有ユーザーのもののみ)
 */
router.delete(
  '/preferences/:id',
  validateParams(NotificationPreferenceIdParamSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = getValidatedParams<NotificationPreferenceIdParam>(res);
      const deleted = await preferenceService.deletePreference(req.user!.userId, id);
      if (!deleted) {
        res.status(404).json({ success: false, error: '通知設定が見つかりませんでした' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[NotificationPreference] 削除エラー:', error);
      res.status(500).json({ success: false, error: '通知設定の削除に失敗しました' });
    }
  }
);

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
