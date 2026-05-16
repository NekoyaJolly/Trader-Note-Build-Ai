/**
 * Orchestrator (RunLedger / StrategyDraft) ルーティング
 *
 * WBS §13 Phase 8 で追加された Run / Step / Draft 確認 + 操作 API。
 *
 * エンドポイント:
 * - GET    /runs/:id           - AgentRun 詳細 + steps
 * - GET    /drafts             - StrategyDraft 一覧 (status / limit フィルタ)
 * - GET    /drafts/:id         - StrategyDraft 詳細
 * - POST   /drafts/:id/approve - Draft 承認 (reviewer 必須、reason 任意)
 * - POST   /drafts/:id/reject  - Draft 却下 (reviewer + reason 必須)
 * - POST   /drafts/:id/queue   - approved → queued_for_validation
 * - POST   /drafts/:id/archive - Draft archive (reason 必須)
 *
 * Run 一覧 API (GET /runs) は RunLedgerService.listByStatus の追加が必要なため、
 * Phase 9 統合テスト時の Service 拡張と一緒に追加する (本 PR では未提供)。
 *
 * 設計方針:
 * - Service (RunLedgerService / StrategyDraftService) のみを呼ぶ
 * - 入力は Zod schema で validate (controller 側に集約)
 * - 認証 / 認可は本 PR のスコープ外 (Phase 8 §8.6 の権限チェックは別 PR)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §13 (Phase 8)
 */

import { Router } from 'express';
import {
  createRunLedgerService,
  type RunLedgerService,
} from '../services/runLedgerService';
import {
  createStrategyDraftService,
  type StrategyDraftService,
} from '../services/strategyDraftService';
import {
  createOrchestratorController,
} from '../controllers/orchestratorController';

export interface OrchestratorRouterOptions {
  /** RunLedgerService (省略時は default Prisma に接続) */
  readonly ledger?: RunLedgerService;
  /** StrategyDraftService (省略時は default Prisma に接続) */
  readonly draftService?: StrategyDraftService;
}

/**
 * Express Router を返す factory。test 用に Service を差し替え可能。
 *
 * @example
 *   import { createOrchestratorRouter } from './routes/orchestratorRoutes';
 *   app.use('/api/side-b/orchestrator', createOrchestratorRouter());
 */
export function createOrchestratorRouter(
  options?: OrchestratorRouterOptions,
): Router {
  const ledger = options?.ledger ?? createRunLedgerService();
  const draftService = options?.draftService ?? createStrategyDraftService();
  const controller = createOrchestratorController({ ledger, draftService });
  const router = Router();

  router.get('/runs', (req, res) => { void controller.listRuns(req, res); });
  router.get('/runs/:id', (req, res) => { void controller.getRunWithSteps(req, res); });
  router.get('/drafts', (req, res) => { void controller.listDrafts(req, res); });
  router.get('/drafts/:id', (req, res) => { void controller.getDraft(req, res); });
  router.post('/drafts/:id/approve', (req, res) => { void controller.approveDraft(req, res); });
  router.post('/drafts/:id/reject', (req, res) => { void controller.rejectDraft(req, res); });
  router.post('/drafts/:id/queue', (req, res) => { void controller.queueDraft(req, res); });
  router.post('/drafts/:id/archive', (req, res) => { void controller.archiveDraft(req, res); });

  return router;
}
