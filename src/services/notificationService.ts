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

  private async loadFromRepository(userId?: string): Promise<void> {
    // Phase α-4: userId 指定時は宛先ユーザーの通知のみロード (DB モードで分離)
    this.notifications = await this.repository.loadAll(userId);
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
    // まずコンストラクタで開始した初期ロードの完了を保証する。
    // これを待たずに loadFromRepository() を走らせると、初期ロードが後から解決して
    // this.notifications を古い配列で上書きするレースが起こり得る。
    await this.loadPromise;
    if (this.storageMode === 'db') {
      await this.loadFromRepository();
    }
  }

  /**
   * 読み取り系の共通取得 (Phase α-4 マルチユーザー分離)。
   *
   * DB モードでは共有インメモリキャッシュ (this.notifications) を経由せず、
   * リポジトリから直接ユーザースコープの結果を返す。NotificationService の
   * インスタンスは全リクエストで共有されるため、キャッシュを userId ごとに
   * 上書きすると同時リクエストで別ユーザーの通知が混ざる競合が起き得る
   * (PR #386 Copilot レビュー指摘)。
   * FS モードは開発専用・単一ユーザー前提のため従来のキャッシュを返す。
   */
  private async readAll(userId?: string): Promise<Notification[]> {
    await this.loadPromise;
    if (this.storageMode === 'db') {
      return this.repository.loadAll(userId);
    }
    return this.notifications;
  }

  /**
   * ID から通知を取得する (userId 指定時は宛先ユーザーの通知のみ。Phase α-4)
   */
  async getNotificationById(id: string, userId?: string): Promise<Notification | undefined> {
    const notifications = await this.readAll(userId);
    return notifications.find((n) => n.id === id);
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
        userId: match.userId ?? null,
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
   * Get all notifications (userId 指定時は宛先ユーザーの通知のみ。Phase α-4)
   */
  async getNotifications(unreadOnly: boolean = false, userId?: string): Promise<Notification[]> {
    const notifications = await this.readAll(userId);
    if (unreadOnly) {
      return notifications.filter(n => !n.read);
    }
    return notifications;
  }

  // 既読・削除はリポジトリの専用メソッドに委譲して永続化する。
  // 旧実装は in-memory 配列を書き換えて saveAll で保存していたが、DB モードでは
  // saveAll が「全件 create」になり既読/削除が反映されず通知が複製されていた
  // （2026-06-10 実機検証で発見）。永続化後に in-memory を最新化してキャッシュ整合を保つ。
  //
  // 各メソッドは冒頭で `await this.loadPromise`（初期ロード完了の保証）を行う。
  // これを省くと、コンストラクタで開始した初期ロードが loadFromRepository() の後に
  // 解決して this.notifications を永続化前の古い配列で上書きするレースが起こり得る。

  /**
   * Mark notification as read (userId 指定時は宛先ユーザーの通知のみ。Phase α-4)
   */
  async markAsRead(notificationId: string, userId?: string): Promise<void> {
    await this.loadPromise;
    await this.repository.markAsRead(notificationId, userId);
    await this.loadFromRepository(userId);
  }

  /**
   * Mark all notifications as read (userId 指定時は宛先ユーザーの通知のみ。Phase α-4)
   */
  async markAllAsRead(userId?: string): Promise<void> {
    await this.loadPromise;
    await this.repository.markAllAsRead(userId);
    await this.loadFromRepository(userId);
  }

  /**
   * Delete a notification (userId 指定時は宛先ユーザーの通知のみ。Phase α-4)
   */
  async deleteNotification(notificationId: string, userId?: string): Promise<void> {
    await this.loadPromise;
    await this.repository.delete(notificationId, userId);
    await this.loadFromRepository(userId);
  }

  /**
   * Clear all notifications (userId 指定時は宛先ユーザーの通知のみ。Phase α-4)
   */
  async clearAll(userId?: string): Promise<void> {
    await this.loadPromise;
    await this.repository.deleteAll(userId);
    await this.loadFromRepository(userId);
  }

  /**
   * 未読通知数を取得 (userId 指定時は宛先ユーザーの通知のみ。Phase α-4)
   */
  async countUnread(userId?: string): Promise<number> {
    const notifications = await this.readAll(userId);
    return notifications.filter(n => !n.read).length;
  }

  private async persist(): Promise<void> {
    await this.repository.saveAll(this.notifications);
  }
}
