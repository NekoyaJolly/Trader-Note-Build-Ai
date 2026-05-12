# SkillRegistry → ADK FunctionTool アダプター 設計書

> **チケット**: Step 1 Ticket T2 (初期ドラフト) → T2.5 (実測スパイク完了、ユーザー承認待ち)
> **作成日**: 2026-05-13 (T2 初稿) / 2026-05-13 (T2.5 実測反映)
> **ステータス**: ✅ T2 承認済み / 🔍 **T2.5 ユーザー承認待ち** (採用方式 B 確定、§3 §4 §6 §8 を実測で更新済み)
> **Nekoさん承認時の追加方針** (§3.5 §8.4 に反映済み): callerReason フォールバック、ADK public API 経由テスト限定
> **計画書**: `docs/architecture/STEP_1_KICKOFF.md` §Ticket T2
> **位置づけ**: ADK 段階導入 Step 1 のサイドカー設計
> **依存方向**: `adk → 既存` (skills, agent 等) のみ。逆向きは禁止

---

## ⚠️ セクションの確定状態 (重要)

本書のセクションには **2 種類** ある:

- ✅ **確定** (§1, §2, §5, §7): 計画書 KICKOFF.md および既存 ADK_ADOPTION.md の方針に基づき、本 T2 ドラフト時点で確定。T2.5 以降で原則変更しない
- 🔍 **T2.5 検証対象** (§3, §4, §6, §8): 現時点では**仮説**。T2.5 スパイクで `@google/adk@1.1.0` の実 API を確認した後、実測結果で更新する

---

## 1. 目的 ✅ 確定

既存の `SkillRegistry` (`/src/side-b/skills/registry.ts`) を **ADK Runner から利用可能な FunctionTool 配列として露出する**。

これにより、Step 2 以降で ADK Agent から既存 Skill を呼び出せる土台を作る。

### スコープ外 (= 本 Step 1 でやらないこと)

- ADK Agent 実装 (Step 2+ で扱う)
- ADK Tracing 統合 (Step 2 範囲)
- 既存 `SkillRegistry` / `Skill` の API 改変 (不可侵領域、`ADK_ADOPTION.md` §6)
- 既存 AgentLoop / PDCALoop から ADK アダプターを呼び出すこと (依存方向違反)

---

## 2. 採用するアダプターパターン ✅ 確定

### 2.1 factory 関数アプローチ

`SkillRegistry` を **1 つのファサードツール**として公開せず、`SkillRegistry.list()` を走査して **1 Skill = 1 FunctionTool** として配列を生成する factory 関数を提供する。

```typescript
// 想定するシグネチャ (T2.5 完了後に確定)
export function skillRegistryToAdkTools(registry: SkillRegistry): FunctionTool[];
```

### 2.2 理由

ADK Agent は `tools` 配列を受け取る API である。`SkillRegistry` を 1 つの汎用ツールとして露出すると、ADK 側で「どの Skill を呼ぶか」を引数で指定する不自然な API になる。1 Skill = 1 FunctionTool の方が:

- ADK Agent の自然な呼び出し慣習に合致
- ADK の Tracing が「どの Skill が呼ばれたか」を tool name 単位で記録できる
- ADK の tool filtering / authorization 機構を Skill 単位で活用できる

### 2.3 対比: 既存 `toMcpToolDefinitions()`

既存 `SkillRegistry.toMcpToolDefinitions()` は MCP 互換の **tool definition 配列** を返す。本アダプターはその ADK 版にあたる: 「定義配列を返す」という方針は既存と同じ。違いは ADK の `FunctionTool` 型に合わせること。

---

## 3. SkillContext マッピング ✅ T2.5 完了で確定

### 3.1 既存 `SkillContext`

```typescript
// src/side-b/skills/types.ts (改変禁止、不可侵領域)
export interface SkillContext {
  callerAgent?: string;
  callerReason?: string;
  timestamp: Date;
}
```

### 3.2 ADK `Context` の実構造 (T2.5 実測)

ADK の `Context` クラス (`ReadonlyContext` 継承) から取得可能なフィールド:

