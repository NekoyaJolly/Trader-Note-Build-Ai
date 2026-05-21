/**
 * tracePlanStep ユニットテスト (P3)
 *
 * 対象: src/side-b/adk/tracing/planStepTrace.ts
 *
 * 検証観点:
 *   - 成功: started + completed の 2 event が emit され、status/kind/skillName が正しい
 *   - 失敗: started + failed の 2 event が emit され、errorMessage が含まれる
 *   - traceId / parentTraceId の紐付けが成立する
 *   - sink が throw しても fn の正常完了が保証される (safeRecord の契約再確認)
 *   - args / result が raw 値でなく TracePayloadSummary に縮約される
 *   - fn が throw した値は再 throw される (caller の catch を尊重)
 */

import { InMemoryTraceSink } from '../../../adk/tracing/inMemoryTraceSink';
import {
    tracePlanStep,
    type PlanStepTraceContext,
} from '../../../adk/tracing/planStepTrace';
import type { TraceSink } from '../../../adk/tracing/traceSink';
import type { AdkTraceEvent } from '../../../adk/tracing/traceTypes';

function makeCtx(sink: TraceSink): PlanStepTraceContext {
    return {
        sink,
        agentName: 'test-orchestrator',
        invocationId: 'invocation-1',
        callerReason: 'plan-multi-stage',
    };
}

describe('tracePlanStep: 成功時', () => {
    it('started + completed の 2 event を emit する', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        const result = await tracePlanStep(ctx, 'research_primary', { symbol: 'XAUUSD' }, async () => {
            return { ok: true, value: 42 };
        });

        expect(result).toEqual({ ok: true, value: 42 });
        const events = sink.events;
        expect(events).toHaveLength(2);

        const started = events[0];
        expect(started.kind).toBe('adk.subagent.started');
        expect(started.status).toBe('started');
        expect(started.skillName).toBe('research_primary');
        expect(started.agentName).toBe('test-orchestrator');
        expect(started.callerReason).toBe('plan-multi-stage');
        expect(started.invocationId).toBe('invocation-1');

        const completed = events[1];
        expect(completed.kind).toBe('adk.subagent.completed');
        expect(completed.status).toBe('ok');
        expect(completed.skillName).toBe('research_primary');
        expect(completed.parentTraceId).toBe(started.traceId);
        expect(completed.durationMs).toBeGreaterThanOrEqual(0);
        expect(completed.errorMessage).toBeUndefined();
    });

    it('args / result は TracePayloadSummary に縮約される (raw 値を保存しない)', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        await tracePlanStep(ctx, 'plan_ai', { symbol: 'XAUUSD', candidateCount: 3 }, async () => {
            return { plan: { id: 'p1' }, tokens: 1500 };
        });

        const [started, completed] = sink.events;
        // started.argsSummary に redacted: true マーカー + topLevelKeys のみ
        expect(started.argsSummary).toBeDefined();
        expect(started.argsSummary?.redacted).toBe(true);
        expect(started.argsSummary?.topLevelKeys).toEqual(
            expect.arrayContaining(['symbol', 'candidateCount']),
        );
        // completed.resultSummary も同様
        expect(completed.resultSummary).toBeDefined();
        expect(completed.resultSummary?.redacted).toBe(true);
        expect(completed.resultSummary?.topLevelKeys).toEqual(
            expect.arrayContaining(['plan', 'tokens']),
        );
    });
});

describe('tracePlanStep: 失敗時', () => {
    it('started + failed の 2 event を emit し、fn が throw した値は再 throw される', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        const boom = new Error('analysis-engine 502 Bad Gateway');
        await expect(
            tracePlanStep(ctx, 'plan_ai', { symbol: 'XAUUSD' }, async () => {
                throw boom;
            }),
        ).rejects.toBe(boom);

        const events = sink.events;
        expect(events).toHaveLength(2);

        const failed = events[1];
        expect(failed.kind).toBe('adk.subagent.failed');
        expect(failed.status).toBe('thrown');
        expect(failed.skillName).toBe('plan_ai');
        expect(failed.parentTraceId).toBe(events[0].traceId);
        expect(failed.errorMessage).toContain('analysis-engine 502 Bad Gateway');
        expect(failed.resultSummary).toBeUndefined();
    });

    it('Error 以外 (= string throw) でも errorMessage が落ちずに記録される', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        await expect(
            tracePlanStep(ctx, 'specialists', { symbol: 'XAUUSD' }, async () => {
                // eslint-disable-next-line @typescript-eslint/only-throw-error -- 非 Error throw のテスト
                throw 'plain string error';
            }),
        ).rejects.toBe('plain string error');

        const failed = sink.events[1];
        expect(failed.kind).toBe('adk.subagent.failed');
        expect(failed.errorMessage).toContain('plain string error');
    });

    it('unknown 型 (= number throw 等) でも fallback "unknown error" が入る', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        await expect(
            tracePlanStep(ctx, 'lens_aggregation', { symbol: 'XAUUSD' }, async () => {
                // eslint-disable-next-line @typescript-eslint/only-throw-error -- 非 Error throw のテスト
                throw 42;
            }),
        ).rejects.toBe(42);

        const failed = sink.events[1];
        expect(failed.kind).toBe('adk.subagent.failed');
        expect(failed.errorMessage).toBe('unknown error');
    });
});

describe('tracePlanStep: trace sink の例外で fn の正常完了を壊さない', () => {
    it('sink.record が同期 throw しても fn の戻り値はそのまま返る', async () => {
        const throwingSink: TraceSink = {
            record(_event: AdkTraceEvent) {
                throw new Error('sink failure');
            },
        };
        const ctx = makeCtx(throwingSink);

        const result = await tracePlanStep(ctx, 'plan_ai', { symbol: 'XAUUSD' }, async () => {
            return 'ok';
        });

        expect(result).toBe('ok');
    });

    it('sink.record が Promise reject しても fn の戻り値はそのまま返る', async () => {
        const rejectingSink: TraceSink = {
            record(_event: AdkTraceEvent) {
                return Promise.reject(new Error('async sink failure'));
            },
        };
        const ctx = makeCtx(rejectingSink);

        const result = await tracePlanStep(ctx, 'plan_ai', { symbol: 'XAUUSD' }, async () => {
            return 'ok';
        });

        expect(result).toBe('ok');
    });
});
