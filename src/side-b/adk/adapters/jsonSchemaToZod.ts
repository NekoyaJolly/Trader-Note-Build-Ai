/**
 * jsonSchemaToZod: SkillInputSchema → Zod 変換ユーティリティ
 *
 * Step 1 Ticket T3 (採用方式 B: Zod パターン) で実装。
 * 既存 `SkillInputSchema` (JSONSchema draft-07 subset) を ADK FunctionTool の
 * `parameters` に渡せる Zod スキーマに変換する。
 *
 * 設計書: /src/side-b/adk/adapters/README.md §4.7
 *
 * 重要な実装方針 (Nekoさん T2.5 承認):
 * - 外部パッケージ採用しない (自前実装)
 * - 未対応 schema は z.any() で握りつぶさず、必ず throw
 * - throw 時は skill 名 / field path を含む構造化エラー
 * - サポート対象: type/properties/required/items/enum/description/null/additionalProperties
 *   + type union (配列形)
 * - 未対応: pattern/format/minimum/maximum/minLength/maxLength/oneOf/anyOf/allOf/$ref
 *
 * 依存方向: adk → 既存 (skills/) のみ。逆向きは禁止
 */

import { z } from 'zod';
import type { SkillInputSchema } from '../../skills/types';

// ============================================================================
// エラー型
// ============================================================================

/**
 * jsonSchemaToZod 変換時に未対応スキーマや不正データに遭遇した場合のエラー。
 *
 * - `skillName`: どの Skill の inputSchema 変換中だったか
 * - `fieldPath`: ルートからの dotted/bracketed パス (例: `'conditions[].rule'`)
 * - `reason`: 何が問題かを具体的に
 */
export class JsonSchemaToZodError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly fieldPath: string,
    public readonly reason: string,
  ) {
    super(`[jsonSchemaToZod] Skill '${skillName}' field '${fieldPath}': ${reason}`);
    this.name = 'JsonSchemaToZodError';
  }
}

// ============================================================================
// JsonSchemaFragment 型 (JSONSchema draft-07 subset)
// ============================================================================

/**
 * サポート対象のプリミティブ・複合型。
 *
 * 既存 SkillInputSchema は `type: 'object'` 固定だが、本ユーティリティは
 * その内部 properties の各 type を再帰的に変換する必要があるため、より広い型を扱う。
 */
type JsonSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array';

/** サポート対象 type のリスト (ランタイム検証用)。 */
const SUPPORTED_TYPES: readonly JsonSchemaType[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'object',
  'array',
] as const;

/**
 * enum で許容するリテラル値の型 (JSON 値)。
 */
type JsonEnumValue = string | number | boolean | null;

/**
 * 内部で扱う JSON Schema フラグメント型。
 *
 * 既存 `SkillInputSchema` は `properties?: Record<string, unknown>` を持つため、
 * 互換性のため本型でも `properties` の値型は `JsonSchemaFragment` ではなく**任意**を許容する
 * (実態は再帰的に JsonSchemaFragment 構造を持つ JSON 値、内部で再帰時に narrow する)。
 *
 * `type` も string union ではなく自由 string を許容することで、未対応 type 値
 * (`'unknown-type'` 等) を**ランタイム検出して throw**する経路を確保する。
 *
 * Zod で表現できない field を保持して**後で throw する**ためにも、未対応 keyword は
 * optional field として宣言し、変換時に存在チェックで throw する。
 */
export interface JsonSchemaFragment {
  // サポート対象 (string で受けてランタイム検証)
  type?: string | readonly string[];
  properties?: Record<string, JsonSchemaFragment>;
  required?: readonly string[];
  items?: JsonSchemaFragment;
  enum?: readonly JsonEnumValue[];
  description?: string;
  additionalProperties?: boolean;

  // 未対応 keyword (検出 → throw 用)
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: readonly JsonSchemaFragment[];
  anyOf?: readonly JsonSchemaFragment[];
  allOf?: readonly JsonSchemaFragment[];
  $ref?: string;
  $defs?: Record<string, JsonSchemaFragment>;
}

/**
 * 型ガード: 文字列が `JsonSchemaType` のいずれかかを判定する。
 */
function isJsonSchemaType(value: string): value is JsonSchemaType {
  return (SUPPORTED_TYPES as readonly string[]).includes(value);
}

