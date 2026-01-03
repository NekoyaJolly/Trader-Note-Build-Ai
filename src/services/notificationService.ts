import { Notification } from '../models/types';
import { v4 as uuidv4 } from 'uuid';
import { MatchResultDTO } from '../domain/matching/MatchResultDTO';
import { NotificationRepository } from '../domain/notification/NotificationRepository';
import { FileNotificationRepository } from '../infrastructure/file/FileNotificationRepository';
import { DbNotificationRepositoryAdapter } from '../infrastructure/db/DbNotificationRepositoryAdapter';
import { NotificationTriggerService } from './notification/notificationTriggerService';
import { TradeNoteService } from './tradeNoteService';
import { config } from '../config';

/**
 * ストレージモード
 * - 'db': DBのみ使用（本番推奨、MatchResult紐付け必須）
 * - 'fs': FSのみ使用（開発用、単独通知対応）
 */
type StorageMode = 'db' | 'fs';

/**
 * 設定に基づいてリポジトリを選択するファクトリ関数
 */
function createRepository(storageMode: StorageMode): NotificationRepository {
  if (storageMode === 'db') {
    console.log('[NotificationService] DBモードで初期化');
    return new DbNotificationRepositoryAdapter();
  }
  console.log('[NotificationService] FSモードで初期化');
  return new FileNotificationRepository();
}

/**
 * Service for managing notifications
 * Supports both push notifications and in-app notifications
 * 
 * Phase 8: ストレージモード対応
 * - FSモード: 従来のファイルベース（MatchResultなしの単独通知対応）
 * - DBモード: DB永続化（MatchResult紐付け必須、本番推奨）
 */
export class NotificationService {
  private notifications: Notification[] = [];
  private readonly repository: NotificationRepository;
  private readonly triggerService: NotificationTriggerService;
  private readonly noteService: TradeNoteService;
  private readonly loadPromise: Promise<void>;
  private readonly storageMode: StorageMode;

  constructor(
    repository?: NotificationRepository,
    triggerService?: NotificationTriggerService,
    noteService?: TradeNoteService,
    storageMode: StorageMode = config.notification.storageMode, // 設定から取得（本番=db、開発=fs）
  ) {
    this.storageMode = storageMode;
    this.repository = repository || createRepository(storageMode);
    this.triggerService = triggerService || new NotificationTriggerService();
    // ストレージモードに合わせてノートサービスも切り替え
    this.noteService = noteService || new TradeNoteService(storageMode);
    this.loadPromise = this.loadFromRepository();
  }

  private async loadFromRepository(): Promise<void> {
    this.notifications = await this.repository.loadAll();
  }

  private async ensureLoaded(): Promise<void> {
    await this.loadPromise;
  }

  /**
   * ID から通知を取得する
   */
  async getNotificationById(id: string): Promise<Notification | undefined> {
    await this.ensureLoaded();
    return this.notifications.find((n) => n.id === id);
  }

  /**
   * MatchResultDTO を受け取り、通知判定→保存を行う
   */
  async trigger(matchResults: MatchResultDTO[]): Promise<void> {
    await this.ensureLoaded();

    for (const match of matchResults) {
      const evaluation = this.triggerService.evaluate({
        matchScore: match.matchScore,
        historicalNoteId: match.historicalNoteId,
        marketSnapshot: match.marketSnapshot,
      });

      if (!evaluation.shouldNotify) {
        continue;
      }

      const note = await this.noteService.getNoteById(match.historicalNoteId);
      if (!note) {
        continue;
      }

      const notification: Notification = {
        id: uuidv4(),
        type: 'match',
        title: `Trade Opportunity: ${note.symbol}`,
        message: `現在の市場がトレードノートと一致しました（一致度: ${(match.matchScore * 100).toFixed(1)}%）`,
        matchResult: {
          noteId: note.id,
          symbol: note.symbol,
          matchScore: match.matchScore,
          threshold: config.matching.threshold,
          isMatch: true,
          currentMarket: match.marketSnapshot as any,
          historicalNote: note,
          timestamp: match.evaluatedAt,
        } as any,
        timestamp: new Date(),
        read: false,
      };

      this.notifications.push(notification);
    }

    await this.persist();
  }

  /**
   * Create a general notification（既存 API 互換のまま残す）
   */
  async notify(type: 'info' | 'warning', title: string, message: string): Promise<void> {
    await this.ensureLoaded();

    const notification: Notification = {
      id: uuidv4(),
      type,
      title,
      message,
      timestamp: new Date(),
      read: false,
    };

    this.notifications.push(notification);
    await this.persist();
  }

  /**
   * Get all notifications
   */
  async getNotifications(unreadOnly: boolean = false): Promise<Notification[]> {
    await this.ensureLoaded();
    if (unreadOnly) {
      return this.notifications.filter(n => !n.read);
    }
    return this.notifications;
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    await this.ensureLoaded();
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      await this.persist();
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<void> {
    await this.ensureLoaded();
    this.notifications.forEach(n => n.read = true);
    await this.persist();
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string): Promise<void> {
    await this.ensureLoaded();
    this.notifications = this.notifications.filter(n => n.id !== notificationId);
    await this.persist();
  }

  /**
   * Clear all notifications
   */
  async clearAll(): Promise<void> {
    await this.ensureLoaded();
    this.notifications = [];
    await this.persist();
  }

  /**
   * 未読通知数を取得
   */
  async countUnread(): Promise<number> {
    await this.ensureLoaded();
    return this.notifications.filter(n => !n.read).length;
  }

  private async persist(): Promise<void> {
    await this.repository.saveAll(this.notifications);
  }
}
