/**
 * Push通知ルート
 *
 * Web Push 購読管理API
 * - GET /api/push/vapid-public-key - VAPID公開鍵取得
 * - POST /api/push/subscribe - 購読登録
 * - POST /api/push/unsubscribe - 購読解除
 * - POST /api/push/test - テスト通知送信
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { WebPushService } from '../services/webPushService';
import { requireAuth } from '../../middleware/authMiddleware';
import { getPrismaClient } from '../../infrastructure/prismaClient';

const router = Router();
const prisma = getPrismaClient();
const webPushService = new WebPushService(prisma);

// PushSubscription 形式の Zod スキーマ
const PushSubscriptionSchema = z.object({
  endpoint: z.string().min(1, 'endpoint は必須です'),
  keys: z.object({
    p256dh: z.string().min(1, 'keys.p256dh は必須です'),
    auth: z.string().min(1, 'keys.auth は必須です'),
  }),
});

// POST /api/push/subscribe のリクエストボディ
const SubscribeBodySchema = z.object({
  subscription: PushSubscriptionSchema,
});

// POST /api/push/unsubscribe のリクエストボディ
const UnsubscribeBodySchema = z.object({
  endpoint: z.string().min(1, 'endpoint は必須です'),
});

/**
 * GET /api/push/vapid-public-key
 * VAPID公開鍵を取得（フロントエンドでの購読登録に必要）
 */
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  const publicKey = webPushService.getVapidPublicKey();

  if (!publicKey) {
    res.status(503).json({
      success: false,
      error: 'Web Push通知は現在利用できません（VAPID鍵が設定されていません）',
    });
    return;
  }

  res.json({
    success: true,
    data: { publicKey },
  });
});

/**
 * GET /api/push/status
 * Web Pushサービスの状態を取得
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      enabled: webPushService.isEnabled(),
      hasVapidKey: !!webPushService.getVapidPublicKey(),
    },
  });
});

/**
 * POST /api/push/subscribe
 * Push通知を購読
 *
 * @body subscription - ブラウザから取得したPushSubscriptionオブジェクト
 *   - endpoint: string
 *   - keys.p256dh: string
 *   - keys.auth: string
 */
router.post('/subscribe', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Zod で req.body を具体型に narrow
    const parsed = SubscribeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: '購読情報が不正です。endpoint と keys (p256dh, auth) が必要です。',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    const { subscription } = parsed.data;

    const result = await webPushService.registerSubscription(userId, subscription);

    res.status(201).json({
      success: true,
      data: {
        id: result.id,
        endpoint: result.endpoint,
        active: result.active,
      },
      message: 'Push通知の購読を登録しました',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '購読の登録に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/push/unsubscribe
 * Push通知の購読を解除
 *
 * @body endpoint - 購読のエンドポイントURL
 */
router.post('/unsubscribe', requireAuth, async (req: Request, res: Response) => {
  try {
    // Zod で req.body を具体型に narrow
    const parsed = UnsubscribeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'endpoint は必須です',
      });
      return;
    }
    const { endpoint } = parsed.data;

    await webPushService.unregisterSubscription(endpoint);

    res.json({
      success: true,
      message: 'Push通知の購読を解除しました',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '購読の解除に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/push/test
 * テスト通知を送信（自分自身に）
 */
router.post('/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    if (!webPushService.isEnabled()) {
      res.status(503).json({
        success: false,
        error: 'Web Push通知は現在利用できません',
      });
      return;
    }

    const result = await webPushService.sendToUser(userId, {
      title: 'TradeAssist テスト通知',
      body: 'Web Push通知が正常に動作しています！',
      icon: '/icon-192x192.png',
      tag: 'test',
      url: '/',
    });

    if (result.successCount === 0 && result.failureCount === 0) {
      res.status(404).json({
        success: false,
        error: 'アクティブな購読が見つかりません。先に購読を登録してください。',
      });
      return;
    }

    res.json({
      success: true,
      data: result,
      message: `${result.successCount}件の通知を送信しました`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'テスト通知の送信に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
