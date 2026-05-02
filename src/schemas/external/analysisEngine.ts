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
  patterns: z
    .array(
      z.enum([
        'pinbar',
        'pinbar_bull',
        'pinbar_bear',
        'hammer',
        'hammer_bull',
        'hammer_bear',
        'shooting_star',
        'engulfing_bull',
        'engulfing_bear',
        'doji',
        'thrust_bull',
        'thrust_bear',
        'bb_bandwidth',
      ])
    )
    .default([]),
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
  patterns: z
    .array(
      z.enum([
        'pinbar',
        'pinbar_bull',
        'pinbar_bear',
        'hammer',
        'hammer_bull',
        'hammer_bear',
        'shooting_star',
        'engulfing_bull',
        'engulfing_bear',
        'doji',
        'thrust_bull',
        'thrust_bear',
        'bb_bandwidth',
      ])
    )
    .default([]),
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

// ============================================
// Critical-4 段階 1: スクリーニング BT API
// ============================================

/**
 * 仮説の MachineReadableCondition を Python BT で評価可能な形で送る。
 * 設計方針 (§12.3): 「変換アダプタを作らない」 → そのまま素直に渡す。
 * Python 側の app/backtest.py で評価する。
 */
const ScreeningBacktestConditionSchema = z.object({
  lensName: z.string(),
  featureKey: z.string(),
  op: z.enum(['<', '<=', '>', '>=', '==', '!=', 'between', 'in']),
  value: z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.tuple([z.number(), z.number()]),
    z.array(z.string()),
  ]),
});

const ScreeningBacktestStopLossSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('atr_multiple'), value: z.number().positive() }),
  z.object({ type: z.literal('fixed_pips'), value: z.number().positive() }),
  z.object({ type: z.literal('swing_point'), lookbackBars: z.number().int().positive() }),
]);

const ScreeningBacktestTakeProfitSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rr_ratio'), value: z.number().positive() }),
  z.object({ type: z.literal('atr_multiple'), value: z.number().positive() }),
  z.object({ type: z.literal('fixed_pips'), value: z.number().positive() }),
]);

/**
 * BT 入力スナップショット (notePayload)。
 * 「ノート schema を BT 入力形式に寄せる」(§12.3) ため、仮説側のフィールド名をそのまま使う。
 */
export const ScreeningBacktestNotePayloadSchema = z.object({
  direction: z.enum(['long', 'short', 'either']),
  conditions: z.array(ScreeningBacktestConditionSchema),
  stopLoss: ScreeningBacktestStopLossSchema,
  takeProfit: ScreeningBacktestTakeProfitSchema,
  /** 指標スペック (Python 側で pandas_ta により計算) */
  indicators: z.array(AnalysisEngineIndicatorSpecSchema).default([]),
  /** 保有上限バー数 */
  maxHoldingBars: z.number().int().positive().optional(),
});

export type ScreeningBacktestNotePayload = z.infer<typeof ScreeningBacktestNotePayloadSchema>;

export const ScreeningBacktestConfigSchema = z.object({
  initialCapital: z.number().positive().default(10_000),
  /** レバレッジ。1 を渡すとレバレッジなし */
  leverage: z.number().positive().default(1),
  /** 片道手数料 (%, 例: 0.05 = 0.05%) */
  tradingCost: z.number().min(0).default(0),
});

export const AnalysisEngineScreeningBacktestRequestSchema = z.object({
  hypothesisId: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  notePayload: ScreeningBacktestNotePayloadSchema,
  config: ScreeningBacktestConfigSchema.optional().default(() => ({
    initialCapital: 10_000,
    leverage: 1,
    tradingCost: 0,
  })),
});

export type AnalysisEngineScreeningBacktestRequest = z.infer<
  typeof AnalysisEngineScreeningBacktestRequestSchema
>;

export const ScreeningBacktestSummarySchema = z.object({
  pf: z.number(),
  winRate: z.number(),
  tradeCount: z.number().int().nonnegative(),
  maxDD: z.number().nullable(),
  sharpe: z.number().nullable(),
  returnPct: z.number().nullable(),
});

export type ScreeningBacktestSummary = z.infer<typeof ScreeningBacktestSummarySchema>;

export const ScreeningBacktestTradeSchema = z.object({
  entryTime: z.string().datetime(),
  entryPrice: z.number(),
  exitTime: z.string().datetime().nullable(),
  exitPrice: z.number().nullable(),
  side: z.enum(['long', 'short']),
  pnl: z.number(),
  outcome: z.enum(['win', 'loss', 'timeout']),
});

export type ScreeningBacktestTrade = z.infer<typeof ScreeningBacktestTradeSchema>;

export const AnalysisEngineScreeningBacktestResponseSchema = z.object({
  summary: ScreeningBacktestSummarySchema,
  trades: z.array(ScreeningBacktestTradeSchema),
  /** equity curve (省略可、長大なため将来サンプリング検討) */
  equity: z.array(z.number()).nullable(),
  /** BT エンジン名+バージョン (例: 'analysis-engine/backtesting.py@0.6.5') */
  engineVersion: z.string().min(1),
  /**
   * 評価できなかった条件 (Python 側で lens 名→指標マッピングできなかったもの)。
   * 段階 1 では SL/TP のみで BT を進めるためのデバッグ用。
   */
  unsupportedConditions: z.array(z.string()).default([]),
});

export type AnalysisEngineScreeningBacktestResponse = z.infer<
  typeof AnalysisEngineScreeningBacktestResponseSchema
>;
