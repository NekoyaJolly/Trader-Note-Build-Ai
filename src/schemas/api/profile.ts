/**
 * プロファイルAPI Zodスキーマ
 * 
 * 目的: インジケータープロファイルのCRUD操作で使用するスキーマ
 */

import { z } from 'zod';
import { 
  UUIDSchema, 
  ProfileIdSchema, 
  NonEmptyStringSchema,
  DateSchema,
} from '../common';

// ========================================
// インジケーター設定スキーマ
// ========================================

/**
 * インジケーターパラメータ
 */
export const IndicatorParamsSchema = z.record(
  z.string(),
  z.union([z.number(), z.string(), z.boolean()])
);

export type IndicatorParams = z.infer<typeof IndicatorParamsSchema>;

/**
 * インジケーター設定
 */
export const IndicatorConfigSchema = z.object({
  configId: z.string().min(1, 'configIdは必須です'),
  indicatorId: z.string().min(1, 'indicatorIdは必須です'),
  label: z.string().min(1, 'labelは必須です'),
  params: IndicatorParamsSchema,
  enabled: z.boolean(),
});

export type IndicatorConfig = z.infer<typeof IndicatorConfigSchema>;

// ========================================
// プロファイルスキーマ
// ========================================

/**
 * プロファイル（完全版）
 */
export const IndicatorProfileSchema = z.object({
  id: UUIDSchema,
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  indicators: z.array(IndicatorConfigSchema),
  isDefault: z.boolean(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});

export type IndicatorProfile = z.infer<typeof IndicatorProfileSchema>;

/**
 * プロファイル作成リクエスト
 */
export const CreateProfileRequestSchema = z.object({
  name: z.string()
    .min(1, 'プロファイル名は必須です')
    .max(100, 'プロファイル名は100文字以内で入力してください'),
  description: z.string().max(500, '説明は500文字以内で入力してください').optional(),
  indicators: z.array(IndicatorConfigSchema).default([]),
  isDefault: z.boolean().optional().default(false),
});

export type CreateProfileRequest = z.infer<typeof CreateProfileRequestSchema>;

/**
 * プロファイル更新リクエスト
 */
export const UpdateProfileRequestSchema = z.object({
  name: z.string()
    .min(1, 'プロファイル名は必須です')
    .max(100, 'プロファイル名は100文字以内で入力してください')
    .optional(),
  description: z.string().max(500, '説明は500文字以内で入力してください').optional(),
  indicators: z.array(IndicatorConfigSchema).optional(),
  isDefault: z.boolean().optional(),
});

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

/**
 * プロファイル選択オプション
 */
export const ProfileOptionSchema = z.object({
  id: ProfileIdSchema,
  label: z.string(),
  description: z.string(),
  icon: z.string(),
  isSpecial: z.boolean(),
  isDefault: z.boolean().optional(),
});

export type ProfileOption = z.infer<typeof ProfileOptionSchema>;

// ========================================
// レスポンススキーマ
// ========================================

/**
 * プロファイル一覧レスポンス
 */
export const GetProfilesResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    profiles: z.array(IndicatorProfileSchema),
  }),
});

/**
 * プロファイル詳細レスポンス
 */
export const GetProfileResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    profile: IndicatorProfileSchema,
  }),
});

/**
 * プロファイルオプションレスポンス
 */
export const GetProfileOptionsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    options: z.array(ProfileOptionSchema),
    defaultId: ProfileIdSchema,
  }),
});

// ========================================
// ノートプロファイル設定スキーマ
// ========================================

/**
 * ノートに保存されるプロファイル設定のスナップショット
 */
export const NoteProfileConfigSchema = z.object({
  profileId: ProfileIdSchema,
  profileName: z.string(),
  indicators: z.array(IndicatorConfigSchema),
  threshold: z.number().min(0).max(1),
  appliedAt: DateSchema,
});

export type NoteProfileConfig = z.infer<typeof NoteProfileConfigSchema>;

/**
 * CSVインポート時のプロファイル適用モード
 */
export const ApplyModeSchema = z.enum(['bulk', 'individual']);

export type ApplyMode = z.infer<typeof ApplyModeSchema>;

/**
 * CSVインポートリクエスト（プロファイル対応）
 */
export const ImportWithProfileRequestSchema = z.object({
  filename: z.string().min(1, 'ファイル名は必須です'),
  csvText: z.string().min(1, 'CSVデータは必須です'),
  profileId: ProfileIdSchema.optional().default('__AI_AUTO__'),
  applyMode: ApplyModeSchema.optional().default('bulk'),
  userComment: z.string().max(1000, 'コメントは1000文字以内で入力してください').optional(),
});

export type ImportWithProfileRequest = z.infer<typeof ImportWithProfileRequestSchema>;
