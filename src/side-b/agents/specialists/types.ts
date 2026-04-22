/**
 * Phase 6: 専門家エージェントの共通型定義
 *
 * 3 専門家 (Trend / Oscillator / VolatilityVolume) が共通で扱う入出力。
 */

import type { LensFeatureSnapshot } from '../../lenses';

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
