/**
 * end-to-end integration test (Phase 9)
 *
 * SideBSchedulerOrchestratorBridge → ADK Orchestrator Wrapper → JobPort →
 * RunLedgerService → StrategyDraftService → Controller (API) の全層を 1 シナリオで
 * 通し、台帳 / Draft / API 応答が期待通りに繋がることを検証する。
 *
 * 実 DB は使わず、in-memory な repository で動かす。
 *
 * WBS §14 (Phase 9) DoD:
 *   - Golden Path 統合 PASS
 *   - 失敗系 (Readiness stop / Evolution 0 候補 / Draft 未承認)
 *   - 冪等性 (二重起動抑止)
 *   - rollback (feature flag OFF で旧経路に戻る)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §14 (Phase 9)
 */
/* eslint-disable @typescript-eslint/require-await -- in-memory mocks の async は Promise<T> シグネチャ用 */
import { randomUUID } from 'node:crypto';
import type { AgentRun, AgentRunStep, StrategyDraft } from '@prisma/client';
import {
  runScheduledOrchestratedCycle,
  ADK_ORCHESTRATOR_ENV_VAR,
} from '../../jobs/sideBSchedulerOrchestratorBridge';
import {
  createRunLedgerService,
  type RunLedgerService,
} from '../../services/runLedgerService';
import {
  createStrategyDraftService,
} from '../../services/strategyDraftService';
import { createOrchestratorController } from '../../controllers/orchestratorController';
import type { JobPort, JobResultEnvelope } from '../../jobs/jobPort';
import type { RunLedgerRepository } from '../../repositories/runLedgerRepository';
import type { StrategyDraftRepository } from '../../repositories/strategyDraftRepository';
import type { Request, Response } from 'express';

// ============================================================
// in-memory repositories
// ============================================================

function makeLedgerRepo(): RunLedgerRepository {
  const runs = new Map<string, AgentRun>();
  const steps = new Map<string, AgentRunStep>();
  return {
    async createRun(input) {
      const id = randomUUID();
      if (input.idempotencyKey) {
        for (const r of runs.values()) {
          if (r.idempotencyKey === input.idempotencyKey) {
            throw new Error('Unique constraint violation on idempotencyKey');
          }
        }
      }
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
    async findRunByIdempotencyKey(key) {
      for (const r of runs.values()) if (r.idempotencyKey === key) return r;
      return null;
    },
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
      for (const s of steps.values()) {
        if (s.runId === input.runId && s.stepName === input.stepName && s.attempt === input.attempt) {
          throw new Error('Unique constraint violation');
        }
      }
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
    async listRunsByStatus(status, limit = 50) {
      return [...runs.values()]
        .filter((r) => r.status === status)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, limit);
    },
  };
}

