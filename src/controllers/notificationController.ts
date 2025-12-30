import { Request, Response } from 'express';
import { NotificationService } from '../services/notificationService';
import { NotificationLogRepository } from '../backend/repositories/notificationLogRepository';
import { MatchingService } from '../services/matchingService';
import { NotificationTriggerService } from '../services/notification/notificationTriggerService';

/**
 * NotificationController
 * 
 * 責務:
 * 1. 既存の Notification API（読み取り/削除）を維持
 * 2. Phase4 で追加された通知トリガ・ログ API
 * 3. 通知の配信判定と記録
 * 4. クールダウン・重複抑止・冪等性の保証
 */
export class NotificationController {
  private notificationService: NotificationService;
  private notificationLogRepository: NotificationLogRepository;
  private matchingService: MatchingService;
  private triggerService: NotificationTriggerService;

  constructor() {
    this.notificationService = new NotificationService();
    this.notificationLogRepository = new NotificationLogRepository();
    this.matchingService = new MatchingService();
    this.triggerService = new NotificationTriggerService();
  }

  /**
   * 既存エンドポイント: すべての通知を取得
   */
  getNotifications = async (req: Request, res: Response): Promise<void> => {
    try {
      // NotificationService が扱うファイルストアの通知を取得し、UI で必要な形へ変換する
      const unreadOnly = req.query.unreadOnly === 'true';
      const notifications = await this.notificationService.getNotifications(unreadOnly);
      const result = notifications
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .map((n) => this.buildListItem(n));

      res.json({ notifications: result });
    } catch (error) {
      // 本番環境ではスタックトレースをログにのみ記録し、ユーザーには安全なメッセージを返す
      console.error('Error getting notifications:', error);
      if (process.env.NODE_ENV !== 'production' && error instanceof Error) {
        console.error('Notification list error message:', error.message);
        console.error(error.stack);
      }
      res.status(500).json({ error: '通知一覧の取得に失敗しました。しばらく待ってから再度お試しください。' });
    }
  };

  /**
   * 既存エンドポイント: 通知詳細を取得
   */
  getNotificationById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const notification = await this.notificationService.getNotificationById(id);

      if (!notification) {
        res.status(404).json({ error: '通知が見つかりませんでした' });
        return;
      }

