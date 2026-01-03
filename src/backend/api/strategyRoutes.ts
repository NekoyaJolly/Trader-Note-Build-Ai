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
import { EventEmitter } from 'events';
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
  BacktestTimeframe,
} from '../services/strategyBacktestService';
import {
  createStrategyNote,
  listStrategyNotes,
  getStrategyNote,
  updateStrategyNote,
  deleteStrategyNote,
  changeNoteStatus,
  createNotesFromBacktestRun,
  getStrategyNoteStats,
  CreateStrategyNoteInput,
  UpdateStrategyNoteInput,
} from '../services/strategyNoteService';
import {
  getStrategyAlert,
  createStrategyAlert,
  updateStrategyAlert,
  deleteStrategyAlert,
  triggerAlert,
  getAlertLogs,
  pauseAlert,
  resumeAlert,
} from '../services/strategyAlertService';
import {
  runWalkForwardTest,
  getWalkForwardResult,
  getWalkForwardHistory,
} from '../services/walkForwardService';
import {
  analyzeFilters,
  verifyFilters,
  getAvailableFilterIndicators,
  FilterCondition,
} from '../services/filterAnalysisService';
import {
  monteCarloService,
  MonteCarloParams,
} from '../../services/backtest/monteCarloService';
import { PrismaClient } from '@prisma/client';

// Prismaクライアント（バージョン比較用）
const prisma = new PrismaClient();

const router = Router();

// ============================================
// SSE アラート配信用イベントエミッター
// ============================================

/**
 * アラートイベントの型定義
 */
interface StrategyAlert {
  strategyId: string;
  type: 'entry' | 'exit' | 'warning';
  symbol: string;
  message: string;
  score?: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * グローバルなアラートイベントエミッター
 * 外部（バッチ処理、マーケットマッチングサービス等）からアラートを発火するために使用
 */
class StrategyAlertEmitter extends EventEmitter {
  /**
   * 特定のストラテジーにアラートを送信
   * @param alert - アラート情報
   */
  emitAlert(alert: StrategyAlert): void {
    console.log(`[StrategyAlertEmitter] アラート発火: strategyId=${alert.strategyId}, type=${alert.type}`);
    this.emit(`alert:${alert.strategyId}`, alert);
    // 全体購読者向けにも発火
    this.emit('alert:all', alert);
  }
}

// シングルトンインスタンスをエクスポート（外部から使用可能）
export const strategyAlertEmitter = new StrategyAlertEmitter();

// SSE 接続クライアント管理
const sseClients = new Map<string, Set<Response>>();

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
 * - lotSize: number (ロット数・通貨量、デフォルト: 10000 = 1万通貨)
 * - leverage: number (レバレッジ、デフォルト: 25、最大1000)
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
      lotSize = 10000, // デフォルト1万通貨
      leverage = 25, // デフォルト25倍
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

