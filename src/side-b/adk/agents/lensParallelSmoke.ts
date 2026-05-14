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
 *   - trace payload に raw input/output を入れない。実際に AdkTraceEvent に乗せるのは
 *     `agentName` / `skillName` (= Lens 名) / `durationMs` / `status` /
 *     `resultSummary.fieldCount` (features 数) / `errorMessage` 短縮版のみ。
 *     `lensVersion` / dependencies は trace 型に乗せず、外側から `getLensVersion()`
 *     等で参照する設計 (KICKOFF §4.3 の許可リストのうち trace 型と整合する subset)。
 *
 * 本ファイルは:
 *   - 本番 SideBScheduler / Express server / EvolutionLoop / PDCALoop に組み込まない
 *     (KICKOFF §2.3)
 *   - DB 書き込み / 通知 / 実 LLM 呼び出しを発生させない
 *   - ADK public API のみ使用 (BaseAgent / InvocationContext / createEvent)
 */

import { randomUUID } from 'node:crypto';

import {
  BaseAgent,
  type Event,
  InMemorySessionService,
  type InvocationContext,
  ParallelAgent,
  Runner,
  createEvent,
} from '@google/adk';
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
  /**
   * Phase 3 追加: 失敗時の throw を呼び出し元へ伝播せず握りつぶすか。
   *
   * - `false` (default): Phase 2 既存挙動。Lens が throw すると `runAsyncImpl` の
   *   呼び出し元 (Runner) まで例外が伝播し、Runner 全体が停止する。単体検証向け。
   * - `true`: 例外を握りつぶし、`getError()` だけに保存して generator は正常終了。
   *   ADK `ParallelAgent` は内部で `Promise.race` (`mergeAgentRuns`) を使うため、
   *   1 sub-agent の throw が全体停止につながる。1 Lens の失敗が他 Lens の実行を
   *   巻き込まないようにするには本オプションを true にして "failure isolation"
   *   を sub-agent 側で吸収する必要がある (KICKOFF §5 Phase 3 DoD)。
   *
   * いずれの場合でも `traceSink` には `adk.subagent.failed` が必ず記録される。
   */
  readonly isolateFailure?: boolean;
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
  /** failure isolation オプション (Phase 3 追加、default false)。 */
  private readonly isolateFailure: boolean;

  constructor(options: LensSubAgentOptions) {
    super({ name: options.nameOverride ?? options.lens.name });
    this.lens = options.lens;
    this.input = options.input;
    this.traceSink = options.traceSink;
    this.isolateFailure = options.isolateFailure ?? false;
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
    // 同一 instance を誤って 2 回実行された場合に、前回の result / error が
    // 残って外側集約 (`runLensParallelSmoke.getResult()` / `getError()`) で
    // 状態混入を起こさないよう、runAsyncImpl 冒頭で必ず初期化する。
    // 通常運用では factory が常に新規 instance を返すが、防衛的に reset しておく。
    this.result = undefined;
    this.error = undefined;

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
      // err は unknown のまま受け取り、Error subclass でない場合 (string / object 等を
      // throw する Lens 実装がもし出てきた場合) は Error に正規化する。`getError()` と
      // 「呼び出し元に伝播する例外」を**同一 instance** にするため、正規化後の `error`
      // を保存しつつ `throw error` で呼び出し元へ転送する (`{ cause: err }` で元の値も
      // 失わない、ES2022 Error.cause)。文字列化は trace event の errorMessage 用にのみ
      // 行い、原因情報は cause として保持される。
      const error =
        err instanceof Error ? err : new Error(String(err), { cause: err });
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
      if (!this.isolateFailure) {
        throw error;
      }
      // isolateFailure: true の場合は例外を握りつぶす。getError() で保存済みの
      // Error を参照することで失敗事実は失われない。ParallelAgent の Promise.race
      // 経路で他 sub-agent を巻き込まないために必要 (KICKOFF Phase 3 DoD)。
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

// ============================================================================
// ParallelAgent dry-run wrapper (Phase 3)
// ============================================================================

/** Phase 3 ParallelAgent root agent のデフォルト appName。 */
export const LENS_PARALLEL_SMOKE_DEFAULT_APP_NAME =
  'trader-note-build-ai-adk-lens-parallel-smoke';

/** Phase 3 ParallelAgent root agent のデフォルト名。 */
export const LENS_PARALLEL_SMOKE_DEFAULT_AGENT_NAME = 'adk-lens-parallel-smoke-root';

/** Phase 3 ParallelAgent dry-run の構築 config。 */
export interface LensParallelSmokeConfig {
  /** 並列実行する Lens 群 (順序は無関係、最終出力は lensName でソート)。 */
  readonly lenses: readonly Lens[];
  /** 全 Lens に渡す共通の `LensInput`。 */
  readonly input: LensInput;
  /** trace event の出力先 (任意、各 sub-agent に共有)。 */
  readonly traceSink?: TraceSink;
  /** Runner.appName の override (任意)。 */
  readonly appName?: string;
  /** ParallelAgent.name の override (任意)。 */
  readonly agentName?: string;
}

/** Phase 3 ParallelAgent dry-run の構築物。 */
export interface LensParallelSmokeArtifacts {
  readonly runner: Runner;
  readonly rootAgent: ParallelAgent;
  readonly sessionService: InMemorySessionService;
  /** lensName で昇順ソート済みの `LensSubAgent` 配列。実行後に `getResult` / `getError` を回収する。 */
  readonly subAgents: readonly LensSubAgent[];
}

/**
 * `runLensParallelSmoke` の戻り値。
 *
 * 成功と失敗を分離して保持。両者とも `lensName` で安定ソート済み (= 並列実行順に
 * 依存しない安定 key、KICKOFF Phase 3 DoD)。
 */
export interface LensParallelExecutionResult {
  /** 成功 Lens の features (lensName 昇順)。 */
  readonly successes: readonly LensFeature[];
  /** 失敗 Lens の {lensName, error} (lensName 昇順)。 */
  readonly failures: readonly LensParallelFailure[];
}

/** Phase 3 並列実行で 1 Lens が失敗したことを示す record。 */
export interface LensParallelFailure {
  readonly lensName: string;
  readonly error: Error;
}

/**
 * 複数 Lens を `ParallelAgent` で並列実行する dry-run wrapper を構築する。
 *
 * KICKOFF §5 Phase 3 / §4.2 (Lens Parallel dry-run wrapper) に準拠:
 * - 各 Lens を `LensSubAgent` (isolateFailure: true) でラップ
 * - 同一 `LensInput` を全 sub-agent で共有
 * - `ParallelAgent` で束ね、`Runner` + `InMemorySessionService` で実行可能にする
 * - trace event は各 sub-agent が自分で `adk.subagent.*` を `traceSink` に record
 *
 * **failure isolation の仕組み**: ADK `ParallelAgent` は内部で `Promise.race`
 * (`mergeAgentRuns`) を使って sub-agent generator を merge するため、1 sub-agent
 * の throw が全体を停止させる。これを避けるため `LensSubAgent.isolateFailure=true`
 * を渡し、Lens 失敗時に sub-agent generator が throw せず正常終了するようにする。
 * 失敗事実は `LensSubAgent.getError()` で `runLensParallelSmoke` 側が後から集約する。
 *
 * @throws lenses が空の場合
 * @throws lenses 内に同名 Lens が 2 つ以上含まれる場合
 */
export function buildLensParallelSmoke(
  config: LensParallelSmokeConfig,
): LensParallelSmokeArtifacts {
  if (config.lenses.length === 0) {
    throw new Error('buildLensParallelSmoke: lenses must be non-empty');
  }

  // 同名 Lens を弾く (ParallelAgent の sub-agent 名一意性を担保、確実な集約のためにも必要)。
  const seenNames = new Set<string>();
  for (const lens of config.lenses) {
    if (seenNames.has(lens.name)) {
      throw new Error(
        `buildLensParallelSmoke: duplicate lens name "${lens.name}" detected`,
      );
    }
    seenNames.add(lens.name);
  }

  // lensName 昇順でソートして安定 key 順序を確保。並列実行順序はこの順序に依存しない。
  const sortedLenses = [...config.lenses].sort((a, b) => a.name.localeCompare(b.name));

  // 各 Lens を LensSubAgent でラップ (isolateFailure: true で failure isolation)。
  const subAgents = sortedLenses.map((lens) =>
    createLensSubAgent({
      lens,
      input: config.input,
      traceSink: config.traceSink,
      isolateFailure: true,
    }),
  );

  // ParallelAgent に渡す sub-agent は mutable BaseAgent[] 期待のため readonly 解除。
  // 本 smoke では構築後に sub-agent を変更しないため安全 (Step 3 sequentialSmoke と同じ運用)。
  const subAgentList: BaseAgent[] = subAgents.map((a) => a);

  const rootAgent = new ParallelAgent({
    name: config.agentName ?? LENS_PARALLEL_SMOKE_DEFAULT_AGENT_NAME,
    subAgents: subAgentList,
  });

  const sessionService = new InMemorySessionService();

  const runner = new Runner({
    appName: config.appName ?? LENS_PARALLEL_SMOKE_DEFAULT_APP_NAME,
    agent: rootAgent,
    sessionService,
  });

  return { runner, rootAgent, sessionService, subAgents };
}

/**
 * 構築済みの `LensParallelSmokeArtifacts` を `Runner.runEphemeral` で実行し、
 * 各 Lens の結果を成功 / 失敗別に集約して返す。
 *
 * 出力 (`LensParallelExecutionResult`) は `lensName` 昇順で安定ソート済み。
 * 並列実行順序 / trace event 順序には依存しない (KICKOFF Phase 3 DoD §安定 key)。
 *
 * @example
 * ```typescript
 * const artifacts = buildLensParallelSmoke({ lenses, input });
 * const result = await runLensParallelSmoke(artifacts);
 * for (const f of result.successes) console.log(f.lensName, f.features);
 * for (const fail of result.failures) console.log(fail.lensName, fail.error.message);
 * ```
 */
export async function runLensParallelSmoke(
  artifacts: LensParallelSmokeArtifacts,
  params?: { readonly userId?: string },
): Promise<LensParallelExecutionResult> {
  const triggerMessage: Content = {
    role: 'user',
    parts: [{ text: 'lens parallel smoke trigger' }],
  };
  const generator = artifacts.runner.runEphemeral({
    userId: params?.userId ?? 'lens-parallel-smoke-tester',
    newMessage: triggerMessage,
  });
  // generator を最後まで回し、各 sub-agent の runAsyncImpl を完了させる。
  // Event の中身は本 wrapper では使用しない (= trace 経由で観測する設計)。
  for await (const _event of generator) {
    // 副作用なし
  }

  const successes: LensFeature[] = [];
  const failures: LensParallelFailure[] = [];
  for (const sub of artifacts.subAgents) {
    const result = sub.getResult();
    const error = sub.getError();
    if (result !== undefined) {
      successes.push(result);
    } else if (error !== undefined) {
      failures.push({ lensName: sub.getLensName(), error });
    } else {
      // 起こりえないが防衛: 未実行 (runEphemeral でも回らなかった) ケース。
      failures.push({
        lensName: sub.getLensName(),
        error: new Error(
          `LensSubAgent ${sub.getLensName()} did not run (no result, no error)`,
        ),
      });
    }
  }
  // 集約結果も lensName 昇順で再ソート (subAgents は既にソート済みだが defensively)。
  successes.sort((a, b) => a.lensName.localeCompare(b.lensName));
  failures.sort((a, b) => a.lensName.localeCompare(b.lensName));

  return { successes, failures };
}

/**
 * `buildLensParallelSmoke` + `runLensParallelSmoke` をまとめて呼ぶ一発便利関数。
 *
 * 既存ファクトリ命名 (`runnerSmoke` / `sequentialSmoke`) と整合させるための薄い
 * wrapper。詳細制御が必要な場合は `buildLensParallelSmoke` を直接使う。
 */
export async function createDryRunLensParallelAgent(
  config: LensParallelSmokeConfig,
  params?: { readonly userId?: string },
): Promise<LensParallelExecutionResult> {
  const artifacts = buildLensParallelSmoke(config);
  return runLensParallelSmoke(artifacts, params);
}
