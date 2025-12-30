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
 * Get all trade notes (クエリパラメータで status フィルタ可能)
 */
router.get('/notes', tradeController.getAllNotes);

/**
 * GET /api/trades/notes/status-counts
 * ステータス別のノート件数を取得
 */
router.get('/notes/status-counts', tradeController.getStatusCounts);

/**
 * GET /api/trades/notes/:id
 * Get specific trade note
 */
router.get('/notes/:id', tradeController.getNoteById);

/**
 * PUT /api/trades/notes/:id
 * ノートの内容を更新（AI 要約、ユーザーメモ、タグ）
 */
router.put('/notes/:id', tradeController.updateNote);

/**
 * POST /api/trades/notes/:id/approve
 * ノートを承認する（マッチング対象になる）
 */
router.post('/notes/:id/approve', tradeController.approveNote);

/**
 * POST /api/trades/notes/:id/reject
 * ノートを非承認にする（マッチング対象外、アーカイブ扱い）
 */
router.post('/notes/:id/reject', tradeController.rejectNote);

/**
 * POST /api/trades/notes/:id/revert-to-draft
 * ノートを下書き状態に戻す
 */
router.post('/notes/:id/revert-to-draft', tradeController.revertToDraft);

export default router;
