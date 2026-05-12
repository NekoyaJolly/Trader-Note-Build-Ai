/**
 * skillRegistryToAdkTools: SkillRegistry → ADK FunctionTool[] アダプター
 *
 * Step 1 Ticket T6 で実装。
 * 既存 `SkillRegistry` を ADK Runner から利用可能な `FunctionTool` 配列に変換する
 * factory 関数。各 Skill につき 1 つの FunctionTool を生成し、ADK 経由の実行で
 * 既存 `SkillRegistry.invoke()` と等価な結果を返す。
 *
 * 対応する既存実装: `src/side-b/skills/registry.ts` の `SkillRegistry`
 * ADK 化の目的: ADK Runner で既存スキル群を再利用 (Step 1)
 * 採用方式: **方式 B (Zod)** — `jsonSchemaToZod` で SkillInputSchema → Zod に変換
 *
 * 設計書: /src/side-b/adk/adapters/README.md §2 (パターン) §4 (採用方式) §6 (エラー伝播)
 *
 * 確定方針 (T2.5 / Nekoさん承認):
 * - factory 関数: `1 Skill = 1 FunctionTool` で N 個の FunctionTool を生成
 * - parameters: `jsonSchemaToZod()` で SkillInputSchema (JSONSchema subset) を Zod に変換
 * - execute: 内部で `registry.invoke()` を呼び、`SkillResult` を**そのまま return**
 *   (throw に変換しない、既存 invoke の挙動を完全保持)
 * - Zod validation error は ADK 標準の throw 伝播に任せる (= `Error in tool '...': ...`)
 *
 * 依存方向 (AGENTS.md):
 * - adk → 既存 (skills/) のみ。逆向きは禁止
 * - 既存 SkillRegistry / Skill / SkillContext は一切改変しない
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';

import type { SkillRegistry } from '../../skills/registry';
import type { Skill } from '../../skills/types';
import { jsonSchemaToZod } from './jsonSchemaToZod';
import { toSkillContext } from './skillContext';

/**
 * 単一 Skill → FunctionTool 変換。
 *
 * 内部使用 (export しない)。`skillRegistryToAdkTools` から各 Skill ごとに呼ばれる。
 */
function skillToFunctionTool(
  registry: SkillRegistry,
  skill: Skill,
): FunctionTool<z.ZodObject<z.ZodRawShape>> {
  // SkillInputSchema は `type: 'object'` 固定 → 変換結果は ZodObject になる。
  // 実行時 instanceof で型を狭め、ADK FunctionTool に要求される
  // `z.ZodObject<z.ZodRawShape>` 型に narrow する。
  const zodSchema = jsonSchemaToZod(skill.inputSchema, { skillName: skill.name });
  if (!(zodSchema instanceof z.ZodObject)) {
    // SkillInputSchema の型契約 (type:'object') が破られている。設計エラー。
    throw new Error(
      `[skillRegistryToAdkTools] Skill '${skill.name}': inputSchema must be 'object' type at the top level (got non-ZodObject)`,
    );
  }
  const parameters = zodSchema as z.ZodObject<z.ZodRawShape>;

  return new FunctionTool({
    name: skill.name,
    description: skill.description,
    parameters,
    // ADK が自動 Zod validation を行うため、execute に渡される input は parse 済み。
    // 型としては z.infer<typeof parameters> だが、parameters が動的 ZodObject のため
    // TS 上は `Record<string, unknown>` 相当として扱う。
    execute: async (input, ctx) => {
      // SkillResult を**そのまま return** (throw しない)。
      // 既存 SkillRegistry.invoke() が { ok: boolean, ... } を返す挙動を完全保持し、
      // ADK 経由でも LLM 視点で構造化エラーが見える。
      const skillContext = toSkillContext(ctx);
      return await registry.invoke(skill.name, input, skillContext);
    },
  });
}

/**
 * SkillRegistry を ADK FunctionTool 配列に変換する。
 *
 * `registry.list()` が返す全 Skill を順に変換する。汎用的に処理するため、個別 Skill
 * を特別扱いする分岐は **禁止** (KICKOFF §T6 禁止事項)。
 *
 * 呼び出し時のキャッシュ・メモ化も追加しない (シンプルさ優先)。Runner 側で必要なら
 * 上位レイヤで構築結果を保持する。
 *
 * @param registry 変換対象の SkillRegistry。
 * @returns 各 Skill に対応する FunctionTool 配列。空 registry の場合は空配列。
 *
 * @example
 * ```typescript
 * import { buildDefaultSkillRegistry } from 'src/side-b/skills';
 * import { skillRegistryToAdkTools } from 'src/side-b/adk/adapters';
 *
 * const registry = buildDefaultSkillRegistry();
 * const tools = skillRegistryToAdkTools(registry);
 * // tools を ADK Runner / LlmAgent.tools に渡して利用
 * ```
 */
export function skillRegistryToAdkTools(
  registry: SkillRegistry,
): FunctionTool<z.ZodObject<z.ZodRawShape>>[] {
  return registry.list().map((skill) => skillToFunctionTool(registry, skill));
}
