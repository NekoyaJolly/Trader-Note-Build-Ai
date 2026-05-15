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

import type { JsonValue } from '../../utils/jsonValue';

/**
 * スキル基盤で扱う汎用入出力値型。
 *
 * 各スキルの実装側で具体型に再定義することが前提だが、Registry レイヤーや
 * 内部呼び出しでは個別スキルを意識せずに扱う必要があるため、JSON 互換の
 * 具体型 (`JsonValue` ベース) で抽象化している。
 * - LLM/外部入力 → Registry → 各スキル の流路で、Registry は構造を解釈しない
 * - 型キーワード `unknown` を使わずに「JSON 互換の何か」を表現する
 */
export type SkillJsonInput = JsonValue;
export type SkillJsonOutput = JsonValue;

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

/**
 * エラー詳細のフィールド型。
 *
 * 元例外スタックを文字列で保持しつつ、構造化情報 (Zod issues 等) も
 * `JsonValue` で持てるよう union している。
 */
export interface SkillErrorDetails {
  /** 元例外のスタックトレース等 */
  stack?: string;
  /** Zod issues 等の構造化情報 */
  issues?: JsonValue;
  /** その他構造化メタ情報 */
  meta?: JsonValue;
}

/** スキル実行時のエラー(Registry が wrap する)。 */
export interface SkillError {
  /** エラーコード(例: 'SKILL_NOT_FOUND', 'INVALID_INPUT', 'ZodError') */
  code: string;
  /** 人間向けメッセージ */
  message: string;
  /** 元例外(デバッグ用。シリアライズ時は注意) */
  details?: SkillErrorDetails;
}

/** スキル実行結果。ok=false の場合は error を参照。 */
export type SkillResult<T = SkillJsonOutput> =
  | { ok: true; data: T }
  | { ok: false; error: SkillError };

/**
 * JSONSchema プロパティ定義の最小サブセット。
 *
 * OpenAI function calling / MCP の仕様準拠で、再帰的に `properties` や
 * `items` を持つ。`unknown` を避け、明示的な JSON ノード型として定義。
 */
export interface SkillJsonSchemaNode {
  type?: string | string[];
  description?: string;
  enum?: JsonValue[];
  properties?: Record<string, SkillJsonSchemaNode>;
  required?: string[];
  items?: SkillJsonSchemaNode | SkillJsonSchemaNode[];
  additionalProperties?: boolean | SkillJsonSchemaNode;
  default?: JsonValue;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  // 拡張可能性のため一部 JSON 値の任意キーを許容
  [key: string]: JsonValue | SkillJsonSchemaNode | SkillJsonSchemaNode[] | undefined;
}

/**
 * スキル入力スキーマ。JSONSchema draft-07 サブセット。
 * OpenAI function calling / MCP ツール定義と互換。
 */
export interface SkillInputSchema {
  type: 'object';
  properties?: Record<string, SkillJsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Registry レイヤーで保持するためのスキルの共通基底型。
 *
 * - 個別スキルの TInput / TOutput を消去 (= 構造的に「何でも受けて何でも返す」) する。
 * - Registry は中身を解釈せず、AgentLoop / MCP に橋渡しするだけなので、
 *   個別スキルの型契約は呼び出し側の Skill<TInput, TOutput> 側で表現する。
 * - any/unknown を書かないために、入出力には JSON 互換型 (`JsonValue`) を採用。
 */
export interface BaseSkill {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: SkillInputSchema;
  /**
   * 入力は JsonValue (= LLM/MCP から来る JSON 互換値)、出力は JsonValue。
   * 実装側は安全にダウンキャスト・narrow した上で具体型として扱う。
   */
  execute(input: SkillJsonInput, context: SkillContext): Promise<SkillJsonOutput>;
}

/**
 * スキル定義。
 *
 * TInput / TOutput は TypeScript レベルの補助で、
 * 実行時バリデーションは execute() 内で Zod などを使って行う。
 *
 * 注意: 個別スキルの TInput / TOutput は具体型 (Zod スキーマから推論された型等) を
 * 取り、`BaseSkill` (= Registry が保持する型) と構造互換にはならないことが多い。
 * Registry 登録時は `toBaseSkill()` でブリッジするか、構造的キャストを介する。
 */
export interface Skill<TInput = SkillJsonInput, TOutput = SkillJsonOutput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: SkillInputSchema;
  execute(input: TInput, context: SkillContext): Promise<TOutput>;
}
