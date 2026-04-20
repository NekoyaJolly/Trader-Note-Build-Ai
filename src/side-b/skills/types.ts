/**
 * Side-B スキル基盤 型定義 (Phase 5.5)
 *
 * エージェントが自律的に呼び出せる「スキル(ツール)」を統一インターフェースで
 * 表現するための型。OpenAI function calling と互換な JSONSchema を持ち、
 * SkillRegistry 経由で AgentLoop からも呼び出せる。
 *
 * 設計方針:
 * - 各スキルは既存の決定論ロジック層(EdgeLedger / StrategistAgent 等)をラップ
 * - execute は例外を投げて良い。Registry 側で SkillResult にラップされる
 *   (ユーザー指示: 「エラーを握りつぶさない」)
 * - context には呼び出しエージェント名・理由・時刻を含め、将来のトレースと
 *   日次サマリーシステムへの入力源として利用
 */

/**
 * スキル呼び出し時のコンテキスト。
 *
 * - `callerAgent`: 呼び出し元エージェント名(例: 'discovery', 'strategist')。
 *   ユーザー手動や統合テストからの呼び出しでは省略可。
 * - `callerReason`: LLM が自由記述で渡す呼び出し理由。トレースとデバッグ用。
 * - `timestamp`: 呼び出し時刻。Registry.invoke() が省略時に現在時刻を入れる。
 */
export interface SkillContext {
  callerAgent?: string;
  callerReason?: string;
  timestamp: Date;
}

/** Registry.invoke に渡す部分コンテキスト(timestamp 省略時は現在時刻)。 */
export type SkillInvocationContext = Partial<SkillContext>;

/** スキル実行時のエラー(Registry が wrap する)。 */
export interface SkillError {
  /** エラーコード(例: 'SKILL_NOT_FOUND', 'INVALID_INPUT', 'ZodError') */
  code: string;
  /** 人間向けメッセージ */
  message: string;
  /** 元例外(デバッグ用。シリアライズ時は注意) */
  details?: unknown;
}

/** スキル実行結果。ok=false の場合は error を参照。 */
export type SkillResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: SkillError };

/**
 * スキル入力スキーマ。JSONSchema draft-07 サブセット。
 * OpenAI function calling / MCP ツール定義と互換。
 */
export interface SkillInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * スキル定義。
 *
 * TInput / TOutput は TypeScript レベルの補助で、
 * 実行時バリデーションは execute() 内で Zod などを使って行う。
 */
export interface Skill<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: SkillInputSchema;
  execute(input: TInput, context: SkillContext): Promise<TOutput>;
}
