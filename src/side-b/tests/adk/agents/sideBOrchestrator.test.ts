/**
 * runSideBOrchestratedCycle の test
 *
 * Golden Path の順序実行、stop / skip 分岐、Draft 抽出、Validation queue、
 * idempotencyKey 再利用を検証する。in-memory な ledger / draftService / mock JobPort を使う。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §11 (Phase 6)
 */
/* eslint-disable @typescript-eslint/require-await --
 * test 用 mock の async 関数は await を持たない。Promise<T> シグネチャを保つため async が必要。
 */
import { randomUUID } from 'node:crypto';
import {
  runSideBOrchestratedCycle,
  type SideBOrchestratorJobs,
  type ExtractEvolutionCandidatesFn,
} from '../../../adk/agents/sideBOrchestrator';
import {
  createRunLedgerService,
  type RunLedgerService,
} from '../../../services/runLedgerService';
import { createStrategyDraftService } from '../../../services/strategyDraftService';
import type { RunLedgerRepository } from '../../../repositories/runLedgerRepository';
import type { StrategyDraftRepository } from '../../../repositories/strategyDraftRepository';
import type {
  AgentRun,
  AgentRunStep,
  StrategyDraft,
} from '@prisma/client';
import type { JobPort, JobResultEnvelope } from '../../../jobs/jobPort';

// ============================================================
// in-memory repositories (test only)
// ============================================================

function createInMemoryLedgerRepo(now: () => Date = () => new Date()): RunLedgerRepository {
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
        id,
        kind: input.kind,
        triggeredBy: input.triggeredBy,
        status: input.status ?? 'pending',
        startedAt: now(),
        finishedAt: null,
        summary: input.summary ?? null,
        errorCode: null,
        errorMessage: null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      runs.set(id, run);
      return run;
    },
    async findRunByIdempotencyKey(key) {
      for (const r of runs.values()) if (r.idempotencyKey === key) return r;
      return null;
    },
    async findRunById(id) {
      return runs.get(id) ?? null;
    },
    async updateRun(id, patch) {
      const existing = runs.get(id);
      if (!existing) throw new Error(`run ${id} not found`);
      const updated = { ...existing, ...patch, updatedAt: now() };
      runs.set(id, updated);
      return updated;
    },
    async createStep(input) {
      const id = randomUUID();
      for (const s of steps.values()) {
        if (s.runId === input.runId && s.stepName === input.stepName && s.attempt === input.attempt) {
          throw new Error('Unique constraint violation');
        }
      }
      const step: AgentRunStep = {
        id,
        runId: input.runId,
        stepName: input.stepName,
        status: input.status ?? 'pending',
        attempt: input.attempt,
        startedAt: now(),
        finishedAt: null,
        durationMs: null,
        summary: null,
        errorCode: null,
        errorMessage: null,
        nextAction: null,
        traceKind: input.traceKind ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      steps.set(id, step);
      return step;
    },
    async findLatestStep(runId, stepName) {
      const matches = [...steps.values()].filter((s) => s.runId === runId && s.stepName === stepName);
      if (matches.length === 0) return null;
      matches.sort((a, b) => b.attempt - a.attempt);
      return matches[0] ?? null;
    },
    async updateStep(id, patch) {
      const existing = steps.get(id);
      if (!existing) throw new Error(`step ${id} not found`);
      const updated = { ...existing, ...patch, updatedAt: now() };
      steps.set(id, updated);
      return updated;
    },
    async findRunWithSteps(runId) {
      const run = runs.get(runId);
      if (!run) return null;
      const stepList = [...steps.values()]
        .filter((s) => s.runId === runId)
        .sort((a, b) => {
          const t = a.startedAt.getTime() - b.startedAt.getTime();
          return t !== 0 ? t : a.attempt - b.attempt;
        });
      return { ...run, steps: stepList };
    },
    async listRunsByStatus(status, limit = 50) {
      return [...runs.values()]
        .filter((r) => r.status === status)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, limit);
    },
  };
}

