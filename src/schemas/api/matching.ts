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

/**
 * matching pipeline run 一覧取得クエリ（observability）
 *
 * limit は数値化・範囲制約・デフォルトを Zod に集約する（コントローラ側で手動 parse/clamp しない）。
 * 1〜100 の範囲外は 400 で弾く。未指定時は 20。
 */
export const GetPipelineRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type GetPipelineRunsQuery = z.infer<typeof GetPipelineRunsQuerySchema>;
