/**
 * IndicatorSpecialist (Phase 6.8、2026-05-27) の入出力型定義。
 *
 * 旧 Phase 6 の 3 体並列 Specialist (Trend / Oscillator / VolatilityVolume) を統合し、
 * `IndicatorSpecialist` 1 体に集約した。テクニカル indicator の **計算は analysis-engine
 * 側**、本 Specialist は **計算済み値の解釈** に専念する役割分離設計。
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md
 */

import { z } from 'zod';
import { INDICATOR_IDS, type IndicatorId } from '../../../shared/indicators/registry';
import type { SupportedTimeframe } from '../../constants/timeframes';

// IndicatorIdSchema: shared registry の INDICATOR_IDS を Zod enum 化
// (= primaryIndicators の str 配列を未知 ID で誤魔化さないため)
const IndicatorIdSchema = z.enum(INDICATOR_IDS);

// ============================================================================
// 入力型
// ============================================================================

/**
 * 1 つの indicator の整形済み系列。
 *
 * analysis-engine の生レスポンス `series: Record<string, Array<number|null>>` を
 * `toIndicatorSeries()` で整形した形 (= prompt 構築層で LLM 解釈に適した構造に変換)。
 */
export interface IndicatorSeries {
  latest: number | null;
  previous: number | null;
  /** 直近 N 期間の値 (Specialist が傾き / 変化を判断する材料、既定 N=20) */
  recentValues: Array<number | null>;
  /** 統計サマリ (= 生配列が冗長な時に置換、prompt トークン削減用) */
  summary?: { mean: number; std: number; min: number; max: number };
}

/**
 * 1 つの時間足分の indicator + price データ。
 *
 * `indicators` は `shared/indicators/registry.ts` の \`IndicatorId\` を canonical な
 * キーとする `Partial<Record<IndicatorId, IndicatorSeries>>`。これにより:
 * - shared registry に新規 indicator が追加されても自動対応 (= drift 防止)
 * - 取得失敗 / 未取得 indicator は undefined (= prompt で「不在」として表示)
 *
 * 実際の取得対象は `indicatorCatalog.ts` の `INDICATOR_CATALOG` (= P0/P1 優先度) で
 * 制限される。本型は柔軟性のため registry 全体をフルに受け取れる構造。
 */
export interface TimeframeData {
  indicators: Partial<Record<IndicatorId, IndicatorSeries>>;
  /** OHLCV 直近サマリ (= 価格・出来高の絶対値、indicator では表現できない情報) */
  priceContext: {
    latestClose: number;
    latestVolume: number;
    sessionHigh: number;
    sessionLow: number;
  };
}

/**
 * IndicatorSpecialist への入力。
 *
 * MTF (Multi-Timeframe) 対応 (Nekoさん 2026-05-27 指示): 現在 TF + 上位 TF の indicator を
 * 両方取って、LLM に MTF 整合性を判断させる。上位 TF は `deriveHigherTimeframe()` で導出。
 *
 * `currentTimeframe / higherTimeframe` は `SupportedTimeframe` で制約 (= `src/side-b/
 * constants/timeframes.ts` の単一情報源、`normalizeTimeframe()` で正規化済の値が入る前提)。
 */
export interface IndicatorSpecialistInput {
  symbol: string;
  /** 現在の時間足 (= entry / execution TF) */
  currentTimeframe: SupportedTimeframe;
  /** 上位の時間足 (= MTF 整合性確認用) */
  higherTimeframe: SupportedTimeframe;
  current: TimeframeData;
  higher: TimeframeData;
}

// ============================================================================
// 出力型 (Zod schema)
// ============================================================================

const TrendStateEnum = z.enum([
  'strong_up',
  'weak_up',
  'ranging',
  'weak_down',
  'strong_down',
]);
const TrendMaturityEnum = z.enum(['early', 'middle', 'late']);
const MomentumEnum = z.enum(['overbought', 'bullish', 'neutral', 'bearish', 'oversold']);
const DivergenceEnum = z.enum(['bullish_divergence', 'bearish_divergence', 'none']);
const VolatilityRegimeEnum = z.enum(['expansion', 'normal', 'contraction']);
const BreakoutRiskEnum = z.enum(['high', 'medium', 'low']);
const VolumeSignalEnum = z.enum(['unusual_high', 'normal', 'unusual_low', 'no_data']);
const TrendAlignmentEnum = z.enum([
  'aligned_bullish',
  'aligned_bearish',
  'mixed',
  'aligned_neutral',
]);

const KeyLevelsSchema = z.object({
  support: z.array(z.number()),
  resistance: z.array(z.number()),
});

const CurrentAnalysisSchema = z.object({
  trendState: TrendStateEnum,
  trendStrength: z.number().min(0).max(1),
  trendMaturity: TrendMaturityEnum,
  keyLevels: KeyLevelsSchema,
  momentum: MomentumEnum,
  divergence: DivergenceEnum,
  volatilityRegime: VolatilityRegimeEnum,
  breakoutRisk: BreakoutRiskEnum,
  volumeSignal: VolumeSignalEnum,
});

const HigherAnalysisSchema = z.object({
  trendState: TrendStateEnum,
  trendStrength: z.number().min(0).max(1),
  keyLevels: KeyLevelsSchema,
  momentum: MomentumEnum,
});

const MtfAlignmentSchema = z.object({
  trendAlignment: TrendAlignmentEnum,
  pullbackOpportunity: z.boolean(),
  counterTrendSignal: z.boolean(),
});

/**
 * IndicatorSpecialist の出力 schema (Zod 検証用)。
 *
 * 旧 3 体出力 (TrendAnalysis / OscillatorAnalysis / VolatilityVolumeAnalysis) の和集合 +
 * MTF 整合性判断 (`higher` / `mtfAlignment`) + primaryIndicators を持つ。
 */
export const IndicatorAnalysisSchema = z.object({
  /**
   * 自然言語の総合解釈 (= MTF 観点込みのテクニカル状態説明)。
   * prompt は「80 文字以上、根拠 indicator id を必ず含める」を要求するが、Zod は
   * 境界ケースの過剰失敗を避けるため最低 40 文字に緩める (= 多くの場合 80 超を出すが、
   * indicator 不在等で短くなる場合も許容)。
   */
  interpretation: z.string().min(40),
  /** 確信度 0-1 (= signal の強さ / MTF 整合性) */
  confidence: z.number().min(0).max(1),
  /** 現在 TF (= currentTimeframe) のテクニカル判断 */
  current: CurrentAnalysisSchema,
  /** 上位 TF (= higherTimeframe) のテクニカル判断 */
  higher: HigherAnalysisSchema,
  /** MTF 整合性判断 */
  mtfAlignment: MtfAlignmentSchema,
  /**
   * どの indicator が判断の主根拠になったか (TF 別、後段 debug / Reflection 用)。
   * shared registry の `IndicatorId` enum で制約 (= 未知 ID / 誤字を早期に弾く)。
   */
  primaryIndicators: z.object({
    current: z.array(IndicatorIdSchema),
    higher: z.array(IndicatorIdSchema),
  }),
});

export type IndicatorAnalysis = z.infer<typeof IndicatorAnalysisSchema>;