function makeDraftRepo(): StrategyDraftRepository {
  const drafts = new Map<string, StrategyDraft>();
  return {
    async createDraft(input) {
      const id = randomUUID();
      for (const d of drafts.values()) {
        if (d.candidateHash === input.candidateHash) {
          throw new Error('Unique constraint violation on candidateHash');
        }
      }
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

function mockJob(
  stepName: string,
  result: Omit<JobResultEnvelope, 'stepName'>,
  ledger: RunLedgerService,
): JobPort {
  return {
    stepName,
    async execute(ctx) {
      await ledger.startStep(ctx.runId, { stepName, traceKind: 'job' });
      const env: JobResultEnvelope = { ...result, stepName };
      if (env.status === 'succeeded') {
        await ledger.succeedStep(ctx.runId, stepName, { summary: env.summary, nextAction: env.nextAction });
      } else if (env.status === 'failed') {
        await ledger.failStep(ctx.runId, stepName, {
          errorCode: env.errorCode ?? null,
          errorMessage: env.errorMessage ?? null,
          summary: env.summary,
          nextAction: env.nextAction,
        });
      } else if (env.status === 'skipped') {
        await ledger.skipStep(ctx.runId, stepName, {
          reason: env.summary ?? 'skip',
          nextAction: env.nextAction,
        });
      }
      return env;
    },
  };
}

function mockRes() {
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));
  const res = { json: jsonMock, status: statusMock } as unknown as Response;
  return { res, jsonMock, statusMock };
}

// ============================================================
// Phase 9 end-to-end tests
// ============================================================

describe('Phase 9 end-to-end integration', () => {
  function setupServices() {
    const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
    return { ledger, draftService };
  }

  it('Golden Path: Bridge OFF → 旧経路継続 (kind=disabled)', async () => {
    const { ledger, draftService } = setupServices();
    const result = await runScheduledOrchestratedCycle({
      ledger, draftService, env: {},
    });
    expect(result.kind).toBe('disabled');
  });

  it('Golden Path: Bridge ON → 全 step 成功 + Draft 作成 + Controller で確認可能', async () => {
    const { ledger, draftService } = setupServices();
    const jobs = {
      readiness: mockJob('readiness', { ok: true, status: 'succeeded' as const, summary: 'ready', nextAction: 'proceed' as const }, ledger),
      plan: mockJob('plan', { ok: true, status: 'succeeded' as const, summary: 'planned', nextAction: 'proceed' as const }, ledger),
      monitor: mockJob('monitor', { ok: true, status: 'succeeded' as const, summary: 'monitored', nextAction: 'proceed' as const }, ledger),
      evolution: mockJob('evolution', { ok: true, status: 'succeeded' as const, summary: 'evolved', nextAction: 'proceed' as const }, ledger),
    };

    const result = await runScheduledOrchestratedCycle({
      ledger, draftService, jobs,
      env: { [ADK_ORCHESTRATOR_ENV_VAR]: 'true' },
      orchestratorOptions: {
        extractCandidates: async () => [
          { candidateHash: 'sha256:e2e-1', strategySummary: 'EMA crossover' },
          { candidateHash: 'sha256:e2e-2', strategySummary: 'RSI mean reversion' },
        ],
      },
    });

    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.result.finalStatus).toBe('succeeded');
      expect(result.result.drafts).toHaveLength(2);

      // Controller 経由で確認 (API レイヤーとの繋がりを検証)
      const ctrl = createOrchestratorController({ ledger, draftService });

      // GET /runs?status=succeeded → 1 件
      const { res: listRes, jsonMock: listJson } = mockRes();
      await ctrl.listRuns({ query: { status: 'succeeded' } } as unknown as Request, listRes);
      const listPayload = listJson.mock.calls[0]?.[0] as { count: number; runs: AgentRun[] };
      expect(listPayload.count).toBe(1);
      expect(listPayload.runs[0]?.id).toBe(result.result.run.id);

      // GET /runs/:id → run + steps
      const { res: detailRes, jsonMock: detailJson } = mockRes();
      await ctrl.getRunWithSteps({ params: { id: result.result.run.id } } as unknown as Request, detailRes);
      const detailPayload = detailJson.mock.calls[0]?.[0] as { id: string; steps: AgentRunStep[] };
      expect(detailPayload.id).toBe(result.result.run.id);
      expect(detailPayload.steps.length).toBeGreaterThanOrEqual(4);

      // GET /drafts?status=draft → 2 件
      const { res: draftRes, jsonMock: draftJson } = mockRes();
      await ctrl.listDrafts({ query: { status: 'draft' } } as unknown as Request, draftRes);
      const draftPayload = draftJson.mock.calls[0]?.[0] as { count: number; drafts: StrategyDraft[] };
      expect(draftPayload.count).toBe(2);
    }
  });

  it('失敗系: Readiness stop → 後続 skip + Draft step も skip + finalStatus=failed', async () => {
    const { ledger, draftService } = setupServices();
    const jobs = {
      readiness: mockJob('readiness', {
        ok: false, status: 'failed' as const, summary: null,
        errorCode: 'E_NOT_READY', errorMessage: 'no data', nextAction: 'stop' as const,
      }, ledger),
    };
    const result = await runScheduledOrchestratedCycle({
      ledger, draftService, jobs, forceEnabled: true,
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.result.finalStatus).toBe('failed');
      // Controller 経由で AgentRun 詳細を取り、readiness が failed、他が skipped を確認
      const ctrl = createOrchestratorController({ ledger, draftService });
      const { res, jsonMock } = mockRes();
      await ctrl.getRunWithSteps({ params: { id: result.result.run.id } } as unknown as Request, res);
      const payload = jsonMock.mock.calls[0]?.[0] as { steps: AgentRunStep[] };
      const readiness = payload.steps.find((s) => s.stepName === 'readiness');
      expect(readiness?.status).toBe('failed');
      const planSkipped = payload.steps.find((s) => s.stepName === 'plan');
      expect(planSkipped?.status).toBe('skipped');
    }
  });

  it('Evolution 0 候補: Draft step は succeeded with candidates=0、Draft 0 件', async () => {
    const { ledger, draftService } = setupServices();
    const jobs = {
      readiness: mockJob('readiness', { ok: true, status: 'succeeded' as const, summary: null, nextAction: 'proceed' as const }, ledger),
      plan: mockJob('plan', { ok: true, status: 'succeeded' as const, summary: null, nextAction: 'proceed' as const }, ledger),
      monitor: mockJob('monitor', { ok: true, status: 'succeeded' as const, summary: null, nextAction: 'proceed' as const }, ledger),
      evolution: mockJob('evolution', { ok: true, status: 'succeeded' as const, summary: null, nextAction: 'proceed' as const }, ledger),
    };
    const result = await runScheduledOrchestratedCycle({
      ledger, draftService, jobs, forceEnabled: true,
      orchestratorOptions: { extractCandidates: async () => [] },
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.result.drafts).toHaveLength(0);
      expect(result.result.finalStatus).toBe('succeeded');
    }
  });

  it('Draft 未承認: autoQueueApprovedDrafts=false なら approved Draft があっても queue に流れない', async () => {
    const { ledger, draftService } = setupServices();
    // 事前に Draft 1 つを approved 状態に
    const seedRun = await ledger.startRun({ kind: 'side_b_cycle', triggeredBy: 'manual' });
    await ledger.startStep(seedRun.id, { stepName: 'evolution' });
    await ledger.succeedStep(seedRun.id, 'evolution');
    const detail = await ledger.findRunWithSteps(seedRun.id);
    const seedStep = detail?.steps[0];
    if (!seedStep) throw new Error('seed step');
    const created = await draftService.createFromEvolutionCandidate(
      { candidateHash: 'sha256:unapproved-test', strategySummary: 'S' },
      { sourceRunId: seedRun.id, sourceStepId: seedStep.id },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    await draftService.approveDraft(created.draft.id, 'neko');
    await ledger.finishRun(seedRun.id, { status: 'succeeded' });

    const result = await runScheduledOrchestratedCycle({
      ledger, draftService, jobs: {}, forceEnabled: true,
      orchestratorOptions: { autoQueueApprovedDrafts: false },
    });
    expect(result.kind).toBe('executed');
    const queued = await draftService.listByStatus('queued_for_validation');
    expect(queued).toHaveLength(0);
    const stillApproved = await draftService.listByStatus('approved');
    expect(stillApproved).toHaveLength(1);
  });

  it('冪等性: 同一 idempotencyKey で 2 度呼んでも run は 1 つだけ作成される', async () => {
    const { ledger, draftService } = setupServices();
    const first = await runScheduledOrchestratedCycle({
      ledger, draftService, jobs: {}, forceEnabled: true,
      orchestratorOptions: { idempotencyKey: 'e2e-cycle-1' },
    });
    const second = await runScheduledOrchestratedCycle({
      ledger, draftService, jobs: {}, forceEnabled: true,
      orchestratorOptions: { idempotencyKey: 'e2e-cycle-1' },
    });
    expect(first.kind).toBe('executed');
    expect(second.kind).toBe('executed');
    if (first.kind === 'executed' && second.kind === 'executed') {
      expect(second.result.idempotentReuse).toBe(true);
      expect(second.result.run.id).toBe(first.result.run.id);
      expect(second.result.finalStatus).toBeNull();
    }
  });

  it('rollback: env を削除すれば旧経路に戻る (kind=disabled)', async () => {
    const { ledger, draftService } = setupServices();
    // 有効化して 1 cycle 実行
    const enabled = await runScheduledOrchestratedCycle({
      ledger, draftService, jobs: {},
      env: { [ADK_ORCHESTRATOR_ENV_VAR]: 'true' },
    });
    expect(enabled.kind).toBe('executed');
    // env を削除 → disabled
    const disabled = await runScheduledOrchestratedCycle({
      ledger, draftService, jobs: {},
      env: {},
    });
    expect(disabled.kind).toBe('disabled');
  });
});
