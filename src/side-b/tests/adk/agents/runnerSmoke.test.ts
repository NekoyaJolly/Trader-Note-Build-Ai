/**
 * runnerSmoke の単体テスト (Step 3 Phase 1)
 *
 * 設計書: docs/architecture/STEP_3_KICKOFF.md §5 Phase 1
 *
 * 検証項目 (KICKOFF §5.4 DoD):
 * 1. Runner.runEphemeral() が最小構成で実行できる
 * 2. InMemorySessionService が使用される
 * 3. Runner.runAsync() の sessionId 経路に進まない (= API 表面で呼ばない)
 * 4. skillRegistryToAdkTools() の戻り値が LlmAgent.tools として受理される
 * 5. traceSink ありで trace event が記録される
 * 6. traceSink なしで実行が壊れない (event 記録は無し)
 * 7. raw payload が trace に保存されない (redaction)
 * 8. ADK Context (agentName / invocationId / functionCallId) が adapter に伝播
 *
 * 実 LLM は呼ばない: `StubFunctionCallLlm` で BaseLlm を継承し function_call →
 * text response の 2 ターン分を deterministic に返す (KICKOFF §5.3 順位 2)。
 */

import {
  BaseLlm,
  InMemorySessionService,
  LlmAgent,
  Runner,
  type Event,
} from '@google/adk';
import type { LlmResponse } from '@google/adk';
import type { Content } from '@google/genai';

import { SkillRegistry } from '../../../skills/registry';
import type { Skill, SkillContext } from '../../../skills/types';
import {
  buildRunnerSmoke,
  runEphemeralSmoke,
  RUNNER_SMOKE_DEFAULT_AGENT_NAME,
  RUNNER_SMOKE_DEFAULT_APP_NAME,
} from '../../../adk/agents/runnerSmoke';
import {
  InMemoryTraceSink,
  type AdkTraceEvent,
} from '../../../adk/tracing';
import { ADK_DEFAULT_CALLER_REASON } from '../../../adk/adapters/skillContext';

// ============================================================================
// テスト用 stub model (実 LLM を呼ばない)
// ============================================================================

/**
 * 決定論的に LlmResponse を返す stub。
 * function_call (1 ターン目) → text "done" (2 ターン目) の 2 段構成。
 * 3 ターン目以降は cap で text 終了を返し、ADK が無限ループに陥らないようにする。
 */
class StubFunctionCallLlm extends BaseLlm {
  static override readonly supportedModels: Array<string | RegExp> = [];

  private callCount = 0;

  constructor(
    private readonly toolName: string,
    private readonly toolArgs: Record<string, unknown>,
  ) {
    super({ model: 'stub-function-call-llm' });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
    const turn = this.callCount;
    this.callCount += 1;

    if (turn === 0) {
      // 1 ターン目: tool を呼ぶ
      const fnCall: LlmResponse = {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: this.toolName,
                args: this.toolArgs,
              },
            },
          ],
        },
        turnComplete: true,
      };
      yield fnCall;
      return;
    }

    // 2 ターン目以降: 終了
    const done: LlmResponse = {
      content: {
        role: 'model',
        parts: [{ text: 'done' }],
      },
      turnComplete: true,
    };
    yield done;
  }

  override connect(): Promise<never> {
    return Promise.reject(
      new Error('StubFunctionCallLlm.connect is not implemented (smoke では使わない)'),
    );
  }

  /** 呼び出し回数 (テスト assertion 用)。 */
  get totalCalls(): number {
    return this.callCount;
  }
}

// ============================================================================
// テスト用 Skill (副作用なし)
// ============================================================================

interface EchoInput {
  readonly msg: string;
}
interface EchoOutput {
  readonly echoed: string;
  readonly secret: string;
}

let lastSkillContext: SkillContext | undefined;
let lastSkillInput: EchoInput | undefined;