    // 期間制限（最大90日）
    const MAX_BACKTEST_DAYS = 90;
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > MAX_BACKTEST_DAYS) {
      return res.status(400).json({
        success: false,
        error: `バックテスト期間は最大${MAX_BACKTEST_DAYS}日までです（指定: ${diffDays}日）`,
        maxDays: MAX_BACKTEST_DAYS,
        requestedDays: diffDays,
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
      lotSize,
      leverage,
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

// ============================================
// StrategyNote エンドポイント
// Phase C: 勝ちパターンノート機能
// ============================================

/**
 * GET /api/strategies/:id/notes
 * ストラテジーのノート一覧を取得
 */
router.get('/:id/notes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, outcome, tags, limit, offset } = req.query;

    const notes = await listStrategyNotes({
      strategyId: id,
      status: status as 'draft' | 'active' | 'archived' | undefined,
      outcome: outcome as 'win' | 'loss' | 'timeout' | undefined,
      tags: tags ? (tags as string).split(',') : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    res.json({
      success: true,
      data: { notes },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ノート一覧取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id/notes/stats
 * ストラテジーのノート統計を取得
 */
router.get('/:id/notes/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const stats = await getStrategyNoteStats(id);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ノート統計取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategies/:id/notes
 * ストラテジーノートを作成
 */
router.post('/:id/notes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input: CreateStrategyNoteInput = {
      ...req.body,
      strategyId: id,
    };

    const note = await createStrategyNote(input);

    res.status(201).json({
      success: true,
      data: note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ノート作成エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategies/:id/notes/from-backtest/:runId
 * バックテスト結果からノートを一括作成
 */
router.post('/:id/notes/from-backtest/:runId', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const { onlyWins = true } = req.body;

    const createdCount = await createNotesFromBacktestRun(runId, onlyWins);

    res.status(201).json({
      success: true,
      data: { createdCount },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] バックテストからノート作成エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id/notes/:noteId
 * ストラテジーノート詳細を取得
 */
router.get('/:id/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const { id, noteId } = req.params;
    const note = await getStrategyNote(noteId);

    if (!note) {
      return res.status(404).json({
        success: false,
        error: 'ノートが見つかりません',
      });
    }

    // ストラテジーIDが一致するか確認
    if (note.strategyId !== id) {
      return res.status(404).json({
        success: false,
        error: 'ノートが見つかりません',
      });
    }

    res.json({
      success: true,
      data: note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ノート詳細取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/strategies/:id/notes/:noteId
 * ストラテジーノートを更新
 */
router.put('/:id/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;
    const input: UpdateStrategyNoteInput = req.body;

    const note = await updateStrategyNote(noteId, input);

    if (!note) {
      return res.status(404).json({
        success: false,
        error: 'ノートが見つかりません',
      });
    }

    res.json({
      success: true,
      data: note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ノート更新エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/strategies/:id/notes/:noteId/status
 * ストラテジーノートのステータスを変更
 */
router.put('/:id/notes/:noteId/status', async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;
    const { status } = req.body;

    if (!['draft', 'active', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'ステータスは draft, active, archived のいずれかです',
      });
    }

    const note = await changeNoteStatus(noteId, status);

    if (!note) {
      return res.status(404).json({
        success: false,
        error: 'ノートが見つかりません',
      });
    }

    res.json({
      success: true,
      data: note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ノートステータス変更エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/strategies/:id/notes/:noteId
 * ストラテジーノートを削除
 */
router.delete('/:id/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;
    const success = await deleteStrategyNote(noteId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'ノートが見つかりません',
      });
    }

    res.json({
      success: true,
      message: 'ノートを削除しました',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ノート削除エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// ============================================
// Phase D: アラートエンドポイント
// ============================================

/**
 * GET /api/strategies/:id/alerts
 * ストラテジーのアラート設定を取得
 */
router.get('/:id/alerts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const alert = await getStrategyAlert(id);

    res.json({
      success: true,
      data: { alert },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] アラート設定取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategies/:id/alerts
 * ストラテジーのアラート設定を作成
 */
router.post('/:id/alerts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { enabled, cooldownMinutes, channels, minMatchScore } = req.body;

    const alert = await createStrategyAlert({
      strategyId: id,
      enabled,
      cooldownMinutes,
      channels,
      minMatchScore,
    });

    res.status(201).json({
      success: true,
      data: { alert },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] アラート設定作成エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/strategies/:id/alerts
 * ストラテジーのアラート設定を更新
 */
router.put('/:id/alerts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { enabled, cooldownMinutes, channels, minMatchScore } = req.body;

    const alert = await updateStrategyAlert(id, {
      enabled,
      cooldownMinutes,
      channels,
      minMatchScore,
    });

    res.json({
      success: true,
      data: { alert },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] アラート設定更新エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/strategies/:id/alerts
 * ストラテジーのアラート設定を削除
 */
router.delete('/:id/alerts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteStrategyAlert(id);

    res.json({
      success: true,
      data: { message: 'アラート設定を削除しました' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] アラート設定削除エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategies/:id/alerts/trigger
 * アラートを手動発火（テスト用）
 */
router.post('/:id/alerts/trigger', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { matchScore, indicatorValues } = req.body;

    if (typeof matchScore !== 'number' || matchScore < 0 || matchScore > 1) {
      return res.status(400).json({
        success: false,
        error: 'matchScore は 0.0〜1.0 の数値で指定してください',
      });
    }

    const result = await triggerAlert({
      strategyId: id,
      matchScore,
      indicatorValues: indicatorValues || {},
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] アラート発火エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/strategies/:id/alerts/pause
 * アラートを一時停止
 */
router.put('/:id/alerts/pause', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const alert = await pauseAlert(id);

    res.json({
      success: true,
      data: { alert },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] アラート一時停止エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/strategies/:id/alerts/resume
 * アラートを再開
 */
router.put('/:id/alerts/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const alert = await resumeAlert(id);

    res.json({
      success: true,
      data: { alert },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] アラート再開エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id/alerts/logs
 * アラート発火履歴を取得
 */
router.get('/:id/alerts/logs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit } = req.query;

    const logs = await getAlertLogs(id, limit ? parseInt(limit as string, 10) : 50);

    res.json({
      success: true,
      data: { logs },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] アラート履歴取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id/alerts/stream
 * リアルタイム監視用 Server-Sent Events (SSE) エンドポイント
 * 
 * クライアントがこのエンドポイントに接続すると、
 * ストラテジー条件成立時にリアルタイムで通知を受け取れる
 * 
 * 使用方法:
 * 1. クライアントがこのエンドポイントに接続
 * 2. 外部プロセス（バッチ、マーケットマッチング等）から strategyAlertEmitter.emitAlert() を呼び出す
 * 3. 接続中のクライアントにリアルタイムでアラートが配信される
 */
router.get('/:id/alerts/stream', async (req: Request, res: Response) => {
  const { id } = req.params;

  // SSE ヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx プロキシ対応

  // 接続確認イベント送信
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ strategyId: id, timestamp: new Date().toISOString() })}\n\n`);

  // SSE クライアントを登録
  if (!sseClients.has(id)) {
    sseClients.set(id, new Set());
  }
  sseClients.get(id)!.add(res);
  console.log(`[SSE] クライアント接続: strategyId=${id}, 接続数=${sseClients.get(id)!.size}`);

  // アラートリスナーを登録
  const alertListener = (alert: StrategyAlert) => {
    try {
      res.write(`event: alert\n`);
      res.write(`data: ${JSON.stringify({
        type: alert.type,
        symbol: alert.symbol,
        message: alert.message,
        score: alert.score,
        timestamp: alert.timestamp.toISOString(),
        metadata: alert.metadata,
      })}\n\n`);
    } catch (error) {
      console.error('[SSE] アラート送信エラー:', error);
    }
  };

  // このストラテジーのアラートを購読
  strategyAlertEmitter.on(`alert:${id}`, alertListener);

  // ハートビート（30秒ごと）
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    } catch (error) {
      // 送信エラー時は接続が切れているとみなす
      console.error('[SSE] ハートビート送信エラー:', error);
    }
  }, 30000);

  // クライアント切断時のクリーンアップ
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    strategyAlertEmitter.off(`alert:${id}`, alertListener);
    sseClients.get(id)?.delete(res);
    console.log(`[SSE] クライアント切断: strategyId=${id}, 残り接続数=${sseClients.get(id)?.size || 0}`);
  });
});

// ============================================
// Phase D: ウォークフォワードテスト
// ============================================

/**
 * POST /api/strategies/:id/walkforward
 * ウォークフォワードテストを実行
 */
router.post('/:id/walkforward', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      startDate,
      endDate,
      splitCount,
      inSampleDays,
      outOfSampleDays,
      timeframe,
      initialCapital,
      lotSize,
      leverage,
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate と endDate は必須です',
      });
    }

    const result = await runWalkForwardTest({
      strategyId: id,
      startDate,
      endDate,
      splitCount,
      inSampleDays,
      outOfSampleDays,
      timeframe,
      initialCapital,
      lotSize,
      leverage,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ウォークフォワードテストエラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id/walkforward/history
 * ウォークフォワードテスト履歴を取得
 */
router.get('/:id/walkforward/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit } = req.query;

    const history = await getWalkForwardHistory(id, limit ? parseInt(limit as string, 10) : 10);

    res.json({
      success: true,
      data: { history },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ウォークフォワード履歴取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/strategies/:id/walkforward/:runId
 * ウォークフォワードテスト結果詳細を取得
 */
router.get('/:id/walkforward/:runId', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const result = await getWalkForwardResult(runId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'ウォークフォワードテスト結果が見つかりません',
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] ウォークフォワード結果取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// ============================================
// Phase 15: モンテカルロシミュレーション
// ============================================

/**
 * POST /api/strategies/:id/montecarlo
 * モンテカルロシミュレーションを実行
 * 
 * リクエストボディ:
 * {
 *   "iterations": 100 | 500 | 1000,
 *   "startDate": "2025-01-01",
 *   "endDate": "2025-12-31",
 *   "timeframe": "15m",
 *   "takeProfit": 2.0,
 *   "stopLoss": 1.0,
 *   "maxHoldingMinutes": 1440,
 *   "initialCapital": 1000000,
 *   "lotSize": 10000
 * }
 */
router.post('/:id/montecarlo', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      iterations,
      startDate,
      endDate,
      timeframe,
      takeProfit,
      stopLoss,
      maxHoldingMinutes,
      initialCapital,
      lotSize,
      entryProbability,
    } = req.body;

    // バリデーション
    if (!iterations || ![100, 500, 1000].includes(iterations)) {
      return res.status(400).json({
        success: false,
        error: 'iterations は 100, 500, 1000 のいずれかを指定してください',
      });
    }

    // ストラテジー取得
    const strategy = await prisma.strategy.findUnique({
      where: { id },
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: 'ストラテジーが見つかりません',
      });
    }

    // 最新のバックテスト結果を取得（比較用）
    const latestBacktest = await prisma.strategyBacktestRun.findFirst({
      where: { strategyId: id, status: 'completed' },
      include: { result: true },
      orderBy: { createdAt: 'desc' },
    });

    // パラメータ構築
    const params: MonteCarloParams = {
      symbol: strategy.symbol,
      timeframe: timeframe || '15m',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      iterations,
      takeProfit: takeProfit || 2.0,
      stopLoss: stopLoss || 1.0,
      maxHoldingMinutes: maxHoldingMinutes || 1440,
      initialCapital: initialCapital || 1000000,
      lotSize: lotSize || 10000,
      entryProbability: entryProbability || 0.05,
    };

    // 比較対象の結果があれば追加
    if (latestBacktest?.result) {
      // DBスキーマのフィールド名をBacktestResultSummary形式に変換
      const result = latestBacktest.result;
      const totalTrades = result.winCount + result.lossCount + result.timeoutCount;
      
      params.actualStrategy = {
        totalTrades,
        winningTrades: result.winCount,
        losingTrades: result.lossCount,
        winRate: result.winRate,
        netProfit: Number(result.totalProfit) - Number(result.totalLoss),
        netProfitRate: (Number(result.totalProfit) - Number(result.totalLoss)) / (initialCapital || 1000000),
        maxDrawdown: result.maxDrawdown ? Number(result.maxDrawdown) : 0,
        maxDrawdownRate: result.maxDrawdown ? Number(result.maxDrawdown) / (initialCapital || 1000000) : 0,
        profitFactor: result.profitFactor || 0,
        averageWin: result.winCount > 0 ? Number(result.totalProfit) / result.winCount : 0,
        averageLoss: result.lossCount > 0 ? Math.abs(Number(result.totalLoss)) / result.lossCount : 0,
        riskRewardRatio: 0, // DBスキーマに無いため0
        maxConsecutiveWins: 0, // DBスキーマに無いため0
        maxConsecutiveLosses: 0, // DBスキーマに無いため0
      };
    }

    // シミュレーション実行
    console.log(`[StrategyRoutes] モンテカルロシミュレーション開始: ${iterations}回`);
    const result = await monteCarloService.runSimulation(params);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] モンテカルロシミュレーションエラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// ============================================
// Phase D: バージョン比較
// ============================================

/**
 * GET /api/strategies/:id/versions/compare
 * 複数バージョンのバックテスト結果を比較
 * 
 * クエリパラメータ:
 * - versionNumbers: カンマ区切りのバージョン番号 (例: "1,2,3")
 */
router.get('/:id/versions/compare', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { versionNumbers } = req.query;

    // バージョン番号をパース
    const versions = versionNumbers
      ? (versionNumbers as string).split(',').map(v => parseInt(v.trim(), 10)).filter(v => !isNaN(v))
      : [];

    // ストラテジーとバージョンを取得
    const strategy = await prisma.strategy.findUnique({
      where: { id },
      include: {
        versions: {
          where: versions.length > 0 ? { versionNumber: { in: versions } } : {},
          orderBy: { versionNumber: 'asc' },
        },
      },
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: 'ストラテジーが見つかりません',
      });
    }

    // 各バージョンの最新バックテスト結果を取得
    const comparisonData = await Promise.all(
      strategy.versions.map(async (version) => {
        // このバージョンの最新バックテスト結果を取得
        const latestRun = await prisma.strategyBacktestRun.findFirst({
          where: {
            strategyId: id,
            versionId: version.id,
            status: 'completed',
          },
          include: {
            result: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        return {
          versionNumber: version.versionNumber,
          versionId: version.id,
          changeNote: version.changeNote,
          createdAt: version.createdAt.toISOString(),
          backtest: latestRun?.result ? {
            runId: latestRun.id,
            executedAt: latestRun.createdAt.toISOString(),
            startDate: latestRun.startDate.toISOString().split('T')[0],
            endDate: latestRun.endDate.toISOString().split('T')[0],
            timeframe: latestRun.timeframe,
            metrics: {
              setupCount: latestRun.result.setupCount,
              winCount: latestRun.result.winCount,
              lossCount: latestRun.result.lossCount,
              winRate: latestRun.result.winRate,
              profitFactor: latestRun.result.profitFactor,
              totalProfit: Number(latestRun.result.totalProfit),
              totalLoss: Number(latestRun.result.totalLoss),
              averagePnL: Number(latestRun.result.averagePnL),
              expectancy: Number(latestRun.result.expectancy),
              maxDrawdown: latestRun.result.maxDrawdown ? Number(latestRun.result.maxDrawdown) : null,
            },
          } : null,
        };
      })
    );

    // 比較サマリーを計算
    const versionsWithBacktest = comparisonData.filter(v => v.backtest !== null);
    const summary = versionsWithBacktest.length > 0 ? {
      bestWinRate: {
        versionNumber: versionsWithBacktest.reduce((best, v) => 
          (v.backtest?.metrics.winRate ?? 0) > (best.backtest?.metrics.winRate ?? 0) ? v : best
        ).versionNumber,
        value: Math.max(...versionsWithBacktest.map(v => v.backtest?.metrics.winRate ?? 0)),
      },
      bestProfitFactor: {
        versionNumber: versionsWithBacktest.reduce((best, v) => 
          (v.backtest?.metrics.profitFactor ?? 0) > (best.backtest?.metrics.profitFactor ?? 0) ? v : best
        ).versionNumber,
        value: Math.max(...versionsWithBacktest.map(v => v.backtest?.metrics.profitFactor ?? 0)),
      },
      bestExpectancy: {
        versionNumber: versionsWithBacktest.reduce((best, v) => 
          (v.backtest?.metrics.expectancy ?? 0) > (best.backtest?.metrics.expectancy ?? 0) ? v : best
        ).versionNumber,
        value: Math.max(...versionsWithBacktest.map(v => v.backtest?.metrics.expectancy ?? 0)),
      },
      lowestDrawdown: {
        versionNumber: versionsWithBacktest
          .filter(v => v.backtest?.metrics.maxDrawdown !== null)
          .reduce((best, v) => 
            (v.backtest?.metrics.maxDrawdown ?? Infinity) < (best.backtest?.metrics.maxDrawdown ?? Infinity) ? v : best
          , versionsWithBacktest[0]).versionNumber,
        value: Math.min(...versionsWithBacktest
          .filter(v => v.backtest?.metrics.maxDrawdown !== null)
          .map(v => v.backtest?.metrics.maxDrawdown ?? Infinity)),
      },
    } : null;

    res.json({
      success: true,
      data: {
        strategyId: id,
        strategyName: strategy.name,
        versions: comparisonData,
        summary,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] バージョン比較エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// ============================================
// フィルター分析 API
// ============================================

/**
 * GET /api/strategies/:id/backtest/:runId/filter-analysis
 * バックテスト結果のフィルター分析
 * 
 * 勝ち/負けトレードのインジケーター傾向を分析し、
 * 有効なフィルター候補を自動提案
 */
router.get('/:id/backtest/:runId/filter-analysis', async (req: Request, res: Response) => {
  try {
    const { id, runId } = req.params;
    
    // バックテスト結果を取得
    const backtestResult = await getBacktestResult(runId);
    if (!backtestResult) {
      return res.status(404).json({
        success: false,
        error: 'バックテスト結果が見つかりません',
      });
    }
    
    // OHLCVデータを再取得（分析用）
    // 注: 本来はバックテスト時のデータをキャッシュすべきだが、MVP版では再取得
    const { fetchHistoricalData } = await import('../services/strategyBacktestService');
    const strategy = await prisma.strategy.findUnique({
      where: { id },
    });
    
    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: 'ストラテジーが見つかりません',
      });
    }
    
    const ohlcvData = await fetchHistoricalData(
      strategy.symbol,
      '1m' as BacktestTimeframe, // 分析用に1分足
      new Date(backtestResult.startDate),
      new Date(backtestResult.endDate)
    );
    
    // フィルター分析実行
    const analysisResult = analyzeFilters({
      trades: backtestResult.trades,
      ohlcvData,
      timeframe: backtestResult.timeframe as '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d',
    });
    
    res.json({
      success: true,
      data: analysisResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] フィルター分析エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/strategies/:id/backtest/:runId/filter-verify
 * フィルター適用効果を検証
 * 
 * Request Body:
 * - filters: FilterCondition[] (最大5つ)
 *   - indicator: 'SMA_20' | 'RSI_14' | 'MACD_HIST' など
 *   - operator: '<' | '<=' | '>' | '>=' | '='
 *   - value: number
 */
router.post('/:id/backtest/:runId/filter-verify', async (req: Request, res: Response) => {
  try {
    const { id, runId } = req.params;
    const { filters } = req.body as { filters: FilterCondition[] };
    
    if (!filters || !Array.isArray(filters)) {
      return res.status(400).json({
        success: false,
        error: 'フィルター条件を指定してください',
      });
    }
    
    if (filters.length === 0 || filters.length > 5) {
      return res.status(400).json({
        success: false,
        error: 'フィルターは1〜5個まで選択してください',
      });
    }
    
    // バックテスト結果を取得
    const backtestResult = await getBacktestResult(runId);
    if (!backtestResult) {
      return res.status(404).json({
        success: false,
        error: 'バックテスト結果が見つかりません',
      });
    }
    
    // OHLCVデータを再取得
    const { fetchHistoricalData } = await import('../services/strategyBacktestService');
    const strategy = await prisma.strategy.findUnique({
      where: { id },
    });
    
    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: 'ストラテジーが見つかりません',
      });
    }
    
    const ohlcvData = await fetchHistoricalData(
      strategy.symbol,
      '1m' as BacktestTimeframe,
      new Date(backtestResult.startDate),
      new Date(backtestResult.endDate)
    );
    
    // フィルター検証実行
    const verifyResult = verifyFilters({
      trades: backtestResult.trades,
      ohlcvData,
      timeframe: backtestResult.timeframe as '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d',
      filters,
      initialCapital: 1000000, // デフォルト
    });
    
    res.json({
      success: true,
      data: verifyResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[StrategyRoutes] フィルター検証エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/filters/indicators
 * 利用可能なフィルターインジケーター一覧
 */
router.get('/filters/indicators', async (_req: Request, res: Response) => {
  try {
    const indicators = getAvailableFilterIndicators();
    res.json({
      success: true,
      data: indicators,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
