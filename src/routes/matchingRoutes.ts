import { Router } from 'express';
import { MatchingController } from '../controllers/matchingController';
import { validateQuery } from '../middleware/validateRequest';
import { GetMatchHistoryQuerySchema } from '../schemas/api/matching';

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

export default router;
