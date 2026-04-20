/**
 * SkillRegistry (Phase 5.5)
 *
 * スキルを登録・列挙・実行する中央管理クラス。
 * AgentLoop の mcpClient と互換な形でツール定義を公開できるため、
 * 既存の自律ループ実装を大きく変えずに差し込める。
 *
 * エラーハンドリング方針(ユーザー指示):
 * - スキル内部の例外は握りつぶさず、Registry.invoke() が SkillResult(ok=false)
 *   に wrap する。details に元例外を保持するので、呼び出し側でロギング可能。
 */

import type { McpToolDefinition, McpToolResult } from '../agent/mcpClient';
import type {
  Skill,
  SkillContext,
  SkillInvocationContext,
  SkillResult,
} from './types';

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`[SkillRegistry] Skill already registered: ${skill.name}`);
    }
    this.skills.set(skill.name, skill);
  }

  registerAll(skills: readonly Skill[]): void {
    for (const s of skills) this.register(s);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * MCP ツール定義形式で返す(AgentLoop / AIProvider.convertToolsToOpenAIFormat 互換)。
   * 既存の McpClientManager.listTools() と同じ形状のため、差し替え容易。
   */
  toMcpToolDefinitions(): McpToolDefinition[] {
    return this.list().map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: {
        type: 'object',
        properties: s.inputSchema.properties as Record<string, object> | undefined,
        required: s.inputSchema.required,
      },
    }));
  }

  /**
   * スキルを実行し、結果を SkillResult に包んで返す。
   *
   * 例外は握りつぶさず SkillResult(ok=false) の error.details に保持する。
   * Zod バリデーション失敗は code='ZodError' で返される。
   */
  async invoke<T = unknown>(
    name: string,
    input: unknown,
    context: SkillInvocationContext = {},
  ): Promise<SkillResult<T>> {
    const skill = this.skills.get(name);
    if (!skill) {
      return {
        ok: false,
        error: {
          code: 'SKILL_NOT_FOUND',
          message: `Skill not found: ${name}`,
        },
      };
    }

    const ctx: SkillContext = {
      callerAgent: context.callerAgent,
      callerReason: context.callerReason,
      timestamp: context.timestamp ?? new Date(),
    };

    try {
      const data = await skill.execute(input, ctx);
      return { ok: true, data: data as T };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof Error && error.name && error.name !== 'Error'
          ? error.name
          : 'SKILL_EXECUTION_ERROR';
      return {
        ok: false,
        error: { code, message, details: error },
      };
    }
  }

  /**
   * McpToolResult 形式で実行結果を返す shim。
   *
   * AgentLoop 内で `this.mcpClient.callTool(...)` を呼んでいる箇所を
   * この関数に差し替えると、スキルを MCP ツールのように扱える。
   */
  async callAsMcpTool(
    name: string,
    args: Record<string, unknown>,
    context: SkillInvocationContext = {},
  ): Promise<McpToolResult> {
    const result = await this.invoke(name, args, context);
    if (result.ok) {
      return {
        content: [{ type: 'text', text: JSON.stringify(result.data) }],
        isError: false,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: result.error.code,
            message: result.error.message,
          }),
        },
      ],
      isError: true,
    };
  }
}
