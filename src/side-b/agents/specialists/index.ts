/**
 * Phase 6: 専門家エージェント集約エクスポート
 *
 * Trend / Oscillator / VolatilityVolume の 3 専門家を並列実行するヘルパー
 * `runAllSpecialists` も提供する。
 */

export { TrendSpecialist } from './TrendSpecialist';
export { OscillatorSpecialist } from './OscillatorSpecialist';
export { VolatilityVolumeSpecialist } from './VolatilityVolumeSpecialist';
export type {
  SpecialistInput,
  SpecialistBundle,
  TrendAnalysis,
  OscillatorAnalysis,
  VolatilityVolumeAnalysis,
} from './types';

import { TrendSpecialist } from './TrendSpecialist';
import { OscillatorSpecialist } from './OscillatorSpecialist';
import { VolatilityVolumeSpecialist } from './VolatilityVolumeSpecialist';
import type { SpecialistInput, SpecialistBundle } from './types';

export interface SpecialistRunOptions {
  trend?: TrendSpecialist;
  oscillator?: OscillatorSpecialist;
  volatilityVolume?: VolatilityVolumeSpecialist;
}

/**
 * 3 専門家を並列実行し、個々の失敗は null としてバンドルに残す。
 * 全体は Promise.allSettled 相当の耐障害性。
 */
export async function runAllSpecialists(
  input: SpecialistInput,
  options: SpecialistRunOptions = {},
): Promise<SpecialistBundle> {
  const trend = options.trend ?? new TrendSpecialist();
  const oscillator = options.oscillator ?? new OscillatorSpecialist();
  const volatilityVolume = options.volatilityVolume ?? new VolatilityVolumeSpecialist();

  const [trendRes, oscRes, volRes] = await Promise.allSettled([
    trend.analyze(input),
    oscillator.analyze(input),
    volatilityVolume.analyze(input),
  ]);

  return {
    trend: trendRes.status === 'fulfilled' ? trendRes.value : null,
    oscillator: oscRes.status === 'fulfilled' ? oscRes.value : null,
    volatilityVolume: volRes.status === 'fulfilled' ? volRes.value : null,
  };
}
