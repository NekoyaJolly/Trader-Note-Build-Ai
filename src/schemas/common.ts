/**
 * 共通Zodスキーマ
 * 
 * 目的: プロジェクト全体で使用する基本的なスキーマを定義
 * 使用方法: import { DateSchema, PaginationSchema } from '@/schemas/common';
 */

import { z } from 'zod';

// ========================================
// 日付・時刻スキーマ
// ========================================

/**
 * ISO日時文字列またはDateオブジェクト → Dateに変換
 */
export const DateSchema = z.union([
  z.string().datetime({ message: '有効なISO日時形式で入力してください' }),
  z.date(),
]).transform((val) => (typeof val === 'string' ? new Date(val) : val));

/**
 * 日付文字列（YYYY-MM-DD形式）
 */
export const DateStringSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  '日付はYYYY-MM-DD形式で入力してください'
);

/**
 * オプショナルな日時（nullも許可）
 */
export const OptionalDateSchema = z.union([
  DateSchema,
  z.null(),
]).optional();

// ========================================
// ID・識別子スキーマ
// ========================================

/**
 * UUID v4
 */
export const UUIDSchema = z.string().uuid('有効なUUID形式で入力してください');

/**
 * 汎用ID（UUID or 文字列）
 */
export const IdSchema = z.string().min(1, 'IDは必須です');

/**
 * 予約済みプロファイルID
 */
export const ReservedProfileIdSchema = z.enum(['__AI_AUTO__', '__NONE__']);

/**
 * プロファイルID（予約ID or UUID）
 */
export const ProfileIdSchema = z.union([
  ReservedProfileIdSchema,
  UUIDSchema,
]);

// ========================================
// ページネーション・クエリスキーマ
// ========================================

/**
 * ページネーションパラメータ
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof PaginationSchema>;

/**
 * ソートパラメータ
 */
export const SortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type Sort = z.infer<typeof SortSchema>;

/**
 * ページネーション + ソート
 */
export const PaginatedQuerySchema = PaginationSchema.merge(SortSchema);

export type PaginatedQuery = z.infer<typeof PaginatedQuerySchema>;

// ========================================
// 数値スキーマ
// ========================================

/**
 * 正の整数
 */
export const PositiveIntSchema = z.coerce.number().int().positive('正の整数を入力してください');

/**
 * 0-100のスコア値
 */
export const ScoreSchema = z.coerce.number().min(0).max(100);

/**
 * 0-1の正規化された値
 */
export const NormalizedValueSchema = z.coerce.number().min(0).max(1);

/**
 * 価格（正の数値）
 */
export const PriceSchema = z.coerce.number().positive('価格は正の数値で入力してください');

/**
 * ロットサイズ（0より大きい）
 */
export const LotSizeSchema = z.coerce.number().positive('ロットサイズは正の数値で入力してください');

// ========================================
// 文字列スキーマ
// ========================================

/**
 * 空でない文字列
 */
export const NonEmptyStringSchema = z.string().min(1, '必須項目です');

/**
 * シンボル（通貨ペア、銘柄コード）
 */
export const SymbolSchema = z.string()
  .min(1, 'シンボルは必須です')
  .max(20, 'シンボルは20文字以内で入力してください')
  .toUpperCase();

/**
 * 時間足
 */
export const TimeframeSchema = z.enum([
  '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'
]);

export type Timeframe = z.infer<typeof TimeframeSchema>;

/**
 * トレード方向
 */
export const DirectionSchema = z.enum(['BUY', 'SELL', 'LONG', 'SHORT']);

export type Direction = z.infer<typeof DirectionSchema>;

// ========================================
// レスポンススキーマ
// ========================================

/**
 * 成功レスポンスを生成するヘルパー
 */
export function createSuccessResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
  });
}

/**
 * エラーレスポンス
 */
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  details: z.unknown().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * ページネーション付きレスポンスを生成するヘルパー
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    success: z.literal(true),
    data: z.object({
      items: z.array(itemSchema),
      total: z.number(),
      page: z.number(),
      limit: z.number(),
      totalPages: z.number(),
    }),
  });
}

// ========================================
// バリデーションユーティリティ
// ========================================

/**
 * Zodエラーを人間が読みやすい形式に変換
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((e) => {
      const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
      return `${path}${e.message}`;
    })
    .join(', ');
}

/**
 * バリデーション結果の型
 */
export type ValidationResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string; details: z.ZodError };

/**
 * safeParse結果をValidationResultに変換
 */
export function toValidationResult<T>(
  result: { success: true; data: T } | { success: false; error: z.ZodError }
): ValidationResult<T> {
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: formatZodError(result.error),
    details: result.error,
  };
}
