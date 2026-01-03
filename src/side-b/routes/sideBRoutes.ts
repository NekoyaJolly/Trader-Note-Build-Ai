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

export default router;