| ADK Context field / getter | 型 | SkillContext へのマッピング |
|----------------------------|----|----------------------------|
| `agentName` (getter, from ReadonlyContext) | `string` | **`callerAgent`** ✅ |
| `invocationId` (getter) | `string` | SkillContext 対応なし (将来 trace 用) |
| `functionCallId` (field) | `string \| undefined` | SkillContext 対応なし (将来 trace 用) |
| `sessionId` (getter) | `string` | SkillContext 対応なし |
| `userId` (getter) | `string` | SkillContext 対応なし |
| `userContent` (getter) | `Content \| undefined` | SkillContext 対応なし |
| (なし) | — | **`callerReason`**: ADK 標準になし → §3.5 fallback |
| (なし) | — | **`timestamp`**: ADK 標準になし → `new Date()` |

### 3.3 確定マッピング

```typescript
// /src/side-b/adk/adapters/skillContext.ts (T5 で実装予定)
import type { Context } from '@google/adk';
import type { SkillContext } from '../../skills/types';

/** ADK Context に callerReason 相当がない場合のフォールバック (§3.5)。 */
export const ADK_DEFAULT_CALLER_REASON = 'invoked-via-adk-runner';

export function toSkillContext(toolContext: Context | undefined): SkillContext {
  return {
    // ADK の agentName を直接利用。toolContext が無い場合は固定値
    callerAgent: toolContext?.agentName ?? 'adk-runner',
    // ADK Context に対応 field なし → adapter 側定数 (§3.5 Nekoさん承認)
    callerReason: ADK_DEFAULT_CALLER_REASON,
    // ADK Context に時刻なし → 呼び出し時刻を生成
    timestamp: new Date(),
  };
}
```

### 3.4 注記

- `SkillContext` 型 (`src/side-b/skills/types.ts`) は**変更しない** (不可侵領域、`ADK_ADOPTION.md` §6)
- ADK 拡張情報 (`invocationId` / `functionCallId` 等) は将来 Tracing 統合 (Step 2) で活用予定。SkillContext には入れない

### 3.5 ✅ Nekoさん承認時の追加方針 (2026-05-13)

**`callerReason` の取り扱い** (T2 approved with note):

- ADK 標準 Context に `callerReason` 相当が存在しない可能性が高い
- T2.5 で取得不能と判明した場合の対応:
  - **固定文字列**: 例えば `'invoked-via-adk'` のような adapter 側定数として埋める
  - または **adapter 側定数**として明示的に export (例: `ADK_DEFAULT_CALLER_REASON`)
- **重要**: 既存 `SkillContext` 型 (`src/side-b/skills/types.ts`) は**変更しない**
  - 不可侵領域 (`ADK_ADOPTION.md` §6 / `/src/side-b/skills/` 改変禁止) と整合
  - `callerReason?: string` のまま、フォールバック値を埋めるだけ

→ **T2.5 結果**: ADK 標準に存在しないことを確認。`ADK_DEFAULT_CALLER_REASON = 'invoked-via-adk-runner'` を adapter 側定数として実装する (§3.3 確定マッピング)。

### 3.5 ✅ Nekoさん承認時の追加方針 (2026-05-13)

**`callerReason` の取り扱い** (T2 approved with note):

- ADK 標準 Context に `callerReason` 相当が存在しない可能性が高い
- T2.5 で取得不能と判明した場合の対応:
  - **固定文字列**: 例えば `'invoked-via-adk'` のような adapter 側定数として埋める
  - または **adapter 側定数**として明示的に export (例: `ADK_DEFAULT_CALLER_REASON`)
- **重要**: 既存 `SkillContext` 型 (`src/side-b/skills/types.ts`) は**変更しない**
  - 不可侵領域 (`ADK_ADOPTION.md` §6 / `/src/side-b/skills/` 改変禁止) と整合
  - `callerReason?: string` のまま、フォールバック値を埋めるだけ

→ T2.5 で `callerReason` 相当の ADK フィールドの有無を確認し、無ければ本方針に従う。

---

## 4. 型変換方針 (parameters) 🔍 T2.5 検証対象 — 3 案併記

