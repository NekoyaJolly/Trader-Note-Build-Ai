/**
 * バックテストコントローラー
 * 
 * 責務:
 * - バックテスト実行 API
 * - バックテスト結果取得 API
 * - ノート別バックテスト履歴 API
 */

import { Request, Response } from 'express';
import { BacktestService, BacktestParams, BacktestSummary } from '../services/backtestService';

/**
 * バックテスト実行リクエストボディ
 */
interface ExecuteBacktestRequest {
  noteId: string;
  startDate: string; // ISO 8601 形式
  endDate: string;   // ISO 8601 形式
  timeframe: string; // '15m', '60m' など
  matchThreshold: number; // 0.0〜1.0
  takeProfit: number; // パーセント
  stopLoss: number;   // パーセント
  maxHoldingMinutes?: number;
  tradingCost?: number; // パーセント
}

/**
 * バックテストコントローラークラス
 */
export class BacktestController {
  private readonly backtestService: BacktestService;

  constructor(backtestService?: BacktestService) {
    this.backtestService = backtestService || new BacktestService();
  }

  /**
   * POST /api/backtest/execute
   * バックテストを実行する
   */
  execute = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as ExecuteBacktestRequest;

      // バリデーション
      const validation = this.validateExecuteRequest(body);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const params: BacktestParams = {
        noteId: body.noteId,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        timeframe: body.timeframe,
        matchThreshold: body.matchThreshold,
        takeProfit: body.takeProfit,
        stopLoss: body.stopLoss,
        maxHoldingMinutes: body.maxHoldingMinutes,
        tradingCost: body.tradingCost,
      };

      // バックテスト実行
      const runId = await this.backtestService.execute(params);

      res.status(202).json({
        message: 'バックテストを開始しました',
        runId,
      });
    } catch (error) {
      console.error('バックテスト実行エラー:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'バックテストの実行に失敗しました' });
      }
    }
  };

  /**
   * GET /api/backtest/:runId
   * バックテスト結果を取得する
   */
  getResult = async (req: Request, res: Response): Promise<void> => {
    try {
      const { runId } = req.params;

      if (!runId) {
        res.status(400).json({ error: 'runId は必須です' });
        return;
      }

      const result = await this.backtestService.getResult(runId);

      if (!result) {
        res.status(404).json({ error: 'バックテスト結果が見つかりません' });
        return;
      }

      res.json(result);
    } catch (error) {
      console.error('バックテスト結果取得エラー:', error);
      res.status(500).json({ error: 'バックテスト結果の取得に失敗しました' });
    }
  };

  /**
   * GET /api/backtest/history/:noteId
   * ノートのバックテスト履歴を取得する
   */
  getHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!noteId) {
        res.status(400).json({ error: 'noteId は必須です' });
        return;
      }

      const history = await this.backtestService.getHistoryByNoteId(noteId, Math.min(limit, 50));

      res.json({ history });
    } catch (error) {
      console.error('バックテスト履歴取得エラー:', error);
      res.status(500).json({ error: 'バックテスト履歴の取得に失敗しました' });
    }
  };

  /**
   * リクエストバリデーション
   */
  private validateExecuteRequest(body: ExecuteBacktestRequest): { valid: boolean; error?: string } {
    if (!body.noteId) {
      return { valid: false, error: 'noteId は必須です' };
    }
    if (!body.startDate) {
      return { valid: false, error: 'startDate は必須です' };
    }
    if (!body.endDate) {
      return { valid: false, error: 'endDate は必須です' };
    }
    if (!body.timeframe) {
      return { valid: false, error: 'timeframe は必須です' };
    }
    if (body.matchThreshold === undefined || body.matchThreshold < 0 || body.matchThreshold > 1) {
      return { valid: false, error: 'matchThreshold は 0.0〜1.0 の範囲で指定してください' };
    }
    if (body.takeProfit === undefined || body.takeProfit <= 0) {
      return { valid: false, error: 'takeProfit は正の数で指定してください' };
    }
    if (body.stopLoss === undefined || body.stopLoss <= 0) {
      return { valid: false, error: 'stopLoss は正の数で指定してください' };
    }

    // 日付の妥当性チェック
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    if (isNaN(startDate.getTime())) {
      return { valid: false, error: 'startDate の形式が不正です' };
    }
    if (isNaN(endDate.getTime())) {
      return { valid: false, error: 'endDate の形式が不正です' };
    }
    if (startDate >= endDate) {
      return { valid: false, error: 'startDate は endDate より前である必要があります' };
    }

    return { valid: true };
  }
}

// シングルトンインスタンスをエクスポート
export const backtestController = new BacktestController();
