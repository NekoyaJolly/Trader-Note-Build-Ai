/**
 * Specialist エクスポート集約 (Phase 6.8、2026-05-27)
 *
 * 旧 3 体並列 Specialist (Trend / Oscillator / VolatilityVolume) を統合した
 * `IndicatorSpecialist` 1 体に集約。
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md
 */

export {
  IndicatorSpecialist,
  toIndicatorSeries,
  buildMacros,
} from './IndicatorSpecialist';
export {
  fetchIndicatorBundleForMTF,
  type FetchIndicatorBundleInput,
  type OhlcvBar,
} from './analysisEngineIndicatorFetch';
export {
  INDICATOR_CATALOG,
  INDICATOR_MEANINGS,
  P0_INDICATOR_IDS,
  renderIndicatorCatalog,
  type IndicatorSpec,
} from './indicatorCatalog';
export {
  IndicatorAnalysisSchema,
  type IndicatorAnalysis,
  type IndicatorSpecialistInput,
  type TimeframeData,
  type IndicatorSeries,
} from './types';
