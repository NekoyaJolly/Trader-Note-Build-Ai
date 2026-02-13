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
 * AIトレードノート (Phase C):
 * - GET    /api/side-b/ai-notes           - AIノート一覧
 * - GET    /api/side-b/ai-notes/:id       - AIノート詳細
 * - GET    /api/side-b/ai-notes/summaries - サマリー一覧
 * - POST   /api/side-b/ai-notes/summaries/generate - サマリー生成
 * 
 * スケジューラー (Phase D):
 * - GET    /api/side-b/scheduler/status   - スケジューラー状態取得
 * - POST   /api/side-b/scheduler/start    - スケジューラー開始
 * - POST   /api/side-b/scheduler/stop     - スケジューラー停止
 * - PUT    /api/side-b/scheduler/config   - スケジューラー設定更新
 * - POST   /api/side-b/scheduler/run-daily-plan - 日次プラン手動実行
 * - POST   /api/side-b/scheduler/run-monitor - 監視手動実行
 * 
 * 管理:
 * - POST   /api/side-b/cleanup            - 期限切れデータ削除
 */

import { Router } from 'express';
import { sideBController } from '../controllers';
import { validateBody, validateQuery, validateParams } from '../../middleware/validateRequest';
import {
  // リサーチ
  GenerateResearchRequestSchema,
  ListResearchQuerySchema,
  // プラン
  GeneratePlanRequestSchema,
  ListPlansQuerySchema,
  GetPlanByIdQuerySchema,
  // パイプライン
  RunPipelineBodyRequestSchema,
  // 仮想トレード
  CreateVirtualTradeRequestSchema,
  ListVirtualTradesQuerySchema,
  CloseVirtualTradeRequestSchema,
  // ポートフォリオ
  UpdatePortfolioSettingsRequestSchema,
  // AIノート
  ListAINotesQuerySchema,
  ListAINoteSummariesQuerySchema,
  GenerateAINoteSummaryRequestSchema,
  // スケジューラー
  UpdateSchedulerConfigRequestSchema,
  // URLパラメータ
  IdParamSchema,
  SymbolParamSchema,
} from '../../schemas/api/sideB';

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
 * - ohlcvData?: Array<{timestamp, open, high, low, close, volume?}> (省略時は自動取得)
 * - indicators?: object
 * - forceRefresh?: boolean (キャッシュ無視)
 */
router.post(
  '/research',
  validateBody(GenerateResearchRequestSchema),
  sideBController.generateResearch
);

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
router.get(
  '/research',
  validateQuery(ListResearchQuerySchema),
  sideBController.listResearch
);

/**
 * GET /api/side-b/research/valid/:symbol
 * 有効なリサーチを取得（キャッシュチェック用）
 */
router.get(
  '/research/valid/:symbol',
  validateParams(SymbolParamSchema),
  sideBController.getValidResearch
);

/**
 * GET /api/side-b/research/:id
 * リサーチを取得
 */
router.get(
  '/research/:id',
  validateParams(IdParamSchema),
  sideBController.getResearchById
);

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
router.post(
  '/plans',
  validateBody(GeneratePlanRequestSchema),
  sideBController.generatePlan
);

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
router.get(
  '/plans',
  validateQuery(ListPlansQuerySchema),
  sideBController.listPlans
);

/**
 * GET /api/side-b/plans/today/:symbol
 * 今日のプランを取得
 */
router.get(
  '/plans/today/:symbol',
  validateParams(SymbolParamSchema),
  sideBController.getTodayPlan
);

/**
 * GET /api/side-b/plans/:id
 * プランを取得
 * 
 * Query:
 * - withResearch?: boolean (リサーチ情報も含める)
 */
router.get(
  '/plans/:id',
  validateParams(IdParamSchema),
  validateQuery(GetPlanByIdQuerySchema),
  sideBController.getPlanById
);

// ===========================================
// パイプライン
// ===========================================

