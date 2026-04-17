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

import { defaultLensAggregator } from './LensAggregator';
import { CurrentAnalysisLens } from './CurrentAnalysisLens';
import { TimeSessionLens } from './TimeSessionLens';

/**
 * defaultLensAggregator に Phase 1 の基本レンズを登録する
 *
 * 冪等に呼び出せる（既に登録済みなら何もしない）。
 * テスト環境でも副作用を最小化するため、インポート時自動登録はしない。
 * PDCA ループへの配線は Phase 3 で行うため、呼び出し自体も当面は任意。
 */
export function registerDefaultLenses(): void {
  const registered = new Set(defaultLensAggregator.getRegisteredLenses());
  if (!registered.has('current_analysis')) {
    defaultLensAggregator.register(new CurrentAnalysisLens());
  }
  if (!registered.has('time_session')) {
    defaultLensAggregator.register(new TimeSessionLens());
  }
}
