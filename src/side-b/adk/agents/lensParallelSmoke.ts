/**
 * lensParallelSmoke: ADK ParallelAgent dry-run wrapper の最小構成 (Step 4)
 *
 * Step 4 (`STEP_4_KICKOFF.md` §5) で実装。本ファイルは Phase 2 (単体 Lens sub-agent
 * wrapper) と Phase 3 (`ParallelAgent` dry-run) の両方で利用する build block の
 * 起点。本コミットでは Phase 2 (createLensSubAgent + LensSubAgent) のみを公開し、
 * `createDryRunLensParallelAgent` / `runLensParallelSmoke` は次 PR (Step 4 PR 2)
 * で additive 追加する。
 *
 * 対応する既存実装: なし (本 Step で新規追加する ADK サイドカー)
 * ADK 化の目的 (`STEP_4_KICKOFF.md` §0):
 *   1. Lens 群の純粋関数的性質を壊さず、ADK `ParallelAgent` に載せられるか確認する
 *   2. 各 Lens 実行を `adk.subagent.*` trace event として個別に観測できるようにする
 *   3. 並列実行しても、同一 input に対して同一 output が得られることを実機テストで確認する
 *
 * 依存方向:
 *   - 既存 `src/side-b/agent/` / `src/side-b/skills/` への参照なし
 *   - `src/side-b/lenses/` からは `Lens` / `LensInput` / `LensFeature` の型と既存
 *     インスタンスだけを受け取る (= Lens 本体を改変しない、KICKOFF §2.1)
 *   - 既存から本ファイルへの import は禁止
 *
 * 設計方針:
 *   - sub-agent は **LLM を呼ばない** `LensSubAgent` (BaseAgent 直接サブクラス)。
 *     Step 3 `SmokeSubAgent` (`sequentialSmoke.ts`) と同パターンで、`compute()` の
 *     呼び出し境界を ADK で包むだけにする (KICKOFF §4.1)。
 *   - sub-agent 単位の trace event は `adk.subagent.*` kind (Step 3 Phase 2 で追加)
 *     を再利用。`skillName` フィールドを Lens 名として再利用 (`traceTypes.ts` §AdkTraceEventKind)。
 *   - `callerReason` は Step 4 専用の固定値 `lens_parallel_dry_run` (KICKOFF §4.3)。
 *   - trace payload に raw input/output を入れない。保存するのは lensName / lensVersion /
 *     featureCount / durationMs / dependencyCount / errorMessage 短縮版のみ (KICKOFF §4.3)。
 *
 * 本ファイルは:
 *   - 本番 SideBScheduler / Express server / EvolutionLoop / PDCALoop に組み込まない
 *     (KICKOFF §2.3)
 *   - DB 書き込み / 通知 / 実 LLM 呼び出しを発生させない
 *   - ADK public API のみ使用 (BaseAgent / InvocationContext / createEvent)
 */

import { randomUUID } from 'node:crypto';

import { BaseAgent, type Event, type InvocationContext, createEvent } from '@google/adk';
import type { Content } from '@google/genai';

import type { Lens, LensFeature, LensInput } from '../../lenses';
import type { AdkTraceEvent, TracePayloadSummary, TraceSink } from '../tracing';
import { shortenErrorMessage } from '../tracing';

/**
 * Step 4 Lens ParallelAgent dry-run 共通の固定 `callerReason` (KICKOFF §4.3)。
 *
 * Step 1 Skill 系の `ADK_DEFAULT_CALLER_REASON` / Step 3 SequentialAgent 系の
 * `SUBAGENT_SMOKE_CALLER_REASON` とは別系統で識別できるようにする。
 */
export const LENS_PARALLEL_SMOKE_CALLER_REASON = 'lens_parallel_dry_run';

/**
 * `TraceSink.record()` の失敗を握りつぶす内部ヘルパー。
 *
 * Step 2/3 (`adapters/skillRegistryToAdkTools.ts` / `agents/sequentialSmoke.ts`) で
 * 確立した「traceSink 失敗で本処理を壊さない」契約に揃える。同期 throw / Promise
 * reject の両方を捕捉し、原因例外を呼び出し元に伝播しない (KICKOFF §4.1 / §8)。
 */
