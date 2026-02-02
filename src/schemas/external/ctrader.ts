/**
 * cTrader Open API レスポンススキーマ定義
 * 
 * 外部APIレスポンスの型安全性を確保するため、
 * Zodスキーマによるランタイムバリデーションを提供
 */

import { z } from 'zod';

/**
 * cTrader アカウント情報スキーマ
 */
export const CTraderAccountSchema = z.object({
  ctidTraderAccountId: z.number().int().positive(),
  isLive: z.boolean(),
  traderLogin: z.number().int().optional(),
});

/**
 * cTrader アカウント一覧レスポンススキーマ
 */
export const CTraderAccountListResponseSchema = z.object({
  ctidTraderAccount: z.array(CTraderAccountSchema).optional(),
});

/**
 * cTrader シンボル情報スキーマ
 */
export const CTraderSymbolInfoSchema = z.object({
  symbolId: z.number().int().positive(),
  symbolName: z.string(),
  digits: z.number().int().optional(),
  pipPosition: z.number().int().optional(),
});

/**
 * cTrader スポット価格イベントスキーマ
 */
export const CTraderSpotEventSchema = z.object({
  symbolId: z.number().int().optional(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  timestamp: z.number().int().optional(),
});

// 型推論用のエクスポート
export type CTraderAccount = z.infer<typeof CTraderAccountSchema>;
export type CTraderAccountListResponse = z.infer<typeof CTraderAccountListResponseSchema>;
export type CTraderSymbolInfo = z.infer<typeof CTraderSymbolInfoSchema>;
export type CTraderSpotEvent = z.infer<typeof CTraderSpotEventSchema>;
