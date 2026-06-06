import { z } from "zod";

/**
 * GET /api/chart/symbols のレスポンススキーマ。
 *
 * チャートの銘柄候補 (cTrader ∪ DB 既知銘柄 ∪ シード) を動的供給する経路。
 * 外部レスポンスは Zod でランタイム検証してから採用する (プロジェクト方針)。
 */
export const ChartSymbolOptionSchema = z.object({
  /** 正規化シンボル (例 XAUUSD)。API パラメータにそのまま使う */
  value: z.string().min(1),
  /** 表示用ラベル (例 XAU/USD) */
  label: z.string().min(1),
});

export const ChartSymbolsResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({
    symbols: z.array(ChartSymbolOptionSchema),
    source: z.enum(["ctrader", "db", "seed"]).optional(),
  }),
});

export type ChartSymbolOption = z.infer<typeof ChartSymbolOptionSchema>;
export type ChartSymbolsResponse = z.infer<typeof ChartSymbolsResponseSchema>;
