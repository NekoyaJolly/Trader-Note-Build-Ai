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
  // color は HEX (#RGB / #RRGGBB / #RRGGBBAA)。壊れた値を弾くため形式を制約する。
  color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/),
  // 線の太さは現実的な範囲 (1-10) に収め、壊れた値での極端な描画を防ぐ。
  lineWidth: z.number().int().min(1).max(10),
  label: z.string().max(100).optional(),
});

export const SelectedIndicatorSchema = z.object({
  id: z.string().min(1).max(64),
  // params は有限かつ現実的な範囲 (±100000) に制約する。
  // 壊れた localStorage に極端な period 等が入ると、インジケーター計算のループが
  // 過大化してフリーズ/極端な遅延を招くため、復元時にここで弾く。
  params: z.record(z.string(), z.number().finite().gte(-100000).lte(100000)),
  displaySettings: IndicatorDisplaySettingsSchema.optional(),
});

export const SelectedIndicatorArraySchema = z.array(SelectedIndicatorSchema);

export type PersistedSelectedIndicator = z.infer<typeof SelectedIndicatorSchema>;
