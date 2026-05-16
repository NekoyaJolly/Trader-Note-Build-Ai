/**
 * RunLedgerService の状態遷移 / 冪等性 / retry / redaction を検証する unit test。
 * 実 DB は使わず、in-memory な RunLedgerRepository 互換オブジェクトを使う。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §7 (Phase 2)
 */
/* eslint-disable @typescript-eslint/require-await --
 * in-memory な RunLedgerRepository 互換オブジェクトは Promise<T> シグネチャを
 * 揃えるためだけに async を付けている (本物の Repository は Prisma で await が必要)。
 * test 中の async は意図通り。
 */
import type {
  AgentRun,
  AgentRunStep,
  AgentRunStatus,
  AgentRunStepStatus,
} from '@prisma/client';
import {
  createRunLedgerService,
  canTransitionRun,
  canTransitionStep,
  RunLedgerStateError,
  RunLedgerDuplicateRunError,
} from '../../services/runLedgerService';
import type { RunLedgerRepository } from '../../repositories/runLedgerRepository';

// ============================================================
// In-memory Repository (test 専用)
// ============================================================

interface InMemoryStore {
  runs: Map<string, AgentRun>;
  steps: Map<string, AgentRunStep>;
}

function createInMemoryRepository(now: () => Date = () => new Date()): {
  repository: RunLedgerRepository;
  store: InMemoryStore;
} {
  const store: InMemoryStore = {
    runs: new Map(),
    steps: new Map(),
  };
  let runCounter = 0;
  let stepCounter = 0;

  const repository: RunLedgerRepository = {
    async createRun(input) {
      runCounter += 1;
      const id = `run-${runCounter}`;
      if (input.idempotencyKey) {
        for (const existing of store.runs.values()) {
          if (existing.idempotencyKey === input.idempotencyKey) {
            // 実 Prisma は P2002 を throw する。test 用は同等のシグナル
            throw new Error(`Unique constraint violation on idempotencyKey`);
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
      store.runs.set(id, run);
      return run;
    },

    async findRunByIdempotencyKey(idempotencyKey) {
      for (const run of store.runs.values()) {
        if (run.idempotencyKey === idempotencyKey) return run;
      }
      return null;
    },

    async findRunById(runId) {
      return store.runs.get(runId) ?? null;
    },

    async updateRun(runId, patch) {
      const existing = store.runs.get(runId);
      if (!existing) throw new Error(`Run ${runId} not found`);
      const updated: AgentRun = {
        ...existing,
        ...patch,
        updatedAt: now(),
      };
      store.runs.set(runId, updated);
      return updated;
    },

    async createStep(input) {
      stepCounter += 1;
      const id = `step-${stepCounter}`;
      // unique 制約 (runId, stepName, attempt) のシミュレーション
      for (const existing of store.steps.values()) {
        if (
          existing.runId === input.runId
          && existing.stepName === input.stepName
          && existing.attempt === input.attempt
        ) {
          throw new Error(
            `Unique constraint violation on (runId, stepName, attempt)`,
          );
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
      store.steps.set(id, step);
      return step;
    },

    async findLatestStep(runId, stepName) {
      const matching = [...store.steps.values()].filter(
        (s) => s.runId === runId && s.stepName === stepName,
      );
      if (matching.length === 0) return null;
      matching.sort((a, b) => b.attempt - a.attempt);
      const first = matching[0];
      return first ?? null;
    },

    async updateStep(stepId, patch) {
      const existing = store.steps.get(stepId);
      if (!existing) throw new Error(`Step ${stepId} not found`);
      const updated: AgentRunStep = {
        ...existing,
        ...patch,
        updatedAt: now(),
      };
      store.steps.set(stepId, updated);
      return updated;
    },

    async findRunWithSteps(runId) {
      const run = store.runs.get(runId);
      if (!run) return null;
      const steps = [...store.steps.values()]
        .filter((s) => s.runId === runId)
        .sort((a, b) => {
          const t = a.startedAt.getTime() - b.startedAt.getTime();
          return t !== 0 ? t : a.attempt - b.attempt;
        });
      return { ...run, steps };
    },
  };

  return { repository, store };
}

// ============================================================
// 状態遷移ルール (pure function test)
// ============================================================

describe('canTransitionRun', () => {
  it('pending → running / cancelled / skipped を許可', () => {
    expect(canTransitionRun('pending', 'running')).toBe(true);
    expect(canTransitionRun('pending', 'cancelled')).toBe(true);
    expect(canTransitionRun('pending', 'skipped')).toBe(true);
  });

  it('running → succeeded / failed / cancelled を許可', () => {
    expect(canTransitionRun('running', 'succeeded')).toBe(true);
    expect(canTransitionRun('running', 'failed')).toBe(true);
    expect(canTransitionRun('running', 'cancelled')).toBe(true);
  });

  it('終端 (succeeded / failed / skipped / cancelled) からは出られない', () => {
    const terminal: AgentRunStatus[] = ['succeeded', 'failed', 'skipped', 'cancelled'];
    const targets: AgentRunStatus[] = [
      'pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled',
    ];
    for (const from of terminal) {
      for (const to of targets) {
        expect(canTransitionRun(from, to)).toBe(false);
      }
    }
  });

  it('同状態への遷移は禁止', () => {
    expect(canTransitionRun('pending', 'pending')).toBe(false);
    expect(canTransitionRun('running', 'running')).toBe(false);
  });

  it('pending → succeeded などスキップ遷移は禁止', () => {
    expect(canTransitionRun('pending', 'succeeded')).toBe(false);
    expect(canTransitionRun('pending', 'failed')).toBe(false);
  });
});

describe('canTransitionStep', () => {
  it('pending → running / skipped を許可、running → succeeded / failed / skipped を許可', () => {
    expect(canTransitionStep('pending', 'running')).toBe(true);
    expect(canTransitionStep('pending', 'skipped')).toBe(true);
    expect(canTransitionStep('running', 'succeeded')).toBe(true);
    expect(canTransitionStep('running', 'failed')).toBe(true);
    expect(canTransitionStep('running', 'skipped')).toBe(true);
  });

  it('終端から出られない / 同状態への遷移は禁止 / pending → succeeded スキップは禁止', () => {
    const terminal: AgentRunStepStatus[] = ['succeeded', 'failed', 'skipped'];
    for (const from of terminal) {
      expect(canTransitionStep(from, 'running')).toBe(false);
      expect(canTransitionStep(from, 'succeeded')).toBe(false);
    }
    expect(canTransitionStep('running', 'running')).toBe(false);
    expect(canTransitionStep('pending', 'succeeded')).toBe(false);
    expect(canTransitionStep('pending', 'failed')).toBe(false);
  });
});

// ============================================================
// Service API: startRun / finishRun
// ============================================================

describe('startRun', () => {
  it('新規 run を running 状態で作る (idempotencyKey なし)', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({
      kind: 'side_b_cycle',
      triggeredBy: 'scheduler',
    });
    expect(run.status).toBe<AgentRunStatus>('running');
    expect(run.kind).toBe('side_b_cycle');
    expect(run.idempotencyKey).toBeNull();
  });

  it('idempotencyKey 重複時に RunLedgerDuplicateRunError を throw し既存 run を expose する', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const first = await service.startRun({
      kind: 'side_b_cycle',
      triggeredBy: 'scheduler',
      idempotencyKey: 'cycle-2026-05-17',
    });
    await expect(
      service.startRun({
        kind: 'side_b_cycle',
        triggeredBy: 'scheduler',
        idempotencyKey: 'cycle-2026-05-17',
      }),
    ).rejects.toBeInstanceOf(RunLedgerDuplicateRunError);

    try {
      await service.startRun({
        kind: 'side_b_cycle',
        triggeredBy: 'scheduler',
        idempotencyKey: 'cycle-2026-05-17',
      });
    } catch (e) {
      expect(e).toBeInstanceOf(RunLedgerDuplicateRunError);
      const err = e as RunLedgerDuplicateRunError;
      expect(err.existingRun.id).toBe(first.id);
    }
  });

  it('summary を redaction する (上限超過は ... で切り詰め)', async () => {
    const { repository, store } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const longSummary = 'a'.repeat(2000);
    const run = await service.startRun({
      kind: 'side_b_cycle',
      triggeredBy: 'adk',
      summary: longSummary,
    });
    const stored = store.runs.get(run.id);
    expect(stored?.summary?.length).toBeLessThanOrEqual(1024);
    expect(stored?.summary?.endsWith('...')).toBe(true);
  });
});

describe('finishRun', () => {
  it('running → succeeded を許可', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    const finished = await service.finishRun(run.id, { status: 'succeeded', summary: 'all green' });
    expect(finished.status).toBe<AgentRunStatus>('succeeded');
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.summary).toBe('all green');
  });

  it('FinishRunInput.status は TerminalRunStatus に narrow されており、'
    + ' pending / running はコンパイル時に排除される', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });

    // @ts-expect-error -- 型レベルで終端 status のみ受けるため running は不可 (Copilot review #2 対応で導入)
    await expect(service.finishRun(run.id, { status: 'running' })).rejects.toBeDefined();
    // @ts-expect-error -- 型レベルで終端 status のみ受けるため pending は不可 (Copilot review #2 対応で導入)
    await expect(service.finishRun(run.id, { status: 'pending' })).rejects.toBeDefined();
  });

  it('存在しない runId は RunLedgerStateError', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    await expect(
      service.finishRun('does-not-exist', { status: 'succeeded' }),
    ).rejects.toBeInstanceOf(RunLedgerStateError);
  });

  it('終端後の再 finishRun は RunLedgerStateError', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.finishRun(run.id, { status: 'succeeded' });
    await expect(
      service.finishRun(run.id, { status: 'failed' }),
    ).rejects.toBeInstanceOf(RunLedgerStateError);
  });

  it('errorMessage を redaction する', async () => {
    const { repository, store } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    const longErr = 'x'.repeat(800);
    await service.finishRun(run.id, {
      status: 'failed',
      errorCode: 'E_TIMEOUT',
      errorMessage: longErr,
    });
    const stored = store.runs.get(run.id);
    expect(stored?.errorCode).toBe('E_TIMEOUT');
    expect(stored?.errorMessage?.length).toBeLessThanOrEqual(512);
  });
});

