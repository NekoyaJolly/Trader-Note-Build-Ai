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
