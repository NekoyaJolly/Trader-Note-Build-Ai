/**
 * バックテスト関連のルート定義
 * 
 * Phase 5: ノート詳細からバックテストを実行可能にする
 */

import { Router } from 'express';
import { backtestController } from '../controllers/backtestController';

const router = Router();

/**
 * POST /api/backtest/execute
 * バックテストを実行する
 * 
 * Request Body:
 * {
 *   "noteId": "uuid",
 *   "startDate": "2024-01-01T00:00:00Z",
 *   "endDate": "2024-03-31T23:59:59Z",
 *   "timeframe": "15m",
 *   "matchThreshold": 0.75,
 *   "takeProfit": 2.0,
 *   "stopLoss": 1.0,
 *   "maxHoldingMinutes": 1440,
 *   "tradingCost": 0.1
 * }
 * 
 * Response:
 * {
 *   "message": "バックテストを開始しました",
 *   "runId": "uuid"
 * }
 */
router.post('/execute', backtestController.execute);

/**
 * GET /api/backtest/:runId
 * バックテスト結果を取得する
 * 
 * Response:
 * {
 *   "runId": "uuid",
 *   "status": "completed",
 *   "setupCount": 50,
 *   "winCount": 30,
 *   "lossCount": 15,
 *   "timeoutCount": 5,
 *   "winRate": 0.6,
 *   "profitFactor": 2.1,
 *   "totalProfit": 150,
 *   "totalLoss": 71.43,
 *   "averagePnL": 1.57,
 *   "expectancy": 1.2,
 *   "maxDrawdown": 25.5,
 *   "events": [...]
 * }
 */
router.get('/:runId', backtestController.getResult);

/**
 * GET /api/backtest/history/:noteId
 * ノートのバックテスト履歴を取得する
 * 
 * Query Parameters:
 * - limit: 取得件数（デフォルト: 10, 最大: 50）
 * 
 * Response:
 * {
 *   "history": [...]
 * }
 */
router.get('/history/:noteId', backtestController.getHistory);

export default router;
