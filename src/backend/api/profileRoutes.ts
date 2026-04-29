/**
 * インジケータープロファイルAPI ルート
 * 
 * 目的:
 * - 複数のインジケータープロファイルの管理（CRUD）
 * - CSVインポート時のプロファイル選択をサポート
 * - 特殊オプション（AIに任せる、プロファイルなし）を含む選択肢を提供
 * 
 * エンドポイント:
 * - GET    /api/profiles         - 全プロファイル取得
 * - GET    /api/profiles/options - 選択オプション取得（特殊含む）
 * - GET    /api/profiles/:id     - プロファイル取得
 * - POST   /api/profiles         - プロファイル作成
 * - PUT    /api/profiles/:id     - プロファイル更新
 * - DELETE /api/profiles/:id     - プロファイル削除
 * - PUT    /api/profiles/:id/default - デフォルト設定
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { getIndicatorProfileService } from '../../services/indicatorProfileService';
import { isReservedProfileId } from '../../models/indicatorProfile';
import { validateBody, validateParams } from '../../middleware/validateRequest';
import {
  CreateProfileRequestSchema,
  UpdateProfileRequestSchema,
} from '../../schemas/api/profile';
import { z } from 'zod';

const router = Router();

// URLパラメータ用スキーマ
const IdParamSchema = z.object({
  id: z.string().min(1, 'IDは必須です'),
});

/**
 * GET /api/profiles
 * 全プロファイルを取得
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const profileService = getIndicatorProfileService();
    const profiles = profileService.getAllProfiles();

    res.json({
      success: true,
      data: profiles,
    });
  } catch (error) {
    console.error('プロファイル取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'プロファイルの取得に失敗しました',
    });
  }
});

/**
 * GET /api/profiles/options
 * プロファイル選択オプションを取得（特殊オプション含む）
 * 
 * CSVインポートUIのドロップダウンで使用
 */
router.get('/options', (_req: Request, res: Response) => {
  try {
    const profileService = getIndicatorProfileService();
    const options = profileService.getProfileOptions();
    const defaultId = profileService.getDefaultProfileId();

    res.json({
      success: true,
      data: {
        options,
        defaultId,
      },
    });
  } catch (error) {
    console.error('プロファイルオプション取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'プロファイルオプションの取得に失敗しました',
    });
  }
});

/**
 * GET /api/profiles/:id
 * 特定のプロファイルを取得
 */
router.get(
  '/:id',
  validateParams(IdParamSchema),
  (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // 予約IDの場合は特別なレスポンス
      if (isReservedProfileId(id)) {
        res.json({
          success: true,
          data: {
            id,
            isReserved: true,
            name: id === '__AI_AUTO__' ? 'AIに任せる' : 'プロファイルなし',
          },
        });
        return;
      }

      const profileService = getIndicatorProfileService();
      const profile = profileService.getProfileById(id);

      if (!profile) {
        res.status(404).json({
          success: false,
          error: 'プロファイルが見つかりません',
        });
        return;
      }

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      console.error('プロファイル取得エラー:', error);
      res.status(500).json({
        success: false,
        error: 'プロファイルの取得に失敗しました',
      });
    }
  },
);

/**
 * POST /api/profiles
 * プロファイルを作成
 * 
 * Body:
 * {
 *   name: string,
 *   description?: string,
 *   indicators: IndicatorConfig[],
 *   isDefault?: boolean
 * }
 */
router.post(
  '/',
  validateBody(CreateProfileRequestSchema),
  (req: Request, res: Response) => {
    try {
      const request = CreateProfileRequestSchema.parse(req.body);

      const profileService = getIndicatorProfileService();
      const profile = profileService.createProfile(request);

      res.status(201).json({
        success: true,
        data: profile,
        message: 'プロファイルを作成しました',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'プロファイルの作成に失敗しました';
      console.error('プロファイル作成エラー:', message);
      res.status(400).json({
        success: false,
        error: message,
      });
    }
  }
);

/**
 * PUT /api/profiles/:id
 * プロファイルを更新
 * 
 * Body:
 * {
 *   name?: string,
 *   description?: string,
 *   indicators?: IndicatorConfig[],
 *   isDefault?: boolean
 * }
 */
router.put(
  '/:id',
  validateParams(IdParamSchema),
  validateBody(UpdateProfileRequestSchema),
  (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const request = UpdateProfileRequestSchema.parse(req.body);

      const profileService = getIndicatorProfileService();
      const profile = profileService.updateProfile(id, request);

      res.json({
        success: true,
        data: profile,
        message: 'プロファイルを更新しました',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'プロファイルの更新に失敗しました';
      console.error('プロファイル更新エラー:', message);
      res.status(400).json({
        success: false,
        error: message,
      });
    }
  }
);

/**
 * DELETE /api/profiles/:id
 * プロファイルを削除
 */
router.delete(
  '/:id',
  validateParams(IdParamSchema),
  (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const profileService = getIndicatorProfileService();
      profileService.deleteProfile(id);

      res.json({
        success: true,
        message: 'プロファイルを削除しました',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'プロファイルの削除に失敗しました';
      console.error('プロファイル削除エラー:', message);
      res.status(400).json({
        success: false,
        error: message,
      });
    }
  }
);

/**
 * PUT /api/profiles/:id/default
 * プロファイルをデフォルトに設定
 */
router.put(
  '/:id/default',
  validateParams(IdParamSchema),
  (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const profileService = getIndicatorProfileService();
      const profile = profileService.updateProfile(id, { isDefault: true });

      res.json({
        success: true,
        data: profile,
        message: 'デフォルトプロファイルを設定しました',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'デフォルト設定に失敗しました';
      console.error('デフォルト設定エラー:', message);
      res.status(400).json({
        success: false,
        error: message,
      });
    }
  }
);

export default router;
