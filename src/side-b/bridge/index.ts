/**
 * ブリッジ層（Phase 4b 縮小版）の再エクスポート
 *
 * Side-B の EdgeHypothesis を Side-A 検証基盤と接続するためのモジュール群。
 */

export {
    MaterializationService,
    materializationService,
    type MaterializeFromVirtualTradeInput,
} from './MaterializationService';

export {
    ScreeningOrchestrator,
    screeningOrchestrator,
    type ScreeningOrchestratorOptions,
    type ScreeningRunResult,
} from './ScreeningOrchestrator';

export {
    MaterializationError,
    type MaterializationPath,
    type MaterializationResult,
    type MaterializeForValidationOptions,
} from './types';