// ============================================================
// Service API: startStep / succeedStep / failStep / skipStep / retry
// ============================================================

describe('startStep', () => {
  it('run が running でないと step を開始できない', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.finishRun(run.id, { status: 'succeeded' });
    await expect(
      service.startStep(run.id, { stepName: 'readiness' }),
    ).rejects.toBeInstanceOf(RunLedgerStateError);
  });

  it('初回 step は attempt=0 で kind=created を返す', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    const result = await service.startStep(run.id, { stepName: 'readiness' });
    expect(result.kind).toBe('created');
    expect(result.step.attempt).toBe(0);
    expect(result.step.status).toBe<AgentRunStepStatus>('running');
  });

  it('前回 attempt が終端なら retry として attempt+1 を作る', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.startStep(run.id, { stepName: 'plan' });
    await service.failStep(run.id, 'plan', { errorCode: 'E_LLM', nextAction: 'retry' });
    const retried = await service.startStep(run.id, { stepName: 'plan' });
    expect(retried.kind).toBe('retry');
    expect(retried.step.attempt).toBe(1);
    if (retried.kind === 'retry') {
      expect(retried.previousAttempt).toBe(0);
    }
  });

  it('前回 attempt が未完了 (running) なら error', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.startStep(run.id, { stepName: 'evolution' });
    await expect(
      service.startStep(run.id, { stepName: 'evolution' }),
    ).rejects.toBeInstanceOf(RunLedgerStateError);
  });
});

