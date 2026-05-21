/**
 * tracePdcaState ユニットテスト (P3b)
 *
 * 対象: src/side-b/adk/tracing/pdcaStateTrace.ts
 *
 * 検証観点 (planStepTrace.test.ts と同パターン、kind だけ違う):
 *   - 成功: started + completed の 2 event が emit され、kind が `pdca.state.*`
 *   - 失敗: started + failed の 2 event が emit され、errorMessage が含まれる
 *   - traceId / parentTraceId の紐付けが成立する
 *   - 同期 / 非同期 fn どちらも受けられる (= state handler の sync/async 混在に対応)
 *   - sink throw でも fn の正常完了を壊さない
 *   - fn の throw 値はそのまま再 throw される
 */

import { InMemoryTraceSink } from '../../../adk/tracing/inMemoryTraceSink';
import {
    tracePdcaState,
    type PdcaStateTraceContext,
} from '../../../adk/tracing/pdcaStateTrace';
import type { TraceSink } from '../../../adk/tracing/traceSink';
import type { AdkTraceEvent } from '../../../adk/tracing/traceTypes';

function makeCtx(sink: TraceSink): PdcaStateTraceContext {
    return {
        sink,
        agentName: 'pdcaLoop',
        invocationId: 'tick-1',
        callerReason: 'pdca-state-machine',
    };
}

describe('tracePdcaState: 成功時', () => {
    it('started + completed の 2 event を emit し、kind が pdca.state.* になる', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        const result = await tracePdcaState(
            ctx,
            'MONITORING',
            { cycle: 42, state: 'MONITORING', marketOpen: true },
            () => ({
                state: 'EVALUATING_ENTRY' as const,
                action: '条件接近',
                nextCheckMs: 1000,
            }),
        );

        expect(result.state).toBe('EVALUATING_ENTRY');

        const events = sink.events;
        expect(events).toHaveLength(2);
        expect(events[0].kind).toBe('pdca.state.started');
        expect(events[0].skillName).toBe('MONITORING');
        expect(events[0].callerReason).toBe('pdca-state-machine');
        expect(events[1].kind).toBe('pdca.state.completed');
        expect(events[1].status).toBe('ok');
        expect(events[1].parentTraceId).toBe(events[0].traceId);
    });

    it('async ハンドラ (= handleReflecting 相当) も受けられる', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        const result = await tracePdcaState(
            ctx,
            'REFLECTING',
            { cycle: 100 },
            async () => {
                await new Promise((r) => setTimeout(r, 5));
                return { state: 'IDLE' as const, action: 'reflection 完了', nextCheckMs: 0 };
            },
        );

        expect(result.action).toBe('reflection 完了');
        const completed = sink.events[1];
        expect(completed.kind).toBe('pdca.state.completed');
        expect(completed.durationMs).toBeGreaterThanOrEqual(5);
    });

    it('args / result は TracePayloadSummary に縮約される', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        await tracePdcaState(
            ctx,
            'SESSION_OPEN',
            { cycle: 3, state: 'SESSION_OPEN', marketOpen: true },
            () => ({ state: 'MONITORING' as const, action: '監視へ', nextCheckMs: 500 }),
        );

        const [started, completed] = sink.events;
        expect(started.argsSummary?.redacted).toBe(true);
        expect(started.argsSummary?.topLevelKeys).toEqual(
            expect.arrayContaining(['cycle', 'state', 'marketOpen']),
        );
        expect(completed.resultSummary?.topLevelKeys).toEqual(
            expect.arrayContaining(['state', 'action', 'nextCheckMs']),
        );
    });
});

describe('tracePdcaState: 失敗時', () => {
    it('failed event を emit し、fn の throw 値は再 throw される', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        const boom = new Error('handleReflecting に渡された AgentMemory が壊れている');
        await expect(
            tracePdcaState(ctx, 'REFLECTING', { cycle: 50 }, async () => {
                throw boom;
            }),
        ).rejects.toBe(boom);

        expect(sink.events).toHaveLength(2);
        const failed = sink.events[1];
        expect(failed.kind).toBe('pdca.state.failed');
        expect(failed.status).toBe('thrown');
        expect(failed.errorMessage).toContain('AgentMemory が壊れている');
    });

    it('非 Error (= string) throw でも errorMessage が落ちずに記録される', async () => {
        const sink = new InMemoryTraceSink();
        const ctx = makeCtx(sink);

        await expect(
            tracePdcaState(ctx, 'IDLE', { cycle: 1 }, () => {
                // eslint-disable-next-line @typescript-eslint/only-throw-error -- 非 Error throw のテスト
                throw 'plain string from handler';
            }),
        ).rejects.toBe('plain string from handler');

        expect(sink.events[1].errorMessage).toContain('plain string from handler');
    });
});

describe('tracePdcaState: sink の例外で fn の正常完了を壊さない', () => {
    it('sink.record が同期 throw しても fn の戻り値はそのまま返る', async () => {
        const throwingSink: TraceSink = {
            record(_event: AdkTraceEvent) {
                throw new Error('sink failure');
            },
        };
        const ctx = makeCtx(throwingSink);

        const result = await tracePdcaState(ctx, 'IDLE', { cycle: 1 }, () => 'ok-sync');
        expect(result).toBe('ok-sync');
    });

    it('sink.record が Promise reject でも fn の戻り値はそのまま返る', async () => {
        const rejectingSink: TraceSink = {
            record(_event: AdkTraceEvent) {
                return Promise.reject(new Error('async sink failure'));
            },
        };
        const ctx = makeCtx(rejectingSink);

        const result = await tracePdcaState(ctx, 'IDLE', { cycle: 1 }, async () => 'ok-async');
        expect(result).toBe('ok-async');
    });
});
