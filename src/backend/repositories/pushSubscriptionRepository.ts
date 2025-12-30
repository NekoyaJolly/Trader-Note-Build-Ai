/**
 * Push通知リポジトリ
 * 
 * 目的: PushSubscription と PushLog の永続化を責務とする
 * 
 * 責務:
 * - Web Push 購読情報の管理（登録・更新・削除）
 * - Push送信ログの管理
 * - 失敗時のリトライ制御
 * 
 * 制約:
 * - すべての DB アクセスはこのリポジトリを経由する
 * - ビジネスロジックは含まない (サービス層の責務)
 */

import { 
  PrismaClient, 
  PushSubscription, 
  PushLog,
  PushLogStatus,
} from '@prisma/client';
import { prisma } from '../db/client';

/**
 * Push購読作成用の入力データ
 */
export interface CreatePushSubscriptionInput {
  userId?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Pushログ作成用の入力データ
 */
export interface CreatePushLogInput {
  subscriptionId: string;
  notificationId?: string;
  status?: PushLogStatus;
  errorMessage?: string;
}

/**
 * Push通知リポジトリクラス
 */
export class PushSubscriptionRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  // ==========================================================
  // PushSubscription メソッド
  // ==========================================================

  /**
   * Push購読を登録する（既存の場合は更新）
   */
  async upsert(input: CreatePushSubscriptionInput): Promise<PushSubscription> {
    return await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: {
        p256dh: input.p256dh,
        auth: input.auth,
        active: true,
        failureCount: 0,
        updatedAt: new Date(),
      },
      create: {
        userId: input.userId || 'default',
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        active: true,
      },
    });
  }

  /**
   * IDで購読を取得する
   */
  async findById(id: string): Promise<PushSubscription | null> {
    return await this.prisma.pushSubscription.findUnique({
      where: { id },
    });
  }

  /**
   * エンドポイントで購読を取得する
   */
  async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    return await this.prisma.pushSubscription.findUnique({
      where: { endpoint },
    });
  }

  /**
   * アクティブな購読を全て取得する
   */
  async findAllActive(userId?: string): Promise<PushSubscription[]> {
    return await this.prisma.pushSubscription.findMany({
      where: {
        active: true,
        ...(userId ? { userId } : {}),
      },
    });
  }

  /**
   * 購読を無効化する
   */
  async deactivate(id: string): Promise<PushSubscription> {
    return await this.prisma.pushSubscription.update({
      where: { id },
      data: { active: false },
    });
  }

  /**
   * エンドポイントで購読を無効化する
   */
  async deactivateByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    const subscription = await this.findByEndpoint(endpoint);
    if (!subscription) return null;
    
    return await this.prisma.pushSubscription.update({
      where: { endpoint },
      data: { active: false },
    });
  }

  /**
   * 購読を削除する
   */
  async delete(id: string): Promise<PushSubscription> {
    return await this.prisma.pushSubscription.delete({
      where: { id },
    });
  }

  /**
   * 失敗回数をインクリメントする
   * 一定回数を超えた場合は自動的に無効化
   */
  async incrementFailureCount(id: string, maxFailures: number = 5): Promise<PushSubscription> {
    const subscription = await this.prisma.pushSubscription.update({
      where: { id },
      data: {
        failureCount: { increment: 1 },
      },
    });

    // 最大失敗回数を超えた場合は無効化
    if (subscription.failureCount >= maxFailures) {
      return await this.prisma.pushSubscription.update({
        where: { id },
        data: { active: false },
      });
    }

    return subscription;
  }

  /**
   * 送信成功時に失敗カウントをリセットし、最終送信日時を更新
   */
  async markSuccess(id: string): Promise<PushSubscription> {
    return await this.prisma.pushSubscription.update({
      where: { id },
      data: {
        failureCount: 0,
        lastPushedAt: new Date(),
      },
    });
  }

  // ==========================================================
  // PushLog メソッド
  // ==========================================================

  /**
   * Pushログを作成する
   */
  async createLog(input: CreatePushLogInput): Promise<PushLog> {
    return await this.prisma.pushLog.create({
      data: {
        subscriptionId: input.subscriptionId,
        notificationId: input.notificationId,
        status: input.status || 'pending',
        errorMessage: input.errorMessage,
      },
    });
  }

  /**
   * ログのステータスを更新する
   */
  async updateLogStatus(
    logId: string, 
    status: PushLogStatus, 
    errorMessage?: string
  ): Promise<PushLog> {
    return await this.prisma.pushLog.update({
      where: { id: logId },
      data: {
        status,
        errorMessage,
        sentAt: status === 'sent' ? new Date() : undefined,
        retryCount: status === 'retrying' ? { increment: 1 } : undefined,
      },
    });
  }

  /**
   * 購読IDでログ一覧を取得する
   */
  async findLogsBySubscriptionId(subscriptionId: string, limit: number = 50): Promise<PushLog[]> {
    return await this.prisma.pushLog.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 失敗したログを取得する（リトライ対象）
   */
  async findFailedLogs(maxRetries: number = 3): Promise<PushLog[]> {
    return await this.prisma.pushLog.findMany({
      where: {
        status: { in: ['failed', 'retrying'] },
        retryCount: { lt: maxRetries },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 通知IDに関連するログを取得する
   */
  async findLogsByNotificationId(notificationId: string): Promise<PushLog[]> {
    return await this.prisma.pushLog.findMany({
      where: { notificationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================================
  // 統計メソッド
  // ==========================================================

  /**
   * アクティブな購読数を取得する
   */
  async countActiveSubscriptions(): Promise<number> {
    return await this.prisma.pushSubscription.count({
      where: { active: true },
    });
  }

  /**
   * ログのステータス別件数を取得する
   */
  async countLogsByStatus(): Promise<{ status: PushLogStatus; count: number }[]> {
    const results = await this.prisma.pushLog.groupBy({
      by: ['status'],
      _count: true,
    });

    return results.map(r => ({
      status: r.status,
      count: r._count,
    }));
  }
}

// シングルトンインスタンスをエクスポート
export const pushSubscriptionRepository = new PushSubscriptionRepository();
