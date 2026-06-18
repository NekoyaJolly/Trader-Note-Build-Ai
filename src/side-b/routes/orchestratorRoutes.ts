/**
 * Orchestrator (RunLedger / StrategyDraft) ルーティング
 *
 * WBS §13 Phase 8 で追加された Run / Step / Draft 確認 + 操作 API。
 *
 * エンドポイント:
 * - GET    /runs/:id           - AgentRun 詳細 + steps
 * - GET    /drafts             - StrategyDraft 一覧 (status / limit フィルタ)
 * - GET    /drafts/:id         - StrategyDraft 詳細
 * - GET    /runs              - AgentRun 一覧 (status 必須、limit 1〜200)
 * - POST   /drafts/:id/approve - Draft 承認 (reviewer 必須、reason 任意)
 * - POST   /drafts/:id/reject  - Draft 却下 (reviewer + reason 必須)
 * - POST   /drafts/:id/queue   - approved → queued_for_validation
 * - POST   /drafts/:id/archive - Draft archive (reason 必須)
 *
 * `GET /runs` は Phase 9 で `RunLedgerService.listByStatus` を追加した時に実装済み
 * (本 chain merge では Phase 8 PR と Phase 9 PR が両方含まれる)。
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
import { requireRole, requireAuth } from '../../middleware/authMiddleware';
import { getAiHealthSnapshot } from '../agent/aiHealth';
import { getOrchestrationFlow } from '../observability/orchestrationFlowService';

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
  const requireAdmin = requireRole(['admin']);

  router.get('/runs', (req, res) => { void controller.listRuns(req, res); });
  router.get('/runs/:id', (req, res) => { void controller.getRunWithSteps(req, res); });
  router.get('/drafts', (req, res) => { void controller.listDrafts(req, res); });
  router.get('/drafts/:id', (req, res) => { void controller.getDraft(req, res); });
  router.post('/drafts/:id/approve', requireAdmin, (req, res) => { void controller.approveDraft(req, res); });
  router.post('/drafts/:id/reject', requireAdmin, (req, res) => { void controller.rejectDraft(req, res); });
  router.post('/drafts/:id/queue', requireAdmin, (req, res) => { void controller.queueDraft(req, res); });
  router.post('/drafts/:id/archive', requireAdmin, (req, res) => { void controller.archiveDraft(req, res); });

  // AI 層の health signal。Side-B の AI 呼び出しが実際に成功しているかを 1 エンドポイントで確認できる。
  // status='down'/'degraded' や lastSuccessAt が古い = 「動いてる風で実は死んでいる」を即検知するため。
  // モデル名/失敗 reason/本文 snippet 等の内部情報を返すため admin 限定で保護する (Copilot review PR #430)。
  // ログイン必須 (admin 不要)。内部状態を返すため完全公開はしないが、運用者が普段のログインで
  // 見られるようにする (sole-user 運用、Nekoさん 要望 2026-06-18)。
  router.get('/ai-health', requireAuth, (_req, res) => {
    const snapshot = getAiHealthSnapshot();
    const httpStatus = snapshot.status === 'down' ? 503 : 200;
    res.status(httpStatus).json({ success: snapshot.status !== 'down', data: snapshot });
  });

  // オーケストレーション可視化用の flow スナップショット (エージェント=ノード / ハンドオフ=エッジ)。
  // 各段の生死をドメインテーブルから導出する。admin 限定 (内部状態の露出を防ぐ)。
  router.get('/flow', requireAuth, (_req, res) => {
    void (async () => {
      try {
        const snapshot = await getOrchestrationFlow();
        res.json({ success: true, data: snapshot });
      } catch (error) {
        console.error('[OrchestratorRoutes] flow 取得エラー:', error);
        res.status(500).json({ success: false, error: 'flow スナップショットの取得に失敗しました' });
      }
    })();
  });

  return router;
}
