/**
 * ストラテジー API ルート
 * 
 * エンドポイント:
 * - GET    /api/strategies          - 一覧取得
 * - GET    /api/strategies/:id      - 詳細取得
 * - POST   /api/strategies          - 新規作成
 * - PUT    /api/strategies/:id      - 更新
 * - DELETE /api/strategies/:id      - 削除
 * - PUT    /api/strategies/:id/status - ステータス変更
 * - POST   /api/strategies/:id/duplicate - 複製
 * - GET    /api/strategies/:id/versions/:versionNumber - バージョン詳細
 * - POST   /api/strategies/:id/backtest - バックテスト実行
 * - GET    /api/strategies/:id/backtest/history - バックテスト履歴
 * - GET    /api/strategies/:id/backtest/:runId - バックテスト結果詳細
 */

import { Router, Request, Response } from 'express';
import { StrategyStatus, TradeSide } from '@prisma/client';
import {
  listStrategies,
  getStrategy,
  getStrategyVersion,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  updateStrategyStatus,
  duplicateStrategy,
} from '../services/strategyService';
import {
  runBacktest,
  getBacktestResult,
  getBacktestHistory,
} from '../services/strategyBacktestService';

const router = Router();

/**
 * GET /api/strategies
 * ストラテジー一覧を取得
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, symbol, limit, offset } = req.query;

    const strategies = await listStrategies({
      status: status as StrategyStatus | undefined,
      symbol: symbol as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    res.json({
      success: true,
      data: { strategies },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] 一覧取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id
 * ストラテジー詳細を取得
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const strategy = await getStrategy(id);

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: 'ストラテジーが見つかりません',
      });
    }

    res.json({
      success: true,
      data: strategy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] 詳細取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id/versions/:versionNumber
 * 特定バージョンの詳細を取得
 */
