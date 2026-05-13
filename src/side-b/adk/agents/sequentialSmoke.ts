/**
 * sequentialSmoke: ADK SequentialAgent の toy sub-agent 構成での実機 smoke
 *
 * Step 3 Phase 2 (`STEP_3_KICKOFF.md` §5 Phase 2) で実装。
 *
 * 対応する既存実装: なし (本 Step で新規追加する ADK サイドカー)
 * ADK 化の目的:
 *   - ADK `SequentialAgent` の挙動 (順序固定実行 / state 共有 / step trace) を実機検証
 *   - Phase 3 (PDCALoop dry-run wrapper) で利用する sub-agent trace pattern を確定
 *
 * 依存方向:
 *   - 既存 `src/side-b/agent/` / `src/side-b/skills/` への参照なし (PDCALoop に触れない、KICKOFF §5.6 §3.2)
 *   - 既存から本ファイルへの import は禁止
 *
 * 設計方針:
 *   - sub-agent は **LLM を呼ばない** `SmokeSubAgent` (BaseAgent 直接サブクラス) を採用
 *     (Phase 1 の `StubFunctionCallLlm` よりさらに軽量、決定論的)
 *   - sub-agent 単位の trace event は `adk.subagent.*` kind (Step 3 Phase 2 で追加) を使い、
 *     `skillName` フィールドを step 識別子 (= sub-agent 名) として再利用 (`traceTypes.ts` 参照)
 *   - SequentialAgent / Runner / InMemorySessionService は Phase 1 と同じ構成
 *   - `runEphemeral` 経路のみ (`runAsync` の sessionId 必須経路には進まない、KICKOFF §5.4 #3)
 *
 * 本ファイルは:
 *   - 本番 SideBScheduler / Express server に組み込まない (`KICKOFF` §3.2)
 *   - DB 書き込み / 通知 / 取引判断を発生させない (`KICKOFF` §6.4 dry-run 安全)
 *   - ADK public API のみ使用 (BaseAgent / SequentialAgent / Runner / InMemorySessionService / createEvent)
 */

import { randomUUID } from 'node:crypto';

import {
  BaseAgent,
  type Event,
  InMemorySessionService,
  type InvocationContext,
  Runner,
  SequentialAgent,
  createEvent,
} from '@google/adk';
import type { Content } from '@google/genai';

import type { AdkTraceEvent, TraceSink } from '../tracing';

/** Phase 2 smoke で使用する固定 callerReason (Skill 系の ADK_DEFAULT_CALLER_REASON とは別系統)。 */
export const SUBAGENT_SMOKE_CALLER_REASON = 'invoked-via-adk-sequential-smoke';

/** デフォルト app 名 (Phase 1 と同系の識別子)。 */
export const SEQUENTIAL_SMOKE_DEFAULT_APP_NAME =
  'trader-note-build-ai-adk-sequential-smoke';

/** デフォルト SequentialAgent 名。 */
export const SEQUENTIAL_SMOKE_DEFAULT_AGENT_NAME = 'adk-sequential-smoke-root';

// ============================================================================
// SmokeSubAgent: LLM を呼ばない軽量 sub-agent
// ============================================================================

/**
 * `SmokeSubAgent` 生成オプション。
 */
export interface SmokeSubAgentOptions {
  /** sub-agent 識別子 (BaseAgent.name)。 */
  readonly name: string;
  /** sub-agent が yield する Event の `content` (`role`: 'model', `parts`: [{ text }] 想定)。 */
  readonly output?: string;
  /** trace event の出力先。未指定なら record されない (= NoopTraceSink 相当)。 */
  readonly traceSink?: TraceSink;
  /** true の場合、`runAsyncImpl` 内で意図的に throw する (error case テスト用)。 */
  readonly shouldThrow?: boolean;
  /** throw する error message (`shouldThrow=true` 時のみ参照)。 */
  readonly throwMessage?: string;
}

