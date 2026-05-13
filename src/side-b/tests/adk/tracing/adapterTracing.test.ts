/**
 * skillRegistryToAdkTools の tracing 統合テスト (Step 2 Phase 3)
 *
 * 設計書: docs/architecture/STEP_2_KICKOFF.md §6 Phase 3
 *
 * 検証項目:
 * 1. 既存挙動 (options なし): Step 1 等価性が壊れていない
 * 2. traceSink 指定時: 成功で `started` + `completed` の 2 event
 * 3. traceSink 指定時: SkillResult error で `started` + `failed` (status: 'error')
 * 4. traceSink.record() の throw / reject で Skill 実行が壊れない
 * 5. argsSummary / resultSummary が含まれ raw payload が漏出しない
 * 6. durationMs / parentTraceId が記録される
 * 7. invocationId / functionCallId が ADK Context から伝播される
 */

import { SkillRegistry } from '../../../skills/registry';
import type { Skill, SkillContext, SkillResult } from '../../../skills/types';
import { skillRegistryToAdkTools } from '../../../adk/adapters/skillRegistryToAdkTools';
import { createMinimalAdkContext } from '../../../adk/adapters/_testHelpers';
import { ADK_DEFAULT_CALLER_REASON } from '../../../adk/adapters/skillContext';
import {
  InMemoryTraceSink,
  type AdkTraceEvent,
  type TraceSink,
} from '../../../adk/tracing';

// ============================================================================
// テスト用 Skill
// ============================================================================

const makeOkSkill = (): Skill<{ msg: string }, { echoed: string; secret: string }> => ({
  name: 'mock_ok',
  description: '成功を返す',
  inputSchema: {
    type: 'object',
    properties: { msg: { type: 'string' } },
    required: ['msg'],
  },
  execute: (input: { msg: string }): Promise<{ echoed: string; secret: string }> => {
    return Promise.resolve({ echoed: input.msg, secret: 'TOP-SECRET-12345' });
  },
});

const makeErrorSkill = (): Skill<{ reason: string }, never> => ({
  name: 'mock_error',
  description: '必ず throw',
  inputSchema: {
    type: 'object',
    properties: { reason: { type: 'string' } },
    required: ['reason'],
  },
  execute: (input: { reason: string }): Promise<never> => {
    return Promise.reject(new Error(`boom: ${input.reason}`));
  },
});

// ============================================================================
// 1. 既存挙動 (options なし)
// ============================================================================

describe('skillRegistryToAdkTools: 既存挙動維持 (options なし)', () => {
  it('options なしで呼んでも従来通り FunctionTool[] を返す', () => {
    const registry = new SkillRegistry();
    registry.register(makeOkSkill());
    const tools = skillRegistryToAdkTools(registry);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('mock_ok');
  });

  it('options なしで runAsync を実行しても registry.invoke と等価な結果', async () => {
    const registry = new SkillRegistry();
    registry.register(makeOkSkill());
    const [tool] = skillRegistryToAdkTools(registry);
    if (!tool) throw new Error('tool not built');

    const result = (await tool.runAsync({
      args: { msg: 'hello' },
      toolContext: createMinimalAdkContext({ agentName: 'a' }),
    })) as SkillResult<{ echoed: string; secret: string }>;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.echoed).toBe('hello');
    }
  });
});

// ============================================================================
// 2. traceSink 指定時: 成功 → started + completed
// ============================================================================

