/**
 * discoveryJobAdapter の test
 *
 * mapDiscoveryResult の各分岐 (skipped / 成功) を検証する。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §8 (Phase 3)
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion --
 * test 用 jest.fn の async mock は await を持たないが、Promise<T> シグネチャを保つため async が必要。
 * mock 戻り値の `{} as never` cast は jest 戻り値型を狭めるための慣用形 (本番コードでは禁止)。
 */
import {
  mapDiscoveryResult,
  createDiscoveryJobAdapter,
  DISCOVERY_STEP_NAME,
} from '../../../jobs/adapters/discoveryJobAdapter';
import type { DiscoveryJob, DiscoveryJobResult } from '../../../jobs/discoveryJob';
import type { SideBSchedulerConfig } from '../../../jobs/sideBScheduler';
import type { JobPortContext } from '../../../jobs/jobPort';
import type { RunLedgerService } from '../../../services/runLedgerService';

function baseResult(overrides: Partial<DiscoveryJobResult> = {}): DiscoveryJobResult {
  return {
    noteCount: 0,
    newHypothesesCount: 0,
    lensInsightsCount: 0,
    tokenUsage: 0,
    skipped: false,
    ...overrides,
  };
}

describe('mapDiscoveryResult', () => {
  it('skipped=true → skipped + summary に skip 理由', () => {
    const env = mapDiscoveryResult(baseResult({ skipped: true }));
    expect(env.status).toBe('skipped');
    expect(env.summary).toContain('skipped');
    expect(env.summary).toContain('no notes');
    expect(env.nextAction).toBe('proceed');
  });

  it('成功時は succeeded + summary に counts を全部載せる', () => {
    const env = mapDiscoveryResult(baseResult({
      noteCount: 42,
      newHypothesesCount: 3,
      lensInsightsCount: 5,
      tokenUsage: 1234,
    }));
    expect(env.status).toBe('succeeded');
    expect(env.summary).toBe('noteCount=42, newHypotheses=3, lensInsights=5, tokens=1234');
    expect(env.nextAction).toBe('proceed');
  });
});

describe('createDiscoveryJobAdapter', () => {
  it('stepName と execute が想定通り', async () => {
    const fakeJob = {
      run: jest.fn(async () => baseResult({ noteCount: 7, tokenUsage: 100 })),
    } as unknown as DiscoveryJob;
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
    const ctx: JobPortContext = { runId: 'run-x', ledger: ledgerSpy };

    const adapter = createDiscoveryJobAdapter(fakeJob, fakeConfig);
    expect(adapter.stepName).toBe(DISCOVERY_STEP_NAME);

    const env = await adapter.execute(ctx);
    expect(env.status).toBe('succeeded');
    expect(env.summary).toContain('noteCount=7');
    expect(ledgerSpy.startStep).toHaveBeenCalled();
    expect(ledgerSpy.succeedStep).toHaveBeenCalled();
  });
});
