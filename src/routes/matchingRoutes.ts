import { Router } from 'express';
import { MatchingController } from '../controllers/matchingController';

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
router.get('/history', matchingController.getMatchHistory);

export default router;