describe('skillRegistryToAdkTools: 成功時の trace', () => {
  let sink: InMemoryTraceSink;
  let events: readonly AdkTraceEvent[];

  beforeEach(async () => {
    sink = new InMemoryTraceSink();
    const registry = new SkillRegistry();
    registry.register(makeOkSkill());
    const [tool] = skillRegistryToAdkTools(registry, { traceSink: sink });
    if (!tool) throw new Error('tool not built');

    await tool.runAsync({
      args: { msg: 'hi' },
      toolContext: createMinimalAdkContext({ agentName: 'discovery' }),
    });
    events = sink.events;
  });

  it('event は 2 件 (started + completed)', () => {
    expect(events).toHaveLength(2);
  });

  it('1 件目は adk.skill.started (status: started)', () => {
    const e = events[0];
    expect(e?.kind).toBe('adk.skill.started');
    expect(e?.status).toBe('started');
    expect(e?.skillName).toBe('mock_ok');
    expect(e?.agentName).toBe('discovery');
    expect(e?.callerReason).toBe(ADK_DEFAULT_CALLER_REASON);
  });

  it('2 件目は adk.skill.completed (status: ok)', () => {
    const e = events[1];
    expect(e?.kind).toBe('adk.skill.completed');
    expect(e?.status).toBe('ok');
    expect(e?.skillName).toBe('mock_ok');
  });

  it('parentTraceId で started と completed が紐付く', () => {
    const startedTraceId = events[0]?.traceId;
    const completedParentId = events[1]?.parentTraceId;
    expect(startedTraceId).toBeDefined();
    expect(completedParentId).toBe(startedTraceId);
  });

  it('durationMs が completed event に記録される (>= 0)', () => {
    const duration = events[1]?.durationMs;
    expect(duration).toBeDefined();
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('argsSummary / resultSummary が記録される (raw 値は含まない)', () => {
    const completed = events[1];
    expect(completed?.argsSummary?.redacted).toBe(true);
    expect(completed?.resultSummary?.redacted).toBe(true);

    // raw 値が漏出していないこと: secret 値が trace 全体に含まれない
    const json = JSON.stringify(events);
    expect(json).not.toContain('TOP-SECRET-12345');
  });
});

// ============================================================================
// 3. SkillResult error 時の trace
// ============================================================================

describe('skillRegistryToAdkTools: SkillResult error 時の trace', () => {
  let events: readonly AdkTraceEvent[];

  beforeEach(async () => {
    const sink = new InMemoryTraceSink();
    const registry = new SkillRegistry();
    registry.register(makeErrorSkill());
    const [tool] = skillRegistryToAdkTools(registry, { traceSink: sink });
    if (!tool) throw new Error('tool not built');

    await tool.runAsync({
      args: { reason: 'fail' },
      toolContext: createMinimalAdkContext({ agentName: 'a' }),
    });
    events = sink.events;
  });

  it('event は 2 件 (started + failed)', () => {
    expect(events).toHaveLength(2);
  });

  it('1 件目は started、2 件目は adk.skill.failed (status: error)', () => {
    expect(events[0]?.kind).toBe('adk.skill.started');
    expect(events[1]?.kind).toBe('adk.skill.failed');
    expect(events[1]?.status).toBe('error');
  });

  it('errorCode / errorMessage が記録される (短縮済み)', () => {
    const failed = events[1];
    expect(failed?.errorCode).toBeDefined();
    expect(failed?.errorMessage).toBeDefined();
    expect(failed?.errorMessage).toContain('boom');
  });

  it('resultSummary は failed event に含まれない', () => {
    expect(events[1]?.resultSummary).toBeUndefined();
  });
});

// ============================================================================
// 4. traceSink.record() の throw / reject が Skill 実行を壊さない
// ============================================================================

describe('skillRegistryToAdkTools: traceSink の例外で Skill 実行を壊さない', () => {
  it('record() が同期 throw しても Skill 実行は正常完了', async () => {
    const buggySink: TraceSink = {
      record: () => {
        throw new Error('sink internal error');
      },
    };
    const registry = new SkillRegistry();
    registry.register(makeOkSkill());
    const [tool] = skillRegistryToAdkTools(registry, { traceSink: buggySink });
    if (!tool) throw new Error('tool not built');

    const result = (await tool.runAsync({
      args: { msg: 'hi' },
      toolContext: createMinimalAdkContext({ agentName: 'a' }),
    })) as SkillResult<{ echoed: string; secret: string }>;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.echoed).toBe('hi');
  });

  it('record() が Promise reject しても Skill 実行は正常完了', async () => {
    const asyncBuggySink: TraceSink = {
      record: () => Promise.reject(new Error('async sink error')),
    };
    const registry = new SkillRegistry();
    registry.register(makeOkSkill());
    const [tool] = skillRegistryToAdkTools(registry, { traceSink: asyncBuggySink });
    if (!tool) throw new Error('tool not built');

    const result = (await tool.runAsync({
      args: { msg: 'hi' },
      toolContext: createMinimalAdkContext({ agentName: 'a' }),
    })) as SkillResult<{ echoed: string; secret: string }>;

    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// 5. invocationId / functionCallId の伝播
// ============================================================================

describe('skillRegistryToAdkTools: ADK Context 識別子の伝播', () => {
  it('Context.invocationId / functionCallId が trace event に伝播', async () => {
    const sink = new InMemoryTraceSink();
    const registry = new SkillRegistry();
    registry.register(makeOkSkill());
    const [tool] = skillRegistryToAdkTools(registry, { traceSink: sink });
    if (!tool) throw new Error('tool not built');

    // _testHelpers.createMinimalAdkContext は agentName のみセット。
    // invocationId / functionCallId を持つ拡張 mock を inline で生成。
    const baseCtx = createMinimalAdkContext({ agentName: 'a' });
    Object.defineProperty(baseCtx, 'invocationId', {
      value: 'inv-xyz',
      enumerable: true,
    });
    Object.defineProperty(baseCtx, 'functionCallId', {
      value: 'fc-001',
      enumerable: true,
    });

    await tool.runAsync({
      args: { msg: 'hi' },
      toolContext: baseCtx,
    });

    const e = sink.events[0];
    expect(e?.invocationId).toBe('inv-xyz');
    expect(e?.functionCallId).toBe('fc-001');
  });

  it('invocationId / functionCallId が無い Context でも実行できる (undefined になる)', async () => {
    const sink = new InMemoryTraceSink();
    const registry = new SkillRegistry();
    registry.register(makeOkSkill());
    const [tool] = skillRegistryToAdkTools(registry, { traceSink: sink });
    if (!tool) throw new Error('tool not built');

    await tool.runAsync({
      args: { msg: 'hi' },
      toolContext: createMinimalAdkContext({ agentName: 'a' }),
    });

    const e = sink.events[0];
    expect(e?.invocationId).toBeUndefined();
    expect(e?.functionCallId).toBeUndefined();
  });
});

// ============================================================================
// 6. registry.invoke() の SkillContext との整合性
// ============================================================================

describe('skillRegistryToAdkTools: SkillContext との整合性', () => {
  it('event の agentName / callerReason は SkillContext と一致 (Step 1 マッピング保持)', async () => {
    const sink = new InMemoryTraceSink();

    // SkillContext を観測できる echo Skill
    type EchoOut = { ctx: Pick<SkillContext, 'callerAgent' | 'callerReason'> };
    const echoSkill: Skill<{ x: number }, EchoOut> = {
      name: 'ctx_echo',
      description: 'SkillContext 観測',
      inputSchema: {
        type: 'object',
        properties: { x: { type: 'number' } },
        required: ['x'],
      },
      execute: (_input: { x: number }, ctx: SkillContext): Promise<EchoOut> => {
        return Promise.resolve({
          ctx: { callerAgent: ctx.callerAgent, callerReason: ctx.callerReason },
        });
      },
    };

    const registry = new SkillRegistry();
    registry.register(echoSkill);
    const [tool] = skillRegistryToAdkTools(registry, { traceSink: sink });
    if (!tool) throw new Error('tool not built');

    const result = (await tool.runAsync({
      args: { x: 1 },
      toolContext: createMinimalAdkContext({ agentName: 'strategist' }),
    })) as SkillResult<EchoOut>;

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Skill が受け取った ctx と trace event の値が一致
      expect(result.data.ctx.callerAgent).toBe('strategist');
      expect(sink.events[0]?.agentName).toBe('strategist');
      expect(sink.events[0]?.callerReason).toBe(ADK_DEFAULT_CALLER_REASON);
    }
  });
});
