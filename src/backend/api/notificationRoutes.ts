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
import { dbNotificationRepository } from '../repositories/notificationRepository';
// req.user の型拡張 (declare module 'express'、authMiddleware 内) を単独コンパイル
// (ts-jest) でも適用するための型のみ import (ランタイム import は発生しない)
import type {} from '../../middleware/authMiddleware';

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

// ========================================
// 通知 SSE (Phase δ-3、NOTE_SIMILARITY_FOUNDATION.md §13.3)
// ========================================

/** SSE のサーバ側 DB ポーリング間隔 (ms)。通知の主生成源は 15 分 cron のため 10 秒で十分 */
const NOTIFICATION_STREAM_POLL_MS = 10_000;

/** SSE の keep-alive heartbeat 間隔 (ms)。realtimeRoutes のチャート SSE と同じ 30 秒 */
const NOTIFICATION_STREAM_HEARTBEAT_MS = 30_000;

/**
 * GET /api/notifications/stream
 * ログインユーザー宛の通知をリアルタイム配信する認証付き per-user SSE (Phase δ-3)。
 *
 * 設計判断 (2026-06-13 Neko 決定 + 実装時確定):
 * - 既存チャート SSE (/api/realtime/stream/:symbol) は認証なし・symbol 単位のため
 *   **流用しない** (他ユーザー通知の漏洩防止)。本ルートは requireAuth 配下 (app.ts の
 *   mount で適用) + `req.user.userId` でフィルタし、URL にユーザー ID を含めない
 * - **配信はサーバ側 DB ポーリング (10 秒)**: Cloud Run max-instances=5 の複数インスタンス
 *   構成では in-process EventEmitter は「cron を受けたインスタンス ≠ SSE 接続中のインスタンス」
 *   で届かない。DB をバスにすることでインスタンス間を自然に跨ぐ。
 *   Postgres LISTEN/NOTIFY は本番接続が Supavisor transaction pooler 経由のため使えず、
 *   Supabase Realtime は RLS 未整備 (認証は cTrader JWT) のため per-user 分離が保証できない
 * - イベント: `notification` (新着 1 件ごと) / `unread_count` (接続時 + 新着時) / `heartbeat`
 * - 注意: /:id より前に定義する必要がある（固定パス優先）
 */
/** SSE ハンドラが使う repository の最小契約 (テストで差し替え可能にするための DI) */
export interface NotificationStreamRepo {
  countUnread(userId?: string): Promise<number>;
  findCreatedSince(
    userId: string,
    since: Date,
    sinceId?: string,
    limit?: number
  ): Promise<Array<{ id: string; type: string; title: string; message: string; sentAt: Date; createdAt: Date }>>;
}

/**
 * 通知 SSE ハンドラを生成する (repo を DI 可能にしてユニットテストで実 DB を不要にする)。
 * 挙動の説明は GET /stream の JSDoc を参照。
 */
export function createNotificationStreamHandler(
  repo: NotificationStreamRepo = dbNotificationRepository
) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // nginx 系プロキシのバッファリング無効化 (チャート SSE と同じ)
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (event: string, data: object): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 接続時: 現在の未読数を即時送信 (バッジの初期同期)
    let closed = false;
    // 複合カーソル (createdAt, id): 同一 createdAt の複数行を取りこぼさない (repository の JSDoc 参照)
    let cursor = new Date();
    let cursorId = '';
    try {
      const initialUnread = await repo.countUnread(userId);
      sendEvent('unread_count', { count: initialUnread });
    } catch (error) {
      console.warn('[NotificationStream] 初期未読数の取得に失敗:', error);
    }

    // 新着の差分配信 (カーソル = 最後に配信した通知の createdAt + id)
    const poll = async (): Promise<void> => {
      if (closed) return;
      try {
        const fresh = await repo.findCreatedSince(userId, cursor, cursorId);
        if (fresh.length === 0) return;
        for (const notification of fresh) {
          sendEvent('notification', {
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            sentAt: notification.sentAt.toISOString(),
          });
        }
        const last = fresh[fresh.length - 1];
        cursor = last.createdAt;
        cursorId = last.id;
        const unread = await repo.countUnread(userId);
        sendEvent('unread_count', { count: unread });
      } catch (error) {
        // 一過性の DB エラーで接続を切らない (次回ポーリングで自己回復)
        console.warn('[NotificationStream] ポーリング失敗 (継続):', error);
      }
    };
    const pollTimer = setInterval(() => { void poll(); }, NOTIFICATION_STREAM_POLL_MS);

    const heartbeatTimer = setInterval(() => {
      if (!closed) sendEvent('heartbeat', { timestamp: new Date().toISOString() });
    }, NOTIFICATION_STREAM_HEARTBEAT_MS);

    req.on('close', () => {
      closed = true;
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
      res.end();
    });
  };
}

router.get('/stream', createNotificationStreamHandler());

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
 * 通知粒度設定を upsert (scope=user / note / strategy)。
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

// ========================================
// Phase4 エンドポイント（通知トリガ・ログ）
// 注意: /:id より前に定義する必要がある（固定パス優先）
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

export default router;
