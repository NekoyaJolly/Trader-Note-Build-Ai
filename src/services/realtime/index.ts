/**
 * リアルタイムサービス - インデックス
 * 
 * Side-A リアルタイム類似度監視のサービス群
 */

// Rolling Window Service
export {
  RollingWindowService,
  RollingWindowConfigSchema,
  RollingWindowConfig,
  BarCompleteCallback,
} from './rollingWindowService';

// Realtime Similarity Service (Phase δ-1: レンズエンジン統一)
export {
  RealtimeSimilarityService,
  RealtimeSimilarityConfigSchema,
  RealtimeSimilarityConfig,
  RealtimeEvaluationResult,
  RealtimeEvaluationCallback,
  RunMatchingPipelineFn,
} from './realtimeSimilarityService';
