import type { Notification, MarketData } from '../models/types';
import { v4 as uuidv4 } from 'uuid';
import type { MatchResultDTO } from '../domain/matching/MatchResultDTO';
import type { NotificationRepository } from '../domain/notification/NotificationRepository';
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

  /**
   * 読み取り前にキャッシュの鮮度を保証する。
   *
   * DB モードでは本サービス以外の経路（マッチングパイプラインの
   * `InAppNotificationSender.sendInApp` / ストラテジーアラートの
   * `strategyAlertService` など）が Notification テーブルに**直接**書き込む。
   * コンストラクタ時に 1 度ロードしたインメモリキャッシュのままだと、起動後に
   * それらの経路で作られた通知が UI 一覧に出ない（= プロセスを再起動するまで
   * 通知が届かない既存不具合）。そのため DB モードでは読み取りのたびに最新を
   * 再ロードする。FS モードは本サービスが単一の書き込み者なので初回ロードで足りる。
   */
  private async ensureLoaded(): Promise<void> {
    if (this.storageMode === 'db') {
      await this.loadFromRepository();
      return;
    }
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
   * MatchResultDTO を受け取り、通知判定→保存を行う（**レガシー / 開発専用**）
   *
   * ⚠️ 本番の正規通知経路ではない。本メソッドは旧 `MatchingScheduler`(開発専用、
   * `CRON_ENABLED=true` 時のみ起動)からのみ呼ばれる。`triggerService.evaluate()` の
   * スコア閾値判定しか行わず、冪等性チェック / クールダウン / 24時間上限 / 重複抑制 /
   * NotificationLog 永続化を**持たない**。
   *
   * 本番の正規経路は `MatchingService.runMatchingPipeline()` で、
   * `NotificationTriggerService.evaluateWithPersistence()`(上記の各制御を実装)+
   * `InAppNotificationSender`(UI 表示用 Notification 行 + Web Push)を使う。新規実装・
   * 本番運用ではそちらを使うこと。
   *
   * @deprecated 開発専用。本番通知は `runMatchingPipeline()` 経路を使うこと。
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
          currentMarket: match.marketSnapshot as MarketData,
          historicalNote: note,
          timestamp: match.evaluatedAt,
        },
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

  // 既読・削除はリポジトリの専用メソッドに委譲して永続化する。
  // 旧実装は in-memory 配列を書き換えて saveAll で保存していたが、DB モードでは
  // saveAll が「全件 create」になり既読/削除が反映されず通知が複製されていた
  // （2026-06-10 実機検証で発見）。永続化後に in-memory を最新化してキャッシュ整合を保つ。

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    await this.repository.markAsRead(notificationId);
    await this.loadFromRepository();
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<void> {
    await this.repository.markAllAsRead();
    await this.loadFromRepository();
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string): Promise<void> {
    await this.repository.delete(notificationId);
    await this.loadFromRepository();
  }

  /**
   * Clear all notifications
   */
  async clearAll(): Promise<void> {
    await this.repository.deleteAll();
    await this.loadFromRepository();
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
