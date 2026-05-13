/**
 * skillRegistryToAdkTools: SkillRegistry → ADK FunctionTool[] アダプター
 *
 * Step 1 Ticket T6 で実装。
 * Step 2 Phase 3 で optional tracing 機能を追加 (既存 signature 維持)。
 *
 * 対応する既存実装: `src/side-b/skills/registry.ts` の `SkillRegistry`
 * ADK 化の目的: ADK Runner で既存スキル群を再利用 (Step 1)
 * 採用方式: **方式 B (Zod)** — `jsonSchemaToZod` で SkillInputSchema → Zod に変換
 *
 * 設計書:
 * - /src/side-b/adk/adapters/README.md §2 (パターン) §4 (採用方式) §6 (エラー伝播)
 * - docs/architecture/STEP_2_ADK_TRACING_SPIKE.md §3 (tracing 方針)
 *
 * 確定方針 (T2.5 / Nekoさん承認):
 * - factory 関数: `1 Skill = 1 FunctionTool` で N 個の FunctionTool を生成
 * - parameters: `jsonSchemaToZod()` で SkillInputSchema (JSONSchema subset) を Zod に変換
 * - execute: 内部で `registry.invoke()` を呼び、`SkillResult` を**そのまま return**
 *   (throw に変換しない、既存 invoke の挙動を完全保持)
 * - Zod validation error は ADK 標準の throw 伝播に任せる (= `Error in tool '...': ...`)
 *
 * Step 2 Phase 3 で追加した tracing 仕様 (KICKOFF §6 Phase 3):
 * - `options.traceSink` 未指定時は Step 1 と完全同挙動 (NoopTraceSink 相当)
 * - 成功時: `adk.skill.started` + `adk.skill.completed` の 2 event を record
 * - SkillResult error 時: `adk.skill.started` + `adk.skill.failed` (status: 'error')
 * - traceSink.record の失敗で Skill 実行を絶対に壊さない (try/catch で握りつぶす)
 * - **Zod validation error の trace は記録されない**: ADK が `execute` を呼ぶ前で throw
 *   するため、adapter 内で started event を発生させる前に throw 起点が来る。完全な
 *   `started + failed (thrown)` 記録には wrap が必要だが、wrap すると LLM 用 schema
 *   公開 (parameters declaration) が崩れるため Step 2 では採用しない。Step 3 で Runner
 *   経由統合する際に再検討する。
 *
 * 依存方向 (AGENTS.md):
 * - adk → 既存 (skills/) のみ。逆向きは禁止
 * - 既存 SkillRegistry / Skill / SkillContext は一切改変しない
 */

import { randomUUID } from 'node:crypto';

import { FunctionTool } from '@google/adk';
import type { Context } from '@google/adk';
import { z } from 'zod';

import type { SkillRegistry } from '../../skills/registry';
import type { Skill, SkillResult } from '../../skills/types';
import {
  NoopTraceSink,
  payloadToSummary,
  shortenErrorMessage,
} from '../tracing';
import type { AdkTraceEvent, TraceSink } from '../tracing';
import { jsonSchemaToZod } from './jsonSchemaToZod';
import { toSkillContext } from './skillContext';

// ============================================================================
// 公開 options 型
// ============================================================================

/**
 * `skillRegistryToAdkTools` の追加オプション。
 *
 * すべて optional。未指定時は Step 1 と完全同挙動 (Step 2 Phase 3 互換性維持)。
 */
export interface SkillRegistryToAdkToolsOptions {
  /**
   * trace event の出力先。
   *
   * - 未指定 / `undefined` → `NoopTraceSink` 相当 (= 何も記録しない)
   * - 指定すると Skill 実行前後で `AdkTraceEvent` が `record()` される
   *
   * **重要**: `record()` が throw / reject しても Skill 実行は壊れない (adapter が catch)
   */
  readonly traceSink?: TraceSink;
}

// ============================================================================
// 内部: trace 記録ヘルパー
// ============================================================================

/**
 * Context の string field を「絶対に throw しない」形で取得する。
 *
 * ADK Context は class で、フィールドは getter で実装される (内部で `invocationContext`
 * を読みに行く)。テスト用 mock の場合、prototype の getter がそのまま動いて
 * `invocationContext` が undefined のため TypeError を起こすことがある。
 *
 * 本関数は getter 経由のアクセスを try/catch で囲み、失敗時は undefined を返す。
 * 本番 Runner 経由の Context では try ブロックが成功するので機能影響なし。
 */
