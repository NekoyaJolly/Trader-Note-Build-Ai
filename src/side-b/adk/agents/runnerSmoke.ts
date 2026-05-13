/**
 * runnerSmoke: ADK Runner / LlmAgent / InMemorySessionService の最小 smoke factory
 *
 * Step 3 Phase 1 (`STEP_3_KICKOFF.md` §5) で実装。
 *
 * 対応する既存実装: なし (本 Step で新規追加する ADK サイドカー)
 * ADK 化の目的:
 *   - Step 2 で確立した `TraceSink` 構成 (`STEP_2_ADK_RUNNER_SMOKE_NOTES.md` §2.1)
 *     が、ADK Runner / LlmAgent / `skillRegistryToAdkTools()` を実機で組み合わせた
 *     場合にも機能することを smoke 検証する
 *   - Step 3 Phase 2 / Phase 3 が利用する最小 Runner factory を提供する
 *
 * 依存方向:
 *   - 既存 `src/side-b/skills/` (registry.ts) からこのファイルへの import は禁止
 *   - 本ファイルから既存 `src/side-b/skills/` への参照は OK (= adapter 経由でのみ)
 *
 * 設計方針:
 *   - `Runner.runEphemeral()` のみ採用 (`runAsync` は sessionId 必須、session-less 方針と衝突)
 *   - `InMemorySessionService` のみ採用 (`DatabaseSessionService` は ADK_ADOPTION.md §2.2 で不採用)
 *   - `model` は呼び出し側が `BaseLlm` を供給する。本ファイル内で stub / 本番 LLM を
 *     ハードコードしない (テストは stub を、本番接続は別途判断 — Step 3 Phase 4 で扱う)
 *   - `traceSink` 未指定時は `NoopTraceSink` 相当 (adapter 側で既に既存挙動互換)
 *
 * 本ファイルは:
 *   - 本番 `SideBScheduler` / Express server に組み込まない (`KICKOFF` §3.2)
 *   - DB 書き込み / 通知 / 取引判断を発生させない (`KICKOFF` §6.4)
 *   - ADK SDK の private / internal API に依存しない
 *   - `any` / `unknown` の本番コード使用なし
 *
 * 撤退時の保証: 本ファイル含む `/src/side-b/adk/` を `git rm -rf` するだけで完全撤退できる
 * (`/src/side-b/adk/AGENTS.md` §撤退手順)。
 */

import {
  type Event,
  InMemorySessionService,
  LlmAgent,
  Runner,
} from '@google/adk';
import type { BaseLlm } from '@google/adk';
import type { Content } from '@google/genai';

import type { SkillRegistry } from '../../skills/registry';
import { skillRegistryToAdkTools } from '../adapters/skillRegistryToAdkTools';
import type { TraceSink } from '../tracing';

/** デフォルト app 名 (smoke で使用、本番値ではない)。 */
export const RUNNER_SMOKE_DEFAULT_APP_NAME = 'trader-note-build-ai-adk-smoke';

/** デフォルト agent 名 (smoke で使用)。 */
export const RUNNER_SMOKE_DEFAULT_AGENT_NAME = 'adk-runner-smoke-agent';

/** デフォルト instruction (Step 3 Phase 1 smoke 用、本番では使わない)。 */
export const RUNNER_SMOKE_DEFAULT_INSTRUCTION =
  'Step 3 Phase 1 smoke agent. dry-run only. 本番判断には使用しない。';

/**
 * Runner smoke を構築するための入力。
 *
 * 呼び出し側の責務:
 * - `model`: 実 LLM を呼ばずに済む構成を優先する (`STEP_3_KICKOFF.md` §5.3)。
 *   テストでは stub `BaseLlm` を供給する。
 * - `registry`: 既存 `buildDefaultSkillRegistry()` の戻り値、またはテスト用の
 *   最小 SkillRegistry を渡す。
 * - `traceSink`: 観測したい場合に `InMemoryTraceSink` 等を渡す。
 *   未指定なら `skillRegistryToAdkTools` の既存挙動 (= 何も記録しない) を保つ。
 */
