/**
 * バックテスト API 用 Zod スキーマ定義 (Critical-4 段階 3b 後の縮小版)
 *
 * 旧 schema (BacktestRunIdParam / BacktestNoteIdParam / BacktestJobIdParam /
 * ExecuteBacktestRequest / GetBacktestHistoryQuery) は段階 3 で全廃止。
 * 残るは `POST /api/backtest/check-coverage` 用の `CheckCoverageRequestSchema` のみ。
 * 段階 4 で analysis-engine 寄せ込み完了時に本ファイル全体削除予定。
 */
import { z } from 'zod';

// ========================================
// POST /api/backtest/check-coverage
// ========================================

/**
 * カバレッジチェックリクエスト。
 *
 * 日付フィールドは date input から `YYYY-MM-DD` で送られる場合と、ISO 8601 完全形式で
 * 送られる場合の両方を受け付ける。
 */
export const CheckCoverageRequestSchema = z.object({
  symbol: z.string().min(1, 'シンボルは必須です'),
  timeframe: z.string().min(1, '時間足は必須です'),
  startDate: z.string().min(1, '開始日は必須です').refine(
    (s) => !isNaN(new Date(s).getTime()),
    { message: '有効な日付を指定してください' },
  ),
  endDate: z.string().min(1, '終了日は必須です').refine(
    (s) => !isNaN(new Date(s).getTime()),
    { message: '有効な日付を指定してください' },
  ),
});

export type CheckCoverageRequest = z.infer<typeof CheckCoverageRequestSchema>;