/**
 * POST /api/side-b/pipeline
 * フルパイプライン実行（リサーチ → プラン一括生成）
 * 
 * Body:
 * - symbol: string (必須)
 * - ohlcvData?: Array (省略時は自動取得)
 * - indicators?: object
 * - userPreferences?: object
 * - forceRefresh?: boolean
 */
router.post(
  '/pipeline',
  validateBody(RunPipelineBodyRequestSchema),
  sideBController.runPipeline
);

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
router.post(
  '/trades',
  validateBody(CreateVirtualTradeRequestSchema),
  sideBController.createVirtualTrade
);

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
router.get(
  '/trades',
  validateQuery(ListVirtualTradesQuerySchema),
  sideBController.listVirtualTrades
);

/**
 * GET /api/side-b/trades/:id
 * 仮想トレード詳細を取得
 */
router.get(
  '/trades/:id',
  validateParams(IdParamSchema),
  sideBController.getVirtualTradeById
);

/**
 * POST /api/side-b/trades/:id/close
 * 仮想トレードを手動決済
 * 
 * Body:
 * - exitPrice: number (必須)
 * - reason?: string (manual, invalidation)
 * - note?: string
 */
router.post(
  '/trades/:id/close',
  validateParams(IdParamSchema),
  validateBody(CloseVirtualTradeRequestSchema),
  sideBController.closeVirtualTrade
);

/**
 * POST /api/side-b/trades/:id/cancel
 * 待機中の仮想トレードをキャンセル
 */
router.post(
  '/trades/:id/cancel',
  validateParams(IdParamSchema),
  sideBController.cancelVirtualTrade
);

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
router.put(
  '/portfolio/settings',
  validateBody(UpdatePortfolioSettingsRequestSchema),
  sideBController.updatePortfolioSettings
);

// ===========================================
// AIトレードノート（Phase C）
// ===========================================

/**
 * GET /api/side-b/ai-notes
 * AIノート一覧を取得
 * 
 * Query:
 * - from?: string (YYYY-MM-DD)
 * - to?: string (YYYY-MM-DD)
 * - outcome?: 'win' | 'loss' | 'breakeven'
 * - symbol?: string
 * - limit?: number (default: 20)
 * - offset?: number (default: 0)
 */
router.get(
  '/ai-notes',
  validateQuery(ListAINotesQuerySchema),
  sideBController.listAINotes
);

/**
 * GET /api/side-b/ai-notes/summaries
 * サマリー一覧を取得
 * 
 * Query:
 * - period?: 'daily' | 'weekly' | 'monthly'
 * - limit?: number
 * - offset?: number
 */
router.get(
  '/ai-notes/summaries',
  validateQuery(ListAINoteSummariesQuerySchema),
  sideBController.listAINoteSummaries
);

/**
 * POST /api/side-b/ai-notes/summaries/generate
 * サマリーを手動生成
 * 
 * Body:
 * - period: 'daily' | 'weekly' | 'monthly' (必須)
 * - startDate: string (YYYY-MM-DD, 必須)
 * - endDate: string (YYYY-MM-DD, 必須)
 */
router.post(
  '/ai-notes/summaries/generate',
  validateBody(GenerateAINoteSummaryRequestSchema),
  sideBController.generateAINoteSummary
);

/**
 * GET /api/side-b/ai-notes/:id
 * AIノート詳細を取得
 */
router.get(
  '/ai-notes/:id',
  validateParams(IdParamSchema),
  sideBController.getAINoteById
);

// ===========================================
// スケジューラー（Phase D）
// ===========================================

/**
 * GET /api/side-b/scheduler/status
 * スケジューラーの状態を取得
 */
router.get('/scheduler/status', sideBController.getSchedulerStatus);

/**
 * POST /api/side-b/scheduler/start
 * スケジューラーを開始
 */
router.post('/scheduler/start', sideBController.startScheduler);

/**
 * POST /api/side-b/scheduler/stop
 * スケジューラーを停止
 */
router.post('/scheduler/stop', sideBController.stopScheduler);