      const detail = this.buildDetailItem(notification);
      res.json(detail);
    } catch (error) {
      console.error('Error getting notification detail:', error);
      res.status(500).json({ error: '通知詳細の取得に失敗しました' });
    }
  };

  /**
   * 既存エンドポイント: 通知を既読にマーク
   */
  markAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const notification = await this.notificationService.getNotificationById(id);
      if (!notification) {
        res.status(404).json({ error: '通知が見つかりませんでした' });
        return;
      }

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
      const notification = await this.notificationService.getNotificationById(id);
      if (!notification) {
        res.status(404).json({ error: '通知が見つかりませんでした' });
        return;
      }

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
   * 
   * 処理フロー:
   * 1. マッチング判定を実行
   * 2. 各マッチに対してクールダウン・重複・冪等性チェック
   * 3. 通知を生成（In-app 通知）
   * 4. NotificationLog を DB に永続化
   * 
   * レスポンス:
   * {
   *   "processed": number,
   *   "notified": number,
   *   "skipped": number,
   *   "results": [{ shouldNotify, status, skipReason?, notificationLogId? }]
   * }
   */
  checkAndNotify = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. マッチング判定を実行
      const matches = await this.matchingService.checkForMatches();
      
      const results: Array<{
        noteId: string;
        shouldNotify: boolean;
        status: string;
        skipReason?: string;
        notificationLogId?: string;
      }> = [];
      
      let notifiedCount = 0;
      let skippedCount = 0;

      // 2. 各マッチに対して通知判定（クールダウン・重複チェック含む）
      for (const match of matches) {
        const triggerResult = await this.triggerService.evaluateWithPersistence({
          matchScore: match.matchScore,
          historicalNoteId: match.historicalNoteId,
          marketSnapshot: match.marketSnapshot,
          marketSnapshotId: match.marketSnapshotId,
          symbol: match.symbol,
          channel: 'in_app',
        });

        if (triggerResult.shouldNotify) {
          notifiedCount++;
        } else {
          skippedCount++;
        }

        results.push({
          noteId: match.historicalNoteId,
          shouldNotify: triggerResult.shouldNotify,
          status: triggerResult.status,
          skipReason: triggerResult.skipReason,
          notificationLogId: triggerResult.notificationLogId,
        });
      }

      // 3. 通知を生成（既存の In-app 通知フロー）
      // shouldNotify が true のマッチのみを抽出して通知生成
      const matchesToNotify = matches.filter((m, i) => results[i]?.shouldNotify);
      if (matchesToNotify.length > 0) {
        await this.notificationService.trigger(matchesToNotify);
      }

      res.json({
        processed: matches.length,
        notified: notifiedCount,
        skipped: skippedCount,
        shouldNotify: notifiedCount > 0,
        results,
      });
    } catch (error) {
      console.error('通知チェックエラー:', error);
      // 本番環境ではエラー詳細を隠蔽し、ログにのみ記録
      const isProduction = process.env.NODE_ENV === 'production';
      res.status(500).json({
        error: '通知処理に失敗しました',
        message: isProduction ? undefined : (error instanceof Error ? error.message : 'unknown'),
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

  /**
   * 通知一覧で必要な情報へ変換する
   */
  private buildListItem(notification: any) {
    const match = notification.matchResult;
    const historicalNote = match?.historicalNote;

    const evaluatedAt = match?.timestamp ? new Date(match.timestamp) : notification.timestamp;
    const symbol = historicalNote?.symbol || match?.symbol || 'N/A';
    const side = historicalNote?.side === 'sell' ? 'SELL' : 'BUY';
    const timeframe = historicalNote?.marketContext?.timeframe || '';

    return {
      id: notification.id,
      matchResultId: match?.noteId || notification.id,
      sentAt: notification.timestamp.toISOString(),
      channel: 'in_app',
      isRead: Boolean(notification.read),
      readAt: notification.read ? notification.timestamp.toISOString() : null,
      createdAt: notification.timestamp.toISOString(),
      matchResult: {
        score: match?.matchScore ?? 0,
        evaluatedAt: evaluatedAt.toISOString(),
      },
      tradeNote: {
        symbol,
        side,
        timeframe,
      },
      reasonSummary: notification.message || '',
    };
  }

  /**
   * 通知詳細で必要な情報へ変換する
   */
  private buildDetailItem(notification: any) {
    const listItem = this.buildListItem(notification);
    const match = notification.matchResult;
    const historicalNote = match?.historicalNote;
    const currentMarket = match?.currentMarket;

    const snapshot15m = this.buildSnapshot(currentMarket, '15m', listItem.tradeNote.symbol);
    const snapshot60m = this.buildSnapshot(currentMarket, '60m', listItem.tradeNote.symbol);

    return {
      ...listItem,
      matchResult: {
        id: match?.noteId || notification.id,
        tradeNoteId: historicalNote?.id || match?.noteId || notification.id,
        evaluatedAt: listItem.matchResult.evaluatedAt,
        score: listItem.matchResult.score,
        matched: Boolean(match?.isMatch ?? (listItem.matchResult.score >= (match?.threshold ?? 0))),
        reasons: (match?.reasons as any[]) || [],
        marketSnapshotId15m: snapshot15m.id,
        marketSnapshotId60m: snapshot60m.id,
        createdAt: listItem.createdAt,
      },
      tradeNote: {
        id: historicalNote?.id || match?.noteId || notification.id,
        tradeId: historicalNote?.tradeId || '',
        symbol: listItem.tradeNote.symbol,
        side: listItem.tradeNote.side,
        timeframe: listItem.tradeNote.timeframe,
        entryConditions: '',
        exitConditions: '',
        aiSummary: historicalNote?.aiSummary || null,
        createdAt: historicalNote?.createdAt?.toISOString?.() || notification.timestamp.toISOString(),
      },
      marketSnapshot15m: snapshot15m,
      marketSnapshot60m: snapshot60m,
    };
  }

  /**
   * MarketSnapshot 表示用のダミー含むスナップショット生成
   */
  private buildSnapshot(currentMarket: any, timeframe: string, symbol: string) {
    const baseTimestamp = currentMarket?.timestamp ? new Date(currentMarket.timestamp) : new Date();

    const price = currentMarket?.close ?? 0;
    return {
      id: `${timeframe}-${symbol}-${baseTimestamp.getTime()}`,
      symbol,
      timeframe,
      timestamp: baseTimestamp.toISOString(),
      open: currentMarket?.open ?? price,
      high: currentMarket?.high ?? price,
      low: currentMarket?.low ?? price,
      close: price,
      volume: currentMarket?.volume ?? 0,
      rsi: currentMarket?.indicators?.rsi ?? null,
      macd: currentMarket?.indicators?.macd ?? null,
      macdSignal: null,
      macdHistogram: null,
      atr: null,
      ema20: null,
      ema50: null,
      bollingerUpper: null,
      bollingerMiddle: null,
      bollingerLower: null,
      createdAt: baseTimestamp.toISOString(),
    };
  }
}