function createInMemoryDraftRepo(now: () => Date = () => new Date()): StrategyDraftRepository {
  const drafts = new Map<string, StrategyDraft>();
  let counter = 0;
  return {
    async createDraft(input) {
      counter += 1;
      const id = `draft-${counter}`;
      for (const d of drafts.values()) {
        if (d.candidateHash === input.candidateHash) {
          throw new Error('Unique constraint violation on candidateHash');
        }
      }
      const draft: StrategyDraft = {
        id,
        sourceRunId: input.sourceRunId,
        sourceStepId: input.sourceStepId,
        candidateHash: input.candidateHash,
        status: 'draft',
        strategySummary: input.strategySummary,
        riskSummary: input.riskSummary ?? null,
        approvalReason: null,
        rejectionReason: null,
        archiveReason: null,
        reviewer: null,
        validatedAt: null,
        validationResultId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      drafts.set(id, draft);
      return draft;
    },
    async findByCandidateHash(hash) {
      for (const d of drafts.values()) if (d.candidateHash === hash) return d;
      return null;
    },
    async findById(id) {
      return drafts.get(id) ?? null;
    },
    async updateDraft(id, patch) {
      const e = drafts.get(id);
      if (!e) throw new Error(`draft ${id} not found`);
      const updated = { ...e, ...patch, updatedAt: now() };
      drafts.set(id, updated);
      return updated;
    },
    async updateDraftIfStatus(id, expectedStatus, patch) {
      const e = drafts.get(id);
      if (!e || e.status !== expectedStatus) return null;
      const updated = { ...e, ...patch, updatedAt: now() };
      drafts.set(id, updated);
      return updated;
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
// mock JobPort factory
// ============================================================

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

// ============================================================
// tests
// ============================================================

describe('runSideBOrchestratedCycle', () => {
  it('Golden Path: 全 step 成功 + Draft / Validation 含めて succeeded で finishRun', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });

    const jobs: SideBOrchestratorJobs = {
      readiness: mockJob('readiness', { ok: true, status: 'succeeded', summary: 'ready', nextAction: 'proceed' }, ledger),
      plan: mockJob('plan', { ok: true, status: 'succeeded', summary: 'planned', nextAction: 'proceed' }, ledger),
      monitor: mockJob('monitor', { ok: true, status: 'succeeded', summary: 'monitored', nextAction: 'proceed' }, ledger),
      evolution: mockJob('evolution', { ok: true, status: 'succeeded', summary: 'evolved', nextAction: 'proceed' }, ledger),
      validation: mockJob('validation', { ok: true, status: 'succeeded', summary: 'validated', nextAction: 'proceed' }, ledger),
    };

    const extractCandidates: ExtractEvolutionCandidatesFn = async () => [
      { candidateHash: 'sha256:cand-1', strategySummary: 'EMA' },
      { candidateHash: 'sha256:cand-2', strategySummary: 'RSI' },
    ];

    const result = await runSideBOrchestratedCycle({
      ledger,
      draftService,
      jobs,
      extractCandidates,
      autoQueueApprovedDrafts: false,
    });

    expect(result.finalStatus).toBe('succeeded');
    expect(result.idempotentReuse).toBe(false);
    expect(result.drafts).toHaveLength(2);
    expect(result.run.status).toBe('succeeded');
    const stepNames = result.stepEnvelopes.map((e) => e.stepName);
    expect(stepNames).toContain('readiness');
    expect(stepNames).toContain('evolution');
    expect(stepNames).toContain('draft');
  });

  it('readiness が stop を返すと後続 step がすべて skip され、finalStatus=failed', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });

    const planExecuted = jest.fn();
    const jobs: SideBOrchestratorJobs = {
      readiness: mockJob('readiness', { ok: false, status: 'failed', summary: null, errorCode: 'E_NOT_READY', errorMessage: 'no data', nextAction: 'stop' }, ledger),
      plan: {
        stepName: 'plan',
        async execute(ctx) {
          planExecuted();
          await ledger.startStep(ctx.runId, { stepName: 'plan' });
          await ledger.succeedStep(ctx.runId, 'plan');
          return { ok: true, status: 'succeeded', stepName: 'plan', summary: null, nextAction: 'proceed' };
        },
      },
    };

    const result = await runSideBOrchestratedCycle({ ledger, draftService, jobs });
    expect(result.finalStatus).toBe('failed');
    expect(planExecuted).not.toHaveBeenCalled();
    const planEnv = result.stepEnvelopes.find((e) => e.stepName === 'plan');
    expect(planEnv && 'kind' in planEnv && planEnv.kind === 'skipped').toBe(true);
  });

  it('Evolution が 0 候補なら Draft step は succeeded with summary candidates=0', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });

    const jobs: SideBOrchestratorJobs = {
      readiness: mockJob('readiness', { ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }, ledger),
      plan: mockJob('plan', { ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }, ledger),
      monitor: mockJob('monitor', { ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }, ledger),
      evolution: mockJob('evolution', { ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }, ledger),
    };
    const extractCandidates: ExtractEvolutionCandidatesFn = async () => [];

    const result = await runSideBOrchestratedCycle({
      ledger, draftService, jobs, extractCandidates,
    });
    expect(result.drafts).toHaveLength(0);
    const draftEnv = result.stepEnvelopes.find((e) => e.stepName === 'draft');
    expect(draftEnv && 'status' in draftEnv).toBe(true);
    if (draftEnv && 'status' in draftEnv) {
      expect(draftEnv.status).toBe('succeeded');
      expect(draftEnv.summary).toContain('candidates=0');
    }
    expect(result.finalStatus).toBe('succeeded');
  });

  it('extractCandidates が省略されたら Draft step は skip', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });

    const jobs: SideBOrchestratorJobs = {
      evolution: mockJob('evolution', { ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }, ledger),
    };
    const result = await runSideBOrchestratedCycle({ ledger, draftService, jobs });
    const draftEnv = result.stepEnvelopes.find((e) => e.stepName === 'draft');
    expect(draftEnv && 'kind' in draftEnv && draftEnv.kind === 'skipped').toBe(true);
  });

  it('autoQueueApprovedDrafts=false なら queue step は skip', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });

    const result = await runSideBOrchestratedCycle({
      ledger, draftService,
      jobs: {},
      autoQueueApprovedDrafts: false,
    });
    const queueEnv = result.stepEnvelopes.find((e) => e.stepName === 'validation-queue');
    expect(queueEnv && 'kind' in queueEnv && queueEnv.kind === 'skipped').toBe(true);
    if (queueEnv && 'kind' in queueEnv && queueEnv.kind === 'skipped') {
      expect(queueEnv.reason).toContain('disabled');
    }
  });

  it('autoQueueApprovedDrafts=true なら approved Draft を queueForValidation する', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });

    // 既に approved Draft を 2 件用意
    const r = await ledger.startRun({ kind: 'side_b_cycle', triggeredBy: 'manual' });
    await ledger.startStep(r.id, { stepName: 'seed' });
    await ledger.succeedStep(r.id, 'seed');
    const seedRun = await ledger.findRunWithSteps(r.id);
    const seedStep = seedRun?.steps[0];
    if (!seedStep) throw new Error('seed step missing');
    const c1 = await draftService.createFromEvolutionCandidate(
      { candidateHash: 'sha256:approved-1', strategySummary: 'S1' },
      { sourceRunId: r.id, sourceStepId: seedStep.id },
    );
    const c2 = await draftService.createFromEvolutionCandidate(
      { candidateHash: 'sha256:approved-2', strategySummary: 'S2' },
      { sourceRunId: r.id, sourceStepId: seedStep.id },
    );
    if (c1.kind !== 'created' || c2.kind !== 'created') throw new Error('seed drafts missing');
    await draftService.approveDraft(c1.draft.id, 'neko');
    await draftService.approveDraft(c2.draft.id, 'neko');
    await ledger.finishRun(r.id, { status: 'succeeded' });

    const result = await runSideBOrchestratedCycle({
      ledger, draftService,
      jobs: {},
      autoQueueApprovedDrafts: true,
    });
    const queueEnv = result.stepEnvelopes.find((e) => e.stepName === 'validation-queue');
    expect(queueEnv && 'status' in queueEnv).toBe(true);
    if (queueEnv && 'summary' in queueEnv) {
      expect(queueEnv.summary).toContain('queued=2');
    }
    const queued = await draftService.listByStatus('queued_for_validation');
    expect(queued).toHaveLength(2);
  });

  it('idempotencyKey 重複時は既存 run を再利用し idempotentReuse=true で早期 return', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });
    const first = await runSideBOrchestratedCycle({
      ledger, draftService,
      jobs: {},
      idempotencyKey: 'cycle-abc',
    });
    const second = await runSideBOrchestratedCycle({
      ledger, draftService,
      jobs: {},
      idempotencyKey: 'cycle-abc',
    });
    expect(first.idempotentReuse).toBe(false);
    expect(second.idempotentReuse).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(second.stepEnvelopes).toHaveLength(0);
    // Copilot review #4 対応: idempotent reuse 時の finalStatus は null (透過)
    expect(second.finalStatus).toBeNull();
  });

  // ============================================================
  // Copilot review #1 対応: skip された step も RunLedger に記録される
  // ============================================================

  it('Copilot #1: skip された step も startStep + skipStep として RunLedger に記録される', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });

    // すべての job 未配線 → 全 step skip → 全 skip が ledger に記録されるはず
    const result = await runSideBOrchestratedCycle({
      ledger, draftService, jobs: {},
    });
    const detail = await ledger.findRunWithSteps(result.run.id);
    expect(detail).not.toBeNull();
    // readiness / plan / monitor / evolution / draft / validation-queue / validation の 7 step
    const stepNames = detail?.steps.map((s) => s.stepName) ?? [];
    expect(stepNames).toContain('readiness');
    expect(stepNames).toContain('plan');
    expect(stepNames).toContain('validation');
    expect(stepNames).toContain('validation-queue');
    // すべて status=skipped
    const skippedCount = detail?.steps.filter((s) => s.status === 'skipped').length ?? 0;
    expect(skippedCount).toBeGreaterThanOrEqual(7);
  });

  // ============================================================
  // Copilot review #2 対応: shouldStop が skip 理由として優先される
  // ============================================================

  it('Copilot #2: shouldStop が autoQueueApprovedDrafts=false の理由を上書きする', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });
    const jobs: SideBOrchestratorJobs = {
      readiness: mockJob('readiness', { ok: false, status: 'failed', summary: null, errorCode: 'E', errorMessage: 'x', nextAction: 'stop' }, ledger),
    };
    const result = await runSideBOrchestratedCycle({
      ledger, draftService, jobs,
      autoQueueApprovedDrafts: false,
    });
    const queueEnv = result.stepEnvelopes.find((e) => e.stepName === 'validation-queue');
    expect(queueEnv && 'kind' in queueEnv).toBe(true);
    if (queueEnv && 'kind' in queueEnv && queueEnv.kind === 'skipped') {
      expect(queueEnv.reason).toBe('previous step requested stop');
    }
  });

  // ============================================================
  // Copilot review #3 対応: Draft step に batchSize の cap がかかる
  // ============================================================

  it('Copilot #3: draftBatchSize で Draft step の候補数が cap される', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });
    const jobs: SideBOrchestratorJobs = {
      evolution: mockJob('evolution', { ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }, ledger),
    };
    const extractCandidates: ExtractEvolutionCandidatesFn = async () =>
      Array.from({ length: 25 }, (_, i) => ({
        candidateHash: `sha256:cap-${i}`,
        strategySummary: `cand-${i}`,
      }));
    const result = await runSideBOrchestratedCycle({
      ledger, draftService, jobs, extractCandidates,
      draftBatchSize: 5,
    });
    expect(result.drafts).toHaveLength(5);
    const draftEnv = result.stepEnvelopes.find((e) => e.stepName === 'draft');
    if (draftEnv && 'summary' in draftEnv) {
      expect(draftEnv.summary).toContain('candidates=5');
      expect(draftEnv.summary).toContain('truncatedFrom=25');
    }
  });

  // ============================================================
  // Copilot review #6 対応: Draft step の partial failure summary
  // ============================================================

  it('Copilot #6: Draft step が途中で throw した場合 summary に partial 進捗が残る', async () => {
    const ledger = createRunLedgerService({ repository: createInMemoryLedgerRepo() });
    const draftService = createStrategyDraftService({ repository: createInMemoryDraftRepo() });
    const jobs: SideBOrchestratorJobs = {
      evolution: mockJob('evolution', { ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }, ledger),
    };
    // 3 候補返し、2 番目で意図的に throw する extractCandidates ではなく、
    // 候補は正常に返すが draftService がモック throw する場合をシミュレート: 候補 hash を invalid にする
    const extractCandidates: ExtractEvolutionCandidatesFn = async () => [
      { candidateHash: 'sha256:partial-1', strategySummary: 'A' },
      { candidateHash: 'bad', strategySummary: 'B' }, // Zod min(8) で reject
      { candidateHash: 'sha256:partial-3', strategySummary: 'C' },
    ];
    const result = await runSideBOrchestratedCycle({
      ledger, draftService, jobs, extractCandidates,
    });
    const draftEnv = result.stepEnvelopes.find((e) => e.stepName === 'draft');
    if (draftEnv && 'status' in draftEnv) {
      expect(draftEnv.status).toBe('failed');
      expect(draftEnv.summary).toContain('candidates=3');
      expect(draftEnv.summary).toContain('created=1');
      expect(draftEnv.summary).toContain('failedAt=1');
    }
  });
});