### 4.1 既存 `SkillInputSchema`

```typescript
// src/side-b/skills/types.ts
export interface SkillInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}
```

JSONSchema draft-07 サブセット (OpenAI function calling / MCP 互換)。

### 4.2 3 つの実装方式

#### 方式 A: SkillInputSchema → ADK Schema として最小変換

```typescript
// 概念
const tool = new FunctionTool({
  name: skill.name,
  description: skill.description,
  parameters: adaptToAdkSchema(skill.inputSchema), // 形を ADK Schema 型に合わせるのみ
  fn: async (args, ctx) => { /* skill.execute を呼ぶ */ },
});
```

- **メリット**: 変換が浅く、依存ライブラリ追加不要。実装が単純
- **デメリット**: ADK Schema 型が JSONSchema と互換でない場合、変換が複雑化

#### 方式 B: SkillInputSchema → Zod object に変換

```typescript
// 概念
const zodSchema = jsonSchemaToZod(skill.inputSchema); // 新規 ユーティリティ
const tool = new FunctionTool({
  name: skill.name,
  description: skill.description,
  parameters: zodSchema, // ADK が Zod を直接受けるなら
  fn: async (args, ctx) => { /* skill.execute を呼ぶ */ },
});
```

- **メリット**: ADK が Zod-native の場合、型安全性が高い
- **デメリット**: `jsonSchemaToZod()` 自作 or npm パッケージ追加が必要 (= T3 が発生)
- **必要条件**: ADK の parameters が Zod を受けることが T2.5 で確認できた場合

#### 方式 C: 最小 schema + 実行時 Zod parse を Skill 側に委譲

```typescript
// 概念
const tool = new FunctionTool({
  name: skill.name,
  description: skill.description,
  parameters: { /* tool declaration 用の最小限の型情報のみ */ },
  fn: async (args, ctx) => {
    // ADK validation は最小限。詳細 validation は skill.execute() 内の Zod parse に委譲
    return await registry.invoke(skill.name, args, toSkillContext(ctx));
  },
});
```

- **メリット**: 既存 Skill が内部で Zod parse を行っている前提なら最小実装
- **デメリット**: ADK 側の自動 validation が効かず、LLM の不正引数検出が後ろ倒し

### 4.3 採用方式 ✅ T2.5 完了で確定

**採用方式**: **方式 B (Zod)**

### 4.4 実測結果

ADK `FunctionTool` の `parameters` 型 (実測):

```typescript
// node_modules/@google/adk/dist/types/tools/function_tool.d.ts
export type ToolInputParameters =
  | z3.ZodObject<z3.ZodRawShape>   // Zod v3
  | z4.ZodObject<z4.ZodRawShape>   // Zod v4
  | Schema                          // @google/genai の Schema 型
  | undefined;
```

→ **Zod v3 / v4 を直接受ける = ADK ネイティブ対応**。

`runAsync` 内部の挙動 (実コード):

```javascript
// node_modules/@google/adk/dist/esm/tools/function_tool.js
async runAsync(req) {
  let validatedArgs = req.args;
  if (isZodObject(this.parameters)) {
    validatedArgs = this.parameters.parse(req.args);  // ADK が自動 Zod parse
  }
  return await this.execute(validatedArgs, req.toolContext);
}
```

→ ADK が `parameters.parse(req.args)` で**自動 validation** してくれる。

### 4.5 各方式の評価

| 方式 | 採否 | 理由 |
|------|------|------|
| **B (Zod)** | ✅ **採用** | ADK ネイティブ対応、自動 validation、`input` が `z.infer` で型付け済み |
| A (Schema) | ❌ 不採用 | `@google/genai` の `Schema` 型からの変換が複雑。Zod の方が型安全 |
| C (parameters なし) | ❌ 不採用 | ADK 側の自動 validation が効かず、LLM の不正引数検出が後ろ倒し。デバッグ性が低い |

### 4.6 T3 実行要否

**方式 B 採用** → T3 (`jsonSchemaToZod` ユーティリティ実装) を実行する。

