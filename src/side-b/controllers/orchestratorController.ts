/**
 * Orchestrator (RunLedger / StrategyDraft) controller
 *
 * Express の req/res に依存しすぎず、Service 呼び出し + 入力検証 + status code 決定を
 * 行う。Router 側 (`routes/orchestratorRoutes.ts`) から薄く呼ばれる。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §13 (Phase 8)
 */

import { z } from 'zod';
import type { Request, Response } from 'express';
import type { RunLedgerService } from '../services/runLedgerService';
import {
  type StrategyDraftService,
  StrategyDraftStateError,
} from '../services/strategyDraftService';

// ============================================================
// 入力 Zod schema
// ============================================================
// 注意 (PR #227 Copilot review #5): Side-B の他ルートは `src/schemas/api/sideB.ts` の
// schema を `validateQuery/validateParams/validateBody` ミドルウェア経由で適用している。
// 本 controller は Phase 8 初期実装の都合で schema をここに集約しているが、後続 PR で
// `src/schemas/api/sideB.ts` 側へ移し routes 側で validate ミドルウェアを使う形に
// 揃えることを検討する (本 WBS スコープ外)。

export const RunIdParamSchema = z.object({ id: z.string().uuid() });
export const DraftIdParamSchema = z.object({ id: z.string().uuid() });

export const RunStatusSchema = z.enum([
  'pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled',
]);

export const RunListQuerySchema = z.object({
  status: RunStatusSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const DraftStatusSchema = z.enum([
  'draft', 'approved', 'rejected', 'queued_for_validation', 'validated', 'archived',
]);

export const DraftListQuerySchema = z.object({
  status: DraftStatusSchema.default('draft'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ApproveBodySchema = z.object({
  reviewer: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(2048).optional(),
});

export const RejectBodySchema = z.object({
  reviewer: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(2048),
});

export const ArchiveBodySchema = z.object({
  reason: z.string().trim().min(1).max(2048),
});

// ============================================================
// Controller factory
// ============================================================

export interface OrchestratorControllerDeps {
  readonly ledger: RunLedgerService;
  readonly draftService: StrategyDraftService;
}

export function createOrchestratorController(deps: OrchestratorControllerDeps) {
  const { ledger, draftService } = deps;

  return {
    /**
     * GET /runs?status=...&limit=... - AgentRun 一覧 (Phase 9 で追加)。
     * status は必須、limit は 1〜200 (default 50)。
     */
    async listRuns(req: Request, res: Response): Promise<void> {
      try {
        const query = RunListQuerySchema.parse(req.query);
        const runs = await ledger.listRunsByStatus(query.status, query.limit);
        res.json({ status: query.status, count: runs.length, runs });
      } catch (err) {
        sendError(res, err);
      }
    },

    /**
     * GET /runs/:id - AgentRun 詳細 + steps を返す。404 if not found。
     */
    async getRunWithSteps(req: Request, res: Response): Promise<void> {
      try {
        const { id } = RunIdParamSchema.parse(req.params);
        const detail = await ledger.findRunWithSteps(id);
        if (!detail) {
          res.status(404).json({ error: 'AgentRun not found' });
          return;
        }
        res.json(detail);
      } catch (err) {
        sendError(res, err);
      }
    },

    /**
     * GET /drafts?status=draft&limit=50 - StrategyDraft 一覧。
     */
    async listDrafts(req: Request, res: Response): Promise<void> {
      try {
        const query = DraftListQuerySchema.parse(req.query);
        const drafts = await draftService.listByStatus(query.status, query.limit);
        res.json({ status: query.status, count: drafts.length, drafts });
      } catch (err) {
        sendError(res, err);
      }
    },

    /**
     * GET /drafts/:id - StrategyDraft 詳細を返す。404 if not found。
     */
    async getDraft(req: Request, res: Response): Promise<void> {
      try {
        const { id } = DraftIdParamSchema.parse(req.params);
        const draft = await draftService.findById(id);
        if (!draft) {
          res.status(404).json({ error: 'StrategyDraft not found' });
          return;
        }
        res.json(draft);
      } catch (err) {
        sendError(res, err);
      }
    },

    /**
     * POST /drafts/:id/approve - reviewer 必須、reason は任意。
     */
    async approveDraft(req: Request, res: Response): Promise<void> {
      try {
        const { id } = DraftIdParamSchema.parse(req.params);
        const body = ApproveBodySchema.parse(req.body);
        const draft = await draftService.approveDraft(id, body.reviewer, body.reason);
        res.json(draft);
      } catch (err) {
        sendError(res, err);
      }
    },

    /**
     * POST /drafts/:id/reject - reviewer + reason 必須。
     */
    async rejectDraft(req: Request, res: Response): Promise<void> {
      try {
        const { id } = DraftIdParamSchema.parse(req.params);
        const body = RejectBodySchema.parse(req.body);
        const draft = await draftService.rejectDraft(id, body.reviewer, body.reason);
        res.json(draft);
      } catch (err) {
        sendError(res, err);
      }
    },

    /**
     * POST /drafts/:id/queue - approved → queued_for_validation。
     */
    async queueDraft(req: Request, res: Response): Promise<void> {
      try {
        const { id } = DraftIdParamSchema.parse(req.params);
        const draft = await draftService.queueForValidation(id);
        res.json(draft);
      } catch (err) {
        sendError(res, err);
      }
    },

    /**
     * POST /drafts/:id/archive - reason 必須。
     */
    async archiveDraft(req: Request, res: Response): Promise<void> {
      try {
        const { id } = DraftIdParamSchema.parse(req.params);
        const body = ArchiveBodySchema.parse(req.body);
        const draft = await draftService.archiveDraft(id, body.reason);
        res.json(draft);
      } catch (err) {
        sendError(res, err);
      }
    },
  };
}

export type OrchestratorController = ReturnType<typeof createOrchestratorController>;

/**
 * エラー応答の統一: ZodError → 400、StrategyDraftStateError → 422、その他 → 500。
 * `err` は catch 由来 (TypeScript 標準で unknown 推論) を受け、instanceof で narrow する。
 */
// eslint-disable-next-line no-restricted-syntax -- catch 由来の値は TS 仕様で unknown、本関数内で narrow するため許容
function sendError(res: Response, err: unknown): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'ValidationError', issues: err.issues });
    return;
  }
  if (err instanceof StrategyDraftStateError) {
    res.status(422).json({ error: 'StrategyDraftStateError', message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ error: 'InternalError', message });
}
