/**
 * sideBSchedulerOrchestratorBridge の test
 *
 * feature flag (env / forceEnabled) によって ADK Orchestrator が呼ばれるかを検証する。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §12 (Phase 7)
 */
import {
  isAdkOrchestratorEnabled,
  runScheduledOrchestratedCycle,
  ADK_ORCHESTRATOR_ENV_VAR,
} from '../../jobs/sideBSchedulerOrchestratorBridge';
import { createRunLedgerService } from '../../services/runLedgerService';
import { createStrategyDraftService } from '../../services/strategyDraftService';
import type { RunLedgerRepository } from '../../repositories/runLedgerRepository';
import type { StrategyDraftRepository } from '../../repositories/strategyDraftRepository';
import type { AgentRun, AgentRunStep, StrategyDraft } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/* eslint-disable @typescript-eslint/require-await --
 * test mocks の async は Promise<T> シグネチャを保つため async を付ける。
 */

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
    async listByStatus(status) {
      return [...drafts.values()].filter((d) => d.status === status);
    },
  };
}

// Phase 7 では Bridge は config を受け取らない (yagni)。
// Orchestrator wire-up 時に必要になったら追加する。

describe('isAdkOrchestratorEnabled', () => {
  it('env が true / 1 / yes (大小無視) なら enabled', () => {
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: 'true' })).toBe(true);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: 'TRUE' })).toBe(true);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: '1' })).toBe(true);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: 'yes' })).toBe(true);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: '  TRUE  ' })).toBe(true);
  });

  it('env 未設定 / false / 空文字 / その他値 は disabled', () => {
    expect(isAdkOrchestratorEnabled({})).toBe(false);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: '' })).toBe(false);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: 'false' })).toBe(false);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: '0' })).toBe(false);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: 'no' })).toBe(false);
    expect(isAdkOrchestratorEnabled({ [ADK_ORCHESTRATOR_ENV_VAR]: 'maybe' })).toBe(false);
  });
});

describe('runScheduledOrchestratedCycle', () => {
  it('feature flag OFF: kind=disabled、Orchestrator は呼ばれない', async () => {
    const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
    const result = await runScheduledOrchestratedCycle({
      ledger,
      draftService,
      env: {}, // env なし
    });
    expect(result.kind).toBe('disabled');
  });

  it('forceEnabled=true: env 無視で Orchestrator が実行される', async () => {
    const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
    const result = await runScheduledOrchestratedCycle({
      ledger,
      draftService,
      forceEnabled: true,
      env: {},
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.result.finalStatus).toBe('succeeded');
      // jobs 未指定なので全 step skip
      const stepNames = result.result.stepEnvelopes.map((e) => e.stepName);
      expect(stepNames).toContain('readiness');
      expect(stepNames).toContain('plan');
    }
  });

  it('env が true: Orchestrator が実行される', async () => {
    const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
    const result = await runScheduledOrchestratedCycle({
      ledger,
      draftService,
      env: { [ADK_ORCHESTRATOR_ENV_VAR]: 'true' },
    });
    expect(result.kind).toBe('executed');
  });

  it('idempotencyKey を Orchestrator へ伝播できる', async () => {
    const ledger = createRunLedgerService({ repository: makeLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: makeDraftRepo() });
    const first = await runScheduledOrchestratedCycle({
      ledger, draftService, forceEnabled: true,
      orchestratorOptions: { idempotencyKey: 'cycle-test-1' },
    });
    const second = await runScheduledOrchestratedCycle({
      ledger, draftService, forceEnabled: true,
      orchestratorOptions: { idempotencyKey: 'cycle-test-1' },
    });
    expect(first.kind).toBe('executed');
    expect(second.kind).toBe('executed');
    if (first.kind === 'executed' && second.kind === 'executed') {
      expect(second.result.idempotentReuse).toBe(true);
      expect(second.result.run.id).toBe(first.result.run.id);
    }
  });
});