`SkillInputSchema` (JSONSchema draft-07 subset) を Zod object に変換するユーティリティが必要。詳細は KICKOFF.md §T3 参照。

### 4.7 ✅ T3 詳細ルール (Nekoさん T2.5 承認時の追加指示)

#### 4.7.1 実装方針: 自前実装

**外部パッケージ採用しない** (`json-schema-to-zod` 等を npm 追加しない)。理由:
- 既存 `SkillInputSchema` は JSONSchema draft-07 のごく一部のサブセット (`type` / `properties` / `required` / `items` / `enum` / `description`)
- 実 Skill 6 件 (`computeLensFeatures` / `readRecentNotes` / `recordLesson` / `getHypothesis` / `queryEdgeLedger` / `registerHypothesis` 等) で使用される features を実測 → 自前で十分対応可能
- 自前実装の方が変換可能範囲を明示的に文書化でき、未対応 schema を確実に throw できる
- 外部パッケージは npm 依存増 + 「裏で `z.any()` でフォールバック」のリスク

#### 4.7.2 サポート対象 (実 Skill 利用状況に基づく)

✅ **対応必須**:
- `type: 'string'` → `z.string()`
- `type: 'number'` → `z.number()`
- `type: 'integer'` → `z.number().int()`
- `type: 'boolean'` → `z.boolean()`
- `type: 'null'` → `z.null()`
- `type: 'object'` + `properties` + `required` → `z.object({...})`
- `type: 'array'` + `items` → `z.array(...)`
- `enum: [...]` → `z.enum([...])` (string array の場合) または `z.union([z.literal(...), ...])`
- `description: string` → `.describe(...)`

✅ **任意対応** (best effort):
- `additionalProperties: false` → `.strict()`
- `additionalProperties: true` (default) → `.passthrough()` または何もしない
- type union (`type: ['string', 'number']`) → `z.union([z.string(), z.number()])`

#### 4.7.3 ❌ 未対応スキーマは throw する

以下は**握りつぶさず必ず throw**:
- `pattern` (正規表現制約)
- `format` (例: `email`, `uri`, `date-time` 等)
- `minimum` / `maximum` / `multipleOf` (数値範囲制約)
- `minLength` / `maxLength` (文字列長制約)
- `minItems` / `maxItems` / `uniqueItems` (配列制約)
- `oneOf` / `anyOf` / `allOf` (合成スキーマ、複雑な場合)
- `$ref` / `$defs` (内部参照)
- 未知の `type` 値

#### 4.7.4 エラーメッセージ形式

```typescript
class JsonSchemaToZodError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly fieldPath: string,
    public readonly reason: string,
  ) {
    super(`[jsonSchemaToZod] Skill '${skillName}' field '${fieldPath}': ${reason}`);
    this.name = 'JsonSchemaToZodError';
  }
}

// 利用例:
// throw new JsonSchemaToZodError('recordLesson', 'lesson', "unsupported 'pattern' constraint");
```

- **skill 名**: 呼び出し側 (`skillRegistryToAdkTools`) から渡される
- **field path**: 再帰中に構築 (例: `'conditions[].rule'` のような dotted/bracketed path)
- **reason**: 何が未対応かを具体的に (例: `"unsupported keyword: 'pattern'"`)

#### 4.7.5 ❌ `z.any()` フォールバック禁止

- 未対応 schema を `z.any()` / `z.unknown()` で握りつぶす実装は禁止
- 未対応に遭遇したら必ず throw して、開発者に明示的に対応を求める
- これにより:
  - LLM の不正引数をすり抜けさせない
  - 新規 Skill 追加時に未対応 schema を即座に検出
  - silent failure を防ぐ

---

## 5. session-less 設計 ✅ 確定

### 5.1 方針

Skill は **stateless** として扱う。ADK の Session オブジェクトに状態を保存しない。

### 5.2 理由

- 既存 `Skill` は実行時 `context` (callerAgent 等) を受けるが、Skill 自体は状態を持たない設計
- 状態管理は既存 `agentMemory` (`/src/side-b/agent/agentMemory.ts`、Prisma 経由) を継続活用
- ADK の `DatabaseSessionService` は MikroORM 依存のため**採用しない** (`ADK_ADOPTION.md` §2.2 / §2.3)

