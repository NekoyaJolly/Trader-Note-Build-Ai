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
import type { UserSettings } from '../../services/userSettingsService';
import { userSettingsService } from '../../services/userSettingsService';
import {
  NotificationPreferenceService,
  type UpsertPreferenceInput,
} from '../../services/notification/notificationPreferenceService';
import { validateBody } from '../../middleware/validateRequest';
import { UpdateSettingsRequestSchema } from '../../schemas/api/settings';

const router = Router();
const notificationPreferenceService = new NotificationPreferenceService();

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
    input.threshold = notification.scoreThreshold / 100;
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
      const updates = req.body as Partial<UserSettings>;
      const userId = req.user!.userId;
      const preferenceSyncInput = buildNotificationPreferenceSyncInput(updates.notification);

      const savedSettings = await userSettingsService.saveSettings(userId, updates);
      if (preferenceSyncInput !== null) {
        await notificationPreferenceService.upsertPreference(userId, preferenceSyncInput);
      }
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
    const settings = await userSettingsService.resetToDefault(req.user!.userId);
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
