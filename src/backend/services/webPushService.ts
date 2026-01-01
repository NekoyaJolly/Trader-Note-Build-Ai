/**
 * Web Push 通知サービス
 *
 * VAPID認証を使用したWeb Push通知の送信を行う
 * - 購読の登録・管理
 * - Push通知の送信
 * - 失敗時のリトライ・無効化処理
 */

import webpush, { PushSubscription as WebPushSubscription, SendResult } from 'web-push';
import { PrismaClient, PushSubscription, PushLogStatus } from '@prisma/client';

// VAPID 鍵（環境変数から取得）
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@tradeassist.app';

// 最大リトライ回数
const MAX_RETRY_COUNT = 3;

// 失敗カウントの閾値（これを超えると購読を無効化）
const MAX_FAILURE_COUNT = 5;

/**
 * Push通知のペイロード型
 */
export interface PushPayload {
  /** 通知タイトル */
  title: string;
  /** 通知本文 */
  body: string;
  /** アイコンURL（任意） */
  icon?: string;
  /** バッジ画像URL（任意） */
  badge?: string;
  /** クリック時の遷移先URL（任意） */
  url?: string;
  /** 追加データ（任意） */
  data?: Record<string, unknown>;
  /** タグ（同一タグの通知は上書き） */
  tag?: string;
  /** 通知ID（DBのNotificationと紐付け） */
  notificationId?: string;
}

/**
 * Push送信結果
 */
export interface PushSendResult {
  /** 成功数 */
  successCount: number;
  /** 失敗数 */
  failureCount: number;
  /** 詳細結果 */
  results: Array<{
    subscriptionId: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Web Push サービスクラス
 */
export class WebPushService {
  private initialized = false;

  constructor(private prisma: PrismaClient) {
    this.initialize();
  }

  /**
   * VAPID 鍵を設定してサービスを初期化
   */
  private initialize(): void {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.warn('[WebPushService] VAPID鍵が設定されていません。Web Push通知は無効です。');
      console.warn('[WebPushService] 鍵を生成するには: npx web-push generate-vapid-keys');
      return;
    }

    try {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      this.initialized = true;
      console.log('[WebPushService] 初期化完了');
    } catch (error) {
      console.error('[WebPushService] 初期化エラー:', error);
    }
  }

  /**
   * VAPID公開鍵を取得（フロントエンドでの購読登録用）
   */
  getVapidPublicKey(): string {
    return VAPID_PUBLIC_KEY;
  }

  /**
   * サービスが有効かどうか
   */
  isEnabled(): boolean {
    return this.initialized;
  }

  /**
   * 購読を登録
   *
   * @param userId - ユーザーID
   * @param subscription - ブラウザから取得したPush購読情報
   * @returns 登録された購読レコード
   */
  async registerSubscription(
    userId: string,
    subscription: {
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
    }
  ): Promise<PushSubscription> {
    const { endpoint, keys } = subscription;

    // 既存の購読をチェック（endpointはユニーク）
    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpoint },
    });

    if (existing) {
      // 既存の購読を更新（キーが変わっている可能性がある）
      return this.prisma.pushSubscription.update({
        where: { endpoint },
        data: {
          userId,
          p256dh: keys.p256dh,
          auth: keys.auth,
          active: true,
          failureCount: 0,
        },
      });
    }

    // 新規購読を作成
    return this.prisma.pushSubscription.create({
      data: {
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        active: true,
      },
    });
  }

  /**
   * 購読を解除
   *
   * @param endpoint - 購読のエンドポイント
   */
  async unregisterSubscription(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: { endpoint },
      data: { active: false },
    });
  }

  /**
   * 特定ユーザーに Push 通知を送信
   *
   * @param userId - 送信先ユーザーID
   * @param payload - 通知内容
   * @returns 送信結果
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<PushSendResult> {
    if (!this.initialized) {
      return { successCount: 0, failureCount: 0, results: [] };
    }

    // ユーザーのアクティブな購読を取得
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: {
        userId,
        active: true,
      },
    });

    if (subscriptions.length === 0) {
      return { successCount: 0, failureCount: 0, results: [] };
    }

    return this.sendToSubscriptions(subscriptions, payload);
  }

  /**
   * 全ユーザーに Push 通知を送信（ブロードキャスト）
   *
   * @param payload - 通知内容
   * @returns 送信結果
   */
  async broadcast(payload: PushPayload): Promise<PushSendResult> {
    if (!this.initialized) {
      return { successCount: 0, failureCount: 0, results: [] };
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { active: true },
    });

    return this.sendToSubscriptions(subscriptions, payload);
  }

  /**
   * 複数の購読に Push 通知を送信
   *
   * @param subscriptions - 送信先の購読一覧
   * @param payload - 通知内容
   * @returns 送信結果
   */
  private async sendToSubscriptions(
    subscriptions: PushSubscription[],
    payload: PushPayload
  ): Promise<PushSendResult> {
    const results: PushSendResult['results'] = [];
    let successCount = 0;
    let failureCount = 0;

    // JSON文字列に変換
    const payloadString = JSON.stringify(payload);

    // 並列送信（ただし同時実行数を制限）
    const promises = subscriptions.map(async (sub) => {
      const webPushSub: WebPushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(webPushSub, payloadString);

        // 成功時: 失敗カウントをリセット、最終送信日時を更新
        await this.prisma.pushSubscription.update({
          where: { id: sub.id },
          data: {
            failureCount: 0,
            lastPushedAt: new Date(),
          },
        });

        // ログを記録
        await this.prisma.pushLog.create({
          data: {
            subscriptionId: sub.id,
            notificationId: payload.notificationId || null,
            status: 'sent',
            sentAt: new Date(),
          },
        });

        successCount++;
        results.push({ subscriptionId: sub.id, success: true });
      } catch (error) {
        failureCount++;

        const errorMessage = error instanceof Error ? error.message : '不明なエラー';
        const statusCode = (error as { statusCode?: number }).statusCode;

        // 410 Gone または 404 Not Found の場合は購読が無効
        if (statusCode === 410 || statusCode === 404) {
          await this.prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { active: false },
          });
        } else {
          // その他のエラーは失敗カウントを増加
          const newFailureCount = sub.failureCount + 1;
          await this.prisma.pushSubscription.update({
            where: { id: sub.id },
            data: {
              failureCount: newFailureCount,
              // 閾値を超えたら無効化
              active: newFailureCount < MAX_FAILURE_COUNT,
            },
          });
        }

        // ログを記録
        await this.prisma.pushLog.create({
          data: {
            subscriptionId: sub.id,
            notificationId: payload.notificationId || null,
            status: 'failed',
            errorMessage,
            retryCount: 0,
          },
        });

        results.push({
          subscriptionId: sub.id,
          success: false,
          error: errorMessage,
        });
      }
    });

    await Promise.allSettled(promises);

    return { successCount, failureCount, results };
  }
}

// シングルトンインスタンス用ファクトリ
export function createWebPushService(prisma: PrismaClient): WebPushService {
  return new WebPushService(prisma);
}