/**
 * PUT /api/side-b/scheduler/config
 * スケジューラー設定を更新
 * 
 * Body:
 * - enabled?: boolean
 * - symbols?: string[]
 * - timeframe?: string
 * - monitorIntervalMs?: number
 * - dailyPlanTimeUTC?: string
 * - autoGenerateNote?: boolean
 */
router.put(
  '/scheduler/config',
  validateBody(UpdateSchedulerConfigRequestSchema),
  sideBController.updateSchedulerConfig
);

/**
 * POST /api/side-b/scheduler/run-daily-plan
 * 日次プランを手動実行
 */
router.post('/scheduler/run-daily-plan', sideBController.runDailyPlanNow);

/**
 * POST /api/side-b/scheduler/run-monitor
 * 監視を手動実行
 */
router.post('/scheduler/run-monitor', sideBController.runMonitorNow);

// ===========================================
// PDCA Loop（Phase 2: 自律エージェント）
// ===========================================

/**
 * GET /api/side-b/agent/status
 * PDCAループの状態を取得
 */
router.get('/agent/status', sideBController.getAgentStatus);

/**
 * POST /api/side-b/agent/start
 * PDCAループを開始（スケジューラーも連動起動）
 */
router.post('/agent/start', sideBController.startAgent);

/**
 * POST /api/side-b/agent/stop
 * PDCAループを停止
 */
router.post('/agent/stop', sideBController.stopAgent);

/**
 * GET /api/side-b/agent/thinking-log
 * 思考ログを取得
 *
 * Query:
 * - limit?: number (default: 50)
 */
router.get('/agent/thinking-log', sideBController.getThinkingLog);

// ===========================================
// 比較分析（Phase D）
// ===========================================

/**
 * GET /api/side-b/comparison
 * 人間vsAIの比較分析を取得
 * 
 * Query:
 * - period?: 'week' | 'month' | 'quarter' | 'year' | 'all'
 * - symbol?: string
 */
router.get('/comparison', sideBController.getComparison);

/**
 * GET /api/side-b/comparison/dashboard
 * 比較ダッシュボードデータを取得（サマリー + 時系列 + 最近のトレード）
 * 
 * Query:
 * - period?: 'week' | 'month' | 'quarter' | 'year' | 'all'
 * - symbol?: string
 */
router.get('/comparison/dashboard', sideBController.getComparisonDashboardData);

// ===========================================
// サマリー（週次/月次）
// ===========================================

/**
 * GET /api/side-b/summaries
 * 生成済みサマリー一覧を取得
 * 
 * Query:
 * - period?: 'weekly' | 'monthly'
 * - limit?: number
 * - offset?: number
 */
router.get('/summaries', sideBController.listSummaries);

/**
 * POST /api/side-b/summaries/generate
 * サマリーを手動生成
 * 
 * Body:
 * - period: 'weekly' | 'monthly' (必須)
 * - startDate?: string (YYYY-MM-DD)
 * - endDate?: string (YYYY-MM-DD)
 */
router.post('/summaries/generate', sideBController.generateSummary);

/**
 * GET /api/side-b/summaries/scheduler
 * サマリースケジューラー設定を取得
 */
router.get('/summaries/scheduler', sideBController.getSummarySchedulerConfig);

/**
 * PUT /api/side-b/summaries/scheduler
 * サマリースケジューラー設定を更新
 * 
 * Body:
 * - weeklyEnabled?: boolean
 * - monthlyEnabled?: boolean
 * - weeklyCronExpression?: string (cron形式)
 * - monthlyCronExpression?: string (cron形式)
 * - notifyOnGeneration?: boolean
 */
router.put('/summaries/scheduler', sideBController.updateSummarySchedulerConfig);

/**
 * POST /api/side-b/summaries/scheduler/start
 * サマリースケジューラーを開始
 */
router.post('/summaries/scheduler/start', sideBController.startSummaryScheduler);

/**
 * POST /api/side-b/summaries/scheduler/stop
 * サマリースケジューラーを停止
 */
router.post('/summaries/scheduler/stop', sideBController.stopSummaryScheduler);

export default router;
