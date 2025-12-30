/**
 * インジケーター設定API ルート
 * 
 * 目的:
 * - ユーザーのインジケーター設定を取得・保存するエンドポイントを提供
 * - サイドバーUIからの設定操作をサポート
 * 
 * エンドポイント:
 * - GET  /api/indicators/settings - 現在の設定を取得
 * - POST /api/indicators/settings - インジケーター設定を追加/更新
 * - DELETE /api/indicators/settings/:indicatorId - 設定を削除
 * - GET  /api/indicators/metadata - 利用可能なインジケーター一覧
 * - POST /api/indicators/settings/reset - デフォルトにリセット
 */

import { Router, Request, Response } from 'express';
import { indicatorSettingsService, SaveIndicatorConfigRequest } from '../services/indicatorSettingsService';
import { INDICATOR_METADATA, IndicatorId, IndicatorCategory } from '../models/indicatorConfig';

// ルーター作成
const router = Router();

/**
 * GET /api/indicators/settings
 * 現在のインジケーター設定を取得
 */
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await indicatorSettingsService.loadSettings();
    
    res.json({
      success: true,
      data: {
        activeSet: settings.activeSet,
        hasCompletedSetup: settings.hasCompletedSetup,
        updatedAt: settings.updatedAt,
      },
    });
  } catch (error) {
    console.error('インジケーター設定取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'インジケーター設定の取得に失敗しました',
    });
  }
});

/**
 * POST /api/indicators/settings
 * インジケーター設定を追加または更新
 * 
 * Body:
 * {
 *   indicatorId: string,
 *   params: { period?: number, ... },
 *   enabled?: boolean,
 *   label?: string
 * }
 */
router.post('/settings', async (req: Request, res: Response) => {
  try {
    const { indicatorId, params, enabled, label } = req.body as SaveIndicatorConfigRequest;

    // バリデーション
    if (!indicatorId) {
      return res.status(400).json({
        success: false,
        error: 'indicatorId は必須です',
      });
    }

    // メタデータの存在確認
    const metadata = INDICATOR_METADATA.find(m => m.id === indicatorId);
    if (!metadata) {
      return res.status(400).json({
        success: false,
        error: `不明なインジケーター: ${indicatorId}`,
      });
    }

    const config = await indicatorSettingsService.upsertIndicatorConfig({
      indicatorId: indicatorId as IndicatorId,
      params: params || metadata.defaultParams,
      enabled,
      label,
    });

    res.json({
      success: true,
      data: config,
      message: `${metadata.displayName} を保存しました`,
    });
  } catch (error) {
    console.error('インジケーター設定保存エラー:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'インジケーター設定の保存に失敗しました',
    });
  }
});

/**
 * DELETE /api/indicators/settings/:indicatorId
 * インジケーター設定を削除
 */
router.delete('/settings/:indicatorId', async (req: Request, res: Response) => {
  try {
    const { indicatorId } = req.params;

    // メタデータの存在確認
    const metadata = INDICATOR_METADATA.find(m => m.id === indicatorId);
    if (!metadata) {
      return res.status(400).json({
        success: false,
        error: `不明なインジケーター: ${indicatorId}`,
      });
    }

    await indicatorSettingsService.removeIndicatorConfig(indicatorId as IndicatorId);

    res.json({
      success: true,
      message: `${metadata.displayName} を削除しました`,
    });
  } catch (error) {
    console.error('インジケーター設定削除エラー:', error);
    res.status(500).json({
      success: false,
      error: 'インジケーター設定の削除に失敗しました',
    });
  }
});

/**
 * PATCH /api/indicators/settings/:indicatorId/toggle
 * インジケーターの有効/無効を切り替え
 * 
 * Body: { enabled: boolean }
 */
router.patch('/settings/:indicatorId/toggle', async (req: Request, res: Response) => {
  try {
    const { indicatorId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled は boolean 型が必要です',
      });
    }

    await indicatorSettingsService.toggleIndicatorConfig(indicatorId as IndicatorId, enabled);

    res.json({
      success: true,
      message: `インジケーターを${enabled ? '有効' : '無効'}にしました`,
    });
  } catch (error) {
    console.error('インジケータートグルエラー:', error);
    res.status(500).json({
      success: false,
      error: 'インジケーターの切り替えに失敗しました',
    });
  }
});

/**
 * GET /api/indicators/metadata
 * 利用可能なインジケーターのメタデータ一覧を取得
 * 
 * Query:
 * - category?: 'momentum' | 'trend' | 'volatility' | 'volume'
 */
router.get('/metadata', async (req: Request, res: Response) => {
  try {
    const { category } = req.query;

    let indicators = [...INDICATOR_METADATA];

    // カテゴリでフィルタリング
    if (category && typeof category === 'string') {
      indicators = indicators.filter(m => m.category === category as IndicatorCategory);
    }

    res.json({
      success: true,
      data: {
        indicators,
        categories: ['momentum', 'trend', 'volatility', 'volume'],
      },
    });
  } catch (error) {
    console.error('メタデータ取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'メタデータの取得に失敗しました',
    });
  }
});

/**
 * POST /api/indicators/settings/reset
 * 設定をデフォルトにリセット
 */
router.post('/settings/reset', async (_req: Request, res: Response) => {
  try {
    const settings = await indicatorSettingsService.resetToDefault();

    res.json({
      success: true,
      data: settings,
      message: 'インジケーター設定をデフォルトにリセットしました',
    });
  } catch (error) {
    console.error('リセットエラー:', error);
    res.status(500).json({
      success: false,
      error: 'リセットに失敗しました',
    });
  }
});

/**
 * GET /api/indicators/settings/setup-status
 * セットアップ状態を取得
 */
router.get('/settings/setup-status', async (_req: Request, res: Response) => {
  try {
    const hasCompleted = await indicatorSettingsService.hasCompletedSetup();

    res.json({
      success: true,
      data: {
        hasCompletedSetup: hasCompleted,
      },
    });
  } catch (error) {
    console.error('セットアップ状態取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'セットアップ状態の取得に失敗しました',
    });
  }
});

export default router;
