/**
 * RunLedgerTraceSink の test
 *
 * ADK trace event を RunLedger の startStep / succeedStep / failStep にルーティング
 * すること、および failure isolation (sink 失敗が ADK / Job 本体を壊さない) を検証する。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §10 (Phase 5)
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion --
 * spy 用の async mock は await を持たないが、Promise<T> シグネチャを保つため async が必要。
 * mock 戻り値の `{} as never` cast は jest 戻り値型を狭めるための慣用形 (本番コードでは禁止)。
 */
import { createRunLedgerTraceSink } from '../../../adk/tracing/runLedgerTraceSink';
import type { AdkTraceEvent } from '../../../adk/tracing/traceTypes';
import type { RunLedgerService } from '../../../services/runLedgerService';

interface SpyLedger {
  service: RunLedgerService;
  startStepMock: jest.Mock;
  succeedStepMock: jest.Mock;
  failStepMock: jest.Mock;
  skipStepMock: jest.Mock;
}

function makeSpyLedger(opts?: { failOn?: 'startStep' | 'succeedStep' | 'failStep' }): SpyLedger {
  const fail = (name: string): never => {
    throw new Error(`mock ${name} failure`);
  };
  const startStepMock = jest.fn(async () => {
    if (opts?.failOn === 'startStep') fail('startStep');
    return { kind: 'created' as const };
  });
  const succeedStepMock = jest.fn(async () => {
    if (opts?.failOn === 'succeedStep') fail('succeedStep');
    return {};
  });
  const failStepMock = jest.fn(async () => {
    if (opts?.failOn === 'failStep') fail('failStep');
    return {};
  });
  const skipStepMock = jest.fn(async () => ({}));

  const service = {
    startStep: startStepMock,
    succeedStep: succeedStepMock,
    failStep: failStepMock,
    skipStep: skipStepMock,
    startRun: jest.fn(),
    finishRun: jest.fn(),
    findRunWithSteps: jest.fn(),
  } as unknown as RunLedgerService;
  return { service, startStepMock, succeedStepMock, failStepMock, skipStepMock };
}

function makeEvent(overrides: Partial<AdkTraceEvent>): AdkTraceEvent {
  return {
    kind: 'adk.skill.started',
    traceId: 't-1',
    agentName: 'TestAgent',
    skillName: 'sample',
    callerReason: 'ADK_DEFAULT',
    startedAt: new Date(),
    status: 'started',
    ...overrides,
  };
}

describe('createRunLedgerTraceSink', () => {
  it('adk.skill.started → startStep (traceKind=adk-skill)', async () => {
    const spy = makeSpyLedger();
    const sink = createRunLedgerTraceSink(spy.service, 'run-1');
    await sink.record(makeEvent({ kind: 'adk.skill.started', skillName: 's1' }));
    expect(spy.startStepMock).toHaveBeenCalledWith('run-1', expect.objectContaining({
      stepName: 's1',
      traceKind: 'adk-skill',
    }));
    expect(spy.succeedStepMock).not.toHaveBeenCalled();
  });

  it('adk.subagent.started → startStep (traceKind=adk-subagent)', async () => {
    const spy = makeSpyLedger();
    const sink = createRunLedgerTraceSink(spy.service, 'run-2');
    await sink.record(makeEvent({ kind: 'adk.subagent.started', skillName: 'PlanAgent' }));
    expect(spy.startStepMock).toHaveBeenCalledWith('run-2', expect.objectContaining({
      stepName: 'PlanAgent',
      traceKind: 'adk-subagent',
    }));
  });

  it('adk.skill.completed → succeedStep (summary に duration/fieldCount)', async () => {
    const spy = makeSpyLedger();
    const sink = createRunLedgerTraceSink(spy.service, 'run-3');
    await sink.record(makeEvent({
      kind: 'adk.skill.completed',
      status: 'ok',
      durationMs: 250,
      resultSummary: { fieldCount: 4, redacted: true },
      skillName: 's2',
    }));
    expect(spy.succeedStepMock).toHaveBeenCalledWith('run-3', 's2', expect.objectContaining({
      summary: expect.stringContaining('durationMs=250'),
      nextAction: 'proceed',
    }));
    const args = spy.succeedStepMock.mock.calls[0]?.[2] as { summary: string };
    expect(args.summary).toContain('result.fieldCount=4');
  });

  it('adk.skill.failed → failStep (errorCode/Message 伝播、nextAction=stop)', async () => {
    const spy = makeSpyLedger();
    const sink = createRunLedgerTraceSink(spy.service, 'run-4');
    await sink.record(makeEvent({
      kind: 'adk.skill.failed',
      status: 'error',
      errorCode: 'E_VALIDATE',
      errorMessage: 'invalid input',
      skillName: 's3',
    }));
    expect(spy.failStepMock).toHaveBeenCalledWith('run-4', 's3', expect.objectContaining({
      errorCode: 'E_VALIDATE',
      errorMessage: 'invalid input',
      nextAction: 'stop',
    }));
  });

  it('errorCode 未設定の failed → ADK_TRACE_FAILED にフォールバック', async () => {
    const spy = makeSpyLedger();
    const sink = createRunLedgerTraceSink(spy.service, 'run-5');
    await sink.record(makeEvent({
      kind: 'adk.subagent.failed',
      status: 'thrown',
      skillName: 'sub-x',
    }));
    expect(spy.failStepMock).toHaveBeenCalledWith('run-5', 'sub-x', expect.objectContaining({
      errorCode: 'ADK_TRACE_FAILED',
    }));
  });

  it('failure isolation: startStep が throw しても record は throw せず logger.warn だけ呼ぶ', async () => {
    const spy = makeSpyLedger({ failOn: 'startStep' });
    const warnMock = jest.fn();
    const sink = createRunLedgerTraceSink(spy.service, 'run-6', { warn: warnMock });
    await expect(
      sink.record(makeEvent({ kind: 'adk.skill.started', skillName: 'fail-step' })),
    ).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]?.[0]).toContain('record failed');
    expect(warnMock.mock.calls[0]?.[0]).toContain('fail-step');
  });

  it('failure isolation: succeedStep が throw しても record は throw せず', async () => {
    const spy = makeSpyLedger({ failOn: 'succeedStep' });
    const warnMock = jest.fn();
    const sink = createRunLedgerTraceSink(spy.service, 'run-7', { warn: warnMock });
    await expect(
      sink.record(makeEvent({ kind: 'adk.skill.completed', status: 'ok', skillName: 's' })),
    ).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('raw payload (argsSummary に raw value など) を保存しない: summary には fieldCount のみ', async () => {
    const spy = makeSpyLedger();
    const sink = createRunLedgerTraceSink(spy.service, 'run-8');
    await sink.record(makeEvent({
      kind: 'adk.skill.completed',
      status: 'ok',
      argsSummary: { fieldCount: 2, topLevelKeys: ['symbol', 'timeframe'], redacted: true },
      resultSummary: { fieldCount: 3, redacted: true },
      durationMs: 100,
      skillName: 'redactme',
    }));
    const summaryArg = spy.succeedStepMock.mock.calls[0]?.[2] as { summary: string };
    // raw payload 由来の値 (symbol/timeframe value) はそもそも AdkTraceEvent にも無いが、
    // summary 出力に出ないことを確認
    expect(summaryArg.summary).toContain('args.fieldCount=2');
    expect(summaryArg.summary).toContain('result.fieldCount=3');
    expect(summaryArg.summary).not.toContain('topLevelKeys');
  });
});
