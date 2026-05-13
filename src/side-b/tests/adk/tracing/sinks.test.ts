/**
 * NoopTraceSink / InMemoryTraceSink テスト (Step 2 Phase 2)
 *
 * 両 sink が TraceSink interface を満たし、それぞれ「何もしない」「配列に push」の
 * 期待挙動を持つことを確認する。
 */

import { NoopTraceSink } from '../../../adk/tracing/noopTraceSink';
import { InMemoryTraceSink } from '../../../adk/tracing/inMemoryTraceSink';
import type { AdkTraceEvent, TraceSink } from '../../../adk/tracing';

function makeEvent(traceId: string): AdkTraceEvent {
  return {
    kind: 'adk.skill.started',
    traceId,
    agentName: 'discovery',
    skillName: 's',
    callerReason: 'invoked-via-adk-runner',
    startedAt: new Date(),
    status: 'started',
  };
}

describe('NoopTraceSink', () => {
  it('TraceSink interface を満たす', () => {
    const sink: TraceSink = new NoopTraceSink();
    expect(typeof sink.record).toBe('function');
  });

  it('record() は void を返し、何も保存しない', () => {
    const sink = new NoopTraceSink();
    const result = sink.record(makeEvent('t-1'));
    expect(result).toBeUndefined();
  });

  it('record() は throw しない', () => {
    const sink = new NoopTraceSink();
    expect(() => sink.record(makeEvent('t-2'))).not.toThrow();
  });
});

describe('InMemoryTraceSink', () => {
  it('TraceSink interface を満たす', () => {
    const sink: TraceSink = new InMemoryTraceSink();
    expect(typeof sink.record).toBe('function');
  });

  it('初期状態で events は空', () => {
    const sink = new InMemoryTraceSink();
    expect(sink.events).toEqual([]);
  });

  it('record() で event が順に追加される', () => {
    const sink = new InMemoryTraceSink();
    const e1 = makeEvent('t-1');
    const e2 = makeEvent('t-2');
    sink.record(e1);
    sink.record(e2);
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]).toBe(e1);
    expect(sink.events[1]).toBe(e2);
  });

  it('events は readonly snapshot (push 等の破壊的変更は型レベル禁止)', () => {
    const sink = new InMemoryTraceSink();
    sink.record(makeEvent('t-1'));
    // sink.events.push(makeEvent('t-bad')) ← TS 上でエラーになる (readonly)
    expect(sink.events).toHaveLength(1);
  });

  it('clear() で全 event を破棄', () => {
    const sink = new InMemoryTraceSink();
    sink.record(makeEvent('t-1'));
    sink.record(makeEvent('t-2'));
    sink.clear();
    expect(sink.events).toEqual([]);
  });

  it('clear() 後も record() できる', () => {
    const sink = new InMemoryTraceSink();
    sink.record(makeEvent('t-1'));
    sink.clear();
    sink.record(makeEvent('t-2'));
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.traceId).toBe('t-2');
  });
});
