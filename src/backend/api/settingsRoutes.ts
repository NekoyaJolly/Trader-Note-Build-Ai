/**
 * 設定 API ルート
 * 
 * エンドポイント:
 * - GET  /api/settings - 現在の設定を取得
 * - PUT  /api/settings - 設定を更新
 * - POST /api/settings/reset - デフォルトにリセット
 * 
 * @see src/services/userSettingsService.ts
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { UserSettings, UserSettingsUpdate } from '../../services/userSettingsService';
import { UserSettingsService, userSettingsService } from '../../services/userSettingsService';
import {
  NotificationPreferenceService,
  type UpsertPreferenceInput,
} from '../../services/notification/notificationPreferenceService';
import { validateBody } from '../../middleware/validateRequest';
import { UpdateSettingsRequestSchema } from '../../schemas/api/settings';
import { prisma } from '../db/client';

const router = Router();

/** NotificationPreference の weak 下限と合わせる旧設定スライダーの実効下限。 */
export const MIN_NOTIFICATION_SCORE_THRESHOLD = 70;

function normalizeNotificationScoreThreshold(scoreThreshold: number): number {
  return Math.max(scoreThreshold, MIN_NOTIFICATION_SCORE_THRESHOLD);
}

/**
 * 旧 /api/settings で受けた通知設定を、現在の通知粒度基盤で実際に効く値へ正規化する。
 * API互換を保つため 70 未満を 400 Bad Request にせず、保存前に実効下限へ丸める。
 */
export function normalizeSettingsUpdateForNotificationPreference(
  updates: UserSettingsUpdate
): UserSettingsUpdate {
  if (updates.notification?.scoreThreshold === undefined) {
    return updates;
  }

  return {
    ...updates,
    notification: {
      ...updates.notification,
      scoreThreshold: normalizeNotificationScoreThreshold(updates.notification.scoreThreshold),
    },
  };
}

/**
 * 旧 /api/settings の通知スライダーを、現在の通知判定で実際に参照される
 * NotificationPreference(user scope) へ同期する。
 *
 * enabled は NotificationPreference に対応フィールドが無いため、ここでは既存互換の
 * UserSettings にのみ保存する。実際の通知粒度は threshold / maxPerDay を同期する。
 */
export function buildNotificationPreferenceSyncInput(
  notification: Partial<UserSettings['notification']> | undefined
): UpsertPreferenceInput | null {
  if (!notification) {
    return null;
  }

  const input: UpsertPreferenceInput = { scope: 'user' };
  let shouldSync = false;

  if (notification.scoreThreshold !== undefined) {
    input.threshold = normalizeNotificationScoreThreshold(notification.scoreThreshold) / 100;
    shouldSync = true;
  }

  if (notification.maxPerDay !== undefined) {
    input.maxPerDay = notification.maxPerDay;
    shouldSync = true;
  }

  return shouldSync ? input : null;
}

/**
 * GET /api/settings
 * 現在のユーザー設定を取得
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const settings = await userSettingsService.loadSettings(req.user!.userId);
    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error('[SettingsRoutes] 設定読み込みエラー:', error);
    res.status(500).json({
      success: false,
      error: '設定の読み込みに失敗しました',
    });
  }
});

/**
 * PUT /api/settings
 * ユーザー設定を更新
 * 
 * リクエストボディ:
 * {
 *   notification?: { enabled?, scoreThreshold?, maxPerDay? },
 *   timeframes?: { primary?, secondary? },
 *   display?: { darkMode?, compactView?, showAiSuggestions? }
 * }
 * 
 * バリデーション: Zodスキーマで自動実行
 */
router.put(
  '/',
  validateBody(UpdateSettingsRequestSchema),
  async (req: Request, res: Response) => {
    try {
      const updates = normalizeSettingsUpdateForNotificationPreference(req.body as UserSettingsUpdate);
      const userId = req.user!.userId;
      const preferenceSyncInput = buildNotificationPreferenceSyncInput(updates.notification);

      const savedSettings = await prisma.$transaction(async (tx) => {
        const settingsService = new UserSettingsService(tx);
        const preferenceService = new NotificationPreferenceService(tx);
        const saved = await settingsService.saveSettings(userId, updates);
        if (preferenceSyncInput !== null) {
          await preferenceService.upsertPreference(userId, preferenceSyncInput);
        }
        return saved;
      });
      res.json({
        success: true,
        data: savedSettings,
        message: '設定を保存しました',
      });
    } catch (error) {
      console.error('[SettingsRoutes] 設定保存エラー:', error);
      res.status(500).json({
        success: false,
        error: '設定の保存に失敗しました',
      });
    }
  }
);

/**
 * POST /api/settings/reset
 * 設定をデフォルトにリセット
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const settings = await prisma.$transaction(async (tx) => {
      const settingsService = new UserSettingsService(tx);
      const preferenceService = new NotificationPreferenceService(tx);
      const resetSettings = await settingsService.resetToDefault(userId);
      const preferenceSyncInput = buildNotificationPreferenceSyncInput(resetSettings.notification);
      if (preferenceSyncInput !== null) {
        await preferenceService.upsertPreference(userId, preferenceSyncInput);
      }
      return resetSettings;
    });
    res.json({
      success: true,
      data: settings,
      message: '設定をデフォルトにリセットしました',
    });
  } catch (error) {
    console.error('[SettingsRoutes] 設定リセットエラー:', error);
    res.status(500).json({
      success: false,
      error: '設定のリセットに失敗しました',
    });
  }
});

export default router;