describe('succeedStep / failStep / skipStep', () => {
  it('succeedStep: running → succeeded + nextAction + durationMs を記録', async () => {
    let t = 1000;
    const clock = (): Date => new Date(t);
    const { repository, store } = createInMemoryRepository(clock);
    const service = createRunLedgerService({ repository, clock });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.startStep(run.id, { stepName: 'readiness' });
    t = 2500;
    const succeeded = await service.succeedStep(run.id, 'readiness', {
      summary: 'ok',
      nextAction: 'proceed',
    });
    expect(succeeded.status).toBe<AgentRunStepStatus>('succeeded');
    expect(succeeded.nextAction).toBe('proceed');
    expect(succeeded.durationMs).toBe(1500);
    expect(store.steps.get(succeeded.id)?.summary).toBe('ok');
  });

  it('failStep: error code / message を redaction しつつ保存', async () => {
    const { repository, store } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.startStep(run.id, { stepName: 'evolution' });
    const failed = await service.failStep(run.id, 'evolution', {
      errorCode: 'EVOLUTION_FAILED',
      errorMessage: 'y'.repeat(600),
      nextAction: 'manual_review',
    });
    expect(failed.status).toBe<AgentRunStepStatus>('failed');
    expect(failed.errorCode).toBe('EVOLUTION_FAILED');
    expect(failed.errorMessage?.length).toBeLessThanOrEqual(512);
    expect(store.steps.get(failed.id)?.nextAction).toBe('manual_review');
  });

  it('skipStep: reason が summary に redaction 済みで入る', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.startStep(run.id, { stepName: 'evolution' });
    const skipped = await service.skipStep(run.id, 'evolution', {
      reason: 'evolution candidates were empty',
      nextAction: 'stop',
    });
    expect(skipped.status).toBe<AgentRunStepStatus>('skipped');
    expect(skipped.summary).toBe('evolution candidates were empty');
    expect(skipped.nextAction).toBe('stop');
  });

  it('終端後の succeedStep は state error', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.startStep(run.id, { stepName: 'plan' });
    await service.succeedStep(run.id, 'plan');
    await expect(
      service.succeedStep(run.id, 'plan'),
    ).rejects.toBeInstanceOf(RunLedgerStateError);
  });

  it('存在しない step name は state error', async () => {
    const { repository } = createInMemoryRepository();
    const service = createRunLedgerService({ repository });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await expect(
      service.succeedStep(run.id, 'never-started'),
    ).rejects.toBeInstanceOf(RunLedgerStateError);
  });
});

// ============================================================
// findRunWithSteps
// ============================================================

describe('findRunWithSteps', () => {
  it('run + steps を時系列で返す', async () => {
    let t = 1000;
    const clock = (): Date => new Date(t);
    const { repository } = createInMemoryRepository(clock);
    const service = createRunLedgerService({ repository, clock });
    const run = await service.startRun({ kind: 'side_b_cycle', triggeredBy: 'scheduler' });
    await service.startStep(run.id, { stepName: 'readiness' });
    await service.succeedStep(run.id, 'readiness', { nextAction: 'proceed' });
    t = 2000;
    await service.startStep(run.id, { stepName: 'plan' });
    await service.failStep(run.id, 'plan', { errorCode: 'E_LLM', nextAction: 'retry' });
    t = 3000;
    await service.startStep(run.id, { stepName: 'plan' });
    await service.succeedStep(run.id, 'plan');

    const detail = await service.findRunWithSteps(run.id);
    expect(detail?.steps.length).toBe(3);
    expect(detail?.steps.map((s) => `${s.stepName}#${s.attempt}:${s.status}`)).toEqual([
      'readiness#0:succeeded',
      'plan#0:failed',
      'plan#1:succeeded',
    ]);
  });
});
