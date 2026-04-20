/**
 * エッジ昇格の数値閾値（設計書・CLAUDE.md と整合）
 */

import { VALIDATION_THRESHOLDS } from '../config/validationThresholds';

/** 学習期間 PF の下限 */
export const MIN_TRAIN_PROFIT_FACTOR = 1.5;

/** 検証期間 PF の下限 */
export const MIN_VALIDATION_PROFIT_FACTOR = 1.3;

/** ウォークフォワード過学習スコア上限（この値未満なら合格方向） */
export const MAX_OVERFIT_SCORE = VALIDATION_THRESHOLDS.walkForward.maxOverfitScore;
