/**
 * バックテストコントローラー (Critical-4 段階 3b 後の縮小版)
 *
 * 責務:
 * - データカバレッジチェック API のみ (`POST /api/backtest/check-coverage`)
 *
 * 旧責務 (execute / getResult / getHistory) は段階 3 で完全撤去済み。
 * ノート手動 BT は廃止 (analysis-engine 経由 ScreeningBacktestRun に統一)、
 * coverage check のみストラテジー BT 画面 (`/strategies/[id]/backtest`) の
 * OHLCV 整合確認用として残存。段階 4 で analysis-engine 寄せ込み完了時に
 * 本ファイル + ルート全体を完全削除予定。
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { checkDataCoverage } from '../services/strategyBacktestService';
import type { BacktestTimeframe } from '../services/strategyBacktestService';

// BT カバレッジチェックの時間足 (BacktestTimeframe 型と同等)
const BacktestTimeframeSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);

// POST /api/backtest/check-coverage のリクエストボディ
const CheckCoverageBodySchema = z.object({
  symbol: z.string().min(1, 'symbol は必須です'),
  timeframe: BacktestTimeframeSchema,
  startDate: z.string().min(1, 'startDate は必須です'),
  endDate: z.string().min(1, 'endDate は必須です'),
});

/**
 * バックテストコントローラークラス (coverage check 専用)
 */
export class BacktestController {
  /**
   * POST /api/backtest/check-coverage
   * BT 実行前に DB の OHLCV データカバレッジをチェックする。
   *
   * プリセットデータが十分にあるか確認し、不足している場合は
   * フロントエンドでユーザーに API 取得の確認を求める用途。
   */
  checkCoverage = async (req: Request, res: Response): Promise<void> => {
    try {
      // Zod で req.body を具体型に narrow
      const parsed = CheckCoverageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: '必須パラメータが不足しています: symbol, timeframe, startDate, endDate',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return;
      }
      const { symbol, timeframe, startDate, endDate } = parsed.data;
      // 型を明示 (checkDataCoverage が BacktestTimeframe を要求するため)
      const tf: BacktestTimeframe = timeframe;

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({
          error: '無効な日時フォーマットです。ISO 8601 形式で指定してください',
        });
        return;
      }

      const coverage = await checkDataCoverage(symbol, tf, start, end);

      // フロントエンドが期待するフィールド名にマッピング
      // hasEnoughData: 95% 以上のカバレッジで true (警告不要)
      res.json({
        success: true,
        data: {
          hasEnoughData: coverage.hasCoverage,
          coverageRatio: coverage.coverageRatio,
          missingBars: coverage.expectedCount - coverage.dataCount,
          expectedBars: coverage.expectedCount,
          actualBars: coverage.dataCount,
        },
      });
    } catch (error) {
      console.error('カバレッジチェックエラー:', error);
      res.status(500).json({
        error: 'カバレッジチェックに失敗しました',
      });
    }
  };
}

// シングルトンインスタンスをエクスポート
export const backtestController = new BacktestController();
