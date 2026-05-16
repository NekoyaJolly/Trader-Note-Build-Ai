/**
 * orchestratorController の test
 *
 * Express の Router を立てずに controller 関数を直接呼ぶ。req / res を手書き mock し、
 * status code と JSON 応答を検証する。Service は in-memory な repository で実体を動かす。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §13 (Phase 8)
 */
/* eslint-disable @typescript-eslint/require-await --
 * in-memory repository / req-res mock の async は Promise<T> シグネチャを保つために必要。
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AgentRun, AgentRunStep, StrategyDraft } from '@prisma/client';
import { createOrchestratorController } from '../../controllers/orchestratorController';
import { createRunLedgerService } from '../../services/runLedgerService';
import { createStrategyDraftService } from '../../services/strategyDraftService';
import type { RunLedgerRepository } from '../../repositories/runLedgerRepository';
import type { StrategyDraftRepository } from '../../repositories/strategyDraftRepository';

// ============================================================
// in-memory repositories
// ============================================================

function makeLedgerRepo(): RunLedgerRepository {
  const runs = new Map<string, AgentRun>();
  const steps = new Map<string, AgentRunStep>();
  return {
    async createRun(input) {
      const id = randomUUID();
      const run: AgentRun = {
        id, kind: input.kind, triggeredBy: input.triggeredBy,
        status: input.status ?? 'running', startedAt: new Date(), finishedAt: null,
        summary: input.summary ?? null, errorCode: null, errorMessage: null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      runs.set(id, run);
      return run;
    },
    async findRunByIdempotencyKey() { return null; },
    async findRunById(id) { return runs.get(id) ?? null; },
    async updateRun(id, patch) {
      const e = runs.get(id);
      if (!e) throw new Error('not found');
      const u = { ...e, ...patch, updatedAt: new Date() };
      runs.set(id, u);
      return u;
    },
    async createStep(input) {
      const id = randomUUID();
      const step: AgentRunStep = {
        id, runId: input.runId, stepName: input.stepName,
        status: input.status ?? 'running', attempt: input.attempt,
        startedAt: new Date(), finishedAt: null, durationMs: null,
        summary: null, errorCode: null, errorMessage: null, nextAction: null,
        traceKind: input.traceKind ?? null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      steps.set(id, step);
      return step;
    },
    async findLatestStep(runId, stepName) {
      const m = [...steps.values()].filter((s) => s.runId === runId && s.stepName === stepName);
      m.sort((a, b) => b.attempt - a.attempt);
      return m[0] ?? null;
    },
    async updateStep(id, patch) {
      const e = steps.get(id);
      if (!e) throw new Error('not found');
      const u = { ...e, ...patch, updatedAt: new Date() };
      steps.set(id, u);
      return u;
    },
    async findRunWithSteps(runId) {
      const run = runs.get(runId);
      if (!run) return null;
      const list = [...steps.values()].filter((s) => s.runId === runId);
      return { ...run, steps: list };
    },
  };
}

function makeDraftRepo(): StrategyDraftRepository {
  const drafts = new Map<string, StrategyDraft>();
  return {
    async createDraft(input) {
      const id = randomUUID();
      const draft: StrategyDraft = {
        id, sourceRunId: input.sourceRunId, sourceStepId: input.sourceStepId,
        candidateHash: input.candidateHash, status: 'draft',
        strategySummary: input.strategySummary, riskSummary: input.riskSummary ?? null,
        approvalReason: null, rejectionReason: null, archiveReason: null,
        reviewer: null, validatedAt: null, validationResultId: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      drafts.set(id, draft);
      return draft;
    },
    async findByCandidateHash(hash) {
      for (const d of drafts.values()) if (d.candidateHash === hash) return d;
      return null;
    },
    async findById(id) { return drafts.get(id) ?? null; },
    async updateDraft(id, patch) {
      const e = drafts.get(id);
      if (!e) throw new Error('not found');
      const u = { ...e, ...patch, updatedAt: new Date() };
      drafts.set(id, u);
      return u;
    },
    async updateDraftIfStatus(id, expected, patch) {
      const e = drafts.get(id);
      if (!e || e.status !== expected) return null;
      const u = { ...e, ...patch, updatedAt: new Date() };
      drafts.set(id, u);
      return u;
    },
    async listByStatus(status, limit = 50) {
      return [...drafts.values()]
        .filter((d) => d.status === status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
  };
}

// ============================================================
// req / res mocks
// ============================================================

function mockRes(): { res: Response; jsonMock: jest.Mock; statusMock: jest.Mock } {
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));
  const res = { json: jsonMock, status: statusMock } as unknown as Response;
  return { res, jsonMock, statusMock };
}

function mockReq(opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown }): Request {
  return {
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body ?? {},
  } as unknown as Request;
}

const VALID_UUID = '00000000-0000-4000-8000-000000001111';

// ============================================================
// tests
// ============================================================

describe('orchestratorController', () => {
  describe('getRunWithSteps', () => {
    it('runId が UUID 形式でない → 400 ValidationError', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, statusMock } = mockRes();
      await ctrl.getRunWithSteps(mockReq({ params: { id: 'not-uuid' } }), res);
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('存在しない runId → 404', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, statusMock } = mockRes();
      await ctrl.getRunWithSteps(mockReq({ params: { id: VALID_UUID } }), res);
      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('存在する runId → 200 + run + steps', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const run = await ledger.startRun({ kind: 'side_b_cycle', triggeredBy: 'manual' });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, jsonMock } = mockRes();
      await ctrl.getRunWithSteps(mockReq({ params: { id: run.id } }), res);
      expect(jsonMock).toHaveBeenCalled();
      const payload = jsonMock.mock.calls[0]?.[0] as { id: string; steps: unknown[] };
      expect(payload.id).toBe(run.id);
      expect(Array.isArray(payload.steps)).toBe(true);
    });
  });

  describe('listDrafts', () => {
    it('status 未指定 → default "draft" で一覧を返す', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, jsonMock } = mockRes();
      await ctrl.listDrafts(mockReq({}), res);
      const payload = jsonMock.mock.calls[0]?.[0] as { status: string; count: number; drafts: unknown[] };
      expect(payload.status).toBe('draft');
      expect(payload.count).toBe(0);
    });

    it('limit が範囲外 (201) → 400', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, statusMock } = mockRes();
      await ctrl.listDrafts(mockReq({ query: { limit: '201' } }), res);
      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe('approveDraft', () => {
    it('reviewer 空文字 → 400 ValidationError', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, statusMock } = mockRes();
      await ctrl.approveDraft(
        mockReq({ params: { id: VALID_UUID }, body: { reviewer: '' } }),
        res,
      );
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('存在しない Draft で approveDraft → 422 StrategyDraftStateError', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, statusMock } = mockRes();
      await ctrl.approveDraft(
        mockReq({ params: { id: VALID_UUID }, body: { reviewer: 'neko' } }),
        res,
      );
      expect(statusMock).toHaveBeenCalledWith(422);
    });

    it('正常系: draft → approved', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const run = await ledger.startRun({ kind: 'side_b_cycle', triggeredBy: 'manual' });
      await ledger.startStep(run.id, { stepName: 'evolution' });
      await ledger.succeedStep(run.id, 'evolution');
      const seedRun = await ledger.findRunWithSteps(run.id);
      const seedStep = seedRun?.steps[0];
      if (!seedStep) throw new Error('seed step');
      const created = await draftService.createFromEvolutionCandidate(
        { candidateHash: 'sha256:approve-test', strategySummary: 'EMA' },
        { sourceRunId: run.id, sourceStepId: seedStep.id },
      );
      if (created.kind !== 'created') throw new Error('expected created');

      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, jsonMock } = mockRes();
      await ctrl.approveDraft(
        mockReq({ params: { id: created.draft.id }, body: { reviewer: 'neko', reason: 'PF > 1.5' } }),
        res,
      );
      const payload = jsonMock.mock.calls[0]?.[0] as { status: string; reviewer: string };
      expect(payload.status).toBe('approved');
      expect(payload.reviewer).toBe('neko');
    });
  });

  describe('rejectDraft / archiveDraft の reason 必須', () => {
    it('rejectDraft: reason 空文字 → 400', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, statusMock } = mockRes();
      await ctrl.rejectDraft(
        mockReq({ params: { id: VALID_UUID }, body: { reviewer: 'neko', reason: '' } }),
        res,
      );
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('archiveDraft: reason 空文字 → 400', async () => {
      const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
      const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, statusMock } = mockRes();
      await ctrl.archiveDraft(
        mockReq({ params: { id: VALID_UUID }, body: { reason: '' } }),
        res,
      );
      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });
});
