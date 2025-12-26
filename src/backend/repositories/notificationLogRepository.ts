import { NotificationLog, NotificationLogStatus, PrismaClient } from '@prisma/client';
import { prisma } from '../db/client';

/**
 * NotificationLog リポジトリ
 * 
 * 目的: 通知配信ログを永続化し、再通知防止（冪等性・クールダウン）のチェックを実装する。
 * 
 * 設計:
 * - noteId × marketSnapshotId × channel の組み合わせは一意（冪等性保証）
 * - クールダウン検査: noteId で直近の sent を取得し、時間制約を確認
 * - 重複抑制: 同一 evaluatedAt の再送信を防ぐ
 */
export interface NotificationLogUpsertInput {
  noteId: string;
  marketSnapshotId: string;
  symbol: string;
  score: number;
  channel: 'in_app' | 'push' | 'webhook';
  status: NotificationLogStatus;
  reasonSummary: string;
  sentAt: Date;
}

/**
 * クールダウン検査の結果
 */
export interface CooldownCheckResult {
  // true: クールダウン中（再通知を避けるべき）
  isInCooldown: boolean;
  // 最後に通知した時刻
  lastNotificationTime?: Date;
  // クールダウン終了予定時刻
  cooldownUntil?: Date;
}

export class NotificationLogRepository {
  private prisma: PrismaClient;
  
  // クールダウン期間（ミリ秒）デフォルト 1 時間
  private readonly DEFAULT_COOLDOWN_MS = 60 * 60 * 1000;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * 通知ログを記録する（既存レコードがある場合は更新）
   */
  async upsertLog(input: NotificationLogUpsertInput): Promise<NotificationLog> {
    return this.prisma.notificationLog.upsert({
      where: {
        noteId_marketSnapshotId_channel: {
          noteId: input.noteId,
          marketSnapshotId: input.marketSnapshotId,
          channel: input.channel,
        },
      },
      create: {
        noteId: input.noteId,
        marketSnapshotId: input.marketSnapshotId,
        symbol: input.symbol,
        score: input.score,
        channel: input.channel,
        status: input.status,
        reasonSummary: input.reasonSummary,
        sentAt: input.sentAt,
      },
      update: {
        score: input.score,
        status: input.status,
        reasonSummary: input.reasonSummary,
        sentAt: input.sentAt,
      },
    });
  }

  /**
   * 冪等性チェック: noteId × marketSnapshotId × channel で既にログが存在するか確認
   * 
   * @returns true: すでに通知済み（重複），false: 初回
   */
  async isDuplicate(
    noteId: string,
    marketSnapshotId: string,
    channel: 'in_app' | 'push' | 'webhook'
  ): Promise<boolean> {
    const existing = await this.prisma.notificationLog.findUnique({
      where: {
        noteId_marketSnapshotId_channel: {
          noteId,
          marketSnapshotId,
          channel,
        },
      },
    });
    return !!existing;
  }

  /**
   * クールダウン検査: 同じ noteId について一定時間内に再通知がないか確認
   * 
   * @param noteId - トレードノート ID
   * @param cooldownMs - クールダウン時間（ミリ秒）。省略時は 1 時間
   * @returns クールダウン状態
   */
  async checkCooldown(
    noteId: string,
    cooldownMs?: number
  ): Promise<CooldownCheckResult> {
    const cooldown = cooldownMs ?? this.DEFAULT_COOLDOWN_MS;
    
    // noteId で最後に sent のログを取得
    const lastLog = await this.prisma.notificationLog.findFirst({
      where: {
        noteId,
        status: 'sent',
      },
      orderBy: {
        sentAt: 'desc',
      },
    });

    if (!lastLog) {
      // 通知履歴がない → クールダウン中ではない
      return {
        isInCooldown: false,
      };
    }

    const lastTime = lastLog.sentAt.getTime();
    const now = Date.now();
    const cooldownUntil = new Date(lastTime + cooldown);

    if (now < lastTime + cooldown) {
      // クールダウン中
      return {
        isInCooldown: true,
        lastNotificationTime: lastLog.sentAt,
        cooldownUntil,
      };
    }

    // クールダウン満了
    return {
      isInCooldown: false,
      lastNotificationTime: lastLog.sentAt,
    };
  }

  /**
   * 同一 evaluatedAt の重複を検査
   * （実装上、NotificationLog には evaluatedAt を直接保持していないため、
   *   送信時刻が非常に近い（秒単位）ログがあれば重複と見なす）
   * 
   * @param noteId - トレードノート ID
   * @param marketSnapshotId - マーケットスナップショット ID
   * @param toleranceSec - 許容時間差（秒単位）デフォルト 5 秒
   * @returns true: 重複の可能性あり
   */
  async hasRecentDuplicate(
    noteId: string,
    marketSnapshotId: string,
    toleranceSec: number = 5
  ): Promise<boolean> {
    const now = new Date();
    const toleranceMs = toleranceSec * 1000;
    const since = new Date(now.getTime() - toleranceMs);

    const recentLog = await this.prisma.notificationLog.findFirst({
      where: {
        noteId,
        marketSnapshotId,
        sentAt: {
          gte: since,
        },
      },
      orderBy: {
        sentAt: 'desc',
      },
    });

    return !!recentLog;
  }

  /**
   * 通知ログを取得（ID で）
   */
  async getLogById(id: string): Promise<NotificationLog | null> {
    return this.prisma.notificationLog.findUnique({
      where: { id },
    });
  }

  /**
   * noteId でログを取得（複数）
   */
  async getLogsByNoteId(noteId: string, limit: number = 10): Promise<NotificationLog[]> {
    return this.prisma.notificationLog.findMany({
      where: { noteId },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
  }

  /**
   * symbol でログを取得（複数）
   */
  async getLogsBySymbol(symbol: string, limit: number = 50): Promise<NotificationLog[]> {
    return this.prisma.notificationLog.findMany({
      where: { symbol },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 通知ログを削除（ID で）
   */
  async deleteLogById(id: string): Promise<void> {
    await this.prisma.notificationLog.delete({
      where: { id },
    });
  }

  /**
   * ステータスで通知ログを検索
   */
  async getLogsByStatus(
    status: NotificationLogStatus,
    limit: number = 100
  ): Promise<NotificationLog[]> {
    return this.prisma.notificationLog.findMany({
      where: { status },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 失敗ログを取得（リトライ対象）
   */
  async getFailedLogs(limit: number = 50): Promise<NotificationLog[]> {
    return this.getLogsByStatus('failed', limit);
  }
}
