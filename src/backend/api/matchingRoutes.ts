import { Router } from 'express';
import { MatchingController } from '../controllers/matchingController';
import { validateQuery } from '../../middleware/validateRequest';
import {
  GetMatchHistoryQuerySchema,
  GetPipelineRunsQuerySchema,
} from '../../schemas/api/matching';

const router = Router();
const matchingController = new MatchingController();

/**
 * POST /api/matching/check
 * Manually trigger match check
 */
router.post('/check', matchingController.checkMatches);

/**
 * GET /api/matching/history
 * Get match history
 */
router.get(
  '/history',
  validateQuery(GetMatchHistoryQuerySchema),
  matchingController.getMatchHistory
);

/**
 * GET /api/matching/pipeline-runs/latest
 * 最新の matching pipeline run を取得（observability）
 * 注: /pipeline-runs より先に登録する（/latest が :id 的に飲み込まれないように静的優先）
 */
router.get('/pipeline-runs/latest', matchingController.getLatestPipelineRun);

/**
 * GET /api/matching/pipeline-runs?limit=N
 * matching pipeline run 一覧を最新順で取得（observability）
 */
router.get(
  '/pipeline-runs',
  validateQuery(GetPipelineRunsQuerySchema),
  matchingController.getPipelineRuns
);

export default router;
