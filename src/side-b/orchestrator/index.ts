/**
 * Side-B オーケストレーターのエクスポート
 */

export {
  AIOrchestrator,
  aiOrchestrator,
  type OrchestratorResearchRequest,
  type OrchestratorPlanRequest,
  type OrchestratorResult,
  type AITradePlanWithOptionalBacktest,
} from './aiOrchestrator';

// Phase B+ (2026-05-24): Top-Level Orchestrator (= 薄い最上位判断層)
export {
  TopLevelOrchestrator,
  TopLevelOrchestratorOutputSchema,
  type TopLevelAction,
  type TopLevelOrchestratorInput,
  type TopLevelOrchestratorOutput,
  type TopLevelOrchestratorDeps,
  type TopLevelOrchestratorJobInvokers,
  type TopLevelOrchestratorResult,
} from './topLevelOrchestrator';
