/**
 * チャート / ブローカー API のクエリスキーマ
 *
 * GET /api/chart/candles・GET /api/broker/quote のクエリ検証を schema 層に集約し、
 * route 側は validateQuery ミドルウェアで適用する (型ドリフト・重複防止)。
 */

import { z } from 'zod';
import {
  AnalysisEngineIndicatorSpecSchema,
  AnalysisEnginePatternIdSchema,
} from '../external/analysisEngine';

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

/**
 * POST /api/chart/indicator-series のリクエストボディ。
 *
 * フロント (例: /strategies/new のプレビュー) が「条件で使うインジ + ローソク足パターン」を
 * 指定し、analysis-engine (pandas-ta) が計算した系列を取得するための公開ルート用スキーマ。
 *
 * 計算ロジックは analysis-engine に一元化し、フロントの自前計算 (chartIndicators.ts) との
 * 乖離をなくす狙い。指標 spec の形 ({ indicatorId, params, field }) と cacheKey 規約は
 * analysis-engine / backtest と完全に共有するため、spec は external スキーマを再利用する。
 *
 * patterns は analysis-engine の pattern 引数 (`AnalysisEnginePatternIdSchema`) をそのまま再利用する。
 * = ローソク足パターン (shared/patterns の CandlePatternId) + `bb_bandwidth` (BB 帯幅 = volatility flag)。
 * リテラルを再定義せず単一情報源を import することでドリフトを防ぐ。
 */
export const ChartIndicatorSeriesRequestSchema = z
  .object({
    symbol: z.string().min(1, 'symbol は必須です'),
    timeframe: z.string().min(1, 'timeframe は必須です'),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    // 1 リクエストで計算する指標数の上限。条件ビルダーの現実的な上限を大きく上回る値で、
    // 悪意ある巨大ペイロードによる analysis-engine 過負荷を防ぐためのガード。
    indicators: z.array(AnalysisEngineIndicatorSpecSchema).max(64).default([]),
    patterns: z.array(AnalysisEnginePatternIdSchema).max(13).default([]),
  })
  .refine((d) => new Date(d.startDate) <= new Date(d.endDate), {
    message: 'startDate は endDate 以前である必要があります',
    path: ['startDate'],
  });

export type ChartIndicatorSeriesRequest = z.infer<typeof ChartIndicatorSeriesRequestSchema>;
