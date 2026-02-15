import { z } from 'zod';

/**
 * analysis-engine（Python）との通信スキーマ
 * 
 * 目的:
 * - pandas-ta を正としてインジケーター系列を取得
 * - 大量データは DB 共有で転送を避け、Node → Python は最小情報のみ
 */

export const AnalysisEngineIndicatorSpecSchema = z.object({
  indicatorId: z.string().min(1),
  params: z.record(z.string(), z.number()).default({}),
  field: z.string().min(1),
});

export type AnalysisEngineIndicatorSpec = z.infer<typeof AnalysisEngineIndicatorSpecSchema>;

export const AnalysisEngineIndicatorSeriesRequestSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  indicators: z.array(AnalysisEngineIndicatorSpecSchema).default([]),
  patterns: z.array(z.enum(['pinbar', 'bb_bandwidth'])).default([]),
  bbBandwidthWindow: z.number().int().min(2).max(500).default(20),
  bbBandwidthThreshold: z.number().min(0).max(10).default(0.2),
});

export type AnalysisEngineIndicatorSeriesRequest = z.infer<typeof AnalysisEngineIndicatorSeriesRequestSchema>;

// Node → Python を ID ベースにする（StrategyVersion を Python が DB 直読み）
export const AnalysisEngineIndicatorSeriesByVersionRequestSchema = z.object({
  strategyId: z.string().uuid(),
  versionId: z.string().uuid(),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  patterns: z.array(z.enum(['pinbar', 'bb_bandwidth'])).default([]),
  bbBandwidthWindow: z.number().int().min(2).max(500).default(20),
  bbBandwidthThreshold: z.number().min(0).max(10).default(0.2),
});

export type AnalysisEngineIndicatorSeriesByVersionRequest = z.infer<typeof AnalysisEngineIndicatorSeriesByVersionRequestSchema>;

export const AnalysisEngineIndicatorSeriesResponseSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  timestamps: z.array(z.string().datetime()),
  series: z.record(z.string(), z.array(z.number().nullable())),
  patterns: z.record(z.string(), z.array(z.boolean())).default({}),
});

export type AnalysisEngineIndicatorSeriesResponse = z.infer<typeof AnalysisEngineIndicatorSeriesResponseSchema>;
