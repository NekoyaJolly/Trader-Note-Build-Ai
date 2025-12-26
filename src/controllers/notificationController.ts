import { Request, Response } from 'express';
import { NotificationService } from '../services/notificationService';
import { NotificationTriggerService } from '../services/notification/notificationTriggerService';
import { NotificationLogRepository } from '../backend/repositories/notificationLogRepository';

/**
 * NotificationController
 * 
 * 責務:
 * 1. 既存の Notification API（読み取り/削除）を維持
 * 2. Phase4 で追加された通知トリガ・ログ API
 * 3. 通知の配信判定と記録
 */
export class NotificationController {
  private notificationService: NotificationService;
  private notificationTriggerService: NotificationTriggerService;
  private notificationLogRepository: NotificationLogRepository;

  constructor() {
    this.notificationService = new NotificationService();
    this.notificationTriggerService = new NotificationTriggerService();
    this.notificationLogRepository = new NotificationLogRepository();
  }

  /**
   * 既存エンドポイント: すべての通知を取得
   */
  getNotifications = async (req: Request, res: Response): Promise<void> => {
    try {
      const unreadOnly = req.query.unreadOnly === 'true';
      const notifications = this.notificationService.getNotifications(unreadOnly);

      res.json({ notifications });
    } catch (error) {
      console.error('Error getting notifications:', error);
      res.status(500).json({ error: 'Failed to retrieve notifications' });
    }
  };

  /**
   * 既存エンドポイント: 通知を既読にマーク
   */
  markAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      await this.notificationService.markAsRead(id);

      res.json({ success: true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  };

  /**
   * 既存エンドポイント: すべての通知を既読にマーク
   */
  markAllAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.notificationService.markAllAsRead();
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking all as read:', error);
      res.status(500).json({ error: 'Failed to mark all as read' });
    }
  };

  /**
   * 既存エンドポイント: 通知を削除
   */
  deleteNotification = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      await this.notificationService.deleteNotification(id);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ error: 'Failed to delete notification' });
    }
  };

  /**
   * 既存エンドポイント: すべての通知をクリア
   */
  clearAll = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.notificationService.clearAll();
      res.json({ success: true });
    } catch (error) {
      console.error('Error clearing notifications:', error);
      res.status(500).json({ error: 'Failed to clear notifications' });
    }
  };

  // ========================================
  // Phase4 新規エンドポイント
  // ========================================

  /**
   * POST /api/notifications/check
   * 
   * 目的: 通知トリガを手動でチェック・評価し、通知を配信する
   * リクエストボディ:
   * {
   *   "matchResultId": "uuid",
   *   "channel": "in_app" | "push" | "webhook"  // オプション、デフォルト: in_app
   * }
   * 
   * レスポンス:
   * {
   *   "shouldNotify": boolean,
   *   "status": "sent" | "skipped" | "failed",
   *   "skipReason"?: string,
   *   "notificationLogId"?: string,
   *   "inAppNotificationId"?: string
   * }
   */
  checkAndNotify = async (req: Request, res: Response): Promise<void> => {
    try {
      const { matchResultId, channel } = req.body;

      if (!matchResultId) {
        res.status(400).json({ error: 'matchResultId is required' });
        return;
      }

      const notificationChannel = channel || 'in_app';
      if (!['in_app', 'push', 'webhook'].includes(notificationChannel)) {
        res.status(400).json({
          error: 'channel must be one of: in_app, push, webhook',
        });
        return;
      }

      // MatchResult をデータベースから取得（リレーション含む）
      const { prisma } = await import('../backend/db/client');
      const matchResult = await prisma.matchResult.findUnique({
        where: { id: matchResultId },
        include: {
          note: true,
          marketSnapshot: true,
        },
      });

      if (!matchResult) {
        res.status(404).json({ error: 'MatchResult not found' });
        return;
      }

      // 通知を評価・配信
      const triggerResult = await this.notificationTriggerService.evaluateAndNotify(
        matchResult as any,
        notificationChannel
      );

      res.json(triggerResult);
    } catch (error) {
      console.error('Error checking and notifying:', error);
      res.status(500).json({
        error: 'Failed to check and notify',
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  };

  /**
   * GET /api/notifications/logs
   * 
   * 目的: 通知ログを取得
   * クエリパラメータ:
   * - symbol?: string （シンボルでフィルタ）
   * - noteId?: string （ノート ID でフィルタ）
   * - status?: 'sent' | 'skipped' | 'failed' （ステータスでフィルタ）
   * - limit?: number （デフォルト: 50）
   * 
   * レスポンス: NotificationLog[]
   */
  getNotificationLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, noteId, status, limit } = req.query;
      const limitNum = parseInt(limit as string) || 50;

      let logs;

      if (symbol) {
        logs = await this.notificationLogRepository.getLogsBySymbol(symbol as string, limitNum);
      } else if (noteId) {
        logs = await this.notificationLogRepository.getLogsByNoteId(noteId as string, limitNum);
      } else if (status) {
        logs = await this.notificationLogRepository.getLogsByStatus(
          status as any,
          limitNum
        );
      } else {
        // デフォルト: 失敗ログを返す
        logs = await this.notificationLogRepository.getFailedLogs(limitNum);
      }

      res.json({ logs });
    } catch (error) {
      console.error('Error getting notification logs:', error);
      res.status(500).json({ error: 'Failed to retrieve notification logs' });
    }
  };

  /**
   * DELETE /api/notifications/logs/:id
   * 
   * 目的: 通知ログを削除
   */
  deleteNotificationLog = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      await this.notificationLogRepository.deleteLogById(id);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting notification log:', error);
      res.status(500).json({ error: 'Failed to delete notification log' });
    }
  };

  /**
   * GET /api/notifications/logs/:id
   * 
   * 目的: 通知ログを ID で取得
   */
  getNotificationLogById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const log = await this.notificationLogRepository.getLogById(id);

      if (!log) {
        res.status(404).json({ error: 'Notification log not found' });
        return;
      }

      res.json({ log });
    } catch (error) {
      console.error('Error getting notification log:', error);
      res.status(500).json({ error: 'Failed to retrieve notification log' });
    }
  };
}
