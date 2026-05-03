/**
 * バックテスト関連のルート定義 (Critical-4 段階 3b 後の縮小版)
 *
 * 旧 endpoint (execute / :runId / history / progress) は段階 3 で完全撤去。
 * 残りは ストラテジー BT 画面の OHLCV 整合確認用 `POST /check-coverage` のみ。
 * 段階 4 で analysis-engine 寄せ込み完了時に本ファイル全体削除予定。
 */

import { Router } from 'express';
import { backtestController } from '../controllers/backtestController';
import { validateBody } from '../../middleware/validateRequest';
import { CheckCoverageRequestSchema } from '../../schemas/api/backtest';

const router = Router();

/**
 * POST /api/backtest/check-coverage
 * バックテスト実行前にデータカバレッジをチェック
 *
 * Request Body:
 * { symbol, timeframe, startDate (ISO), endDate (ISO) }
 *
 * Response:
 * { success: true, data: { hasEnoughData, coverageRatio, missingBars, expectedBars, actualBars } }
 */
router.post(
  '/check-coverage',
  validateBody(CheckCoverageRequestSchema),
  backtestController.checkCoverage,
);

export default router;