router.get('/:id/versions/:versionNumber', async (req: Request, res: Response) => {
  try {
    const { id, versionNumber } = req.params;
    const version = await getStrategyVersion(id, parseInt(versionNumber, 10));

    if (!version) {
      return res.status(404).json({
        success: false,
        error: '指定されたバージョンが見つかりません',
      });
    }

    res.json({
      success: true,
      data: version,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] バージョン取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategies
 * ストラテジーを新規作成
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      symbol,
      side,
      entryConditions,
      exitSettings,
      entryTiming,
      tags,
    } = req.body;

    // 必須フィールドのバリデーション
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'ストラテジー名は必須です',
      });
    }
    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'シンボルは必須です',
      });
    }
    if (!side) {
      return res.status(400).json({
        success: false,
        error: '売買方向は必須です',
      });
    }
    if (!entryConditions) {
      return res.status(400).json({
        success: false,
        error: 'エントリー条件は必須です',
      });
    }
    if (!exitSettings) {
      return res.status(400).json({
        success: false,
        error: 'イグジット設定は必須です',
      });
    }

    const strategy = await createStrategy({
      name,
      description,
      symbol,
      side: side as TradeSide,
      entryConditions,
      exitSettings,
      entryTiming,
      tags,
    });

    res.status(201).json({
      success: true,
      data: strategy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] 作成エラー:', message);
    res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/strategies/:id
 * ストラテジーを更新（条件変更時は新バージョン作成）
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      symbol,
      side,
      entryConditions,
      exitSettings,
      entryTiming,
      status,
      tags,
      changeNote,
    } = req.body;

    const strategy = await updateStrategy(id, {
      name,
      description,
      symbol,
      side: side as TradeSide | undefined,
      entryConditions,
      exitSettings,
      entryTiming,
      status: status as StrategyStatus | undefined,
      tags,
      changeNote,
    });

    res.json({
      success: true,
      data: strategy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] 更新エラー:', message);
    
    if (message.includes('見つかりません')) {
      return res.status(404).json({
        success: false,
        error: message,
      });
    }
    
    res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/strategies/:id
 * ストラテジーを削除
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteStrategy(id);

    res.json({
      success: true,
      message: 'ストラテジーを削除しました',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] 削除エラー:', message);
    
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
 * PUT /api/strategies/:id/status
 * ストラテジーのステータスを変更
 */
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['draft', 'active', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'ステータスは draft, active, archived のいずれかを指定してください',
      });
    }

    const strategy = await updateStrategyStatus(id, status as StrategyStatus);

    res.json({
      success: true,
      data: strategy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ステータス更新エラー:', message);
    
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
 * POST /api/strategies/:id/duplicate
 * ストラテジーを複製
 */
router.post('/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: '新しいストラテジー名を指定してください',
      });
    }

    const strategy = await duplicateStrategy(id, name);

    res.status(201).json({
      success: true,
      data: strategy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] 複製エラー:', message);
    
    if (message.includes('見つかりません')) {
      return res.status(404).json({
        success: false,
        error: message,
      });
    }
    
    res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategies/:id/backtest
 * バックテストを実行
 * 
 * Request Body:
 * - startDate: string (ISO形式の開始日)
 * - endDate: string (ISO形式の終了日)
 * - stage1Timeframe: '15m' | '30m' | '1h' | '4h' | '1d' (デフォルト: '1h')
 * - enableStage2: boolean (Stage2精密検証を有効化、デフォルト: true)
 * - initialCapital: number (初期資金、デフォルト: 1000000)
 * - positionSize: number (ポジションサイズ、デフォルト: 0.1 = 10%)
 */
router.post('/:id/backtest', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      startDate,
      endDate,
      stage1Timeframe = '1h',
      enableStage2 = true,
      initialCapital = 1000000,
      positionSize = 0.1,
    } = req.body;

    // 必須フィールドのバリデーション
    if (!startDate) {
      return res.status(400).json({
        success: false,
        error: '開始日は必須です',
      });
    }
    if (!endDate) {
      return res.status(400).json({
        success: false,
        error: '終了日は必須です',
      });
    }

    // 日付の妥当性チェック
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: '日付の形式が不正です',
      });
    }
    if (start >= end) {
      return res.status(400).json({
        success: false,
        error: '開始日は終了日より前である必要があります',
      });
    }

    // タイムフレームのバリデーション
    const validTimeframes = ['15m', '30m', '1h', '4h', '1d'];
    if (!validTimeframes.includes(stage1Timeframe)) {
      return res.status(400).json({
        success: false,
        error: `タイムフレームは ${validTimeframes.join(', ')} のいずれかを指定してください`,
      });
    }

    console.log(`[StrategyRoutes] バックテスト開始: strategyId=${id}, period=${startDate} ~ ${endDate}`);

    // バックテストを実行（日付は文字列形式で渡す）
    const result = await runBacktest({
      strategyId: id,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      stage1Timeframe: stage1Timeframe as '15m' | '30m' | '1h' | '4h' | '1d',
      runStage2: enableStage2,
      initialCapital,
      positionSize,
    });

    console.log(`[StrategyRoutes] バックテスト完了: runId=${result.id}, trades=${result.summary.totalTrades}`);

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] バックテスト実行エラー:', message);
    
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
 * GET /api/strategies/:id/backtest/history
 * バックテスト履歴を取得
 * 
 * Query Parameters:
 * - limit: number (取得件数、デフォルト: 20)
 */
router.get('/:id/backtest/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit } = req.query;

    const history = await getBacktestHistory(
      id,
      limit ? parseInt(limit as string, 10) : 20
    );

    res.json({
      success: true,
      data: { history },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] バックテスト履歴取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id/backtest/:runId
 * バックテスト結果詳細を取得
 */
router.get('/:id/backtest/:runId', async (req: Request, res: Response) => {
  try {
    const { id, runId } = req.params;
    const result = await getBacktestResult(runId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'バックテスト結果が見つかりません',
      });
    }

    // ストラテジーIDが一致するか確認
    if (result.strategyId !== id) {
      return res.status(404).json({
        success: false,
        error: 'バックテスト結果が見つかりません',
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] バックテスト結果取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
