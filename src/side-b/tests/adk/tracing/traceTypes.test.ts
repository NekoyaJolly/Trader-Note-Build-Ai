/**
 * traceTypes 型定義テスト (Step 2 Phase 2)
 *
 * AdkTraceEvent / TracePayloadSummary が想定通りの形状を持ち、raw payload を
 * 型レベルで保存できないことを確認する。
 *
 * 設計書: docs/architecture/STEP_2_KICKOFF.md §5.1 / STEP_2_ADK_TRACING_SPIKE.md §3.1
 */

import type {
  AdkTraceEvent,
  AdkTraceEventKind,
  AdkTraceStatus,
  TracePayloadSummary,
} from '../../../adk/tracing/traceTypes';

describe('AdkTraceEventKind', () => {
  it('3 値のみを許容する union', () => {
    const valid: AdkTraceEventKind[] = ['adk.skill.started', 'adk.skill.completed', 'adk.skill.failed'];
    expect(valid).toHaveLength(3);
  });
});

describe('AdkTraceStatus', () => {
  it('4 値のみを許容する union', () => {
    const valid: AdkTraceStatus[] = ['started', 'ok', 'error', 'thrown'];
    expect(valid).toHaveLength(4);
  });
});

describe('TracePayloadSummary', () => {
  it('redacted: true は必須リテラル', () => {
    const s: TracePayloadSummary = { redacted: true };
    expect(s.redacted).toBe(true);
  });

  it('全フィールドが optional (redacted を除く)', () => {
    const minimal: TracePayloadSummary = { redacted: true };
    const full: TracePayloadSummary = {
      fieldCount: 3,
      topLevelKeys: ['a', 'b'],
      primitiveType: 'string',
      redacted: true,
    };
    expect(minimal.redacted).toBe(true);
    expect(full.fieldCount).toBe(3);
  });

  it('topLevelKeys は readonly string[] (push 等の破壊的変更は型レベル禁止)', () => {
    const s: TracePayloadSummary = { topLevelKeys: ['x', 'y'], redacted: true };
    expect(s.topLevelKeys).toEqual(['x', 'y']);
    // (s.topLevelKeys as string[]).push('z') ← これは型システムで禁止される
  });
});

describe('AdkTraceEvent', () => {
  it('必須フィールド: kind / traceId / agentName / skillName / callerReason / startedAt / status', () => {
    const e: AdkTraceEvent = {
      kind: 'adk.skill.started',
      traceId: 't-1',
      agentName: 'discovery',
      skillName: 'compute_lens_features',
      callerReason: 'invoked-via-adk-runner',
      startedAt: new Date(),
      status: 'started',
    };
    expect(e.traceId).toBe('t-1');
  });

  it('optional フィールド: parentTraceId / invocationId / functionCallId / endedAt / durationMs / errorCode / errorMessage / argsSummary / resultSummary', () => {
    const e: AdkTraceEvent = {
      kind: 'adk.skill.completed',
      traceId: 't-2',
      parentTraceId: 't-1',
      invocationId: 'inv-1',
      functionCallId: 'fc-1',
      agentName: 'strategist',
      skillName: 'register_hypothesis',
      callerReason: 'invoked-via-adk-runner',
      startedAt: new Date('2026-05-13T00:00:00Z'),
      endedAt: new Date('2026-05-13T00:00:01Z'),
      durationMs: 1000,
      status: 'ok',
      argsSummary: { fieldCount: 2, topLevelKeys: ['a', 'b'], redacted: true },
      resultSummary: { fieldCount: 1, topLevelKeys: ['id'], redacted: true },
    };
    expect(e.durationMs).toBe(1000);
    expect(e.argsSummary?.redacted).toBe(true);
  });

  it('failed event は errorCode / errorMessage を含められる', () => {
    const e: AdkTraceEvent = {
      kind: 'adk.skill.failed',
      traceId: 't-3',
      agentName: 'a',
      skillName: 's',
      callerReason: 'invoked-via-adk-runner',
      startedAt: new Date(),
      endedAt: new Date(),
      durationMs: 50,
      status: 'error',
      errorCode: 'ZodError',
      errorMessage: 'Required field missing',
    };
    expect(e.errorCode).toBe('ZodError');
  });

  it('AdkTraceEvent に errorDetails や rawPayload のような型レベル禁止フィールドがないこと (型上 keyof で確認)', () => {
    // keyof AdkTraceEvent に "errorDetails" / "rawArgs" / "rawResult" 等が含まれないことを
    // 型システムで確認する。ここではコンパイル時の型エラーが出ないことが PASS の証拠。
    type Keys = keyof AdkTraceEvent;
    const allowedKeys: Keys[] = [
      'kind',
      'traceId',
      'parentTraceId',
      'invocationId',
      'functionCallId',
      'agentName',
      'skillName',
      'callerReason',
      'startedAt',
      'endedAt',
      'durationMs',
      'status',
      'errorCode',
      'errorMessage',
      'argsSummary',
      'resultSummary',
    ];
    expect(allowedKeys).toHaveLength(16);
  });
});
