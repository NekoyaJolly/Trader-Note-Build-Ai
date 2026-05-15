/**
 * BarLocator API 用 Zod スキーマ
 *
 * barLocatorRoutes.ts のリクエストバリデーション
 */
import { z } from 'zod';

/** BarLocator のマッチモード */
export const BarLocatorModeSchema = z.enum(['auto', 'exact', 'nearest']);

export type BarLocatorMode = z.infer<typeof BarLocatorModeSchema>;

// ========================================
// POST /api/bars/locate
// ========================================

/** POST リクエストボディ */
export const BarLocatorPostBodySchema = z.object({
  symbol: z.string().min(1, 'symbol は必須です'),
  targetTime: z.string().min(1, 'targetTime は必須です'),
  timeframe: z.string().min(1, 'timeframe は必須です'),
  mode: BarLocatorModeSchema.optional().default('auto'),
});

export type BarLocatorPostBody = z.infer<typeof BarLocatorPostBodySchema>;

// ========================================
// GET /api/bars/locate/:symbol/:timestamp/:timeframe
// ========================================

/** GET URL パラメータ */
export const BarLocatorGetParamsSchema = z.object({
  symbol: z.string().min(1, 'symbol は必須です'),
  timestamp: z.string().min(1, 'timestamp は必須です'),
  timeframe: z.string().min(1, 'timeframe は必須です'),
});

export type BarLocatorGetParams = z.infer<typeof BarLocatorGetParamsSchema>;

/** GET クエリパラメータ */
export const BarLocatorGetQuerySchema = z.object({
  mode: BarLocatorModeSchema.optional().default('auto'),
});

export type BarLocatorGetQuery = z.infer<typeof BarLocatorGetQuerySchema>;
