/**
 * ストラテジー横断分析 API ルート
 * 
 * エンドポイント:
 * - GET    /api/strategy-comparison          - 比較セッション一覧
 * - POST   /api/strategy-comparison          - 比較セッション作成
 * - GET    /api/strategy-comparison/:id      - 比較セッション詳細
 * - DELETE /api/strategy-comparison/:id      - 比較セッション削除
 * - POST   /api/strategy-comparison/:id/optimize - ポートフォリオ最適化
 * 
 * 参照: docs/phase-next/strategy-comparison-analysis.md
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { assertStrategyOwnership } from '../services/strategyService';
import type {
  CreateComparisonRequest,
  OptimizeRequest} from '../services/strategyComparisonService';
import {
  createComparisonSession,
  getComparisonSession,
  getComparisonSessions,
  deleteComparisonSession,
  runPortfolioOptimization
} from '../services/strategyComparisonService';

const router = Router();

// ============================================
// Zod スキーマ定義
// ============================================

/** 比較セッション作成リクエストスキーマ */
const CreateComparisonRequestSchema = z.object({
  name: z.string().min(1, 'セッション名は必須です').max(100, 'セッション名は100文字以内'),
  strategyIds: z.array(z.string().uuid('無効なストラテジーID'))
    .min(2, '比較には最低2つのストラテジーが必要です')
    .max(10, '比較できるストラテジーは最大10個です'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で指定'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で指定'),
  timeframe: z.enum(['15m', '30m', '1h', '4h', '1d']).optional().default('1h'),
});

/** ポートフォリオ最適化リクエストスキーマ */
const OptimizeRequestSchema = z.object({
  method: z.enum([
    'mean_variance',
    'risk_parity',
    'equal_weight',
    'minimum_variance',
    'max_sharpe',
  ]),
  riskFreeRate: z.number().min(0).max(0.1).optional().default(0),
});

// ============================================
// エンドポイント
// ============================================

/**
 * GET /api/strategy-comparison
 * 比較セッション一覧を取得
 * 
 * Query Parameters:
 * - limit: number (取得件数、デフォルト: 20)
 * - offset: number (オフセット、デフォルト: 0)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { limit, offset } = req.query;
    
    const result = await getComparisonSessions(
      limit ? parseInt(limit as string, 10) : 20,
      offset ? parseInt(offset as string, 10) : 0
    );
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyComparisonRoutes] 一覧取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategy-comparison
 * 比較セッションを作成し分析を実行
 * 
 * Request Body:
 * - name: string (セッション名)
 * - strategyIds: string[] (比較対象ストラテジーID、2〜10個)
 * - startDate: string (分析期間開始日、YYYY-MM-DD)
 * - endDate: string (分析期間終了日、YYYY-MM-DD)
 * - timeframe?: string (時間足、デフォルト: 1h)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    // バリデーション
    const parseResult = CreateComparisonRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error.format(),
      });
    }
    
    const request: CreateComparisonRequest = parseResult.data;
    
    // 日付の妥当性チェック
    const startDate = new Date(request.startDate);
    const endDate = new Date(request.endDate);
    
    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        error: '開始日は終了日より前である必要があります',
      });
    }
    
    // 期間制限（最大365日）
    const MAX_DAYS = 365;
    const diffDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > MAX_DAYS) {
      return res.status(400).json({
        success: false,
        error: `分析期間は最大${MAX_DAYS}日までです（指定: ${diffDays}日）`,
      });
    }
    
    // Phase α-4: 比較対象は認証ユーザーの所有ストラテジーに限定する
    // (他ユーザーのストラテジー ID を混ぜた比較セッション作成を拒否)
    try {
      for (const strategyId of request.strategyIds) {
        await assertStrategyOwnership(strategyId, req.user?.userId);
      }
    } catch {
      return res.status(404).json({
        success: false,
        error: 'ストラテジーが見つかりません',
      });
    }

    console.log(`[StrategyComparisonRoutes] 比較セッション作成: ${request.name}, ${request.strategyIds.length}ストラテジー`);

    const session = await createComparisonSession(request);
    
    console.log(`[StrategyComparisonRoutes] 比較セッション作成完了: ${session.id}`);
    
    res.status(201).json({
      success: true,
      data: session,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyComparisonRoutes] 作成エラー:', message);
    
    if (message.includes('見つかりません')) {
      return res.status(404).json({
        success: false,
        error: message,
      });
    }
    
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategy-comparison/:id
 * 比較セッション詳細を取得
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const session = await getComparisonSession(id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '比較セッションが見つかりません',
      });
    }
    
    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyComparisonRoutes] 詳細取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/strategy-comparison/:id
 * 比較セッションを削除
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteComparisonSession(id);
    
    res.json({
      success: true,
      message: '比較セッションを削除しました',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyComparisonRoutes] 削除エラー:', message);
    
    if (message.includes('見つかりません') || message.includes('Record to delete does not exist')) {
      return res.status(404).json({
        success: false,
        error: '比較セッションが見つかりません',
      });
    }
    
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategy-comparison/:id/optimize
 * ポートフォリオ最適化を実行
 * 
 * Request Body:
 * - method: OptimizationMethod (最適化手法)
 *   - 'mean_variance': 平均分散最適化（マーコビッツ）
 *   - 'risk_parity': リスクパリティ
 *   - 'equal_weight': 等ウェイト
 *   - 'minimum_variance': 最小分散
 *   - 'max_sharpe': 最大シャープレシオ
 * - riskFreeRate?: number (リスクフリーレート、年率、デフォルト: 0)
 */
router.post('/:id/optimize', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // バリデーション
    const parseResult = OptimizeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error.format(),
      });
    }
    
    const request: OptimizeRequest = {
      method: parseResult.data.method,
      riskFreeRate: parseResult.data.riskFreeRate,
    };
    
    console.log(`[StrategyComparisonRoutes] ポートフォリオ最適化: sessionId=${id}, method=${request.method}`);
    
    const result = await runPortfolioOptimization(id, request);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyComparisonRoutes] 最適化エラー:', message);
    
    if (message.includes('見つかりません')) {
      return res.status(404).json({
        success: false,
        error: message,
      });
    }
    
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;

