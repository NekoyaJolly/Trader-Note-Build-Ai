import type { PrismaClient } from '@prisma/client';
import type { NotificationSender, NotificationPayload } from './notificationSender';
import { prisma } from '../../backend/db/client';
import { WebPushService } from '../../backend/services/webPushService';

/**
 * In-App Notification Sender
 *
 * 目的: Notification テーブルに通知レコードを保存する
 * 前提: MatchResult と Notification のリレーションを使用
 */
export class InAppNotificationSender implements NotificationSender {
  private prisma: PrismaClient;
  private webPushService: WebPushService;
  private isProduction: boolean;

  constructor(prismaClient?: PrismaClient, webPushService?: WebPushService) {
    this.prisma = prismaClient || prisma;
    this.webPushService = webPushService || new WebPushService(this.prisma);
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  /**
   * In-App 通知をデータベースに保存
   *
   * @param payload 通知ペイロード
   * @returns 保存された通知 ID、または失敗情報
   */
  async sendInApp(payload: NotificationPayload): Promise<{ success: boolean; id?: string }> {
    try {
      // MatchResult を取得（既に通知対象として特定されているはず）
      const matchResult = await this.prisma.matchResult.findFirst({
        where: {
          noteId: payload.noteId,
          marketSnapshotId: payload.marketSnapshotId,
        },
      });

      if (!matchResult) {
        // 本番環境では過度なログ出力を抑制
        if (!this.isProduction) {
          console.warn(
            `In-App 通知作成失敗: MatchResult が見つかりません (noteId=${payload.noteId}, snapshotId=${payload.marketSnapshotId})`
          );
        }
        return {
          success: false,
        };
      }

      // Notification レコードを作成
      // Phase α-4: MatchResult の所有ユーザーを通知にも伝播 (通知フィードのユーザー分離)
      const notification = await this.prisma.notification.create({
        data: {
          matchResultId: matchResult.id,
          title: payload.title,
          message: payload.message,
          status: 'unread',
          sentAt: new Date(),
          userId: matchResult.userId ?? undefined,
        },
      });

      // 本番環境ではデバッグログを抑制
      if (!this.isProduction) {
        console.log(
          `In-App 通知を作成しました: ${notification.title} (ID=${notification.id})`
        );
      }

      return {
        success: true,
        id: notification.id,
      };
    } catch (error) {
      console.error('In-App 通知作成エラー:', error);
      return {
        success: false,
      };
    }
  }

  /**
   * Web Push 通知を配信する。
   *
   * Phase β (per-user Push): 由来 MatchResult の所有ユーザー (userId、α-4a で伝播済み)
   * が分かる場合は、そのユーザーのアクティブ購読のみに送信する。userId が無い
   * レガシー行 / MatchResult 不在の場合は従来通り broadcast にフォールバックする
   * (単一ユーザー運用では挙動は実質同じ)。
   * VAPID 鍵未設定時は WebPushService が内部で空結果を返すので呼び出し側は気にしなくて良い。
   */
  async sendPush(payload: NotificationPayload): Promise<{ success: boolean; id?: string }> {
    try {
      // 宛先ユーザーを由来 MatchResult から解決する (複合ユニークキーで一意参照)。
      // MatchResult.userId が NULL のレガシー行は由来ノートの userId にフォールバック
      // して不要な broadcast (誤配送リスク) を避ける (PR #388 Copilot レビュー対応)
      const matchResult = await this.prisma.matchResult.findUnique({
        where: {
          noteId_marketSnapshotId: {
            noteId: payload.noteId,
            marketSnapshotId: payload.marketSnapshotId,
          },
        },
        select: { userId: true, note: { select: { userId: true } } },
      });
      const targetUserId = matchResult?.userId ?? matchResult?.note?.userId ?? null;

      const pushPayload = {
        title: payload.title,
        body: payload.message,
        url: `/notifications`,
        tag: `note-match-${payload.noteId}`,
        notificationId: payload.noteId,
        data: {
          noteId: payload.noteId,
          marketSnapshotId: payload.marketSnapshotId,
          symbol: payload.symbol,
          score: payload.score,
        },
      };

      const result = targetUserId
        ? await this.webPushService.sendToUser(targetUserId, pushPayload)
        : await this.webPushService.broadcast(pushPayload);

      if (!this.isProduction) {
        console.log(
          `[WebPush] ${targetUserId ? `sendToUser(${targetUserId})` : 'broadcast'}: ` +
            `symbol=${payload.symbol}, success=${result.successCount}, fail=${result.failureCount}`
        );
      }

      const ok = result.failureCount === 0 || result.successCount > 0;
      return {
        success: ok,
        id: ok ? `webpush_${payload.noteId}_${result.successCount}` : undefined,
      };
    } catch (error) {
      console.error('[WebPush] 配信エラー:', error);
      return { success: false };
    }
  }

  /**
   * Webhook（スタブ実装）
   * Phase4 では実装は不要。設定に基づいて Slack などへ通知する想定
   */
  sendWebhook(payload: NotificationPayload): Promise<{ success: boolean; id?: string }> {
    // 本番環境ではスタブログを抑制
    if (!this.isProduction) {
      console.log(
        `[スタブ] Webhook 通知: ${payload.symbol} - ${payload.title} (score=${payload.score})`
      );
    }
    return Promise.resolve({
      success: true,
      id: `webhook_stub_${Date.now()}`,
    });
  }
}
