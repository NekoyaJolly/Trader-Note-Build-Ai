# ADK FunctionTool 型定義スパイク結果 (T2.5)

> **作成日**: 2026-05-13
> **対象**: `@google/adk@1.1.0`
> **目的**: T2.5 検証項目のうち**型定義の確認**部分。実コード検証は `adk_spike_methods.ts` を参照
> **削除予定**: Phase 2 / Ticket T8 (使い捨てファイル)

---

## 1. 主要型の実定義

### 1.1 `FunctionTool<TParameters>` クラス
**ファイル**: `node_modules/@google/adk/dist/types/tools/function_tool.d.ts`

```typescript
export declare class FunctionTool<TParameters extends ToolInputParameters = undefined> extends BaseTool {
  constructor(options: ToolOptions<TParameters>);
  private readonly execute;          // ★ private field
  private readonly parameters?;      // ★ private field
  _getDeclaration(): FunctionDeclaration;  // ★ _ prefix = internal
  runAsync(req: RunAsyncToolRequest): Promise<unknown>;  // ★ public method
}
```

**重要**:
- `execute` は **private** (constructor で渡された fn を保持)
- `runAsync()` が **public method** (BaseTool で abstract 定義、FunctionTool で実装)
- `_getDeclaration()` は `_` prefix で internal 扱い (LLM 用 declaration 生成)

### 1.2 `ToolInputParameters` (parameters の期待型)

```typescript
export type ToolInputParameters =
  | z3.ZodObject<z3.ZodRawShape>
  | z4.ZodObject<z4.ZodRawShape>
  | Schema  // from '@google/genai'
  | undefined;
```

→ **Zod v3 / v4 のどちらも受ける**。`Schema` (Google GenAI 型) も受ける。`undefined` なら parameters なし。

### 1.3 `ToolOptions<TParameters>` (FunctionTool constructor 引数)

```typescript
export type ToolOptions<TParameters extends ToolInputParameters> = {
  name?: string;
  description: string;
  parameters?: TParameters;
  execute: ToolExecuteFunction<TParameters>;
  isLongRunning?: boolean;
};
```

- `name`: optional (execute 関数の name を使う fallback あり)
- `description`: 必須
- `parameters`: optional (= undefined OK)
- `execute`: 必須

### 1.4 `ToolExecuteFunction<TParameters>` (execute の signature)

```typescript
export type ToolExecuteFunction<TParameters extends ToolInputParameters> = (
  input: ToolExecuteArgument<TParameters>,
  tool_context?: Context  // ★ optional!
) => Promise<unknown> | unknown;
```

→ **`tool_context` は optional**。execute 関数側で省略可能。
→ ただし `runAsync(req)` を呼ぶ際の `req.toolContext` は **必須** (RunAsyncToolRequest 型より)。

### 1.5 `RunAsyncToolRequest` (runAsync の引数)

**ファイル**: `node_modules/@google/adk/dist/types/tools/base_tool.d.ts`

```typescript
export interface RunAsyncToolRequest {
  args: Record<string, unknown>;   // ★ tool への実引数
  toolContext: Context;             // ★ 必須 (non-optional)
}
```

→ テストで `tool.runAsync({ args, toolContext: ??? })` を呼ぶには `toolContext` を構築する必要がある。

### 1.6 `Context` (ADK の実行 context)

**ファイル**: `node_modules/@google/adk/dist/types/agents/context.d.ts`

```typescript
export declare class Context extends ReadonlyContext {
  readonly eventActions: EventActions;
  readonly functionCallId?: string;
  toolConfirmation?: ToolConfirmation;
  readonly abortSignal?: AbortSignal;

  constructor(options: {
    invocationContext: InvocationContext;
    eventActions?: EventActions;
    functionCallId?: string;
    toolConfirmation?: ToolConfirmation;
  });

  get state(): State;
  get actions(): EventActions;
  loadArtifact(...): Promise<...>;
  saveArtifact(...): Promise<...>;
  // ... 多数のメソッド
}
```

### 1.7 `ReadonlyContext` (Context の親クラス)

**ファイル**: `node_modules/@google/adk/dist/types/agents/readonly_context.d.ts`

```typescript
export declare class ReadonlyContext {
  readonly invocationContext: InvocationContext;
  constructor(invocationContext: InvocationContext);

  get userContent(): Content | undefined;
  get invocationId(): string;       // ★ invocation id
  get userId(): string;
  get sessionId(): string;
  get agentName(): string;          // ★★ callerAgent 相当!
  get state(): Readonly<State>;
}
```

→ **`agentName` getter が `SkillContext.callerAgent` に直接マッピング可能**。

### 1.8 `InvocationContext`

**ファイル**: `node_modules/@google/adk/dist/types/agents/invocation_context.d.ts`

