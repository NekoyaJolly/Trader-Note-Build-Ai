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

import type { McpToolDefinition, McpToolResult } from './types';
import type { JsonValue } from '../../utils/jsonValue';
import type {
  BaseSkill,
  Skill,
  SkillContext,
  SkillInvocationContext,
  SkillResult,
  SkillJsonInput,
  SkillJsonOutput,
} from './types';

export class SkillRegistry {
  private readonly skills = new Map<string, BaseSkill>();

  /**
   * 個別スキル (Skill<TInput, TOutput>) を Registry に登録する。
   *
   * 個別スキルの具体型は TypeScript レベルで消去し、Registry 内では BaseSkill として保持する。
   * **同一参照** を保存することで `get()` / `list()` の戻り値が登録時の原参照と一致する
   * (登録 → 取得の identity を契約として保つ)。
   *
   * 関数引数の反変性で `Skill<TInput, TOutput>` を直接 `BaseSkill` に代入できないため、
   * `never` を介した構造的キャストで橋渡しする (実行時挙動は同一)。
   */
  register<TInput, TOutput>(skill: Skill<TInput, TOutput>): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`[SkillRegistry] Skill already registered: ${skill.name}`);
    }
    this.skills.set(skill.name, skill as BaseSkill);
  }

  /**
   * 複数スキルを一括登録する。
   *
   * 要素ごとに `TInput` / `TOutput` が異なる場合、配列リテラルでは共通の最広型
   * (= `Skill<JsonValue, JsonValue>`) に推論できないことがあるため、個別の
   * `register()` ループで呼び出し側に型を尊重させる構造にしている。
   */
  registerAll(skills: ReadonlyArray<Skill<JsonValue, JsonValue>>): void {
    for (const s of skills) this.register(s);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  get(name: string): BaseSkill | undefined {
    return this.skills.get(name);
  }

  list(): BaseSkill[] {
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
        // JSONSchema ノード型は Record<string, SkillJsonSchemaNode> → MCP は
        // Record<string, object> を要求。構造的に互換のため安全にダウンキャスト。
        properties: s.inputSchema.properties,
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
  async invoke<T = SkillJsonOutput>(
    name: string,
    input: SkillJsonInput,
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
      // T は呼び出し側が想定する具体的な戻り値型。BaseSkill.execute の戻り値 (JsonValue)
      // を構造的に下位型 T へキャストする。
      return { ok: true, data: data as T };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof Error && error.name && error.name !== 'Error'
          ? error.name
          : 'SKILL_EXECUTION_ERROR';
      // details は Error インスタンスのときは原例外をそのまま保持 (デバッグ容易性 + 後方互換)。
      // SkillErrorDetails 型が `Error | SkillErrorDetailsObject` の union のため型整合。
      // JSON シリアライズパスでは呼び出し側で stack/message を抽出する想定。
      return {
        ok: false,
        error: { code, message, details: error instanceof Error ? error : undefined },
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
    args: Record<string, JsonValue>,
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