### 5.3 結果

ADK 経由でも直接経由でも、Skill の挙動は同一であるべき (= §8 の等価性検証の前提)。

---

## 6. エラー伝播 ✅ T2.5 完了で確定

### 6.1 既存 `Skill.invoke()` の挙動

```typescript
type SkillResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

- Skill 内部の例外を catch して `{ ok: false, error: ... }` でラップ
- throw は呼び出し側に伝播しない

### 6.2 ADK `runAsync` の実挙動 (T2.5 実測)

```javascript
// node_modules/@google/adk/dist/esm/tools/function_tool.js
async runAsync(req) {
  try {
    /* ... */
    return await this.execute(validatedArgs, req.toolContext);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Error in tool '${this.name}': ${errorMessage}`);  // ★ throw 伝播
  }
}
```

→ ADK の標準慣習は **throw 伝播**。execute が throw すると `Error in tool 'xxx': ...` で wrap して再 throw される。

### 6.3 採用方針: アダプター内では throw しない

ADK 慣習と既存 `invoke()` の慣習が異なる。両者を併存させるため:

| シナリオ | アダプターの挙動 |
|---------|-----------------|
| Skill 成功 | `registry.invoke()` の `{ ok: true, data }` を tool 戻り値として **return** |
| Skill 内例外 | `registry.invoke()` が `{ ok: false, error }` に wrap → そのまま **return** |
| Zod parse 失敗 (ADK 自動 validation) | ADK が throw → ADK 標準 wrap (`Error in tool 'xxx': ...`) |

### 6.4 理由

- アダプターは **`SkillRegistry.invoke()` をそのまま呼ぶ**。既存挙動を完全保持
- `invoke()` の戻り値 (`SkillResult<T>`) を tool 戻り値として返すことで、LLM 視点では構造化エラー JSON が見える (デバッグ性が高い)
- ADK 経由でも throw されない (= §5 session-less + §8 等価性検証の前提)
- ADK 自動 validation エラー (Zod parse 失敗) のみ ADK 標準 throw が発生 → これは LLM の不正引数 (= LLM 側で修正すべき) なので throw で正解

### 6.5 等価性検証 (T7) への影響

- 直接経路: `await registry.invoke(name, input, ctx)` → `SkillResult<T>`
- ADK 経路: `await tool.runAsync({ args: input, toolContext })` → `SkillResult<T>` (アダプターが invoke を呼んで結果を return するため)
- 両者の戻り値が **deep equal** で一致するはず

---

## 7. ディレクトリ構成 ✅ 確定 (一部 T2.5 で追加)

```
/src/side-b/adk/adapters/
├── README.md                 # 本設計書
├── (T2.5 結果次第で追加ファイルが決まる)
```

Phase 1 完了時の想定構成 (採用方式によって変動):

```
/src/side-b/adk/adapters/
├── README.md
├── jsonSchemaToZod.ts        # T3 (方式 B 採用時のみ)
├── jsonSchemaToZod.test.ts   # 同上
```

Phase 2 完了時の想定構成:

```
/src/side-b/adk/adapters/
├── README.md
├── jsonSchemaToZod.ts                  # 方式 B 採用時のみ
├── jsonSchemaToZod.test.ts             # 同上
├── skillContext.ts                     # T5
├── skillContext.test.ts                # T5
├── skillRegistryToAdkTools.ts          # T6
├── skillRegistryToAdkTools.test.ts     # T6
├── equivalence.test.ts                 # T7
```

---

## 8. テスト戦略 ✅ T2.5 完了で確定

### 8.1 想定するテストレイヤー

| レイヤー | 対象 | 実装場所 | 備考 |
|---------|------|---------|------|
| ユニット (変換) | `jsonSchemaToZod()` | T3 | プリミティブ / 配列 / オブジェクト / enum / union / null 網羅 |
| ユニット (context) | `toSkillContext()` | T5 | フィールド欠落フォールバック含む (Context undefined → 'adk-runner') |
| ユニット (アダプター) | `skillRegistryToAdkTools()` | T6 | 空 registry / 1 Skill / N Skill / parameters 整合 / エラー変換 |
| **等価性** | ADK 経由 vs 直接 invoke | T7 | 同一入力 → 同一出力を deep equal で検証 |

### 8.2 ADK 実行 API 実測結果

| API | 種別 | 利用可否 |
|-----|------|---------|
| `FunctionTool.execute` (private field) | **private** (`private readonly execute`) | ❌ 利用禁止 (Nekoさん承認 §8.4) |
| `FunctionTool._getDeclaration` | internal (`_` prefix) | ❌ 利用禁止 |
| `FunctionTool.runAsync(req)` | **public method** (BaseTool で abstract、FunctionTool で実装) | ✅ **これを使う** |

### 8.3 等価性検証 (T7) の経路 ✅ 確定

T7 では `tool.runAsync({ args, toolContext })` を使う。

```typescript
// T7 等価性検証の概念コード
const directResult = await registry.invoke('skill_name', input, ctx);
const adkResult = await tool.runAsync({
  args: input,
  toolContext: createMinimalAdkContext({ agentName: ctx.callerAgent }),
});
expect(adkResult).toEqual(directResult);  // deep equal
```

### 8.4 ✅ Nekoさん承認時の追加方針 (2026-05-13)

**ADK public API 経由テストの厳格化** (T2 approved with note):

T2.5 で `FunctionTool` の公開実行 API が以下のいずれかと判明した場合の対応を明文化:

| ケース | T7 等価性検証の経路 |
|--------|--------------------|
| `execute()` が public method として露出 | `execute()` 直接呼び出し可 |
| **`runAsync()` または相当が public method** | `runAsync()` 経由でテスト (`execute()` は internal 扱いの可能性) |
| **Runner / Agent 経由でしか実行できない** | Runner / Agent を T7 テストで構築 (mock Agent + ADK Runner 経由) |
| internal/private な execute のみ | **internal API には依存しない** (= Runner 経由のテストに変更) |

**禁止**: ADK SDK の internal / private API (`@internal` JSDoc、underscore prefix、d.ts 非公開等) に依存するテストコード。脆い (SDK 更新で壊れる) ため。

T2.5 で確定した実行経路を T7 設計時に厳守する。

### 8.5 T2.5 確定: `runAsync` 経由 + Context partial mock

実測の結果、**`runAsync()` が public method、`execute` は private field**。Nekoさん承認 §8.4 表の 2 行目 (`runAsync()` 経由) のケースに該当。

`runAsync({ args, toolContext })` の `toolContext: Context` は非 optional。フル `InvocationContext` 構築は重い (agent / session / pluginManager 必須) ため、テスト用最小 mock を提供する:

```typescript
// /src/side-b/adk/adapters/_testHelpers.ts (T6 で実装予定)
// ★★ テスト専用ヘルパー — 本番実装からは使わない (Nekoさん T2.5 承認時の方針)
import type { Context } from '@google/adk';

/**
 * テスト専用: `Context` の必要最小限フィールドのみを持つ mock を生成。
 * adapter 本体が触る field (agentName のみ) を持つ。
 *
 * ★ 本番コードからは絶対に使わない。テストヘルパー専用。
 * ★ ファイル名 `_testHelpers.ts` の underscore prefix で「内部用」を明示。
 * ★ 本番 export からは含めない (jobs/index.ts などへ含めない)。
 */
export function createMinimalAdkContext(options: { agentName?: string }): Context {
  // 本番 Context は InvocationContext を要求するが、adapter が触るのは agentName のみ。
  // Object.create + getter で最小限を満たす。
  const ctx = Object.create(Context.prototype) as Context;
  Object.defineProperty(ctx, 'agentName', {
    value: options.agentName ?? 'test-agent',
    enumerable: true,
  });
  return ctx;
}
```

このアプローチは ADK の internal API に依存せず (= `Object.defineProperty` は標準 JS API)、`Context.prototype` の継承だけ利用する。

**本番実装での Context 利用ルール**:
- 本番アダプター (`skillRegistryToAdkTools`) は ADK Runner が渡してくる本物の `Context` をそのまま受ける
- `toSkillContext()` は `Context | undefined` を受けて (Runner 経由なら定義、テストヘルパーでも生成、いずれも対応可)
- `Context.agentName` getter にのみアクセス。他フィールドには触らない (= mock 構築の最小化を維持)
- `createMinimalAdkContext` の本番呼び出しは禁止 (ESLint で防御するなら `no-restricted-imports` などを将来検討)

### 8.4 ✅ Nekoさん承認時の追加方針 (2026-05-13)

**ADK public API 経由テストの厳格化** (T2 approved with note):

T2.5 で `FunctionTool` の公開実行 API が以下のいずれかと判明した場合の対応を明文化:

| ケース | T7 等価性検証の経路 |
|--------|--------------------|
| `execute()` が public method として露出 | `execute()` 直接呼び出し可 |
| **`runAsync()` または相当が public method** | `runAsync()` 経由でテスト (`execute()` は internal 扱いの可能性) |
| **Runner / Agent 経由でしか実行できない** | Runner / Agent を T7 テストで構築 (mock Agent + ADK Runner 経由) |
| internal/private な execute のみ | **internal API には依存しない** (= Runner 経由のテストに変更) |

**禁止**: ADK SDK の internal / private API (`@internal` JSDoc、underscore prefix、d.ts 非公開等) に依存するテストコード。脆い (SDK 更新で壊れる) ため。

T2.5 で確定した実行経路を T7 設計時に厳守する。

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| `docs/architecture/STEP_1_KICKOFF.md` | Step 1 全体の作業手順書 (Nekoさん作成) |
| `docs/architecture/ADK_ADOPTION.md` | ADK 採用範囲・撤退基準・不可侵領域 |
| `docs/architecture/STEP_0_ADK_INSTALL_DRYRUN.md` | @google/adk dry-run 結果 + peer dep 対応方針 |
| `/src/side-b/adk/AGENTS.md` | ADK サイドカー領域の作業ルール (依存方向制約等) |
| `/src/side-b/skills/types.ts` | 既存 Skill / SkillRegistry / SkillContext の型定義 |
| `/src/side-b/skills/registry.ts` | 既存 SkillRegistry の実装 |

---

## 10. ユーザーレビュー履歴

### T2 (初期ドラフト): ✅ 承認済み (2026-05-13)

**Nekoさん回答**: `T2 approved with note` (2 件)

1. **callerReason フォールバック方針** → §3.5 に反映
2. **ADK public API 経由テスト限定 (internal/private API 不依存)** → §8.4 に反映

承認に基づき T2.5 (実測スパイク) に進行中。

### T2.5 (実測スパイク): ✅ 承認済み (2026-05-13)

**Nekoさん回答**: `T2.5 approved with note`

**確定方針** (本書 §3 §4 §6 §8 に反映済み):
- ✅ **方式 B (Zod)** — `parameters` 変換は `SkillInputSchema → Zod`
- ✅ **`runAsync()` public API 経由テスト限定**、`execute` / `_getDeclaration` 等 private/internal 不依存
- ✅ **`ADK_DEFAULT_CALLER_REASON = 'invoked-via-adk-runner'`** adapter 側定数
- ✅ アダプター内で `SkillResult` を **throw に変換せず return**
- ✅ Zod validation error は ADK 標準 throw 伝播に任せる
- ✅ `createMinimalAdkContext` は **test helper 専用**、本番未使用 (§8.5 で明記)

**T3 前の修正** (本セクション以下に反映):
- ✅ `createMinimalAdkContext` がテスト専用であることを §8.5 で明記
- ✅ `jsonSchemaToZod` は **自前実装** (外部パッケージ採用しない)。既存 `SkillInputSchema` subset 向け

### T3 (jsonSchemaToZod) 合格条件 (Nekoさん追加指示)

- ✅ **未対応 JSONSchema を `z.any()` で握りつぶさない**
- ✅ **未対応 schema は skill 名 / field path 付きで throw する**

→ §4.7 に T3 詳細ルールとして反映。

### T3 (実装) 着手中
