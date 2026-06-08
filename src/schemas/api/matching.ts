/**
 * マッチングAPI用 Zodスキーマ定義
 * 
 * matchingRoutes.ts で使用するリクエストバリデーション
 */
import { z } from 'zod';

// ========================================
// POST /api/matching/check
// ========================================

/** マッチングチェックリクエスト（オプショナル） */
export const CheckMatchesRequestSchema = z.object({
  noteId: z.string().uuid('有効なUUIDを指定してください').optional(),
  symbol: z.string().optional(),
}).optional();

export type CheckMatchesRequest = z.infer<typeof CheckMatchesRequestSchema>;

// ========================================
// GET /api/matching/history クエリ
// ========================================

/** マッチング履歴取得クエリ */
export const GetMatchHistoryQuerySchema = z.object({
  noteId: z.string().uuid('有効なUUIDを指定してください').optional(),
  symbol: z.string().optional(),
  limit: z.string().regex(/^\d+$/, '数値を指定してください').optional(),
  offset: z.string().regex(/^\d+$/, '数値を指定してください').optional(),
});

export type GetMatchHistoryQuery = z.infer<typeof GetMatchHistoryQuerySchema>;

// ========================================
// GET /api/matching/pipeline-runs クエリ
// ========================================

/** matching pipeline run 一覧取得クエリ（observability） */
export const GetPipelineRunsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/, '数値を指定してください').optional(),
});

export type GetPipelineRunsQuery = z.infer<typeof GetPipelineRunsQuerySchema>;
