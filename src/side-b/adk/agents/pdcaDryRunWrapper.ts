/**
 * pdcaDryRunWrapper: 既存 PDCALoop の dry-run 観測 wrapper (Step 3 Phase 3)
 *
 * 設計書: docs/architecture/STEP_3_KICKOFF.md §5 Phase 3 / §5.8-§5.11
 *
 * 対応する既存実装: src/side-b/agent/pdcaLoop.ts (PDCALoop クラス) — **改変禁止**
 *
 * ADK 化の目的:
 *   - 既存 PDCALoop の挙動を ADK SequentialAgent + sub-agent 経由で **dry-run 観測**できるか実機検証
 *   - private state handler 単位の span 化はしない (KICKOFF §5.10 禁止粒度)
 *   - public API (`start` / `stop` / `getStatus` / `getThinkingLog`) のみを sub-agent から呼ぶ
 *
 * 依存方向:
 *   - 本ファイル → `src/side-b/agent/pdcaLoop.ts` (read-only import のみ、改変禁止)
 *   - 既存 `src/side-b/agent/` から本ファイルへの import は禁止 (撤退時に切り離すため)
 *   - `as any` / `as unknown as` / private field アクセスは一切しない
 *
 * 安全性:
 *   - 受け取る `PDCALoop` は **`enabled: false` で構築されている** ことが呼び出し側の責務 (§3 参照)
 *   - その状態では `start()` は即 return、`stop()` は `isRunning=false` のため即 return、
 *     `getStatus()` / `getThinkingLog()` は read-only
 *   - DB 書き込み / 通知 / 取引判断 / agentMemory 変更が起きないことを **テストで実測**
 *   - 本番 SideBScheduler / Express server に組み込まない (KICKOFF §3.2)
 *
 * trace contract:
 *   - Phase 2 で追加した `adk.subagent.*` event kind をそのまま使う
 *   - 新規 event kind / 新規フィールド追加なし
 *   - `skillName` フィールドを sub-agent 名 (= 観測アクション名) として再利用 (Phase 2 と同様)
 *   - `callerReason` は本 Phase 専用識別子で他と区別
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

import { PDCALoop } from '../../agent/pdcaLoop';
import type {
  AdkTraceEvent,
  TracePayloadSummary,
  TraceSink,
} from '../tracing';
import { payloadToSummary, shortenErrorMessage } from '../tracing';

/** Phase 3 dry-run で使用する固定 callerReason (Phase 2 sequential smoke とも区別)。 */
export const PDCA_DRY_RUN_CALLER_REASON = 'invoked-via-adk-pdca-dry-run';

/** デフォルト app 名。 */
export const PDCA_DRY_RUN_DEFAULT_APP_NAME =
  'trader-note-build-ai-adk-pdca-dry-run';

/** デフォルト root agent 名 (SequentialAgent)。 */
export const PDCA_DRY_RUN_DEFAULT_AGENT_NAME = 'adk-pdca-dry-run-root';

// ============================================================================
// 観測アクション定義
// ============================================================================

/**
 * `PdcaObservationSubAgent` が実行する観測アクション。
 *
 * いずれも **PDCALoop の public API のみ** を呼び、副作用を起こさない。
 *
 * - `noop-start`: `pdcaLoop.start()` を呼ぶ。受け取った PDCALoop が `enabled: false`
 *   である前提のため、PDCALoop 内部で即 return される (= no-op)。`start()` を呼んでも
 *   安全であることを **trace 上で観測** するためのアクション
 * - `noop-stop`: `pdcaLoop.stop()` を呼ぶ。`isRunning=false` であれば即 return
 * - `snapshot-status`: `pdcaLoop.getStatus()` を呼び、戻り値 (state / isRunning 等を含む) を
 *   summary に縮約して trace event の `resultSummary` に乗せる
 * - `snapshot-log`: `pdcaLoop.getThinkingLog(limit)` を呼び、配列長のみ trace に記録
 */
export type PdcaObservationAction =
  | 'noop-start'
  | 'noop-stop'
  | 'snapshot-status'
  | 'snapshot-log';

// ============================================================================
// PdcaObservationSubAgent: PDCALoop 公開 API の 1 アクションを sub-agent 化
// ============================================================================

/**
 * `PdcaObservationSubAgent` 生成オプション。
 */