export interface RunnerSmokeConfig {
  /** ADK `Runner` の `appName`。識別子のみで、外部 IO は発生しない。 */
  readonly appName?: string;
  /** LlmAgent の `name`。adapter 内 trace event の `agentName` 候補。 */
  readonly agentName?: string;
  /** LlmAgent の `instruction`。`STEP_3_KICKOFF.md` §10.5 と §6.4 を厳守する文字列を渡す。 */
  readonly instruction?: string;
  /** ADK Runner に組み込む LLM。stub / 本番 LLM どちらでも可 (呼び出し側責務)。 */
  readonly model: BaseLlm;
  /** ADK FunctionTool に変換する既存スキル群。 */
  readonly registry: SkillRegistry;
  /** trace event 出力先。未指定なら `skillRegistryToAdkTools` 側で no-op となる。 */
  readonly traceSink?: TraceSink;
}

/**
 * `buildRunnerSmoke()` の戻り値。
 * 検証側で個別 component の挙動を確認できるように、構築物をそのまま公開する。
 */
export interface RunnerSmokeArtifacts {
  readonly runner: Runner;
  readonly agent: LlmAgent;
  readonly sessionService: InMemorySessionService;
}

/**
 * Step 3 Phase 1 smoke の最小構成を構築する。
 *
 * 本関数は **構築のみ**を行い、Runner を実行しない。実行は
 * {@link runEphemeralSmoke} に分離している。
 *
 * 構成:
 * ```
 * SkillRegistry
 *   ↓ skillRegistryToAdkTools({ traceSink })
 * FunctionTool[]
 *   ↓ LlmAgent({ name, model, instruction, tools })
 * LlmAgent
 *   ↓ Runner({ appName, agent, sessionService: new InMemorySessionService() })
 * Runner
 * ```
 *
 * @param config smoke 構成
 * @returns 構築済みの Runner / LlmAgent / InMemorySessionService
 */
export function buildRunnerSmoke(config: RunnerSmokeConfig): RunnerSmokeArtifacts {
  // adapter を通して既存 Skill を ADK FunctionTool に変換 (Step 1/2 で実装済み)。
  // traceSink を渡すと Skill 実行前後の trace event が記録される (Step 2 Phase 3 の仕様)。
  const tools = skillRegistryToAdkTools(config.registry, {
    traceSink: config.traceSink,
  });

  const agent = new LlmAgent({
    name: config.agentName ?? RUNNER_SMOKE_DEFAULT_AGENT_NAME,
    model: config.model,
    instruction: config.instruction ?? RUNNER_SMOKE_DEFAULT_INSTRUCTION,
    tools,
  });

  // session-less 方針: InMemorySessionService のみ採用。DatabaseSessionService は不採用。
  const sessionService = new InMemorySessionService();

  const runner = new Runner({
    appName: config.appName ?? RUNNER_SMOKE_DEFAULT_APP_NAME,
    agent,
    sessionService,
  });

  return { runner, agent, sessionService };
}

/**
 * `Runner.runEphemeral` を実行し、AsyncGenerator が yield する全 Event を配列に
 * 集めて返す。session-less 方針に従い `runEphemeral` のみ使用する。
 *
 * テスト / smoke での観測に使う。本番ループからは呼ばない。
 *
 * @param runner 構築済み Runner
 * @param params runEphemeral 引数 (userId / newMessage)
 * @returns yield された Event の配列 (順序保持)
 */
export async function runEphemeralSmoke(
  runner: Runner,
  params: {
    readonly userId: string;
    readonly newMessage: Content;
  },
): Promise<Event[]> {
  const events: Event[] = [];
  // Runner 経由でも adapter 内の traceSink.record() が発火する想定 (Step 2 spike §2.3)。
  // ここでは Runner 内部の event stream を全件回収するだけ。
  const generator = runner.runEphemeral({
    userId: params.userId,
    newMessage: params.newMessage,
  });
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}
