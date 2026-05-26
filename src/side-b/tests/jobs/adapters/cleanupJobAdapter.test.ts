/**
 * cleanupJobAdapter の test
 *
 * mapCleanupResult の各分岐 (executed=false / error 付き / 成功) を検証する。
 * adapter factory 自体は runJobWithLedger を呼ぶだけのため、helper test と重複しない
 * 「結果マッピング」部分にフォーカス。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §8 (Phase 3)
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion --
 * test 用 jest.fn の async mock は await を持たないが、Promise<T> シグネチャを保つため async が必要。
 * mock 戻り値の `{} as never` cast は jest 戻り値型を狭めるための慣用形 (本番コードでは禁止)。
 */
import { mapCleanupResult, createCleanupJobAdapter, CLEANUP_STEP_NAME } from '../../../jobs/adapters/cleanupJobAdapter';
import type { CleanupJob, CleanupJobResult } from '../../../jobs/cleanupJob';
import type { SideBSchedulerConfig } from '../../../jobs/sideBScheduler';
import type { JobPortContext } from '../../../jobs/jobPort';
import type { RunLedgerService } from '../../../services/runLedgerService';

function baseResult(overrides: Partial<CleanupJobResult> = {}): CleanupJobResult {
  return {
    executed: true,
    expiredResearchCount: 0,
    oldPlansCount: 0,
    oldTradesCount: 0,
    carryRetention: { deleted: 0 },
    indicatorCacheRetention: { deleted: 0 },
    ...overrides,
  };
}

describe('mapCleanupResult', () => {
  it('executed=false の場合は skipped に分類', () => {
    const env = mapCleanupResult(baseResult({ executed: false }));
    expect(env.status).toBe('skipped');
    expect(env.summary).toContain('skipped');
    expect(env.nextAction).toBe('proceed');
  });

  it('error 付きは failed + CLEANUP_PARTIAL + summary に件数を含む', () => {
    const env = mapCleanupResult(baseResult({
      executed: true,
      expiredResearchCount: 3,
      oldPlansCount: 1,
      oldTradesCount: 2,
      carryRetention: { deleted: 1 },
      error: 'some research rows failed',
    }));
    expect(env.status).toBe('failed');
    expect(env.errorCode).toBe('CLEANUP_PARTIAL');
    expect(env.errorMessage).toBe('some research rows failed');
    expect(env.summary).toContain('expiredResearch=3');
    expect(env.summary).toContain('oldPlans=1');
    expect(env.summary).toContain('oldTrades=2');
    expect(env.summary).toContain('evolutionCarryDeleted=1');
    expect(env.nextAction).toBe('proceed');
  });

  it('成功時は succeeded + summary に削除件数', () => {
    const env = mapCleanupResult(baseResult({
      expiredResearchCount: 10,
      oldPlansCount: 5,
      oldTradesCount: 3,
      carryRetention: { deleted: 2 },
    }));
    expect(env.status).toBe('succeeded');
    expect(env.ok).toBe(true);
    expect(env.summary).toBe(
      'expiredResearch=10, oldPlans=5, oldTrades=3, evolutionCarryDeleted=2, indicatorCacheDeleted=0',
    );
    expect(env.nextAction).toBe('proceed');
  });
});

describe('createCleanupJobAdapter', () => {
  it('stepName が CLEANUP_STEP_NAME と一致し、execute が job.run を呼ぶ', async () => {
    const runMock = jest.fn(async () => baseResult({ expiredResearchCount: 1 }));
    const fakeJob = { run: runMock } as unknown as CleanupJob;
    const fakeConfig = {} as SideBSchedulerConfig;

    const ledgerSpy = {
      startStep: jest.fn(async () => ({ kind: 'created' as const, step: {} as never })),
      succeedStep: jest.fn(async () => ({} as never)),
      failStep: jest.fn(async () => ({} as never)),
      skipStep: jest.fn(async () => ({} as never)),
      startRun: jest.fn(),
      finishRun: jest.fn(),
      findRunWithSteps: jest.fn(),
    } as unknown as RunLedgerService;
    const ctx: JobPortContext = { runId: 'run-1', ledger: ledgerSpy };

    const adapter = createCleanupJobAdapter(fakeJob, fakeConfig);
    expect(adapter.stepName).toBe(CLEANUP_STEP_NAME);

    const env = await adapter.execute(ctx);
    expect(runMock).toHaveBeenCalledWith(fakeConfig);
    expect(env.status).toBe('succeeded');
    expect(env.stepName).toBe(CLEANUP_STEP_NAME);
    expect(ledgerSpy.startStep).toHaveBeenCalledWith('run-1', expect.objectContaining({ stepName: CLEANUP_STEP_NAME, traceKind: 'job' }));
    expect(ledgerSpy.succeedStep).toHaveBeenCalled();
  });
});