async function safeRecord(sink: TraceSink, event: AdkTraceEvent): Promise<void> {
  try {
    await Promise.resolve(sink.record(event));
  } catch {
    // intentionally swallowed: trace 記録の失敗で sub-agent 実行を壊さない
  }
}

// ============================================================================
// LensSubAgent: 単体 Lens を BaseAgent でラップする (Phase 2)
// ============================================================================

/**
 * `LensSubAgent` 生成オプション。
 */
export interface LensSubAgentOptions {
  /** ラップ対象の Lens (既存 `src/side-b/lenses/` のインスタンス、無改変)。 */
  readonly lens: Lens;
  /** Lens に渡す `LensInput`。同入力で複数 sub-agent を構築可能。 */
  readonly input: LensInput;
  /** trace event の出力先。未指定なら record されない (= NoopTraceSink 相当)。 */
  readonly traceSink?: TraceSink;
  /**
   * sub-agent 名 (BaseAgent.name) の override。未指定なら `lens.name` を使う。
   *
   * ParallelAgent では同名 sub-agent を複数登録できない場合があるため、テスト等で
   * 同じ Lens から複数の sub-agent を作るときだけ override する。
   */
  readonly nameOverride?: string;
}

/**
 * 単体 Lens を ADK `BaseAgent` subclass として薄くラップする dry-run wrapper。
 *
 * 責務 (KICKOFF §4.1):
 * - Lens 名を ADK sub-agent 名へ変換する
 * - `LensInput` を constructor で受け取り、`runAsyncImpl` で `lens.compute(input)` を呼ぶ
 * - `adk.subagent.started` / `completed` / `failed` を `traceSink` に record する
 * - raw input / raw output / features の中身を trace に保存しない
 * - 成功時に得られた `LensFeature` を `getResult()` で外から回収できる
 *
 * 非責務:
 * - 相場判断 (Lens の `compute()` をそのまま委譲するだけ、新たな意思決定を持たない)
 * - 並列化 / 集約 (それは Phase 3 の `createDryRunLensParallelAgent` の責務)
 * - LLM 呼び出し / Session / DB 永続化
 *
 * 並列実行で問題なく動かすために重要な点:
 * - `LensSubAgent` は内部で `result` / `error` のみを state として保持する。
 *   Lens 自体には state を増やさない (KICKOFF §2.1)。
 * - 二重実行 (= 同じ instance に対し `runAsyncImpl` を 2 回回す) は想定しない。
 *   都度新しい instance を作る。
 */
export class LensSubAgent extends BaseAgent {
  /** 成功時に Lens から得た `LensFeature` を保持。未実行/失敗時は `undefined`。 */
  private result?: LensFeature;
  /** 失敗時の error (`runAsyncImpl` で `throw` 前に保存)。`getError()` で外から参照。 */
  private error?: Error;
  /** ラップ対象 Lens (外部 read 専用)。 */
  private readonly lens: Lens;
  /** Lens に渡す入力 (immutable に保持)。 */
  private readonly input: LensInput;
  /** trace 出力先 (任意)。 */
  private readonly traceSink: TraceSink | undefined;

  constructor(options: LensSubAgentOptions) {
    super({ name: options.nameOverride ?? options.lens.name });
    this.lens = options.lens;
    this.input = options.input;
    this.traceSink = options.traceSink;
  }

  /** 成功時に Lens から得た `LensFeature` を返す (未実行/失敗時は `undefined`)。 */
  getResult(): LensFeature | undefined {
    return this.result;
  }

  /** 失敗時の error を返す (未実行/成功時は `undefined`)。 */
  getError(): Error | undefined {
    return this.error;
  }

  /** ラップしている Lens の name を返す。 */
  getLensName(): string {
    return this.lens.name;
  }

  /** ラップしている Lens の version を返す。 */
  getLensVersion(): string {
    return this.lens.version;
  }