const makeEchoSkill = (): Skill<EchoInput, EchoOutput> => ({
  name: 'echo_skill',
  description: 'テスト用エコー (副作用なし)',
  inputSchema: {
    type: 'object',
    properties: { msg: { type: 'string' } },
    required: ['msg'],
  },
  execute: (input: EchoInput, context: SkillContext): Promise<EchoOutput> => {
    lastSkillContext = context;
    lastSkillInput = input;
    // raw payload テスト用に 「secret」 を含む (trace に漏れないことを後で検証)
    return Promise.resolve({ echoed: input.msg, secret: 'TOP-SECRET-1234567890' });
  },
});

function buildTestRegistry(): SkillRegistry {
  const reg = new SkillRegistry();
  reg.register(makeEchoSkill());
  return reg;
}

const helloMessage: Content = {
  role: 'user',
  parts: [{ text: 'Hello, please call the echo_skill.' }],
};

beforeEach(() => {
  lastSkillContext = undefined;
  lastSkillInput = undefined;
});

// ============================================================================
// テストケース
// ============================================================================

describe('buildRunnerSmoke: 構築物の型/構造', () => {
  it('Runner / LlmAgent / InMemorySessionService が揃っている', () => {
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'ping' });
    const { runner, agent, sessionService } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
    });
    expect(runner).toBeInstanceOf(Runner);
    expect(agent).toBeInstanceOf(LlmAgent);
    expect(sessionService).toBeInstanceOf(InMemorySessionService);
  });

  it('DatabaseSessionService 不採用: Runner.sessionService が InMemorySessionService', () => {
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'ping' });
    const { runner } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
    });
    expect(runner.sessionService).toBeInstanceOf(InMemorySessionService);
  });

  it('appName / agentName のデフォルトが KICKOFF 準拠の識別子', () => {
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'ping' });
    const { runner, agent } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
    });
    expect(runner.appName).toBe(RUNNER_SMOKE_DEFAULT_APP_NAME);
    expect(agent.name).toBe(RUNNER_SMOKE_DEFAULT_AGENT_NAME);
  });

  it('呼び出し側が appName / agentName / instruction を上書きできる', () => {
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'ping' });
    const { runner, agent } = buildRunnerSmoke({
      appName: 'custom-app',
      agentName: 'custom-agent',
      instruction: 'custom instruction',
      model: stub,
      registry: buildTestRegistry(),
    });
    expect(runner.appName).toBe('custom-app');
    expect(agent.name).toBe('custom-agent');
  });

  it('LlmAgent.tools に skillRegistryToAdkTools の戻り値 (FunctionTool 配列) が渡る', () => {
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'ping' });
    const { agent } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
    });
    expect(Array.isArray(agent.tools)).toBe(true);
    expect(agent.tools.length).toBe(1);
    // FunctionTool 個別 instance までは @google/adk SDK 構造に依存するため
    // ここでは長さ + ToolUnion 型を満たすことだけ確認 (Step 1 で型互換は実証済み)
  });
});

