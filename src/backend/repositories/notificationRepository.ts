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
  /**
   * 通知の宛先ユーザー (Phase α-4 マルチユーザー分離)。
   * 由来エンティティ (TradeNote / Strategy) の所有ユーザーを伝播させる。
   */
  userId?: string | null;
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
  /** 宛先ユーザーで絞り込み (Phase α-4)。HTTP 経路では必ず指定 */
  userId?: string;
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
        userId: input.userId ?? undefined,
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
    const { status, symbol, limit = 50, offset = 0, includeMatch = false, userId } = options;
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

    if (userId) {
      where.userId = userId;
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
  async findUnread(limit: number = 50, userId?: string): Promise<NotificationWithMatch[]> {
    return await this.findWithOptions({
      status: 'unread',
      limit,
      includeMatch: true,
      userId,
    }) as NotificationWithMatch[];
  }

  /**
   * 全通知を取得する（ページング付き）
   */
  async findAll(limit: number = 50, offset: number = 0, userId?: string): Promise<NotificationWithMatch[]> {
    return await this.findWithOptions({
      limit,
      offset,
      includeMatch: true,
      userId,
    }) as NotificationWithMatch[];
  }

  /**
   * UI フィードに表示する通知（ソフトデリート済みを除く未読/既読）を新しい順に取得する。
   * delete はソフトデリート（status=deleted）のため、フィードからは本メソッドで除外する。
   * 物理削除は deleteOlderThan の定期クリーンアップが担う。
   */
  async findActiveForFeed(limit: number = 500, offset: number = 0, userId?: string): Promise<NotificationWithMatch[]> {
    return await this.findWithOptions({
      status: ['unread', 'read'],
      limit,
      offset,
      includeMatch: true,
      userId,
    }) as NotificationWithMatch[];
  }

  /**
   * 更新系操作の宛先ユーザーチェック (Phase α-4 マルチユーザー分離)。
   * userId 指定時、対象通知が宛先ユーザーのものでなければエラーを投げる。
   */
  private async assertOwnership(id: string, userId?: string): Promise<void> {
    if (!userId) return;
    const owned = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) {
      throw new Error(`通知が見つかりませんでした: ${id}`);
    }
  }

  /**
   * 通知を既読にする
   */
  async markAsRead(id: string, userId?: string): Promise<Notification> {
    await this.assertOwnership(id, userId);
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
  async markAllAsRead(userId?: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { status: 'unread', ...(userId ? { userId } : {}) },
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
  async softDelete(id: string, userId?: string): Promise<Notification> {
    await this.assertOwnership(id, userId);
    return await this.prisma.notification.update({
      where: { id },
      data: { status: 'deleted' },
    });
  }

  /**
   * すべての未読/既読通知をソフトデリート（status=deleted）する。返り値は対象件数。
   * 「全クリア」操作（DELETE /api/notifications）の DB 永続化に使う。
   */
  async softDeleteAll(userId?: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { status: { in: ['unread', 'read'] }, ...(userId ? { userId } : {}) },
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
  async countUnread(userId?: string): Promise<number> {
    return await this.prisma.notification.count({
      where: { status: 'unread', ...(userId ? { userId } : {}) },
    });
  }

  /**
   * カーソル (createdAt, id) より後に作成された宛先ユーザーの通知を古い順に返す
   * (Phase δ-3 通知 SSE 用)。SSE のサーバ側ポーリングが「前回カーソル以降の新着」を
   * 差分取得するために使う。一覧 (findActiveForFeed) と同じく userId 厳密一致で
   * 他ユーザーへ漏らさない。
   *
   * カーソルを複合 (createdAt, id) にする理由: createdAt のみの `gt` だと、同一
   * createdAt の通知が複数行ある場合に「前回最後と同時刻の残り」を取りこぼす。
   * id (uuid) は時系列ではないが、(createdAt, id) の辞書順で安定・完全に走査できる。
   */
  async findCreatedSince(
    userId: string,
    since: Date,
    sinceId: string = '',
    limit: number = 50
  ): Promise<Notification[]> {
    return await this.prisma.notification.findMany({
      where: {
        userId,
        status: { in: ['unread', 'read'] },
        OR: [
          { createdAt: { gt: since } },
          { createdAt: since, id: { gt: sinceId } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
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
