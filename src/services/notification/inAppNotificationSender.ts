import { PrismaClient } from '@prisma/client';
import { NotificationSender, NotificationPayload } from './notificationSender';
import { prisma } from '../../backend/db/client';

/**
 * In-App Notification Sender
 * 
 * 目的: Notification テーブルに通知レコードを保存する
 * 前提: MatchResult と Notification のリレーションを使用
 */
export class InAppNotificationSender implements NotificationSender {
  private prisma: PrismaClient;
  // 本番環境かどうかを判定（ログ出力制御用）
  private isProduction: boolean;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
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
      const notification = await this.prisma.notification.create({
        data: {
          matchResultId: matchResult.id,
          title: payload.title,
          message: payload.message,
          status: 'unread',
          sentAt: new Date(),
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
   * Push 通知（スタブ実装）
   * Phase4 では実装は不要。Phase5 以降で FCM/APNs を統合する想定
   */
  async sendPush(payload: NotificationPayload): Promise<{ success: boolean; id?: string }> {
    // 本番環境ではスタブログを抑制
    if (!this.isProduction) {
      console.log(
        `[スタブ] Push 通知: ${payload.symbol} - ${payload.title} (score=${payload.score})`
      );
    }
    return {
      success: true,
      id: `push_stub_${Date.now()}`,
    };
  }

  /**
   * Webhook（スタブ実装）
   * Phase4 では実装は不要。設定に基づいて Slack などへ通知する想定
   */
  async sendWebhook(payload: NotificationPayload): Promise<{ success: boolean; id?: string }> {
    // 本番環境ではスタブログを抑制
    if (!this.isProduction) {
      console.log(
        `[スタブ] Webhook 通知: ${payload.symbol} - ${payload.title} (score=${payload.score})`
      );
    }
    return {
      success: true,
      id: `webhook_stub_${Date.now()}`,
    };
  }
}
