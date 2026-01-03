/**
 * バックテスト関連のルート定義
 * 
 * Phase 5: ノート詳細からバックテストを実行可能にする
 * Phase 15: SSE進捗ストリーミング追加
 */

import { Router, Request, Response } from 'express';
import { backtestController } from '../controllers/backtestController';
import { progressStore } from '../services/backtest/progressStore';

const router = Router();

/**
 * POST /api/backtest/check-coverage
 * バックテスト実行前にデータカバレッジをチェック
 * 
 * Request Body:
 * {
 *   "symbol": "USD/JPY",
 *   "timeframe": "15m",
 *   "startDate": "2024-01-01T00:00:00Z",
 *   "endDate": "2024-03-31T23:59:59Z"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "hasEnoughData": true,
 *     "coverageRatio": 0.95,
 *     "missingBars": 50,
 *     "expectedBars": 1000,
 *     "actualBars": 950
 *   }
 * }
 */
router.post('/check-coverage', backtestController.checkCoverage);

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

/**
 * GET /api/backtest/progress/:jobId
 * バックテスト進捗をSSEでストリーミング
 * 
 * Response: Server-Sent Events
 * - event: progress
 * - data: { status, processedCandles, totalCandles, progressPercent, ohlcvData, indicators, tradeMarkers }
 */
router.get('/progress/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  
  // SSEヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx対応
  
  // 初期状態を送信
  const initialState = progressStore.getProgress(jobId);
  if (initialState) {
    res.write(`event: progress\n`);
    res.write(`data: ${JSON.stringify(initialState)}\n\n`);
  } else {
    // ジョブが見つからない場合
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: 'Job not found', jobId })}\n\n`);
  }
  
  // 進捗更新をリッスン
  const onProgress = (state: unknown) => {
    res.write(`event: progress\n`);
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };
  
  progressStore.on(`progress:${jobId}`, onProgress);
  
  // 接続終了時のクリーンアップ
  req.on('close', () => {
    progressStore.off(`progress:${jobId}`, onProgress);
  });
  
  // Keep-alive（30秒ごとにコメント送信）
  const keepAliveInterval = setInterval(() => {
    res.write(`: keep-alive\n\n`);
  }, 30000);
  
  req.on('close', () => {
    clearInterval(keepAliveInterval);
  });
});

export default router;
