/**
 * 並列レンズ基盤 エクスポート集約（Phase 1）
 *
 * @see docs/design/phase_1_specification.md
 */

export type {
  Lens,
  LensInput,
  LensFeature,
  LensFeatureSnapshot,
  SerializedLensFeatureSnapshot,
} from './types';

export {
  LensAggregator,
  defaultLensAggregator,
  serializeLensSnapshot,
} from './LensAggregator';

export { CurrentAnalysisLens } from './CurrentAnalysisLens';
export { TimeSessionLens } from './TimeSessionLens';
export { DowTheoryLens } from './DowTheoryLens';
export { VolatilityRegimeLens } from './VolatilityRegimeLens';
export { PatternLens } from './PatternLens';
export type { OHLCVBar, Pivot } from './utils/pivotDetection';

import { defaultLensAggregator } from './LensAggregator';
import { CurrentAnalysisLens } from './CurrentAnalysisLens';
import { TimeSessionLens } from './TimeSessionLens';
import { DowTheoryLens } from './DowTheoryLens';
import { VolatilityRegimeLens } from './VolatilityRegimeLens';
import { PatternLens } from './PatternLens';

/**
 * defaultLensAggregator に基本レンズを登録する
 *
 * 冪等に呼び出せる（既に登録済みなら何もしない）。
 * テスト環境でも副作用を最小化するため、インポート時自動登録はしない。
 *
 * Phase 1: current_analysis / time_session
 * Phase 3: dow_theory / volatility_regime
 * PR ②-1: pattern (12 種ローソク足パターン真偽)
 */
export function registerDefaultLenses(): void {
  const registered = new Set(defaultLensAggregator.getRegisteredLenses());
  if (!registered.has('current_analysis')) {
    defaultLensAggregator.register(new CurrentAnalysisLens());
  }
  if (!registered.has('time_session')) {
    defaultLensAggregator.register(new TimeSessionLens());
  }
  if (!registered.has('dow_theory')) {
    defaultLensAggregator.register(new DowTheoryLens());
  }
  if (!registered.has('volatility_regime')) {
    defaultLensAggregator.register(new VolatilityRegimeLens());
  }
  if (!registered.has('pattern')) {
    defaultLensAggregator.register(new PatternLens());
  }
}
