import { Router } from 'express';
import { TradeController } from '../controllers/tradeController';

const router = Router();
const tradeController = new TradeController();

/**
 * POST /api/trades/import/csv
 * Import trades from CSV file
 */
router.post('/import/csv', tradeController.importCSV);

/**
 * POST /api/trades/import/api
 * Import trades from exchange API
 */
router.post('/import/api', tradeController.importAPI);

/**
 * GET /api/trades/notes
 * Get all trade notes
 */
router.get('/notes', tradeController.getAllNotes);

/**
 * GET /api/trades/notes/:id
 * Get specific trade note
 */
router.get('/notes/:id', tradeController.getNoteById);

export default router;
