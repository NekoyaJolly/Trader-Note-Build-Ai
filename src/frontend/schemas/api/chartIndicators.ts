import { z } from "zod";

/**
 * チャートに適用中のインジケーター選択を localStorage に永続化するためのスキーマ。
 *
 * 条件6: アプリ再起動 (リロード) してもチャート上のインジケーターが消えないように、
 * 選択状態を保存・復元する。localStorage から読む際は壊れた値を弾くため Zod で検証する。
 *
 * shape は components/IndicatorSelector.ts の SelectedIndicator / IndicatorDisplaySettings と
 * 構造的に一致させる。
 */
export const IndicatorDisplaySettingsSchema = z.object({
  color: z.string(),
  lineWidth: z.number(),
  label: z.string().optional(),
});

export const SelectedIndicatorSchema = z.object({
  id: z.string().min(1),
  params: z.record(z.string(), z.number()),
  displaySettings: IndicatorDisplaySettingsSchema.optional(),
});

export const SelectedIndicatorArraySchema = z.array(SelectedIndicatorSchema);

export type PersistedSelectedIndicator = z.infer<typeof SelectedIndicatorSchema>;