export interface PdcaObservationSubAgentOptions {
  /** sub-agent 識別子 (BaseAgent.name)。trace event の `skillName` にもなる。 */
  readonly name: string;
  /** 観測対象の PDCALoop インスタンス。`enabled: false` で構築されていること。 */
  readonly pdcaLoop: PDCALoop;
  /** 実行する観測アクション。 */
  readonly action: PdcaObservationAction;
  /** `snapshot-log` 時の取得件数 (デフォルト: 10、`getThinkingLog` に渡す)。 */
  readonly thinkingLogLimit?: number;
  /** trace event の出力先。未指定なら record されない。 */
  readonly traceSink?: TraceSink;
  /** true の場合、`runAsyncImpl` 内で意図的に throw する (error case テスト用)。 */
  readonly shouldThrow?: boolean;
  /** throw する error message (`shouldThrow=true` 時のみ参照)。 */
  readonly throwMessage?: string;
}

/**
 * PDCALoop の public API 1 アクションを 1 sub-agent として観測する BaseAgent 派生。
 *
 * `runAsyncImpl` の流れ:
 * 1. `adk.subagent.started` を traceSink に safeRecord
 * 2. 観測アクション (start/stop/getStatus/getThinkingLog) を実行
 * 3. Runner event stream に 1 件の text event を yield
 * 4. 成功時: `adk.subagent.completed` を safeRecord (`resultSummary` に観測値の summary を含む)
 * 5. `shouldThrow=true` 時: `adk.subagent.failed` を safeRecord 後 rethrow
 */
export class PdcaObservationSubAgent extends BaseAgent {
  constructor(private readonly options: PdcaObservationSubAgentOptions) {
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
        skillName: this.name,
        callerReason: PDCA_DRY_RUN_CALLER_REASON,
        startedAt,
        status: 'started',
      };
      await safeRecord(sink, startedEvent);
    }

    try {
      if (this.options.shouldThrow === true) {
        throw new Error(
          this.options.throwMessage ??
            `PdcaObservationSubAgent ${this.name} intentionally threw`,
        );
      }

      const resultSummary = this.executeAction();

      // Runner event stream に流す 1 件の text event (本番判断には流さない)
      const content: Content = {
        role: 'model',
        parts: [
          {
            text: `${this.name}: ${this.options.action} executed (no side effects)`,
          },
        ],
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
          callerReason: PDCA_DRY_RUN_CALLER_REASON,
          startedAt,
          endedAt,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          status: 'ok',
          resultSummary,
        };
        await safeRecord(sink, completedEvent);
      }
    } catch (err) {
      if (sink !== undefined) {
        const endedAt = new Date();
        const rawMessage = err instanceof Error ? err.message : String(err);
        const failedEvent: AdkTraceEvent = {
          kind: 'adk.subagent.failed',
          traceId: randomUUID(),
          parentTraceId: startedTraceId,
          invocationId: context.invocationId,
          agentName: this.name,
          skillName: this.name,
          callerReason: PDCA_DRY_RUN_CALLER_REASON,
          startedAt,
          endedAt,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          status: 'thrown',
          errorCode: 'PDCA_OBSERVATION_THROWN',
          errorMessage: shortenErrorMessage(rawMessage),
        };
        await safeRecord(sink, failedEvent);
      }
      throw err;
    }
  }

  protected override async *runLiveImpl(): AsyncGenerator<Event, void, void> {
    // smoke では runLive を呼ばないため未実装。型シグネチャを満たすため最初の await で throw する。
    await Promise.resolve();
    throw new Error(
      `PdcaObservationSubAgent.runLiveImpl is not implemented (dry-run では使わない): ${this.name}`,
    );
    // 到達不能 (require-yield 充足用)
    yield undefined as never;
  }

  /**
   * 観測アクションを実行し、戻り値の **summary だけ** を返す。
   *
   * 各アクションは PDCALoop の public API のみを呼び、raw payload を trace に乗せない。
   */
  private executeAction(): TracePayloadSummary | undefined {
    const { action, pdcaLoop } = this.options;

    switch (action) {
      case 'noop-start': {
        // pdcaLoop.start() は enabled:false で即 return、副作用なし
        pdcaLoop.start();
        return undefined;
      }
      case 'noop-stop': {
        // pdcaLoop.stop() は isRunning=false で即 return、副作用なし
        pdcaLoop.stop();
        return undefined;
      }
      case 'snapshot-status': {
        const status = pdcaLoop.getStatus();
        // raw status を summary に縮約 (top-level keys / field count のみ、KICKOFF §6.3)
        return payloadToSummary(status);
      }
      case 'snapshot-log': {
        const log = pdcaLoop.getThinkingLog(this.options.thinkingLogLimit ?? 10);
        return payloadToSummary(log);
      }
      default: {
        // exhaustive check (TypeScript で網羅性を担保)
        const exhaustive: never = action;
        throw new Error(`Unknown observation action: ${String(exhaustive)}`);
      }
    }
  }
}