function safeContextString(
  ctx: Context | undefined,
  getter: (c: Context) => string | undefined,
): string | undefined {
  if (!ctx) return undefined;
  try {
    const v = getter(ctx);
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `traceSink.record()` を「絶対に throw しない」形で呼ぶ。
 *
 * 同期 throw も Promise reject も catch して握りつぶす。Skill 実行を壊さないため。
 */
function safeRecord(sink: TraceSink, event: AdkTraceEvent): void {
  try {
    const maybePromise = sink.record(event);
    if (maybePromise instanceof Promise) {
      // 非同期実装の reject も握りつぶす
      maybePromise.catch(() => {
        /* swallow */
      });
    }
  } catch {
    // 同期 throw も握りつぶす
  }
}

// ============================================================================
// 内部: 単一 Skill → FunctionTool 変換
// ============================================================================

/**
 * 単一 Skill → FunctionTool 変換 (内部使用、export しない)。
 */
function skillToFunctionTool(
  registry: SkillRegistry,
  skill: Skill,
  traceSink: TraceSink,
): FunctionTool<z.ZodObject<z.ZodRawShape>> {
  // SkillInputSchema は `type: 'object'` 固定 → 変換結果は ZodObject になる。
  const zodSchema = jsonSchemaToZod(skill.inputSchema, { skillName: skill.name });
  if (!(zodSchema instanceof z.ZodObject)) {
    throw new Error(
      `[skillRegistryToAdkTools] Skill '${skill.name}': inputSchema must be 'object' type at the top level (got non-ZodObject)`,
    );
  }
  const parameters = zodSchema as z.ZodObject<z.ZodRawShape>;

  return new FunctionTool({
    name: skill.name,
    description: skill.description,
    parameters,
    execute: async (input, ctx) => {
      const skillContext = toSkillContext(ctx);

      // trace の root span 用 ID を生成 (UUID v4)。
      // started と completed/failed event を `parentTraceId` で紐付ける。
      const parentTraceId = randomUUID();
      const startedAt = new Date();

      // ADK Context から取れる識別子 (optional)。
      // 本番 Runner 経由なら getter で取れる、テスト mock の prototype getter が
      // throw する場合は undefined にフォールバック。
      const invocationId = safeContextString(ctx, (c) => c.invocationId);
      const functionCallId = safeContextString(ctx, (c) => c.functionCallId);

      // started event
      safeRecord(traceSink, {
        kind: 'adk.skill.started',
        traceId: parentTraceId,
        invocationId,
        functionCallId,
        agentName: skillContext.callerAgent ?? '',
        skillName: skill.name,
        callerReason: skillContext.callerReason ?? '',
        startedAt,
        status: 'started',
        argsSummary: payloadToSummary(input),
      });

      // Skill 実行 (既存 invoke の挙動完全保持)
      const result: SkillResult = await registry.invoke(skill.name, input, skillContext);

      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();
      const isOk = result.ok;

      // completed / failed event
      safeRecord(traceSink, {
        kind: isOk ? 'adk.skill.completed' : 'adk.skill.failed',
        traceId: randomUUID(),
        parentTraceId,
        invocationId,
        functionCallId,
        agentName: skillContext.callerAgent ?? '',
        skillName: skill.name,
        callerReason: skillContext.callerReason ?? '',
        startedAt,
        endedAt,
        durationMs,
        status: isOk ? 'ok' : 'error',
        errorCode: isOk ? undefined : result.error.code,
        errorMessage: isOk ? undefined : shortenErrorMessage(result.error.message),
        argsSummary: payloadToSummary(input),
        resultSummary: isOk ? payloadToSummary(result.data) : undefined,
      });

      // SkillResult を**そのまま return** (throw しない、Step 1 挙動維持)
      return result;
    },
  });
}

// ============================================================================
// 公開関数
// ============================================================================

/**
 * SkillRegistry を ADK FunctionTool 配列に変換する。
 *
 * @param registry 変換対象の SkillRegistry。
 * @param options 追加オプション (trace 設定など、すべて optional)。
 * @returns 各 Skill に対応する FunctionTool 配列。空 registry の場合は空配列。
 *
 * @example
 * ```typescript
 * import { buildDefaultSkillRegistry } from 'src/side-b/skills';
 * import { skillRegistryToAdkTools, InMemoryTraceSink } from 'src/side-b/adk';
 *
 * const registry = buildDefaultSkillRegistry();
 *
 * // Step 1 互換 (trace なし)
 * const toolsNoTrace = skillRegistryToAdkTools(registry);
 *
 * // Step 2: trace 付き
 * const sink = new InMemoryTraceSink();
 * const tools = skillRegistryToAdkTools(registry, { traceSink: sink });
 * // ... tool 実行後、sink.events に AdkTraceEvent が蓄積される
 * ```
 */
export function skillRegistryToAdkTools(
  registry: SkillRegistry,
  options?: SkillRegistryToAdkToolsOptions,
): FunctionTool<z.ZodObject<z.ZodRawShape>>[] {
  // traceSink 未指定時は NoopTraceSink を使う (= record 呼び出しのコストはあるが
  // 何も保存されない、Step 1 挙動と機能等価)。
  const traceSink: TraceSink = options?.traceSink ?? new NoopTraceSink();
  return registry.list().map((skill) => skillToFunctionTool(registry, skill, traceSink));
}
