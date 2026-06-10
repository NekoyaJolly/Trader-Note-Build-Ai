/**
 * 通知リポジトリ（DB版）
 * 
 * 目的: Notification の永続化を DB で管理する
 * FileNotificationRepository の代替実装
 * 
 * 責務:
 * - 通知の作成・読み取り・更新
 * - 既読管理
 * - MatchResult との紐付け
 * 
 * 制約:
 * - すべての DB アクセスはこのリポジトリを経由する
 * - ビジネスロジックは含まない (サービス層の責務)
 */

import type { 
  PrismaClient, 
  Notification, 
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../db/client';
import type { 
  MatchReasons, 
} from '../../models/prismaTypes';

/**
 * 通知作成用の入力データ
 *
 * Phase γ-1: ストラテジーアラート通知(matchResult を持たない)に対応するため
 * matchResultId は nullable、type で通知種別を区別する。
 */
export interface CreateNotificationInput {
  /** 由来 MatchResult(ノートマッチ通知のみ。ストラテジーアラートは null) */
  matchResultId: string | null;
  /** 通知種別(note_match / strategy_alert)。省略時は note_match */
  type?: 'note_match' | 'strategy_alert';
  title: string;
  message: string;
  status?: NotificationStatus;
}

/**
 * Notification と MatchResult を含む完全なデータ
 * (matchResult はストラテジーアラート通知では null)
 */
export interface NotificationWithMatch extends Notification {
  matchResult: {
    id: string;
    noteId: string;
    symbol: string;
    score: number;
    threshold: number;
    trendMatched: boolean;
    priceRangeMatched: boolean;
    reasons: MatchReasons | Prisma.JsonValue;
    note?: {
      id: string;
      symbol: string;
      side: string;
      entryPrice: Prisma.Decimal | number;
      aiSummary?: { summary: string } | null;
    };
  } | null;
}

/**
 * 通知取得用のフィルタオプション
 */
export interface FindNotificationsOptions {
  status?: NotificationStatus | NotificationStatus[];
  symbol?: string;
  limit?: number;
  offset?: number;
  includeMatch?: boolean;
}

/**
 * 通知リポジトリクラス（DB版）
 */
export class DbNotificationRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * 通知を作成する
   */
  async create(input: CreateNotificationInput): Promise<Notification> {
    return await this.prisma.notification.create({
      data: {
        matchResultId: input.matchResultId,
        type: input.type ?? 'note_match',
        title: input.title,
        message: input.message,
        status: input.status || 'unread',
      },
    });
  }

  /**
   * IDで通知を取得する（MatchResult を含む）
   */
  async findById(id: string): Promise<NotificationWithMatch | null> {
    return await this.prisma.notification.findUnique({
      where: { id },
      include: {
        matchResult: {
          include: {
            note: {
              include: {
                aiSummary: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * オプションを指定して通知を取得する
   */
  async findWithOptions(options: FindNotificationsOptions = {}): Promise<Notification[] | NotificationWithMatch[]> {
    const { status, symbol, limit = 50, offset = 0, includeMatch = false } = options;
    const safeLimit = Math.min(limit, 500);

    // where 条件を構築（Prisma の生成型を使用）
    const where: Prisma.NotificationWhereInput = {};
    
    if (status) {
      // status は文字列または配列で指定可能
      if (Array.isArray(status)) {
        where.status = { in: status };
      } else {
        where.status = status;
      }
    }
    
    if (symbol) {
      where.matchResult = {
        symbol,
      };
    }

    return await this.prisma.notification.findMany({
      where,
      include: includeMatch ? {
        matchResult: {
          include: {
            note: {
              include: {
                aiSummary: true,
              },
            },
          },
        },
      } : undefined,
      orderBy: { sentAt: 'desc' },
      take: safeLimit,
      skip: offset,
    });
  }

  /**
   * 未読通知を取得する
   */
  async findUnread(limit: number = 50): Promise<NotificationWithMatch[]> {
    return await this.findWithOptions({
      status: 'unread',
      limit,
      includeMatch: true,
    }) as NotificationWithMatch[];
  }

  /**
   * 全通知を取得する（ページング付き）
   */
  async findAll(limit: number = 50, offset: number = 0): Promise<NotificationWithMatch[]> {
    return await this.findWithOptions({
      limit,
      offset,
      includeMatch: true,
    }) as NotificationWithMatch[];
  }

  /**
   * UI フィードに表示する通知（ソフトデリート済みを除く未読/既読）を新しい順に取得する。
   * delete はソフトデリート（status=deleted）のため、フィードからは本メソッドで除外する。
   * 物理削除は deleteOlderThan の定期クリーンアップが担う。
   */
  async findActiveForFeed(limit: number = 500, offset: number = 0): Promise<NotificationWithMatch[]> {
    return await this.findWithOptions({
      status: ['unread', 'read'],
      limit,
      offset,
      includeMatch: true,
    }) as NotificationWithMatch[];
  }

  /**
   * 通知を既読にする
   */
  async markAsRead(id: string): Promise<Notification> {
    return await this.prisma.notification.update({
      where: { id },
      data: {
        status: 'read',
        readAt: new Date(),
      },
    });
  }

  /**
   * 複数の通知を既読にする
   */
  async markManyAsRead(ids: string[]): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'read',
        readAt: new Date(),
      },
    });
    return result.count;
  }

  /**
   * すべての通知を既読にする
   */
  async markAllAsRead(): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { status: 'unread' },
      data: {
        status: 'read',
        readAt: new Date(),
      },
    });
    return result.count;
  }

  /**
   * 通知を削除（ソフトデリート）
   */
  async softDelete(id: string): Promise<Notification> {
    return await this.prisma.notification.update({
      where: { id },
      data: { status: 'deleted' },
    });
  }

  /**
   * すべての未読/既読通知をソフトデリート（status=deleted）する。返り値は対象件数。
   * 「全クリア」操作（DELETE /api/notifications）の DB 永続化に使う。
   */
  async softDeleteAll(): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { status: { in: ['unread', 'read'] } },
      data: { status: 'deleted' },
    });
    return result.count;
  }

  /**
   * 通知を物理削除
   */
  async delete(id: string): Promise<Notification> {
    return await this.prisma.notification.delete({
      where: { id },
    });
  }

  /**
   * MatchResultId で既存の通知があるか確認（重複チェック）
   */
  async existsByMatchResultId(matchResultId: string): Promise<boolean> {
    const count = await this.prisma.notification.count({
      where: { matchResultId },
    });
    return count > 0;
  }

  /**
   * 未読通知数を取得する
   */
  async countUnread(): Promise<number> {
    return await this.prisma.notification.count({
      where: { status: 'unread' },
    });
  }

  /**
   * ステータス別の件数を取得する
   */
  async countByStatus(): Promise<{ status: NotificationStatus; count: number }[]> {
    const results = await this.prisma.notification.groupBy({
      by: ['status'],
      _count: true,
    });

    return results.map(r => ({
      status: r.status,
      count: r._count,
    }));
  }

  /**
   * 指定日数より古い通知を削除する（クリーンアップ）
   */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.prisma.notification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        status: { in: ['read', 'deleted'] },
      },
    });
    return result.count;
  }
}

// シングルトンインスタンスをエクスポート
export const dbNotificationRepository = new DbNotificationRepository();