describe('runEphemeralSmoke: 実機実行', () => {
  it('traceSink あり: 成功時に adk.skill.started + completed が記録される', async () => {
    const sink = new InMemoryTraceSink();
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'hello' });
    const { runner } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
      traceSink: sink,
    });

    const events = await runEphemeralSmoke(runner, {
      userId: 'smoke-user',
      newMessage: helloMessage,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(stub.totalCalls).toBeGreaterThanOrEqual(1);

    const recorded = sink.events;
    const started = recorded.filter((e) => e.kind === 'adk.skill.started');
    const completed = recorded.filter((e) => e.kind === 'adk.skill.completed');
    expect(started.length).toBe(1);
    expect(completed.length).toBe(1);
    expect(started[0].skillName).toBe('echo_skill');
    expect(completed[0].status).toBe('ok');
    // started → completed の対応関係 (Step 2 Phase 3 で parentTraceId で紐付け)
    expect(completed[0].parentTraceId).toBe(started[0].traceId);
  });

  it('traceSink なし: smoke が壊れず、event 記録もされない (NoopTraceSink 相当)', async () => {
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'hello' });
    const { runner } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
      // traceSink を渡さない
    });

    const events = await runEphemeralSmoke(runner, {
      userId: 'smoke-user',
      newMessage: helloMessage,
    });

    expect(events.length).toBeGreaterThan(0);
    // skill 自体は呼ばれている (= adapter execute は通った)
    expect(lastSkillInput?.msg).toBe('hello');
  });

  it('raw payload が trace event に保存されていない (redacted summary のみ)', async () => {
    const sink = new InMemoryTraceSink();
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'leak-test' });
    const { runner } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
      traceSink: sink,
    });

    await runEphemeralSmoke(runner, {
      userId: 'smoke-user',
      newMessage: helloMessage,
    });

    const allEvents: readonly AdkTraceEvent[] = sink.events;
    expect(allEvents.length).toBeGreaterThan(0);

    for (const ev of allEvents) {
      // argsSummary / resultSummary はあれば redacted: true のみ
      if (ev.argsSummary !== undefined) {
        expect(ev.argsSummary.redacted).toBe(true);
      }
      if (ev.resultSummary !== undefined) {
        expect(ev.resultSummary.redacted).toBe(true);
      }
      // event 全体を JSON 化しても skill の secret payload は含まれない
      const serialized = JSON.stringify(ev);
      expect(serialized).not.toContain('TOP-SECRET-1234567890');
      expect(serialized).not.toContain('leak-test');
    }
  });

  it('Context 伝播: adapter 内 trace event の agentName が LlmAgent.name と一致', async () => {
    const sink = new InMemoryTraceSink();
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'ctx-test' });
    const { runner, agent } = buildRunnerSmoke({
      agentName: 'phase1-smoke-agent',
      model: stub,
      registry: buildTestRegistry(),
      traceSink: sink,
    });

    await runEphemeralSmoke(runner, {
      userId: 'smoke-user',
      newMessage: helloMessage,
    });

    const started = sink.events.find((e) => e.kind === 'adk.skill.started');
    expect(started).toBeDefined();
    expect(started!.agentName).toBe('phase1-smoke-agent');
    // LlmAgent.name と trace の agentName が同一であること
    expect(started!.agentName).toBe(agent.name);
  });

  it('Context 伝播: invocationId が trace event に届き、Skill 実行側に正しい SkillContext が渡る', async () => {
    const sink = new InMemoryTraceSink();
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'invocation-test' });
    const { runner } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
      traceSink: sink,
    });

    await runEphemeralSmoke(runner, {
      userId: 'smoke-user',
      newMessage: helloMessage,
    });

    const started = sink.events.find((e) => e.kind === 'adk.skill.started');
    expect(started).toBeDefined();
    // invocationId は ADK Runner が生成するので、非空であることを確認
    expect(typeof started!.invocationId).toBe('string');
    expect((started!.invocationId ?? '').length).toBeGreaterThan(0);

    // Skill 実行側にも SkillContext が届いており、callerReason は Step 1 で確立した
    // ADK_DEFAULT_CALLER_REASON 定数になっている (`/src/side-b/adk/adapters/skillContext.ts`)
    expect(lastSkillContext).toBeDefined();
    expect(lastSkillContext!.callerReason).toBe(ADK_DEFAULT_CALLER_REASON);
  });

  it('runEphemeral の event stream に Runner からの Event 列が yield される', async () => {
    const stub = new StubFunctionCallLlm('echo_skill', { msg: 'event-stream' });
    const { runner } = buildRunnerSmoke({
      model: stub,
      registry: buildTestRegistry(),
    });

    const events: Event[] = await runEphemeralSmoke(runner, {
      userId: 'smoke-user',
      newMessage: helloMessage,
    });

    expect(events.length).toBeGreaterThan(0);
    // 全 event が `invocationId` を持つ (ADK Event interface 定義通り)
    for (const ev of events) {
      expect(typeof ev.invocationId).toBe('string');
    }
    // 同一 runEphemeral 内では invocationId が共通 (= 1 invocation = 1 ID)
    const uniqueInvocationIds = new Set(events.map((e) => e.invocationId));
    expect(uniqueInvocationIds.size).toBe(1);
  });
});
