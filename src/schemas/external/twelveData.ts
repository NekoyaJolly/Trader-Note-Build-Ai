/**
 * 外部API Zodスキーマ - Twelve Data
 * 
 * 目的: Twelve Data APIのレスポンスを安全にパースするためのスキーマ
 */

import { z } from 'zod';

// ========================================
// 基本レスポンススキーマ
// ========================================

/**
 * Twelve Data エラーレスポンス
 */
export const TwelveDataErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  status: z.literal('error'),
});

export type TwelveDataError = z.infer<typeof TwelveDataErrorSchema>;

/**
 * Twelve Data メタ情報
 */
export const TwelveDataMetaSchema = z.object({
  symbol: z.string(),
  interval: z.string(),
  currency: z.string().optional(),
  exchange_timezone: z.string().optional(),
  exchange: z.string().optional(),
  mic_code: z.string().optional(),
  type: z.string().optional(),
});

export type TwelveDataMeta = z.infer<typeof TwelveDataMetaSchema>;

// ========================================
// 時系列データスキーマ
// ========================================

/**
 * OHLCVバー
 */
export const TwelveDataOHLCVSchema = z.object({
  datetime: z.string(),
  open: z.string().transform((v) => parseFloat(v)),
  high: z.string().transform((v) => parseFloat(v)),
  low: z.string().transform((v) => parseFloat(v)),
  close: z.string().transform((v) => parseFloat(v)),
  volume: z.string().transform((v) => parseFloat(v)).optional(),
});

export type TwelveDataOHLCV = z.infer<typeof TwelveDataOHLCVSchema>;

/**
 * 時系列レスポンス（成功）
 */
export const TwelveDataTimeSeriesSuccessSchema = z.object({
  meta: TwelveDataMetaSchema,
  values: z.array(TwelveDataOHLCVSchema),
  status: z.literal('ok').optional(),
});

export type TwelveDataTimeSeriesSuccess = z.infer<typeof TwelveDataTimeSeriesSuccessSchema>;

/**
 * 時系列レスポンス（成功 or エラー）
 */
export const TwelveDataTimeSeriesResponseSchema = z.union([
  TwelveDataTimeSeriesSuccessSchema,
  TwelveDataErrorSchema,
]);

export type TwelveDataTimeSeriesResponse = z.infer<typeof TwelveDataTimeSeriesResponseSchema>;

// ========================================
// リアルタイム価格スキーマ
// ========================================

/**
 * リアルタイム価格データ
 */
export const TwelveDataPriceSchema = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  exchange: z.string().optional(),
  mic_code: z.string().optional(),
  currency: z.string().optional(),
  datetime: z.string(),
  timestamp: z.number().optional(),
  open: z.string().transform((v) => parseFloat(v)),
  high: z.string().transform((v) => parseFloat(v)),
  low: z.string().transform((v) => parseFloat(v)),
  close: z.string().transform((v) => parseFloat(v)),
  volume: z.string().transform((v) => parseFloat(v)).optional(),
  previous_close: z.string().transform((v) => parseFloat(v)).optional(),
  change: z.string().transform((v) => parseFloat(v)).optional(),
  percent_change: z.string().transform((v) => parseFloat(v)).optional(),
  is_market_open: z.boolean().optional(),
});

export type TwelveDataPrice = z.infer<typeof TwelveDataPriceSchema>;

/**
 * 価格レスポンス
 */
export const TwelveDataPriceResponseSchema = z.union([
  TwelveDataPriceSchema,
  TwelveDataErrorSchema,
]);

export type TwelveDataPriceResponse = z.infer<typeof TwelveDataPriceResponseSchema>;

// ========================================
// テクニカルインジケータースキーマ
// ========================================

/**
 * RSIレスポンス値
 */
export const TwelveDataRSIValueSchema = z.object({
  datetime: z.string(),
  rsi: z.string().transform((v) => parseFloat(v)),
});

/**
 * RSIレスポンス
 */
export const TwelveDataRSIResponseSchema = z.object({
  meta: TwelveDataMetaSchema.extend({
    indicator: z.object({
      name: z.string(),
      time_period: z.number(),
    }),
  }),
  values: z.array(TwelveDataRSIValueSchema),
});

export type TwelveDataRSIResponse = z.infer<typeof TwelveDataRSIResponseSchema>;

/**
 * MACDレスポンス値
 */
export const TwelveDataMACDValueSchema = z.object({
  datetime: z.string(),
  macd: z.string().transform((v) => parseFloat(v)),
  macd_signal: z.string().transform((v) => parseFloat(v)),
  macd_hist: z.string().transform((v) => parseFloat(v)),
});

/**
 * MACDレスポンス
 */
export const TwelveDataMACDResponseSchema = z.object({
  meta: TwelveDataMetaSchema.extend({
    indicator: z.object({
      name: z.string(),
      fast_period: z.number().optional(),
      slow_period: z.number().optional(),
      signal_period: z.number().optional(),
    }),
  }),
  values: z.array(TwelveDataMACDValueSchema),
});

export type TwelveDataMACDResponse = z.infer<typeof TwelveDataMACDResponseSchema>;

/**
 * ボリンジャーバンドレスポンス値
 */
export const TwelveDataBBValueSchema = z.object({
  datetime: z.string(),
  upper_band: z.string().transform((v) => parseFloat(v)),
  middle_band: z.string().transform((v) => parseFloat(v)),
  lower_band: z.string().transform((v) => parseFloat(v)),
});

/**
 * ボリンジャーバンドレスポンス
 */
export const TwelveDataBBResponseSchema = z.object({
  meta: TwelveDataMetaSchema.extend({
    indicator: z.object({
      name: z.string(),
      time_period: z.number().optional(),
      sd: z.number().optional(),
      ma_type: z.string().optional(),
    }),
  }),
  values: z.array(TwelveDataBBValueSchema),
});

export type TwelveDataBBResponse = z.infer<typeof TwelveDataBBResponseSchema>;

// ========================================
// ヘルパー関数
// ========================================

/**
 * Twelve Dataレスポンスがエラーかどうかを判定
 */
export function isTwelveDataError(response: unknown): response is TwelveDataError {
  const result = TwelveDataErrorSchema.safeParse(response);
  return result.success;
}

/**
 * 時系列レスポンスを安全にパース
 */
export function parseTwelveDataTimeSeries(response: unknown): TwelveDataTimeSeriesSuccess {
  const result = TwelveDataTimeSeriesResponseSchema.safeParse(response);
  
  if (!result.success) {
    throw new Error(`Twelve Data レスポンスのパースに失敗: ${result.error.message}`);
  }
  
  if ('code' in result.data && result.data.status === 'error') {
    throw new Error(`Twelve Data API エラー: ${result.data.message} (code: ${result.data.code})`);
  }
  
  return result.data;
}

/**
 * 価格レスポンスを安全にパース
 */
export function parseTwelveDataPrice(response: unknown): TwelveDataPrice {
  const result = TwelveDataPriceResponseSchema.safeParse(response);
  
  if (!result.success) {
    throw new Error(`Twelve Data 価格レスポンスのパースに失敗: ${result.error.message}`);
  }
  
  if ('code' in result.data && 'status' in result.data && result.data.status === 'error') {
    throw new Error(`Twelve Data API エラー: ${(result.data).message}`);
  }
  
  return result.data as TwelveDataPrice;
}