/**
 * 型ガード: 入力値が「plain object として扱える JsonSchemaFragment」であるか判定する。
 *
 * - `null` / `undefined` / プリミティブ / 配列 は false
 * - その他の object は true (内部 keyword は `convertFragment` でさらに検証する)
 *
 * 不正な properties 値 (null / 文字列等) が JSON Schema に入っている場合、convertFragment 冒頭で
 * これを使って **JsonSchemaToZodError として throw** する。これにより TypeError ではなく
 * 構造化エラーとしてレポートできる (skill 名 / field path 付き)。
 *
 * ESLint 例外: 型ガードは性質上、未知の値 (`unknown`) を受け取って絞り込む関数。プロジェクト
 * 規約の `unknown` 禁止は「業務ロジック内で曖昧な型を放置するな」の意図のため、入力検証用の
 * 型ガード一点に限定して disable する。
 */
// eslint-disable-next-line no-restricted-syntax
function isPlainSchemaObject(value: unknown): value is JsonSchemaFragment {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ============================================================================
// 公開関数
// ============================================================================

/**
 * 変換オプション。
 *
 * - `skillName`: エラー時のメッセージで使う
 * - `fieldPath`: 再帰中に構築されるパス。トップレベル呼び出し時は省略 (= '$' ルートとして扱う)
 */
export interface JsonSchemaToZodOptions {
  skillName: string;
  fieldPath?: string;
}

/**
 * JSON Schema フラグメントを Zod スキーマに変換する。
 *
 * 既存 `SkillInputSchema` (= JSONSchema draft-07 subset) と、本ユーティリティ内部の
 * `JsonSchemaFragment` のいずれも受け取れる。実態は同構造のため、内部で narrow して扱う。
 *
 * @param schema 既存 `SkillInputSchema` または その内部フラグメント。
 * @param options 変換オプション (`skillName` 必須、`fieldPath` は再帰で構築)。
 * @returns 変換された Zod スキーマ (任意の Zod 型)。
 * @throws {JsonSchemaToZodError} 未対応 schema features に遭遇した場合。
 */
export function jsonSchemaToZod(
  schema: SkillInputSchema | JsonSchemaFragment,
  options: JsonSchemaToZodOptions,
): z.ZodTypeAny {
  const fieldPath = options.fieldPath ?? '$';
  const opts: Required<JsonSchemaToZodOptions> = {
    skillName: options.skillName,
    fieldPath,
  };

  // SkillInputSchema (properties: Record<string, unknown>) を JsonSchemaFragment として narrow。
  // 構造は同じ (JSON value tree)、内部で再帰時に各 fragment を再度検証する。
  // 不正な値 (null / プリミティブ / 配列 等) は convertFragment 冒頭で plain object 検証する。
  return convertFragment(schema as JsonSchemaFragment, opts);
}

// ============================================================================
// 内部実装
// ============================================================================

/**
 * 単一フラグメントを Zod に変換する内部再帰関数。
 */
function convertFragment(
  schema: JsonSchemaFragment,
  opts: Required<JsonSchemaToZodOptions>,
): z.ZodTypeAny {
  // 0. plain object 検証 (最優先)
  //
  // properties の値が null / プリミティブ / 配列 等の不正な形だった場合、
  // ここで構造化エラー (JsonSchemaToZodError) として throw する。検証なしだと
  // `schema.pattern` などの property アクセス時に TypeError で落ち、skill 名や
  // field path が失われる。
  if (!isPlainSchemaObject(schema)) {
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      `schema fragment must be a plain object (got ${schema === null ? 'null' : Array.isArray(schema) ? 'array' : typeof schema})`,
    );
  }

  // 1. 未対応 keyword の検出 (最優先で throw)
  checkUnsupportedKeywords(schema, opts);

  // 2. enum (type に依らず enum 単体で評価)
  if (schema.enum !== undefined) {
    return applyDescription(convertEnum(schema.enum, opts), schema.description);
  }

  // 3. type が配列の場合 (type union)
  if (Array.isArray(schema.type)) {
    return applyDescription(convertTypeUnion(schema, opts), schema.description);
  }

  // 4. type 単一値の確認とランタイム検証
  if (schema.type === undefined) {
    // JSON Schema draft-07 仕様: type / enum どちらもない場合は "schema-less" =
    // **任意の JSON 値を許容** する。これは silent な型喪失ではなく、JSON Schema
    // 標準の明示的なセマンティクス。
    //
    // ユースケース例: `register_hypothesis.value` (任意の JSON 値を受ける比較対象値)
    //
    // z.unknown() を使う (z.any() ではなく) ことで:
    // - 戻り値の型を unknown として narrowing を必須にする (z.any() より型安全)
    // - LLM 側でも「型不明」と認識される
    // - 実行時 validation は Skill 内部 (Skill.execute() の Zod parse) に委譲
    //
    // Nekoさん T2.5 承認の「z.any() で握りつぶさない」精神に整合:
    // - silent な型情報喪失なし (unknown は明示的)
    // - 未対応 keyword (pattern / format 等) との区別: 「JSON Schema 仕様の機能」と
    //   「アダプターが対応していない機能」は別物
    return applyDescription(z.unknown(), schema.description);
  }

  // type が string で来た場合のランタイム検証
  if (typeof schema.type !== 'string') {
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      `unexpected "type" form (expected string or string[])`,
    );
  }

  if (!isJsonSchemaType(schema.type)) {
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      `unsupported "type" value: '${schema.type}'`,
    );
  }

  let result: z.ZodTypeAny;
  switch (schema.type) {
    case 'string':
      result = z.string();
      break;
    case 'number':
      result = z.number();
      break;
    case 'integer':
      result = z.number().int();
      break;
    case 'boolean':
      result = z.boolean();
      break;
    case 'null':
      result = z.null();
      break;
    case 'object':
      result = convertObject(schema, opts);
      break;
    case 'array':
      result = convertArray(schema, opts);
      break;
  }

  // 5. description を付与
  return applyDescription(result, schema.description);
}

