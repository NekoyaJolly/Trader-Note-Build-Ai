import { Notification, MatchResult, MarketData, TradeNote } from '../../models/types';
import { NotificationRepository } from '../../domain/notification/NotificationRepository';
import { DbNotificationRepository, NotificationWithMatch } from '../../backend/repositories/notificationRepository';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * DbNotificationRepository を NotificationRepository インターフェースに適合させるアダプター
 * 
 * 目的:
 * - DBベースの通知リポジトリを既存の NotificationService で使用可能にする
 * - 本番環境（Vercel等）でファイルシステムが永続化されない問題を解決
 * 
 * 制約:
 * - DB版は MatchResult との紐付けが必須のため、単独通知は matchResult=null で対応
 */
export class DbNotificationRepositoryAdapter implements NotificationRepository {
  private readonly dbRepo: DbNotificationRepository;

  constructor(dbRepo?: DbNotificationRepository) {
    this.dbRepo = dbRepo || new DbNotificationRepository();
  }

  /**
   * 全通知を読み込む
   * DBから取得したデータを Notification 型に変換
   */
  async loadAll(): Promise<Notification[]> {
    const dbNotifications = await this.dbRepo.findAll(500, 0);
    
    return dbNotifications.map((n) => this.convertToNotification(n));
  }

  /**
   * 単一の通知を保存
   * 注意: DB版は MatchResult 紐付けが前提のため、matchResult がない場合は警告
   */
  async save(notification: Notification): Promise<void> {
    // matchResult から matchResultId を取得
    const matchResultId = notification.matchResult?.noteId;
    
    if (!matchResultId) {
      // MatchResult なしの通知はDBには保存できない（スキップ）
      console.warn('[DbNotificationRepositoryAdapter] matchResult がないため DB 保存をスキップ:', notification.id);
      return;
    }

    await this.dbRepo.create({
      matchResultId,
      title: notification.title,
      message: notification.message,
      status: notification.read ? 'read' : 'unread',
    });
  }

  /**
   * 全通知を保存（一括）
   * 注意: 既存データを削除せず追加のみ
   */
  async saveAll(notifications: Notification[]): Promise<void> {
    for (const notification of notifications) {
      await this.save(notification);
    }
  }

  /**
   * Decimal を number に変換するヘルパー
   */
  private toNumber(value: number | Decimal | null | undefined): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    return value.toNumber();
  }

  /**
   * DB の Notification を models/types の Notification に変換
   */
  private convertToNotification(dbNotification: NotificationWithMatch): Notification {
    const matchResult = dbNotification.matchResult;
    
    // MatchResult がない場合は matchResult なしの通知として返す
    if (!matchResult) {
      return {
        id: dbNotification.id,
        type: 'match',
        title: dbNotification.title,
        message: dbNotification.message,
        timestamp: dbNotification.sentAt,
        read: dbNotification.status === 'read',
      };
    }

    // ダミーの MarketData を生成（DBには詳細が保存されていないため）
    const dummyMarketData: MarketData = {
      symbol: matchResult.symbol,
      timestamp: dbNotification.sentAt,
      timeframe: '15m',
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      volume: 0,
    };

    // ダミーの TradeNote を生成
    const note = matchResult.note;
    const dummyTradeNote: TradeNote = {
      id: note?.id || matchResult.noteId,
      tradeId: '',
      timestamp: dbNotification.sentAt,
      symbol: matchResult.symbol,
      side: (note?.side as 'buy' | 'sell') || 'buy',
      entryPrice: this.toNumber(note?.entryPrice),
      quantity: 0,
      marketContext: {
        timeframe: '15m',
        trend: 'neutral',
      },
      aiSummary: note?.aiSummary?.summary || '',
      features: [],
      createdAt: dbNotification.sentAt,
      status: 'active',
    };

    const convertedMatchResult: MatchResult = {
      noteId: matchResult.noteId,
      symbol: matchResult.symbol,
      matchScore: this.toNumber(matchResult.score),
      threshold: 0.75,
      isMatch: true,
      timestamp: dbNotification.sentAt,
      currentMarket: dummyMarketData,
      historicalNote: dummyTradeNote,
    };

    return {
      id: dbNotification.id,
      type: 'match',
      title: dbNotification.title,
      message: dbNotification.message,
      timestamp: dbNotification.sentAt,
      read: dbNotification.status === 'read',
      matchResult: convertedMatchResult,
    };
  }
}
