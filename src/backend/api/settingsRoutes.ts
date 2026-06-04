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
import { validateBody } from '../../middleware/validateRequest';
import { UpdateSettingsRequestSchema } from '../../schemas/api/settings';

const router = Router();

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

      const savedSettings = await userSettingsService.saveSettings(req.user!.userId, updates);
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
