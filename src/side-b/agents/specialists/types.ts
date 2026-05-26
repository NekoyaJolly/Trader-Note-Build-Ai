/**
 * Specialist エージェントの入出力型定義。
 *
 * ## Phase 6 (旧)
 * 3 体並列 Specialist (Trend / Oscillator / VolatilityVolume) の入出力。
 * `SpecialistInput` / `SpecialistBundle` / `TrendAnalysis` / `OscillatorAnalysis` /
 * `VolatilityVolumeAnalysis` がこれに対応。
 *
 * ## Phase 6.8 (新、2026-05-27)
 * 上記 3 体を `IndicatorSpecialist` 1 体に統合。`IndicatorSpecialistInput` /
 * `IndicatorAnalysis` / `TimeframeData` / `IndicatorSeries` がこれに対応。テクニカル
 * indicator の **計算は analysis-engine 側**、本 Specialist は **計算済み値の解釈** に
 * 専念する役割分離設計。
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md
 *
 * 移行: 本 PR では新型を **追加** するだけで、旧 3 体は残置 (= tsc 維持)。次 PR で
 * aiOrchestrator / 下流接続切替 + 旧 3 体削除を行う。
 */

import { z } from 'zod';
import type { LensFeatureSnapshot } from '../../lenses';

// ============================================================================
// 旧型 (Phase 6、Trend / Oscillator / VolatilityVolume 3 体並列、次 PR で削除予定)
// ============================================================================

/** 専門家エージェントへの共通入力。 */
export interface SpecialistInput {
  symbol: string;
  timeframe: string;
  lensSnapshot: LensFeatureSnapshot;
}

/** 専門家の確信度共通フィールド(0-1)。 */
export interface SpecialistBase {
  interpretation: string;
  confidence: number;
}

/** TrendSpecialist の出力。 */
export interface TrendAnalysis extends SpecialistBase {
  trendState: 'strong_up' | 'weak_up' | 'ranging' | 'weak_down' | 'strong_down';
  trendStrength: number;
  trendMaturity: 'early' | 'middle' | 'late';
  keyLevels: {
    support: number[];
    resistance: number[];
  };
}

/** OscillatorSpecialist の出力。 */
export interface OscillatorAnalysis extends SpecialistBase {
  momentum: 'overbought' | 'bullish' | 'neutral' | 'bearish' | 'oversold';
  divergence: 'bullish_divergence' | 'bearish_divergence' | 'none';
}

/** VolatilityVolumeSpecialist の出力。 */
export interface VolatilityVolumeAnalysis extends SpecialistBase {
  volatilityRegime: 'expansion' | 'normal' | 'contraction';
  breakoutRisk: 'high' | 'medium' | 'low';
  volumeSignal: 'unusual_high' | 'normal' | 'unusual_low' | 'no_data';
}

/** 3 専門家の統合結果(HypothesisGenerator / StrategyThinker への入力で使用)。 */
export interface SpecialistBundle {
  trend: TrendAnalysis | null;
  oscillator: OscillatorAnalysis | null;
  volatilityVolume: VolatilityVolumeAnalysis | null;
}

// ============================================================================
// 新型 (Phase 6.8、IndicatorSpecialist 1 体統合、2026-05-27)
// ============================================================================

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
 * 各 indicator は P0/P1/P2 優先度 (= `indicatorCatalog.ts`) に基づいて取得され、
 * 取得失敗または未取得は undefined。Specialist は不在 indicator を prompt で明示。
 */
export interface TimeframeData {
  indicators: {
    // トレンド系
    sma?: IndicatorSeries;
    ema?: IndicatorSeries;
    dema?: IndicatorSeries;
    tema?: IndicatorSeries;
    macd?: IndicatorSeries;
    ichimoku?: IndicatorSeries;
    psar?: IndicatorSeries;
    aroon?: IndicatorSeries;
    // オシレーター系
    rsi?: IndicatorSeries;
    cci?: IndicatorSeries;
    roc?: IndicatorSeries;
    mfi?: IndicatorSeries;
    // ボラ/出来高系
    atr?: IndicatorSeries;
    kc?: IndicatorSeries;
    obv?: IndicatorSeries;
    vwap?: IndicatorSeries;
    cmf?: IndicatorSeries;
  };
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
 */
export interface IndicatorSpecialistInput {
  symbol: string;
  /** 現在の時間足 (= entry / execution TF) */
  currentTimeframe: string;
  /** 上位の時間足 (= MTF 整合性確認用) */
  higherTimeframe: string;
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
  /** 自然言語の総合解釈 (= MTF 観点込みのテクニカル状態説明) */
  interpretation: z.string().min(1),
  /** 確信度 0-1 (= signal の強さ / MTF 整合性) */
  confidence: z.number().min(0).max(1),
  /** 現在 TF (= currentTimeframe) のテクニカル判断 */
  current: CurrentAnalysisSchema,
  /** 上位 TF (= higherTimeframe) のテクニカル判断 */
  higher: HigherAnalysisSchema,
  /** MTF 整合性判断 */
  mtfAlignment: MtfAlignmentSchema,
  /** どの indicator が判断の主根拠になったか (TF 別、後段 debug / Reflection 用) */
  primaryIndicators: z.object({
    current: z.array(z.string()),
    higher: z.array(z.string()),
  }),
});

export type IndicatorAnalysis = z.infer<typeof IndicatorAnalysisSchema>;
