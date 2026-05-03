/**
 * ブリッジ層 (Critical-4 段階 3b 後の縮小版) の再エクスポート
 *
 * 旧経路型 (`MaterializationError` / `MaterializationResult` / `MaterializationPath` /
 * `MaterializeForValidationOptions`) は段階 3b で完全撤去。本 index は新経路の
 * `MaterializationService.materializeFromVirtualTrade` (VirtualTrade → TradeNote) と
 * `ScreeningOrchestrator` (analysis-engine 経由 BT) のみ公開する。
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