/**
 * Zod スキーマに `.describe()` を適用するヘルパー。
 *
 * description が string でなければ何もせず元の zod を返す。enum / type union / unknown
 * のような早期 return 経路でも漏れなく description を反映するために使う。
 */
function applyDescription(
  zod: z.ZodTypeAny,
  description: string | undefined,
): z.ZodTypeAny {
  if (typeof description === 'string' && description.length > 0) {
    return zod.describe(description);
  }
  return zod;
}

/**
 * 未対応 keyword を検出して throw する。
 */
function checkUnsupportedKeywords(
  schema: JsonSchemaFragment,
  opts: Required<JsonSchemaToZodOptions>,
): void {
  const unsupported: { key: string; present: boolean }[] = [
    { key: 'pattern', present: schema.pattern !== undefined },
    { key: 'format', present: schema.format !== undefined },
    { key: 'minimum', present: schema.minimum !== undefined },
    { key: 'maximum', present: schema.maximum !== undefined },
    { key: 'multipleOf', present: schema.multipleOf !== undefined },
    { key: 'minLength', present: schema.minLength !== undefined },
    { key: 'maxLength', present: schema.maxLength !== undefined },
    { key: 'minItems', present: schema.minItems !== undefined },
    { key: 'maxItems', present: schema.maxItems !== undefined },
    { key: 'uniqueItems', present: schema.uniqueItems !== undefined },
    { key: 'oneOf', present: schema.oneOf !== undefined },
    { key: 'anyOf', present: schema.anyOf !== undefined },
    { key: 'allOf', present: schema.allOf !== undefined },
    { key: '$ref', present: schema.$ref !== undefined },
    { key: '$defs', present: schema.$defs !== undefined },
  ];

  for (const { key, present } of unsupported) {
    if (present) {
      throw new JsonSchemaToZodError(
        opts.skillName,
        opts.fieldPath,
        `unsupported keyword: '${key}'`,
      );
    }
  }
}

/**
 * enum の変換。
 */
function convertEnum(
  values: readonly JsonEnumValue[],
  opts: Required<JsonSchemaToZodOptions>,
): z.ZodTypeAny {
  if (values.length === 0) {
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      'empty enum array',
    );
  }

  // 全 string なら z.enum (型安全性が高い)
  if (values.every((v): v is string => typeof v === 'string')) {
    // Zod の z.enum は非空タプルを要求するため、明示的にキャスト
    const first = values[0];
    const rest = values.slice(1);
    return z.enum([first, ...rest] as [string, ...string[]]);
  }

  // 混合型 → z.union(z.literal())
  const literals = values.map((v) => {
    // null は z.literal(null) ではなく z.null() (Zod の制約)
    if (v === null) return z.null();
    return z.literal(v);
  });

  if (literals.length === 1) {
    return literals[0];
  }

  // z.union は最低 2 要素のタプルを要求。destructure + 安全化で unknown キャストを回避。
  const [firstLiteral, secondLiteral, ...restLiterals] = literals;
  if (!firstLiteral || !secondLiteral) {
    // length === 1 を上で return しているため到達しないはず。型 narrowing 用の guard。
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      'unreachable: enum union requires at least 2 elements',
    );
  }
  return z.union([firstLiteral, secondLiteral, ...restLiterals]);
}

