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

  it('keyof AdkTraceEvent が想定 16 フィールドと完全一致 (網羅性の型レベル検証)', () => {
    // Record<keyof AdkTraceEvent, true> 形式で網羅性を型レベルに持たせる。
    // - 列挙し損ねた keyof があれば型エラー
    // - 列挙にない (= AdkTraceEvent に存在しない) キーを書いても型エラー
    const allKeys: Record<keyof AdkTraceEvent, true> = {
      kind: true,
      traceId: true,
      parentTraceId: true,
      invocationId: true,
      functionCallId: true,
      agentName: true,
      skillName: true,
      callerReason: true,
      startedAt: true,
      endedAt: true,
      durationMs: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      argsSummary: true,
      resultSummary: true,
    };
    expect(Object.keys(allKeys)).toHaveLength(16);
  });

  it('禁止フィールドが型レベルで存在しない (ts-expect-error で検証)', () => {
    /*
     * 以下は AdkTraceEvent に存在しないキー = TypeScript で型エラーになる。
     * ts-expect-error directive は「型エラーが起きること」を期待するため、エラーが
     * 起きないと逆に test compile が失敗する。これにより「禁止フィールドが存在しない」
     * が型レベルで担保される。
     *
     * (説明コメントを block 形式にしているのは、行コメントだと directive 誤認識を
     *  起こすため)
     */

    // @ts-expect-error errorDetails は AdkTraceEvent に存在しない (raw payload 保存禁止)
    type _ForbidsErrorDetails = Pick<AdkTraceEvent, 'errorDetails'>;
    // @ts-expect-error rawArgs は AdkTraceEvent に存在しない (raw payload 保存禁止)
    type _ForbidsRawArgs = Pick<AdkTraceEvent, 'rawArgs'>;
    // @ts-expect-error rawResult は AdkTraceEvent に存在しない (raw payload 保存禁止)
    type _ForbidsRawResult = Pick<AdkTraceEvent, 'rawResult'>;
    // @ts-expect-error stackTrace は AdkTraceEvent に存在しない (機微情報の保存禁止)
    type _ForbidsStackTrace = Pick<AdkTraceEvent, 'stackTrace'>;

    // 型レベル検証のため runtime 値の確認は不要 (型が通れば PASS)
    expect(true).toBe(true);
  });
});
