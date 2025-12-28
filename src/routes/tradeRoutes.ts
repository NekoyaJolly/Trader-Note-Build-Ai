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
 * POST /api/trades/import/upload-text
 * クライアントから受け取った CSV テキストを保存して取り込み、Draft ノートを生成
 */
router.post('/import/upload-text', tradeController.uploadCSVText);

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

/**
 * POST /api/trades/notes/:id/approve
 * ノート承認（簡易）。ファイルに承認フラグを記録する。
 */
router.post('/notes/:id/approve', tradeController.approveNote);

export default router;
