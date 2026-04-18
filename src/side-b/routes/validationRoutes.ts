/**
 * Phase 4c/4d: 仮説検証 API ルーター
 *
 * /api/side-b/hypotheses/* 配下のサブルーター。
 * sideBRoutes.ts から `router.use('/hypotheses', validationRoutes)` で組み込まれる。
 *
 * エンドポイント:
 *   GET  /                            - 一覧（フィルタ/検索/ソート/ページネーション）  [Phase 4d]
 *   GET  /pending-validation          - screening_passed 一覧                         [Phase 4c]
 *   POST /:id/validate                - 手動で本格検証                                [Phase 4c]
 *   GET  /:id/validation-status       - 現在のステータス・レポート                    [Phase 4c]
 */

import { Router } from 'express';
import { validationController } from '../controllers/validationController';

const router = Router();

// 静的パスは :id より先に置く（Express のルートマッチ優先度のため）
router.get('/', validationController.listHypotheses);
router.get('/pending-validation', validationController.listPendingValidation);

router.post('/:id/validate', validationController.validate);
router.get('/:id/validation-status', validationController.getValidationStatus);

export { router as validationRoutes };