  protected override async *runAsyncImpl(
    context: InvocationContext,
  ): AsyncGenerator<Event, void, void> {
    const startedAt = new Date();
    const startedTraceId = randomUUID();
    const sink = this.traceSink;

    if (sink !== undefined) {
      const startedEvent: AdkTraceEvent = {
        kind: 'adk.subagent.started',
        traceId: startedTraceId,
        invocationId: context.invocationId,
        agentName: this.name,
        // skillName を step 識別子として再利用 (Lens 名)、traceTypes.ts §AdkTraceEventKind 参照
        skillName: this.lens.name,
        callerReason: LENS_PARALLEL_SMOKE_CALLER_REASON,
        startedAt,
        status: 'started',
      };
      await safeRecord(sink, startedEvent);
    }

    try {
      // Lens.compute() の呼び出し境界をそのまま委譲。新たな相場判断を行わない。
      const feature = await this.lens.compute(this.input);
      this.result = feature;

      // Runner event stream に流す 1 件の text event (Lens 名と Lens 内部 confidence の有無のみ)。
      // raw features 自体は乗せない (KICKOFF §4.3)。
      const content: Content = {
        role: 'model',
        parts: [{ text: `${this.lens.name} computed` }],
      };
      const event = createEvent({
        invocationId: context.invocationId,
        author: this.name,
        content,
      });
      yield event;

      if (sink !== undefined) {
        const endedAt = new Date();
        const resultSummary: TracePayloadSummary = {
          // featureCount のみ trace 化 (KICKOFF §4.3: 「保存してよい」リストに `featureCount`)。
          // features の中身 (key 名や値) は乗せない。
          fieldCount: Object.keys(feature.features).length,
          redacted: true,
        };
        const completedEvent: AdkTraceEvent = {
          kind: 'adk.subagent.completed',
          traceId: randomUUID(),
          parentTraceId: startedTraceId,
          invocationId: context.invocationId,
          agentName: this.name,
          skillName: this.lens.name,
          callerReason: LENS_PARALLEL_SMOKE_CALLER_REASON,
          startedAt,
          endedAt,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          status: 'ok',
          resultSummary,
        };
        await safeRecord(sink, completedEvent);
      }
    } catch (err) {
      // err は unknown のまま受け取り、cause として伝播。文字列化は trace event の
      // errorMessage 用にのみ行い、原因 Error の throw 経路にはそのまま転送する。
      const error = err instanceof Error ? err : new Error(String(err));
      this.error = error;

      if (sink !== undefined) {
        const endedAt = new Date();
        const failedEvent: AdkTraceEvent = {
          kind: 'adk.subagent.failed',
          traceId: randomUUID(),
          parentTraceId: startedTraceId,
          invocationId: context.invocationId,
          agentName: this.name,
          skillName: this.lens.name,
          callerReason: LENS_PARALLEL_SMOKE_CALLER_REASON,
          startedAt,
          endedAt,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          status: 'thrown',
          errorCode: 'LENS_SUBAGENT_THROWN',
          // 巨大な error message が trace event に乗らないよう Step 2 上限で短縮 (KICKOFF §4.3)。
          errorMessage: shortenErrorMessage(error.message),
        };
        await safeRecord(sink, failedEvent);
      }
      throw err;
    }
  }

  protected override async *runLiveImpl(): AsyncGenerator<Event, void, void> {
    // smoke では runLive を呼ばないため未実装。Step 3 SmokeSubAgent と同じパターンで、
    // 型シグネチャを満たすために generator として宣言し、最初の状態遷移で必ず throw する。
    // await の存在で `require-await` を満たし、到達不能な yield で `require-yield` を満たす。
    await Promise.resolve();
    throw new Error(
      `LensSubAgent.runLiveImpl is not implemented (smoke では使わない): ${this.name}`,
    );
    // この yield には到達しない。generator 関数として宣言するために残す。
    yield undefined as never;
  }
}

/**
 * `LensSubAgent` を生成する factory。
 *
 * 直接 `new LensSubAgent(...)` でもよいが、Phase 3 で追加する
 * `createDryRunLensParallelAgent(lenses, options)` と命名を揃え、テスト / README で
 * 呼び出し例を統一する目的で factory を export する。
 *
 * @example
 * ```typescript
 * const subAgent = createLensSubAgent({
 *   lens: new TimeSessionLens(),
 *   input: { symbol: 'XAUUSD', timeframe: '15m', timestamp: new Date('2026-05-14T00:00:00Z') },
 *   traceSink: new InMemoryTraceSink(),
 * });
 * ```
 */
export function createLensSubAgent(options: LensSubAgentOptions): LensSubAgent {
  return new LensSubAgent(options);
}
