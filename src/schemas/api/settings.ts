/**
 * 設定API用 Zodスキーマ定義
 * 
 * settingsRoutes.ts で使用するリクエストバリデーション
 */
import { z } from 'zod';

// ========================================
// 通知設定スキーマ
// ========================================

/** 通知設定 */
export const NotificationSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  scoreThreshold: z.number().min(0, '0以上を指定').max(100, '100以下を指定').optional(),
  maxPerDay: z.number().min(1, '1以上を指定').max(100, '100以下を指定').optional(),
});

// ========================================
// 時間足設定スキーマ
// ========================================

/** 時間足設定 */
export const TimeframesSettingsSchema = z.object({
  primary: z.string().optional(),
  secondary: z.string().optional(),
});

// ========================================
// 表示設定スキーマ
// ========================================

/** 表示設定 */
export const DisplaySettingsSchema = z.object({
  darkMode: z.boolean().optional(),
  compactView: z.boolean().optional(),
  showAiSuggestions: z.boolean().optional(),
});

// ========================================
// PUT /api/settings リクエスト
// ========================================

/** 設定更新リクエスト */
export const UpdateSettingsRequestSchema = z.object({
  notification: NotificationSettingsSchema.optional(),
  timeframes: TimeframesSettingsSchema.optional(),
  display: DisplaySettingsSchema.optional(),
});

export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