```typescript
export declare class InvocationContext {
  readonly invocationId: string;
  agent: BaseAgent;            // ★ agentName はここから派生
  readonly session: Session;
  pluginManager: PluginManager;
  // ... session, runConfig, abortSignal 等多数のフィールド
}
```

→ `InvocationContext` の構築には `agent`, `session`, `pluginManager` が必要 (= フル構築は重い)。

### 1.9 `runAsync` の実装 (実コード)

**ファイル**: `node_modules/@google/adk/dist/esm/tools/function_tool.js`

```javascript
async runAsync(req) {
  try {
    let validatedArgs = req.args;
    if (isZodObject(this.parameters)) {
      validatedArgs = this.parameters.parse(req.args);  // ★ Zod parse
    }
    return await this.execute(validatedArgs, req.toolContext);  // ★ execute 呼び出し
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Error in tool '${this.name}': ${errorMessage}`);  // ★ throw!
  }
}
```

**重要**:
- ADK は parameters が Zod なら自動 validation を行う (`parameters.parse(req.args)`)
- execute throw 時は ADK が wrap して再 throw する (= ADK 慣習は **throw 伝播**)

---

## 2. T2 README §3 / §4 / §6 / §8 への影響

### §3 SkillContext マッピング → 採用可能

| SkillContext field | ADK 取得元 |
|--------------------|-----------|
| `callerAgent` | `Context.agentName` (getter from ReadonlyContext) ✅ |
| `callerReason` | **存在しない** → 固定文字列 `'invoked-via-adk'` (Nekoさん承認 §3.5 通り) |
| `timestamp` | **存在しない** → `new Date()` で生成 |

参考: ADK 側で取得できる追加情報 (SkillContext には入れない、将来 trace 用に活用)
- `invocationId`: invocation 単位の ID
- `functionCallId`: tool call ごとの ID (LLM が割り振る)
- `userId` / `sessionId`: マルチユーザー / セッション識別

### §4 型変換方針 → 方式 B (Zod) を推奨

理由:
- ADK の `parameters` 型が `z3.ZodObject | z4.ZodObject | Schema | undefined`
- **Zod を直接受ける** → 方式 B が ADK ネイティブ
- ADK が `parameters.parse(req.args)` で自動 validation してくれる (= LLM の不正引数を ADK 側で検出可能)
- 方式 A (Schema): `Schema` は `@google/genai` の型。JSONSchema からの変換が複雑
- 方式 C (parameters なし): ADK の自動 validation が効かない (= 既存 Skill 内部の Zod parse に全依存) → LLM デバッグ性が低い

**結論**: 方式 B (`jsonSchemaToZod` で SkillInputSchema → Zod) を採用。T3 を実行する。

### §6 エラー伝播 → アダプター内で `{ok:false}` を return する方針

- ADK の `runAsync` は **throw 伝播**が標準慣習 (`Error in tool 'xxx': ...` で wrap)
- ただし、既存 `SkillRegistry.invoke()` は throw を `{ ok: false, error }` に wrap する設計
- 等価性 (§5 / §8) を保つため、アダプター内で `registry.invoke()` を呼び、結果 (`SkillResult<T>`) を **そのまま return** する
- これにより:
  - ADK 経由でも throw されない (LLM 視点ではエラーが構造化された JSON として渡る)
  - 既存 `invoke()` の挙動と完全等価 (T7 等価性検証可能)
- **結論**: アダプター内では throw しない。`SkillResult` を tool 戻り値として返す

### §8 テスト戦略 → runAsync 経由 + Context partial mock

- `FunctionTool.execute` は private → **直接呼び禁止** (Nekoさん承認 §8.4)
- `runAsync(req)` が public method → これを使う
- `req.toolContext: Context` 必須 → 最小限の `Context` mock を構築

**選択肢**:
- (a) `InvocationContext` をフル構築 → 重い、`agent`/`session`/`pluginManager` 全部必要
- (b) `Context` を partial mock 化 → TypeScript `satisfies` や `as unknown as Context` (test ファイルなら例外 OK だが Step 1 では厳格運用)
- (c) **`toSkillContext` を `toolContext?: Context | undefined`** として、undefined OK にする
  - ただし `RunAsyncToolRequest.toolContext: Context` (非 optional) なので `runAsync` 呼び出し時に何か渡す必要
- (d) **テストヘルパー `createMinimalAdkContext()` を adapters 配下に追加** (本番でも使える形)

**結論**: (d) のテストヘルパーを `/src/side-b/adk/adapters/_testHelpers.ts` (内部用) として実装し、T7 から使う。本番コードは `Context.agentName` のみアクセス → `agentName` だけ持つ minimum mock で十分。

---

## 3. T3 実行要否判定

**T3 実行**: ✅ 必要 (方式 B 採用のため)。`jsonSchemaToZod` を実装する。
