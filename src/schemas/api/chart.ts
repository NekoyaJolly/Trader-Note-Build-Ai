/**
 * チャート / ブローカー API のクエリスキーマ
 *
 * GET /api/chart/candles・GET /api/broker/quote のクエリ検証を schema 層に集約し、
 * route 側は validateQuery ミドルウェアで適用する (型ドリフト・重複防止)。
 */

import { z } from 'zod';

/**
 * GET /api/chart/candles のクエリ。
 *
 * from / to は「両方指定」または「両方省略」のみ許可する。
 * 片方だけ指定されると Provider 側が意図せず通常取得にフォールバックするため、
 * クエリ段階で弾く。両方指定時は from <= to も検証する。
 */
export const ChartCandlesQuerySchema = z
  .object({
    symbol: z.string().min(1, 'symbol は必須です'),
    timeframe: z.string().min(1, 'timeframe は必須です'),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().positive().max(5000).optional(),
  })
  .refine((d) => (d.from == null) === (d.to == null), {
    message: 'from と to は両方指定するか両方省略してください',
    path: ['from'],
  })
  .refine((d) => !(d.from && d.to) || new Date(d.from) <= new Date(d.to), {
    message: 'from は to 以前である必要があります',
    path: ['from'],
  });

export type ChartCandlesQuery = z.infer<typeof ChartCandlesQuerySchema>;

/**
 * GET /api/broker/quote のクエリ。
 */
export const BrokerQuoteQuerySchema = z.object({
  symbol: z.string().min(1, 'symbol は必須です'),
});

export type BrokerQuoteQuery = z.infer<typeof BrokerQuoteQuerySchema>;
