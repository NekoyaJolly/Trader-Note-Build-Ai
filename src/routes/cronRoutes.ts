/**
 * Cronエンドポイント
 * 
 * 目的: 外部Cronサービスから呼び出される自動実行エンドポイント
 * 
 * エンドポイント:
 * - GET /api/cron/side-b/daily-plan - 日次プラン生成（毎朝）
 * - GET /api/cron/side-b/monitor - 監視実行（毎時）
 * - GET /api/cron/health - ヘルスチェック
 * 
 * 認証: CRON_SECRET による Bearer 認証
 * 
 * @see src/middleware/cronAuth.ts
 */

import { Router, Request, Response } from 'express';
import { cronAuth } from '../middleware/cronAuth';
import { getSideBScheduler } from '../side-b/jobs/sideBScheduler';
import { isFXMarketOpen, getMarketStatusJST } from '../side-b/utils/marketHours';

const router = Router();

// 全Cronエンドポイントに認証を適用
router.use(cronAuth);

/**
 * GET /api/cron/health
 * Cronヘルスチェック
 */
router.get('/health', (_req: Request, res: Response) => {
  const marketStatus = getMarketStatusJST();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    market: {
      isOpen: marketStatus.isOpen,
      message: marketStatus.message,
    },
  });
});

/**
 * GET /api/cron/side-b/daily-plan
 * 日次プラン生成（Research → Plan → Trade）
 * 
 * 推奨実行時刻: 毎日 00:00 UTC（09:00 JST）
 * 
 * 動作:
 * 1. 市場開場チェック（休場時はスキップ）
 * 2. 各シンボルのOHLCVデータ取得
 * 3. Research AI → Plan AI → VirtualTrade作成
 */
router.get('/side-b/daily-plan', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    console.log('[Cron] 日次プラン生成を開始します');

    // 市場開場チェック
    if (!isFXMarketOpen()) {
      const marketStatus = getMarketStatusJST();
      console.log('[Cron] 市場休場のためスキップ:', marketStatus.message);
      res.json({
        success: true,
        skipped: true,
        reason: '市場休場',
        market: marketStatus.message,
        duration: Date.now() - startTime,
      });
      return;
    }

    // スケジューラーから日次プランを実行
    const scheduler = getSideBScheduler();
    const result = await scheduler.runDailyPlanNow();

    console.log('[Cron] 日次プラン生成完了:', result.message);

    res.json({
      success: result.success,
      message: result.message,
      data: result.data,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron] 日次プラン生成エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

/**
 * GET /api/cron/side-b/monitor
 * 監視実行（エントリー/決済判定）
 * 
 * 推奨実行間隔: 毎時（0分）
 * 
 * 動作:
 * 1. 市場開場チェック（休場時はスキップ）
 * 2. 1分足60本を取得
 * 3. 高安値ベースでエントリー/決済判定
 * 4. 決済時はAIノート自動生成
 */
router.get('/side-b/monitor', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    console.log('[Cron] 監視実行を開始します');

    // 市場開場チェック
    if (!isFXMarketOpen()) {
      const marketStatus = getMarketStatusJST();
      console.log('[Cron] 市場休場のためスキップ:', marketStatus.message);
      res.json({
        success: true,
        skipped: true,
        reason: '市場休場',
        market: marketStatus.message,
        duration: Date.now() - startTime,
      });
      return;
    }

    // スケジューラーから監視を実行
    const scheduler = getSideBScheduler();
    const result = await scheduler.runMonitorNow();

    console.log('[Cron] 監視実行完了:', result.message);

    res.json({
      success: result.success,
      message: result.message,
      data: result.data,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron] 監視実行エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

export default router;
