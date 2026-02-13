/**
 * バックテストAPI用 Zodスキーマ定義
 * 
 * backtestRoutes.ts で使用するリクエストバリデーション
 */
import { z } from 'zod';

// ========================================
// 共通パラメータ
// ========================================

/** バックテスト実行ID パラメータ */
export const BacktestRunIdParamSchema = z.object({
  runId: z.string().uuid('有効なUUIDを指定してください'),
});

export type BacktestRunIdParam = z.infer<typeof BacktestRunIdParamSchema>;

/** ノートID パラメータ（履歴取得用） */
export const BacktestNoteIdParamSchema = z.object({
  noteId: z.string().uuid('有効なUUIDを指定してください'),
});

export type BacktestNoteIdParam = z.infer<typeof BacktestNoteIdParamSchema>;

/** ジョブID パラメータ（進捗取得用） */
export const BacktestJobIdParamSchema = z.object({
  jobId: z.string().min(1, 'jobIdは必須です'),
});

export type BacktestJobIdParam = z.infer<typeof BacktestJobIdParamSchema>;

// ========================================
// POST /api/backtest/check-coverage
// ========================================

/** カバレッジチェックリクエスト */
export const CheckCoverageRequestSchema = z.object({
  symbol: z.string().min(1, 'シンボルは必須です'),
  timeframe: z.string().min(1, '時間足は必須です'),
  // 日付のみ (YYYY-MM-DD) および ISO8601 の両方を受け付ける（フロントは date input で日付のみ送信）
  startDate: z.string().min(1, '開始日は必須です').refine(
    (s) => !isNaN(new Date(s).getTime()),
    { message: '有効な日付を指定してください' }
  ),
  endDate: z.string().min(1, '終了日は必須です').refine(
    (s) => !isNaN(new Date(s).getTime()),
    { message: '有効な日付を指定してください' }
  ),
});

export type CheckCoverageRequest = z.infer<typeof CheckCoverageRequestSchema>;

// ========================================
// POST /api/backtest/execute
// ========================================

/** バックテスト実行リクエスト */
export const ExecuteBacktestRequestSchema = z.object({
  noteId: z.string().uuid('有効なUUIDを指定してください'),
  startDate: z.string().datetime('有効なISO8601日付を指定してください'),
  endDate: z.string().datetime('有効なISO8601日付を指定してください'),
  timeframe: z.string().optional(),
  matchThreshold: z.number().min(0).max(1).optional(),
  takeProfit: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  maxHoldingMinutes: z.number().positive().optional(),
  tradingCost: z.number().min(0).optional(),
});

export type ExecuteBacktestRequest = z.infer<typeof ExecuteBacktestRequestSchema>;

// ========================================
// GET /api/backtest/history/:noteId クエリ
// ========================================

/** 履歴取得クエリ */
export const GetBacktestHistoryQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/, '数値を指定してください').optional(),
});

export type GetBacktestHistoryQuery = z.infer<typeof GetBacktestHistoryQuerySchema>;