/** type union で許容するプリミティブ Zod 型の union。 */
type PrimitiveZod = z.ZodString | z.ZodNumber | z.ZodBoolean | z.ZodNull;

/**
 * type union 内のプリミティブ型変換。
 *
 * `type: ['string', 'number']` のような型配列ではプリミティブ型のみサポート。
 * object / array との union は構造が複雑で意図が不明確なため throw する。
 */
function primitiveTypeToZod(
  t: string,
  opts: Required<JsonSchemaToZodOptions>,
): PrimitiveZod {
  switch (t) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    default:
      throw new JsonSchemaToZodError(
        opts.skillName,
        opts.fieldPath,
        `unsupported "type" value in type union: '${t}' (only primitive types allowed in union)`,
      );
  }
}

/**
 * type union (配列形) の変換。例: `type: ['string', 'number']`
 *
 * プリミティブ型のみサポート (object / array は不採用、構造が複雑で意図が不明確なため)。
 */
function convertTypeUnion(
  schema: JsonSchemaFragment,
  opts: Required<JsonSchemaToZodOptions>,
): z.ZodTypeAny {
  if (!Array.isArray(schema.type)) {
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      'convertTypeUnion called without array type',
    );
  }

  if (schema.type.length === 0) {
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      'empty type array',
    );
  }

  // PrimitiveZod[] として明示することで z.ZodTypeAny を経由せず ESLint no-unsafe-* を回避
  // t の型を string で明示 (Array.isArray narrowing 後の readonly string[] 要素型)
  const subSchemas: PrimitiveZod[] = schema.type.map(
    (t: string): PrimitiveZod => primitiveTypeToZod(t, opts),
  );

  if (subSchemas.length === 1) {
    return subSchemas[0];
  }

  // destructure + null guard で unknown キャストを回避
  const [firstSub, secondSub, ...restSubs] = subSchemas;
  if (!firstSub || !secondSub) {
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      'unreachable: type union requires at least 2 elements',
    );
  }
  return z.union([firstSub, secondSub, ...restSubs]);
}

/**
 * object の変換。
 */
function convertObject(
  schema: JsonSchemaFragment,
  opts: Required<JsonSchemaToZodOptions>,
): z.ZodTypeAny {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, propSchema] of Object.entries(properties)) {
    const childPath = `${opts.fieldPath}.${key}`;
    const childZod = convertFragment(propSchema, { ...opts, fieldPath: childPath });
    shape[key] = required.has(key) ? childZod : childZod.optional();
  }

  let zodObject: z.ZodTypeAny = z.object(shape);

  // additionalProperties の挙動 (確定方針):
  // - `false` → Zod `.strict()` (extra key で reject)
  // - `true` / `undefined` → Zod default = **strip** (extra key を静かに削除)
  //
  // JSON Schema draft-07 仕様では `true` は「追加プロパティを許容して保持」、`undefined`
  // は default = `true` 相当。Zod の `.passthrough()` を使うとこの仕様に厳密準拠できるが、
  // ADK FunctionTool の引数は **LLM が生成する** ため、想定外の余計なフィールドが
  // tool 側 (= Skill 側) にそのまま渡るのはセキュリティ的・デバッグ的に望ましくない。
  //
  // → **アダプターとしては LLM 安全性を優先し、strip 固定**にする (passthrough は採用しない)。
  // - `additionalProperties: false` → reject (Skill 設計者が「余計なキー禁止」と明示)
  // - `additionalProperties: true` / 未指定 → strip (余計なキーは無視するが reject はしない)
  //
  // この方針はテストで固定されている (`additionalProperties` の挙動テスト参照)。
  if (schema.additionalProperties === false) {
    zodObject = (zodObject as z.ZodObject<Record<string, z.ZodTypeAny>>).strict();
  }
  return zodObject;
}

/**
 * array の変換。
 */
function convertArray(
  schema: JsonSchemaFragment,
  opts: Required<JsonSchemaToZodOptions>,
): z.ZodTypeAny {
  if (schema.items === undefined) {
    throw new JsonSchemaToZodError(
      opts.skillName,
      opts.fieldPath,
      'array type requires "items" keyword',
    );
  }

  const itemSchema = convertFragment(schema.items, {
    ...opts,
    fieldPath: `${opts.fieldPath}[]`,
  });
  return z.array(itemSchema);
}
