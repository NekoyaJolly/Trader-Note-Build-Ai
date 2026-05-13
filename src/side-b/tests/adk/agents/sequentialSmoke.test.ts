/**
 * sequentialSmoke の単体テスト (Step 3 Phase 2)
 *
 * 設計書: docs/architecture/STEP_3_KICKOFF.md §5 Phase 2 / §5.7 DoD
 *
 * 検証項目 (KICKOFF §5.7 DoD):
 * 1. toy sub-agent が指定順に実行される
 * 2. SequentialAgent の実行単位を trace event として記録できる
 * 3. error ケースで failed trace が記録される
 * 4. started が completed / failed のどちらかで閉じる
 * 5. raw payload が trace に保存されない
 * 6. SequentialAgent の知見が PDCALoop wrapper 設計に転用可能 (NOTES に記録)
 * 7. PDCALoop には接続していない (本 file は agent/ から import しない)
 *
 * 実 LLM は呼ばない: SmokeSubAgent は BaseAgent を直接 subclass しており LLM 経由しない。
 */

import { InMemorySessionService, Runner, SequentialAgent } from '@google/adk';
import type { Content } from '@google/genai';

import {
  buildSequentialSmoke,
  extractSubAgentOrder,
  runSequentialSmoke,
  SmokeSubAgent,
  SEQUENTIAL_SMOKE_DEFAULT_AGENT_NAME,
  SEQUENTIAL_SMOKE_DEFAULT_APP_NAME,
  SUBAGENT_SMOKE_CALLER_REASON,
} from '../../../adk/agents/sequentialSmoke';
import { InMemoryTraceSink, type AdkTraceEvent } from '../../../adk/tracing';

// ============================================================================
// テスト共通
// ============================================================================

const helloMessage: Content = {
  role: 'user',
  parts: [{ text: 'sequential smoke trigger' }],
};

// ============================================================================
// buildSequentialSmoke: 構築物
// ============================================================================

describe('buildSequentialSmoke: 構築物', () => {
  it('SequentialAgent / Runner / InMemorySessionService が揃う', () => {
    const a = new SmokeSubAgent({ name: 'step-a' });
    const b = new SmokeSubAgent({ name: 'step-b' });
    const { runner, rootAgent, sessionService } = buildSequentialSmoke({
      subAgents: [a, b],
    });
    expect(runner).toBeInstanceOf(Runner);
    expect(rootAgent).toBeInstanceOf(SequentialAgent);
    expect(sessionService).toBeInstanceOf(InMemorySessionService);
  });

  it('Runner.sessionService が InMemorySessionService (DatabaseSessionService 不採用)', () => {
    const { runner } = buildSequentialSmoke({
      subAgents: [new SmokeSubAgent({ name: 'only' })],
    });
    expect(runner.sessionService).toBeInstanceOf(InMemorySessionService);
  });

  it('appName / agentName のデフォルトが Phase 2 用識別子', () => {
    const { runner, rootAgent } = buildSequentialSmoke({
      subAgents: [new SmokeSubAgent({ name: 'only' })],
    });
    expect(runner.appName).toBe(SEQUENTIAL_SMOKE_DEFAULT_APP_NAME);
    expect(rootAgent.name).toBe(SEQUENTIAL_SMOKE_DEFAULT_AGENT_NAME);
  });

  it('subAgents が空だと throw する (構築段階で防御)', () => {
    expect(() =>
      buildSequentialSmoke({ subAgents: [] }),
    ).toThrow(/subAgents must be non-empty/);
  });

  it('sub-agent が SequentialAgent.subAgents に順序保持で渡る', () => {
    const a = new SmokeSubAgent({ name: 'first' });
    const b = new SmokeSubAgent({ name: 'second' });
    const c = new SmokeSubAgent({ name: 'third' });
    const { rootAgent } = buildSequentialSmoke({ subAgents: [a, b, c] });
    expect(rootAgent.subAgents.map((sa) => sa.name)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});

// ============================================================================
// runSequentialSmoke: 順序固定実行
// ============================================================================

describe('runSequentialSmoke: 実機実行 (順序固定)', () => {
  it('指定した順で sub-agent が実行される (Event.author 順序)', async () => {
    const subA = new SmokeSubAgent({ name: 'sub_a', output: 'A done' });
    const subB = new SmokeSubAgent({ name: 'sub_b', output: 'B done' });
    const subC = new SmokeSubAgent({ name: 'sub_c', output: 'C done' });

    const { runner } = buildSequentialSmoke({
      subAgents: [subA, subB, subC],
    });

    const events = await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });

    const order = extractSubAgentOrder(events);
    expect(order).toEqual(['sub_a', 'sub_b', 'sub_c']);
  });

  it('同一 runEphemeral 内の全 Event が共通 invocationId を持つ', async () => {
    const subA = new SmokeSubAgent({ name: 'sub_a' });
    const subB = new SmokeSubAgent({ name: 'sub_b' });
    const { runner } = buildSequentialSmoke({
      subAgents: [subA, subB],
    });

    const events = await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });

    expect(events.length).toBeGreaterThan(0);
    const ids = new Set(events.map((e) => e.invocationId));
    expect(ids.size).toBe(1);
  });
});

