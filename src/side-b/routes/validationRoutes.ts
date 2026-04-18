/**
 * Phase 4c: 仮説検証 API ルーター
 *
 * /api/side-b/hypotheses/* 配下のサブルーター。
 * sideBRoutes.ts から `router.use('/hypotheses', validationRoutes)` で組み込まれる。
 *
 * エンドポイント:
 *   GET  /pending-validation          - screening_passed 一覧
 *   POST /:id/validate                - 手動で本格検証
 *   GET  /:id/validation-status       - 現在のステータス・レポート
 */

import { Router } from 'express';
import { validationController } from '../controllers/validationController';

const router = Router();

// pending 一覧は :id より先に置く（Express のルートマッチ優先度のため）
router.get('/pending-validation', validationController.listPendingValidation);

router.post('/:id/validate', validationController.validate);
router.get('/:id/validation-status', validationController.getValidationStatus);

export { router as validationRoutes };
