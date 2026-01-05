/**
 * インジケーターAPI用 Zodスキーマ定義
 * 
 * indicatorRoutes.ts で使用するリクエストバリデーション
 */
import { z } from 'zod';

// ========================================
// インジケーターIDパラメータ
// ========================================

/** インジケーターID パラメータ */
export const IndicatorIdParamSchema = z.object({
  indicatorId: z.string().min(1, 'インジケーターIDは必須です'),
});

export type IndicatorIdParam = z.infer<typeof IndicatorIdParamSchema>;

// ========================================
// POST /api/indicators/settings
// ========================================

/** インジケーター設定保存リクエスト */
export const SaveIndicatorSettingsRequestSchema = z.object({
  indicatorId: z.string().min(1, 'indicatorId は必須です'),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  enabled: z.boolean().optional(),
  label: z.string().optional(),
});

export type SaveIndicatorSettingsRequest = z.infer<typeof SaveIndicatorSettingsRequestSchema>;

// ========================================
// PATCH /api/indicators/settings/:indicatorId/toggle
// ========================================

/** インジケータートグルリクエスト */
export const ToggleIndicatorRequestSchema = z.object({
  enabled: z.boolean({ message: 'enabled は boolean 型が必要です' }),
});

export type ToggleIndicatorRequest = z.infer<typeof ToggleIndicatorRequestSchema>;

// ========================================
// GET /api/indicators/metadata クエリ
// ========================================

/** メタデータ取得クエリ */
export const GetMetadataQuerySchema = z.object({
  category: z.enum(['momentum', 'trend', 'volatility', 'volume']).optional(),
});

export type GetMetadataQuery = z.infer<typeof GetMetadataQuerySchema>;
