import { z } from "zod";

/**
 * GET /api/chart/candles のレスポンススキーマ。
 *
 * 外部レスポンスは Zod でランタイム検証してから採用する (AGENTS.md §3.4 / プロジェクト方針)。
 * 手動 type guard を散らさず、検証を本スキーマに一元化する。
 *
 * **欠損足の扱い**: 5m 以上の FX OHLCV には市場休場等の欠損足が含まれ、その足は OHLC が null。
 * そのため OHLC は `number | null` を許容する (string/undefined は弾く)。欠損足の除外は
 * 利用側 (`toOhlcvPoints`) が行う。`time` は整列・描画の基準なので必須の数値。
 */
const NumberOrNull = z.number().nullable();

export const ChartCandleSchema = z.object({
  /** Unix 秒 (UTC)。NaN/Infinity は schema では弾けないため利用側で finite フィルタする。 */
  time: z.number(),
  open: NumberOrNull,
  high: NumberOrNull,
  low: NumberOrNull,
  close: NumberOrNull,
  volume: z.number().nullable().optional(),
});

export type ChartCandle = z.infer<typeof ChartCandleSchema>;

export const ChartCandlesResponseSchema = z.object({
  candles: z.array(ChartCandleSchema),
  warning: z.string().optional(),
});

export type ChartCandlesResponse = z.infer<typeof ChartCandlesResponseSchema>;
