/**
 * EdgeLedger エクスポート集約（Phase 4a）
 */

export { EdgeLedger, edgeLedger } from './EdgeLedger';
export {
    StatusManager,
    statusManager,
    PROMOTION_THRESHOLDS,
    STALE_DEFAULTS,
    type PromoteCheck,
    type StaleCheck,
} from './statusManager';
export { evaluateCondition, evaluateConditions } from './conditionMatcher';
export type { EdgeLedgerStats, ObservationInput } from './types';