// ============================================================================
// trace event 記録
// ============================================================================

describe('sub-agent 単位の trace event 記録', () => {
  it('成功時: 各 sub-agent ごとに adk.subagent.started + completed が対で記録される', async () => {
    const sink = new InMemoryTraceSink();
    const subA = new SmokeSubAgent({ name: 'plan', traceSink: sink });
    const subB = new SmokeSubAgent({ name: 'do', traceSink: sink });
    const subC = new SmokeSubAgent({ name: 'check', traceSink: sink });

    const { runner } = buildSequentialSmoke({
      subAgents: [subA, subB, subC],
    });

    await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });

    const recorded = sink.events;
    const started = recorded.filter((e) => e.kind === 'adk.subagent.started');
    const completed = recorded.filter((e) => e.kind === 'adk.subagent.completed');
    const failed = recorded.filter((e) => e.kind === 'adk.subagent.failed');

    expect(started.length).toBe(3);
    expect(completed.length).toBe(3);
    expect(failed.length).toBe(0);

    // step 識別子 (skillName) が sub-agent 名と一致
    expect(started.map((e) => e.skillName)).toEqual(['plan', 'do', 'check']);
    expect(completed.map((e) => e.skillName)).toEqual(['plan', 'do', 'check']);

    // 各 sub-agent の started → completed が parentTraceId で紐付く
    for (let i = 0; i < started.length; i++) {
      expect(completed[i].parentTraceId).toBe(started[i].traceId);
      expect(completed[i].status).toBe('ok');
      // 開始 → 完了は同一 invocationId を共有
      expect(completed[i].invocationId).toBe(started[i].invocationId);
    }
  });

  it('error ケース: sub-agent が throw すると adk.subagent.failed が記録される', async () => {
    const sink = new InMemoryTraceSink();
    const subA = new SmokeSubAgent({ name: 'before-failure', traceSink: sink });
    const subB = new SmokeSubAgent({
      name: 'fails',
      traceSink: sink,
      shouldThrow: true,
      throwMessage: 'intentional failure for phase 2 smoke',
    });
    const subC = new SmokeSubAgent({ name: 'after-failure', traceSink: sink });

    const { runner } = buildSequentialSmoke({
      subAgents: [subA, subB, subC],
    });

    // SequentialAgent は sub-agent throw を伝播する想定 (実機確認)
    await expect(
      runSequentialSmoke(runner, {
        userId: 'phase2-user',
        newMessage: helloMessage,
      }),
    ).rejects.toThrow(/intentional failure/);

    const recorded = sink.events;
    const startedFails = recorded.filter(
      (e) => e.kind === 'adk.subagent.started' && e.skillName === 'fails',
    );
    const failedEvents = recorded.filter((e) => e.kind === 'adk.subagent.failed');

    expect(startedFails.length).toBe(1);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].skillName).toBe('fails');
    expect(failedEvents[0].status).toBe('thrown');
    expect(failedEvents[0].errorMessage).toContain('intentional failure');
    expect(failedEvents[0].parentTraceId).toBe(startedFails[0].traceId);

    // 失敗 sub-agent の前 (before-failure) は completed が記録される
    const beforeCompleted = recorded.find(
      (e) => e.kind === 'adk.subagent.completed' && e.skillName === 'before-failure',
    );
    expect(beforeCompleted).toBeDefined();

    // 失敗 sub-agent の後 (after-failure) は started すらされない (SequentialAgent が中断)
    const afterStarted = recorded.find(
      (e) => e.kind === 'adk.subagent.started' && e.skillName === 'after-failure',
    );
    expect(afterStarted).toBeUndefined();
  });

  it('started は必ず completed または failed で閉じる (orphan started 不在)', async () => {
    const sink = new InMemoryTraceSink();
    const subA = new SmokeSubAgent({ name: 'a', traceSink: sink });
    const subB = new SmokeSubAgent({ name: 'b', traceSink: sink });

    const { runner } = buildSequentialSmoke({
      subAgents: [subA, subB],
    });

    await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });

    const started = sink.events.filter((e) => e.kind === 'adk.subagent.started');
    const closers = sink.events.filter(
      (e) =>
        e.kind === 'adk.subagent.completed' || e.kind === 'adk.subagent.failed',
    );

    // 各 started の traceId が、closer の parentTraceId として現れる
    const startedIds = new Set(started.map((e) => e.traceId));
    const closerParents = new Set(closers.map((e) => e.parentTraceId));
    for (const id of startedIds) {
      expect(closerParents.has(id)).toBe(true);
    }
    expect(closers.length).toBe(started.length);
  });

  it('traceSink なし: smoke は壊れず、event は記録されない', async () => {
    const subA = new SmokeSubAgent({ name: 'no-trace-a' });
    const subB = new SmokeSubAgent({ name: 'no-trace-b' });

    const { runner } = buildSequentialSmoke({
      subAgents: [subA, subB],
    });

    const events = await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });

    // Runner からは Event が返るが、TraceSink には何も流れない (= traceSink 未渡しで動く)
    expect(events.length).toBeGreaterThan(0);
    const order = extractSubAgentOrder(events);
    expect(order).toEqual(['no-trace-a', 'no-trace-b']);
  });

  it('traceSink.record() が同期 throw しても sub-agent 実行は壊れない', async () => {
    const failingSink = {
      record: (): void => {
        throw new Error('sink throws synchronously');
      },
    };
    const subA = new SmokeSubAgent({ name: 'sub-with-failing-sink', traceSink: failingSink });
    const { runner } = buildSequentialSmoke({ subAgents: [subA] });

    // record の throw は内部で握りつぶされ、smoke は正常完走する
    const events = await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(extractSubAgentOrder(events)).toEqual(['sub-with-failing-sink']);
  });

  it('traceSink.record() が Promise reject しても sub-agent 実行は壊れない', async () => {
    const rejectingSink = {
      record: (): Promise<void> => Promise.reject(new Error('sink rejects async')),
    };
    const subA = new SmokeSubAgent({ name: 'sub-with-rejecting-sink', traceSink: rejectingSink });
    const { runner } = buildSequentialSmoke({ subAgents: [subA] });

    const events = await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(extractSubAgentOrder(events)).toEqual(['sub-with-rejecting-sink']);
  });
});

