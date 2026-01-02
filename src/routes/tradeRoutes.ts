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

// ============================================
// フェーズ8: ノート優先度/有効無効管理
// ============================================

/**
 * PATCH /api/trades/notes/:id/priority
 * ノートの優先度を更新（1-10）
 */
router.patch('/notes/:id/priority', tradeController.updatePriority);

/**
 * PATCH /api/trades/notes/:id/enabled
 * ノートの有効/無効を切り替え
 */
router.patch('/notes/:id/enabled', tradeController.setEnabled);

/**
 * PATCH /api/trades/notes/:id/pause
 * ノートを一時停止（指定日時まで無効）
 */
router.patch('/notes/:id/pause', tradeController.setPausedUntil);

// ============================================
// フェーズ9: ノートパフォーマンス
// ============================================

/**
 * GET /api/trades/notes/performance/ranking
 * ノートランキングを取得（総合スコア順）
 * 
 * クエリパラメータ:
 * - limit: 取得件数（デフォルト: 20）
 * - from: 集計開始日時（ISO 8601）
 * - to: 集計終了日時（ISO 8601）
 * - timeframe: 時間足で絞り込み
 */
router.get('/notes/performance/ranking', tradeController.getPerformanceRanking);

/**
 * POST /api/trades/notes/performance/bulk
 * 複数ノートのパフォーマンスサマリーを一括取得
 * 
 * リクエストボディ:
 * - noteIds: string[] - ノート ID 配列
 * - from?: 集計開始日時
 * - to?: 集計終了日時
 */
router.post('/notes/performance/bulk', tradeController.getBulkPerformanceSummary);

/**
 * GET /api/trades/notes/:id/performance
 * ノートのパフォーマンスレポートを取得
 * 
 * クエリパラメータ:
 * - from: 集計開始日時（ISO 8601）
 * - to: 集計終了日時（ISO 8601）
 * - timeframe: 時間足で絞り込み
 * - weakThreshold: 弱いパターン検出閾値（0.0〜1.0）
 */
router.get('/notes/:id/performance', tradeController.getPerformanceReport);

/**
 * POST /api/trades/notes/:id/similar
 * 特定のノートに類似したノートを検索
 * 
 * リクエストボディ:
 * - threshold: 類似度閾値（0.0〜1.0、デフォルト: 0.70）
 * - limit: 最大件数（デフォルト: 10）
 */
router.post('/notes/:id/similar', tradeController.findSimilarNotes);

export default router;
