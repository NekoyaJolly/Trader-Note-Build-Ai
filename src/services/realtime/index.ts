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

// Realtime Similarity Service
export {
  RealtimeSimilarityService,
  RealtimeSimilarityConfigSchema,
  RealtimeSimilarityConfig,
  SimilarityCheckResult,
  SimilarityAlertCallback,
  NoteForSimilarity,
} from './realtimeSimilarityService';