describe('error message 短縮 (DEFAULT_ERROR_MESSAGE_MAX)', () => {
  it('巨大な throw message は failed event の errorMessage で短縮される', async () => {
    const sink = new InMemoryTraceSink();
    const longMessage = 'X'.repeat(10_000); // 10KB の巨大メッセージ
    const subA = new SmokeSubAgent({
      name: 'long-throw',
      traceSink: sink,
      shouldThrow: true,
      throwMessage: longMessage,
    });
    const { runner } = buildSequentialSmoke({ subAgents: [subA] });

    await expect(
      runSequentialSmoke(runner, {
        userId: 'phase2-user',
        newMessage: helloMessage,
      }),
    ).rejects.toThrow();

    const failed = sink.events.find((e) => e.kind === 'adk.subagent.failed');
    expect(failed).toBeDefined();
    // 短縮後の errorMessage は元の 10KB より十分短い (Step 2 の DEFAULT_ERROR_MESSAGE_MAX = 512)
    expect((failed?.errorMessage ?? '').length).toBeLessThan(longMessage.length);
    expect((failed?.errorMessage ?? '').length).toBeLessThanOrEqual(600); // 余裕を持って 600 で判定
  });
});

// ============================================================================
// redaction
// ============================================================================

describe('raw payload 非保存 (redaction)', () => {
  it('trace event を JSON 化しても sub-agent の output 文字列が漏れない', async () => {
    const sink = new InMemoryTraceSink();
    const secret = 'TOP-SECRET-PHASE2-PAYLOAD';
    const subA = new SmokeSubAgent({
      name: 'leaky-step',
      traceSink: sink,
      output: secret, // この値が Event の content には載るが、trace event には載らない
    });

    const { runner } = buildSequentialSmoke({ subAgents: [subA] });
    await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });

    const recorded: readonly AdkTraceEvent[] = sink.events;
    expect(recorded.length).toBeGreaterThan(0);
    for (const ev of recorded) {
      const serialized = JSON.stringify(ev);
      expect(serialized).not.toContain(secret);
      // argsSummary / resultSummary は本 sub-agent では使わないが、存在するなら redacted: true
      if (ev.argsSummary !== undefined) {
        expect(ev.argsSummary.redacted).toBe(true);
      }
      if (ev.resultSummary !== undefined) {
        expect(ev.resultSummary.redacted).toBe(true);
      }
    }
  });

  it('callerReason は固定値 (Step 1/2 と区別する Phase 2 専用識別子)', async () => {
    const sink = new InMemoryTraceSink();
    const subA = new SmokeSubAgent({ name: 'caller-check', traceSink: sink });
    const { runner } = buildSequentialSmoke({ subAgents: [subA] });
    await runSequentialSmoke(runner, {
      userId: 'phase2-user',
      newMessage: helloMessage,
    });

    for (const ev of sink.events) {
      expect(ev.callerReason).toBe(SUBAGENT_SMOKE_CALLER_REASON);
    }
  });
});

// ============================================================================
// extractSubAgentOrder ヘルパー
// ============================================================================

describe('extractSubAgentOrder ヘルパー', () => {
  it('user author event を除外する', () => {
    const order = extractSubAgentOrder([
      { author: 'user', invocationId: 'i1' } as never,
      { author: 'sub_a', invocationId: 'i1' } as never,
      { author: 'sub_b', invocationId: 'i1' } as never,
    ]);
    expect(order).toEqual(['sub_a', 'sub_b']);
  });

  it('同じ author の連続を 1 件に正規化する', () => {
    const order = extractSubAgentOrder([
      { author: 'sub_a', invocationId: 'i1' } as never,
      { author: 'sub_a', invocationId: 'i1' } as never,
      { author: 'sub_b', invocationId: 'i1' } as never,
      { author: 'sub_a', invocationId: 'i1' } as never,
    ]);
    expect(order).toEqual(['sub_a', 'sub_b', 'sub_a']);
  });
});
