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
import { userSettingsService, UserSettings } from '../services/userSettingsService';

const router = Router();

/**
 * GET /api/settings
 * 現在のユーザー設定を取得
 */
router.get('/', async (_req, res) => {
  try {
    const settings = await userSettingsService.loadSettings();
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
 */
router.put('/', async (req, res) => {
  try {
    const updates = req.body as Partial<UserSettings>;
    
    // バリデーション
    if (updates.notification?.scoreThreshold !== undefined) {
      if (updates.notification.scoreThreshold < 0 || updates.notification.scoreThreshold > 100) {
        return res.status(400).json({
          success: false,
          error: 'scoreThreshold は 0-100 の範囲で指定してください',
        });
      }
    }
    
    if (updates.notification?.maxPerDay !== undefined) {
      if (updates.notification.maxPerDay < 1 || updates.notification.maxPerDay > 100) {
        return res.status(400).json({
          success: false,
          error: 'maxPerDay は 1-100 の範囲で指定してください',
        });
      }
    }
    
    const savedSettings = await userSettingsService.saveSettings(updates);
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
});

/**
 * POST /api/settings/reset
 * 設定をデフォルトにリセット
 */
router.post('/reset', async (_req, res) => {
  try {
    const settings = await userSettingsService.resetToDefault();
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
