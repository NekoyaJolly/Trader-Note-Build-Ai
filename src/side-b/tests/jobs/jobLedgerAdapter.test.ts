/**
 * runJobWithLedger helper の unit test。
 *
 * Job を呼び RunLedger に startStep / 終端 API を残すパスを検証する。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §8 (Phase 3.5 / 3.6)
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion --
 * test 用 jest.fn の async mock は await を持たないが、Promise<T> シグネチャを保つため async が必要。
 * mock 戻り値の `{} as never` cast は spy 用に jest 戻り値型を狭めるための慣用形 (本番コードでは禁止)。
 */
import { runJobWithLedger } from '../../jobs/jobLedgerAdapter';
import type { JobPortContext } from '../../jobs/jobPort';
import type { RunLedgerService } from '../../services/runLedgerService';

interface RecordedCall {
  fn: 'startStep' | 'succeedStep' | 'failStep' | 'skipStep';
  args: unknown;
}

function createLedgerSpy(): { ledger: RunLedgerService; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const ledger = {
    startStep: jest.fn(async (runId: string, input: unknown) => {
      calls.push({ fn: 'startStep', args: { runId, ...((input ?? {}) as object) } });
      return { kind: 'created' as const, step: {} as never };
    }),
    succeedStep: jest.fn(async (runId: string, stepName: string, input: unknown) => {
      calls.push({ fn: 'succeedStep', args: { runId, stepName, ...((input ?? {}) as object) } });
      return {} as never;
    }),
    failStep: jest.fn(async (runId: string, stepName: string, input: unknown) => {
      calls.push({ fn: 'failStep', args: { runId, stepName, ...((input ?? {}) as object) } });
      return {} as never;
    }),
    skipStep: jest.fn(async (runId: string, stepName: string, input: unknown) => {
      calls.push({ fn: 'skipStep', args: { runId, stepName, ...((input ?? {}) as object) } });
      return {} as never;
    }),
    startRun: jest.fn(),
    finishRun: jest.fn(),
    findRunWithSteps: jest.fn(),
  } as unknown as RunLedgerService;
  return { ledger, calls };
}

function ctx(ledger: RunLedgerService): JobPortContext {
  return { runId: 'run-1', ledger };
}

describe('runJobWithLedger', () => {
  it('成功時: startStep → succeedStep を呼び、envelope を返す', async () => {
    const { ledger, calls } = createLedgerSpy();
    const envelope = await runJobWithLedger(ctx(ledger), {
      stepName: 'sample',
      invoke: () => Promise.resolve({ count: 3 }),
      mapResult: (r) => ({
        ok: true,
        status: 'succeeded',
        summary: `count=${r.count}`,
        nextAction: 'proceed',
      }),
    });
    expect(envelope).toMatchObject({
      ok: true,
      status: 'succeeded',
      stepName: 'sample',
      summary: 'count=3',
      nextAction: 'proceed',
    });
    expect(calls.map((c) => c.fn)).toEqual(['startStep', 'succeedStep']);
  });

  it('correlationId 指定時: RunLedger summary に相関IDを付与する', async () => {
    const { ledger, calls } = createLedgerSpy();
    const envelope = await runJobWithLedger(
      { runId: 'run-1', ledger, correlationId: 'job-run-20260603' },
      {
        stepName: 'sample',
        invoke: () => Promise.resolve({ count: 3 }),
        mapResult: (r) => ({
          ok: true,
          status: 'succeeded',
          summary: `count=${r.count}`,
          nextAction: 'proceed',
        }),
      },
    );

    expect(envelope.summary).toBe('count=3');
    const succeedCall = calls[1];
    if (!succeedCall) throw new Error('expected succeedStep call');
    expect((succeedCall.args as { summary?: string }).summary).toBe(
      'correlationId=job-run-20260603 count=3',
    );
  });

  it('skipped 時: skipStep を呼ぶ', async () => {
    const { ledger, calls } = createLedgerSpy();
    await runJobWithLedger(ctx(ledger), {
      stepName: 'skip-sample',
      invoke: () => Promise.resolve({}),
      mapResult: () => ({
        ok: false,
        status: 'skipped',
        summary: '24h guard',
        nextAction: 'proceed',
      }),
    });
    expect(calls.map((c) => c.fn)).toEqual(['startStep', 'skipStep']);
  });

  it('failed 時: failStep を呼び errorCode / errorMessage を伝播', async () => {
    const { ledger, calls } = createLedgerSpy();
    const envelope = await runJobWithLedger(ctx(ledger), {
      stepName: 'failing-sample',
      invoke: () => Promise.resolve('x'),
      mapResult: () => ({
        ok: false,
        status: 'failed',
        summary: 'half done',
        errorCode: 'E_PARTIAL',
        errorMessage: 'some rows failed',
        nextAction: 'retry',
      }),
    });
    expect(envelope.status).toBe('failed');
    expect(envelope.errorCode).toBe('E_PARTIAL');
    expect(calls.map((c) => c.fn)).toEqual(['startStep', 'failStep']);
    const failCall = calls[1];
    if (!failCall) throw new Error('expected failStep call');
    expect((failCall.args as { errorCode?: string }).errorCode).toBe('E_PARTIAL');
  });

  it('invoke が throw した場合: defaultMapError 経由で failStep に', async () => {
    const { ledger, calls } = createLedgerSpy();
    const envelope = await runJobWithLedger(ctx(ledger), {
      stepName: 'throw-sample',
      invoke: () => {
        throw new Error('boom');
      },
      mapResult: () => {
        throw new Error('mapResult should not be called');
      },
    });
    expect(envelope.status).toBe('failed');
    expect(envelope.errorCode).toBe('JOB_UNCAUGHT');
    expect(envelope.errorMessage).toBe('boom');
    expect(envelope.nextAction).toBe('stop');
    expect(calls.map((c) => c.fn)).toEqual(['startStep', 'failStep']);
  });

  it('invoke が string を throw しても normalize される', async () => {
    const { ledger } = createLedgerSpy();
    const envelope = await runJobWithLedger(ctx(ledger), {
      stepName: 'string-throw',
      invoke: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- 既存 Job が string を throw するケースを模擬する意図的な test
        throw 'bare string error';
      },
      mapResult: () => ({ ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }),
    });
    expect(envelope.status).toBe('failed');
    expect(envelope.errorMessage).toBe('bare string error');
  });

  it('mapError が指定されていれば優先される', async () => {
    const { ledger } = createLedgerSpy();
    const envelope = await runJobWithLedger(ctx(ledger), {
      stepName: 'custom-error',
      invoke: () => {
        throw new Error('upstream timeout');
      },
      mapResult: () => ({ ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }),
      mapError: (e) => ({
        ok: false,
        status: 'failed',
        summary: null,
        errorCode: 'E_UPSTREAM',
        errorMessage: e.message,
        nextAction: 'manual_review',
      }),
    });
    expect(envelope.errorCode).toBe('E_UPSTREAM');
    expect(envelope.nextAction).toBe('manual_review');
  });

  it('traceKind が指定されない場合は "job" になる', async () => {
    const { ledger, calls } = createLedgerSpy();
    await runJobWithLedger(ctx(ledger), {
      stepName: 's',
      invoke: () => Promise.resolve(undefined),
      mapResult: () => ({ ok: true, status: 'succeeded', summary: null, nextAction: 'proceed' }),
    });
    const startCall = calls[0];
    if (!startCall) throw new Error('expected startStep call');
    expect((startCall.args as { traceKind?: string }).traceKind).toBe('job');
  });
});
