/**
 * Side-B ルーティング
 * 
 * エンドポイント:
 * 
 * リサーチ:
 * - POST   /api/side-b/research           - リサーチ生成
 * - GET    /api/side-b/research           - リサーチ一覧
 * - GET    /api/side-b/research/:id       - リサーチ取得
 * - GET    /api/side-b/research/valid/:symbol - 有効なリサーチ取得
 * 
 * プラン:
 * - POST   /api/side-b/plans              - プラン生成
 * - GET    /api/side-b/plans              - プラン一覧
 * - GET    /api/side-b/plans/:id          - プラン取得
 * - GET    /api/side-b/plans/today/:symbol - 今日のプラン取得
 * 
 * パイプライン:
 * - POST   /api/side-b/pipeline           - フルパイプライン実行
 * 
 * 仮想トレード (Phase B):
 * - POST   /api/side-b/trades             - 仮想トレード作成
 * - GET    /api/side-b/trades             - 仮想トレード一覧
 * - GET    /api/side-b/trades/:id         - 仮想トレード詳細
 * - POST   /api/side-b/trades/:id/close   - 仮想トレード決済
 * - POST   /api/side-b/trades/:id/cancel  - 仮想トレードキャンセル
 * 
 * ポートフォリオ (Phase B):
 * - GET    /api/side-b/portfolio          - ポートフォリオ取得
 * - PUT    /api/side-b/portfolio/settings - ポートフォリオ設定更新
 * 
 * 管理:
 * - POST   /api/side-b/cleanup            - 期限切れデータ削除
 */

import { Router } from 'express';
import { sideBController } from '../controllers';

const router = Router();

// ===========================================
// リサーチ
// ===========================================

/**
 * POST /api/side-b/research
 * リサーチを生成（キャッシュ対応）
 * 
 * Body:
 * - symbol: string (必須)
 * - timeframe?: string
 * - ohlcvData: Array<{timestamp, open, high, low, close, volume?}> (必須)
 * - indicators?: object
 * - forceRefresh?: boolean (キャッシュ無視)
 */
router.post('/research', sideBController.generateResearch);

/**
 * GET /api/side-b/research
 * リサーチ一覧を取得
 * 
 * Query:
 * - symbol?: string
 * - validOnly?: boolean
 * - limit?: number
 * - offset?: number
 */
router.get('/research', sideBController.listResearch);

/**
 * GET /api/side-b/research/valid/:symbol
 * 有効なリサーチを取得（キャッシュチェック用）
 */
router.get('/research/valid/:symbol', sideBController.getValidResearch);

/**
 * GET /api/side-b/research/:id
 * リサーチを取得
 */
router.get('/research/:id', sideBController.getResearchById);

// ===========================================
// プラン
// ===========================================

/**
 * POST /api/side-b/plans
 * プランを生成
 * 
 * Body:
 * - symbol: string (必須)
 * - targetDate?: string (YYYY-MM-DD)
 * - researchId?: string (指定しない場合はohlcvDataから生成)
 * - userPreferences?: object
 * - ohlcvData?: Array (researchIdがない場合必須)
 * - indicators?: object
 */
router.post('/plans', sideBController.generatePlan);

/**
 * GET /api/side-b/plans
 * プラン一覧を取得
 * 
 * Query:
 * - symbol?: string
 * - targetDate?: string (YYYY-MM-DD)
 * - fromDate?: string
 * - toDate?: string
 * - limit?: number
 * - offset?: number
 */
router.get('/plans', sideBController.listPlans);

/**
 * GET /api/side-b/plans/today/:symbol
 * 今日のプランを取得
 */
router.get('/plans/today/:symbol', sideBController.getTodayPlan);

/**
 * GET /api/side-b/plans/:id
 * プランを取得
 * 
 * Query:
 * - withResearch?: boolean (リサーチ情報も含める)
 */
router.get('/plans/:id', sideBController.getPlanById);

// ===========================================
// パイプライン
// ===========================================

/**
 * POST /api/side-b/pipeline
 * フルパイプライン実行（リサーチ → プラン一括生成）
 * 
 * Body:
 * - symbol: string (必須)
 * - ohlcvData: Array (必須)
 * - indicators?: object
 * - userPreferences?: object
 * - forceRefresh?: boolean
 */
router.post('/pipeline', sideBController.runPipeline);

// ===========================================
// 管理
// ===========================================

/**
 * POST /api/side-b/cleanup
 * 期限切れリサーチを削除
 */
router.post('/cleanup', sideBController.cleanup);

// ===========================================
// 仮想トレード（Phase B）
// ===========================================

/**
 * POST /api/side-b/trades
 * プランからシナリオに基づいて仮想トレードを作成
 * 
 * Body:
 * - planId: string (必須)
 * - scenarioId?: string (指定しない場合は最初のシナリオ)
 */
router.post('/trades', sideBController.createVirtualTrade);

/**
 * GET /api/side-b/trades
 * 仮想トレード一覧を取得
 * 
 * Query:
 * - status?: string (pending, open, closed, expired, cancelled)
 * - planId?: string
 * - symbol?: string
 * - limit?: number
 */
router.get('/trades', sideBController.listVirtualTrades);

/**
 * GET /api/side-b/trades/:id
 * 仮想トレード詳細を取得
 */
router.get('/trades/:id', sideBController.getVirtualTradeById);

/**
 * POST /api/side-b/trades/:id/close
 * 仮想トレードを手動決済
 * 
 * Body:
 * - exitPrice: number (必須)
 * - reason?: string (manual, invalidation)
 * - note?: string
 */
router.post('/trades/:id/close', sideBController.closeVirtualTrade);

/**
 * POST /api/side-b/trades/:id/cancel
 * 待機中の仮想トレードをキャンセル
 */
router.post('/trades/:id/cancel', sideBController.cancelVirtualTrade);

// ===========================================
// ポートフォリオ（Phase B）
// ===========================================

/**
 * GET /api/side-b/portfolio
 * ポートフォリオサマリーを取得
 */
router.get('/portfolio', sideBController.getPortfolio);

/**
 * PUT /api/side-b/portfolio/settings
 * ポートフォリオ設定を更新
 * 
 * Body:
 * - maxOpenPositions?: number (1-10)
 * - riskPercentPerTrade?: number (0.1-10)
 * - enableSpread?: boolean
 * - spreadPips?: number
 */
router.put('/portfolio/settings', sideBController.updatePortfolioSettings);

export default router;