// ============================================================================
// Dry-run wrapper factory
// ============================================================================

/**
 * Phase 3 dry-run wrapper の入力。
 */
export interface PdcaDryRunConfig {
  readonly appName?: string;
  readonly agentName?: string;
  /** 観測対象の PDCALoop インスタンス (`enabled: false` であること)。 */
  readonly pdcaLoop: PDCALoop;
  /** 観測する sub-agent (順番に実行される、各 1 アクションを担当)。 */
  readonly subAgents: readonly PdcaObservationSubAgent[];
}

/**
 * Phase 3 dry-run wrapper の構築物。
 */
export interface PdcaDryRunArtifacts {
  readonly runner: Runner;
  readonly rootAgent: SequentialAgent;
  readonly sessionService: InMemorySessionService;
}

/**
 * Step 3 Phase 3 dry-run wrapper の最小構成を構築する (実行はしない)。
 *
 * 構成:
 * ```
 * PdcaObservationSubAgent[]
 *   ↓ new SequentialAgent({ name, subAgents })
 * SequentialAgent (root)
 *   ↓ new Runner({ appName, agent, sessionService: new InMemorySessionService() })
 * Runner
 * ```
 *
 * 注意: 本 wrapper は **dry-run** 限定。本番 SideBScheduler から呼ばない、Express server
 * から呼ばない、production scheduler 経路に組み込まない。
 */
export function buildPdcaDryRunWrapper(
  config: PdcaDryRunConfig,
): PdcaDryRunArtifacts {
  if (config.subAgents.length === 0) {
    throw new Error('buildPdcaDryRunWrapper: subAgents must be non-empty');
  }

  const subAgentList: BaseAgent[] = config.subAgents.map((a) => a);

  const rootAgent = new SequentialAgent({
    name: config.agentName ?? PDCA_DRY_RUN_DEFAULT_AGENT_NAME,
    subAgents: subAgentList,
  });

  const sessionService = new InMemorySessionService();

  const runner = new Runner({
    appName: config.appName ?? PDCA_DRY_RUN_DEFAULT_APP_NAME,
    agent: rootAgent,
    sessionService,
  });

  return { runner, rootAgent, sessionService };
}

/**
 * `Runner.runEphemeral` を実行し、全 Event を順序保持で収集する (Phase 1/2 と同じ手順)。
 */
export async function runPdcaDryRun(
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
 * Dry-run 専用 PDCALoop ファクトリ。**`enabled: false` を強制** することで、
 * start() が即 return する安全な状態の PDCALoop を返す。
 *
 * テスト / dry-run smoke の利便のために提供する。本番経路では使わない。
 */
export function createDryRunPdcaLoop(options?: {
  readonly verbose?: boolean;
  readonly symbols?: string[];
}): PDCALoop {
  return new PDCALoop({
    enabled: false,
    verbose: options?.verbose ?? false,
    symbols: options?.symbols ?? ['XAUUSD'],
  });
}

// ============================================================================
// 内部ヘルパー
// ============================================================================

/**
 * `TraceSink.record()` の失敗を握りつぶす内部ヘルパー (Phase 2 と同じ方針)。
 * Step 2 Phase 3 の adapter / Phase 2 の sequentialSmoke と同パターン。
 */
async function safeRecord(sink: TraceSink, event: AdkTraceEvent): Promise<void> {
  try {
    await Promise.resolve(sink.record(event));
  } catch {
    // intentionally swallowed: trace 記録の失敗で sub-agent 実行を壊さない
  }
}
