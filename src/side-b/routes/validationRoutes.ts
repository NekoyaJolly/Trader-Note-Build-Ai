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
 *   GET  /:id                         - 個別仮説取得                                  [Phase 4d]
 *   GET  /:id/validation-status       - 現在のステータス・レポート                    [Phase 4c]
 *   GET  /:id/validation-history      - 検証履歴エントリ配列                          [Phase 4d]
 *   GET  /testing                     - testing 一覧                                 [Phase 4d Step 5]
 *   GET  /recently-validated          - 直近で検証完了した仮説                       [Phase 4d Step 5]
 *   POST /batch-validate              - 最大10件バッチ検証                         [Phase 4d Step 5]
 *   GET  /recent-confirmed            - 最新の confirmed 一覧（limit）             [Phase 4d Step 6]
 *   GET  /recent-rejected             - 最新の rejected 一覧（limit）                [Phase 4d Step 6]
 */

import { Router } from 'express';
import { validationController } from '../controllers/validationController';
import { requireRole } from '../../middleware/authMiddleware';

const router = Router();
const requireAdmin = requireRole(['admin']);

// 静的パスは :id より先に置く（Express のルートマッチ優先度のため）
router.get('/', validationController.listHypotheses);
router.get('/pending-validation', validationController.listPendingValidation);
router.get('/testing', validationController.listTesting);
router.get('/recently-validated', validationController.listRecentlyValidated);
router.get('/recent-confirmed', validationController.listRecentConfirmed);
router.get('/recent-rejected', validationController.listRecentRejected);
router.post('/batch-validate', requireAdmin, validationController.batchValidate);

router.post('/:id/validate', requireAdmin, validationController.validate);
router.get('/:id', validationController.getHypothesis);
router.get('/:id/validation-status', validationController.getValidationStatus);
router.get('/:id/validation-history', validationController.getValidationHistory);

export { router as validationRoutes };