/**
 * LLM 非依存の deterministic sub-agent。
 *
 * SequentialAgent の sub-agent として登録され、`runAsyncImpl` が:
 * 1. `adk.subagent.started` を traceSink に record
 * 2. 1 件の Event を yield (text content)
 * 3. 成功時: `adk.subagent.completed` を record (status: 'ok')
 * 4. `shouldThrow=true` 時: 例外を throw する前に `adk.subagent.failed` を record (status: 'thrown')
 *
 * `runLiveImpl` は smoke で使わないため未実装 (call されたら throw)。
 */
export class SmokeSubAgent extends BaseAgent {
  constructor(private readonly options: SmokeSubAgentOptions) {
    super({ name: options.name });
  }

  protected override async *runAsyncImpl(
    context: InvocationContext,
  ): AsyncGenerator<Event, void, void> {
    const startedAt = new Date();
    const startedTraceId = randomUUID();
    const sink = this.options.traceSink;

    if (sink !== undefined) {
      const startedEvent: AdkTraceEvent = {
        kind: 'adk.subagent.started',
        traceId: startedTraceId,
        invocationId: context.invocationId,
        agentName: this.name,
        // skillName を step 識別子として再利用 (sub-agent 名)、traceTypes.ts §AdkTraceEventKind 参照
        skillName: this.name,
        callerReason: SUBAGENT_SMOKE_CALLER_REASON,
        startedAt,
        status: 'started',
      };
      await Promise.resolve(sink.record(startedEvent));
    }

    try {
      if (this.options.shouldThrow === true) {
        throw new Error(
          this.options.throwMessage ?? `SmokeSubAgent ${this.name} intentionally threw`,
        );
      }

      // Runner event stream に流す 1 件の text event
      const content: Content = {
        role: 'model',
        parts: [{ text: this.options.output ?? `${this.name} executed` }],
      };
      const event = createEvent({
        invocationId: context.invocationId,
        author: this.name,
        content,
      });
      yield event;

      if (sink !== undefined) {
        const endedAt = new Date();
        const completedEvent: AdkTraceEvent = {
          kind: 'adk.subagent.completed',
          traceId: randomUUID(),
          parentTraceId: startedTraceId,
          invocationId: context.invocationId,
          agentName: this.name,
          skillName: this.name,
          callerReason: SUBAGENT_SMOKE_CALLER_REASON,
          startedAt,
          endedAt,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          status: 'ok',
        };
        await Promise.resolve(sink.record(completedEvent));
      }
    } catch (err) {
      if (sink !== undefined) {
        const endedAt = new Date();
        const failedEvent: AdkTraceEvent = {
          kind: 'adk.subagent.failed',
          traceId: randomUUID(),
          parentTraceId: startedTraceId,
          invocationId: context.invocationId,
          agentName: this.name,
          skillName: this.name,
          callerReason: SUBAGENT_SMOKE_CALLER_REASON,
          startedAt,
          endedAt,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          status: 'thrown',
          errorCode: 'SUBAGENT_THROWN',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
        // record 自体の失敗で原因例外を消さないように catch (Step 2 Phase 3 と同じ握りつぶし方針)
        try {
          await Promise.resolve(sink.record(failedEvent));
        } catch {
          // intentionally swallowed
        }
      }
      throw err;
    }
  }

  protected override async *runLiveImpl(): AsyncGenerator<Event, void, void> {
    // smoke では runLive を呼ばないため未実装。型シグネチャを満たすために generator として宣言し、
    // 最初の状態遷移で必ず throw する。await の存在で `require-await` を満たし、
    // 到達不能な yield で `require-yield` を満たす (どちらも実際には実行されない)。
    await Promise.resolve();
    throw new Error(
      `SmokeSubAgent.runLiveImpl is not implemented (smoke では使わない): ${this.name}`,
    );
    // この yield には到達しない。generator 関数として宣言するために残す。
    yield undefined as never;
  }
}

// ============================================================================
// Sequential smoke factory
// ============================================================================

/**
 * Phase 2 smoke の入力。
 */
export interface SequentialSmokeConfig {
  /** ADK `Runner` の `appName`。 */
  readonly appName?: string;
  /** SequentialAgent (root agent) の `name`。 */
  readonly agentName?: string;
  /** sub-agent 群 (順序がそのまま実行順)。 */
  readonly subAgents: readonly SmokeSubAgent[];
}

/**
 * Phase 2 smoke の構築物。
 */
export interface SequentialSmokeArtifacts {
  readonly runner: Runner;
  readonly rootAgent: SequentialAgent;
  readonly sessionService: InMemorySessionService;
}

/**
 * Step 3 Phase 2 smoke の最小構成を構築する (実行はしない)。
 *
 * 構成:
 * ```
 * subAgents (SmokeSubAgent[])
 *   ↓ new SequentialAgent({ name, subAgents })
 * SequentialAgent
 *   ↓ new Runner({ appName, agent, sessionService: new InMemorySessionService() })
 * Runner
 * ```
 *
 * 注意: SequentialAgent は ADK 仕様上 root agent としても sub-agent としても使えるが、
 * 本 smoke では Runner.agent に直接渡す root agent 用途に限定する。
 */
export function buildSequentialSmoke(
  config: SequentialSmokeConfig,
): SequentialSmokeArtifacts {
  if (config.subAgents.length === 0) {
    throw new Error('buildSequentialSmoke: subAgents must be non-empty');
  }

  // SequentialAgent の subAgents は mutable BaseAgent[] 期待のため readonly を解除して渡す。
  // 本 smoke では sub-agent を構築後に変更しない (factory 内で完結) ため安全。
  const subAgentList: BaseAgent[] = config.subAgents.map((a) => a);

  const rootAgent = new SequentialAgent({
    name: config.agentName ?? SEQUENTIAL_SMOKE_DEFAULT_AGENT_NAME,
    subAgents: subAgentList,
  });

  const sessionService = new InMemorySessionService();

  const runner = new Runner({
    appName: config.appName ?? SEQUENTIAL_SMOKE_DEFAULT_APP_NAME,
    agent: rootAgent,
    sessionService,
  });

  return { runner, rootAgent, sessionService };
}

/**
 * `Runner.runEphemeral` を実行し、全 Event を順序保持で収集する。
 *
 * Phase 1 (`runnerSmoke.ts`) の `runEphemeralSmoke` と同じ手順だが、こちらは
 * SequentialAgent の sub-agent 実行順を Event.author で観測することを想定している。
 *
 * @param runner 構築済み Runner (SequentialAgent を agent に持つ)
 * @param params runEphemeral 引数 (userId / newMessage)
 * @returns Event 配列 (順序保持、各 Event.author が実行 sub-agent 名になる想定)
 */
export async function runSequentialSmoke(
  runner: Runner,
  params: {
    readonly userId: string;
    readonly newMessage: Content;
  },
): Promise<Event[]> {
  const events: Event[] = [];
  const generator = runner.runEphemeral({
    userId: params.userId,
    newMessage: params.newMessage,
  });
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

/**
 * Runner Event の `author` (= sub-agent 名) を順序保持で抽出する。
 *
 * SequentialAgent の sub-agent 実行順序が、`runEphemeral` の event stream にどう
 * 反映されるかを観測するためのヘルパー。テスト assertion 用途。
 *
 * @param events `runSequentialSmoke` の戻り値
 * @returns 重複連続を除いた sub-agent 名の配列 (= 実行順序)
 */
export function extractSubAgentOrder(events: readonly Event[]): string[] {
  const order: string[] = [];
  for (const ev of events) {
    const author = ev.author;
    if (author === undefined || author === 'user') {
      continue;
    }
    if (order.length === 0 || order[order.length - 1] !== author) {
      order.push(author);
    }
  }
  return order;
}
