/**
 * analysis-engine の indicator field alias 解決。
 *
 * DSL の `Condition.feature` は後方互換のため string のまま維持する。
 * 一方、analysis-engine は `indicatorId + field` で MACD histogram や BB upper を
 * 計算できるため、feature 名だけで field 別 series を表現する alias をここで解決する。
 */

import { isPythonSupportedIndicatorId, type IndicatorId } from '../../shared/indicators/registry';

/** analysis-engine に渡す indicator series 指定。 */
export interface ResolvedIndicatorFeature {
  readonly indicatorId: IndicatorId;
  readonly field: string;
}

const FEATURE_ALIASES: Readonly<Record<string, ResolvedIndicatorFeature>> = Object.freeze({
  macd_signal: { indicatorId: 'macd', field: 'signal' },
  macd_histogram: { indicatorId: 'macd', field: 'histogram' },
  stochastic_k: { indicatorId: 'stochastic', field: 'value' },
  stochastic_d: { indicatorId: 'stochastic', field: 'd' },
  bb_middle: { indicatorId: 'bb', field: 'value' },
  bb_upper: { indicatorId: 'bb', field: 'upper' },
  bb_lower: { indicatorId: 'bb', field: 'lower' },
  bb_bandwidth: { indicatorId: 'bb', field: 'bandwidth' },
  kc_middle: { indicatorId: 'kc', field: 'value' },
  kc_upper: { indicatorId: 'kc', field: 'upper' },
  kc_lower: { indicatorId: 'kc', field: 'lower' },
  ichimoku_tenkan: { indicatorId: 'ichimoku', field: 'tenkan' },
  ichimoku_kijun: { indicatorId: 'ichimoku', field: 'kijun' },
  ichimoku_senkou_a: { indicatorId: 'ichimoku', field: 'senkouA' },
  ichimoku_senkou_b: { indicatorId: 'ichimoku', field: 'senkouB' },
  ichimoku_chikou: { indicatorId: 'ichimoku', field: 'chikou' },
});

/** DSL feature 名を analysis-engine の indicatorId/field に解決する。 */
export function resolveIndicatorFeature(feature: string): ResolvedIndicatorFeature | null {
  const aliased = FEATURE_ALIASES[feature];
  if (aliased) return aliased;
  if (!isPythonSupportedIndicatorId(feature)) return null;
  return { indicatorId: feature, field: 'value' };
}

