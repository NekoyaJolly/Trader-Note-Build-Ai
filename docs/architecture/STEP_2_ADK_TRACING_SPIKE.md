# STEP_2_ADK_TRACING_SPIKE.md - ADK Tracing API 実測結果

> **作成日**: 2026-05-13
> **対象**: `@google/adk@1.1.0`
> **目的**: Step 2 Phase 1 (Tracing Spike) の検証結果。Phase 2 (Trace Contract) / Phase 3 (Adapter Integration) の方針確定の根拠
> **実行スクリプト**: `scripts/adk_tracing_spike.ts` (Phase 5 で削除予定)
> **削除予定**: 本書と spike script は Step 2 Phase 5 (Cleanup) で削除

---

## 1. 結論サマリー (先出し)

Phase 2 / Phase 3 で採用する方針:

| 項目 | 採用方針 |
|------|---------|
| **Trace を取る位置** | adapter (`skillRegistryToAdkTools`) の `execute` 内部 |
| **ADK Plugin 依存** | なし (`BasePlugin.*ToolCallback` は Runner / PluginManager 経由のみ発火) |
| **Trace event 定義** | 自前 (`AdkTraceEvent` + `TraceSink` interface) |
| **Context から取る値** | `agentName` / `invocationId` / `sessionId` / `userId` (ADK 型で必須) + `functionCallId?` (Context のみ optional)。**adapter 視点では `ctx` 自体が undefined になりうる**ため、optional chain で扱う |
| **raw payload** | 保存しない (KICKOFF §5.2 厳守) |
| **summary 関数** | `argsSummary` / `resultSummary` を自前生成 (`TracePayloadSummary` で field 数 + 上位キー名のみ) |
| **Runner 統合** | Step 3 で `runEphemeral + InMemorySessionService` を試す (session-less 維持) |
| **OTel 統合** | Step 3 以降の判断。今は `TraceSink` interface に逃げ場を残す |

---

## 2. 検証項目別の実測結果

### 2.1 Context / ReadonlyContext の getter 一覧

`@google/adk` の `Context extends ReadonlyContext` から取得できる値 (実測 + d.ts 確認):

| Getter | ADK 型 | 取得可否 | 用途 |
|--------|--------|---------|------|
| `agentName` | `string` (必須) | ✅ 必ず取れる (BaseAgent 由来) | **`SkillContext.callerAgent` にマッピング** (Step 1 で確立) |
| `invocationId` | `string` (必須) | ✅ 取れる (= 一度の Agent 実行に紐付く ID) | **trace の root span 識別子** として有用 |
| `functionCallId` | `string?` (Context のみ、optional) | ⚠️ 取れない場合あり | **trace の child span 識別子** として有用 (取れるときのみ) |
| `sessionId` | `string` (必須) | ✅ 取れる | trace の cross-cutting ID 候補 |
| `userId` | `string` (必須) | ✅ 取れる | trace の cross-cutting ID 候補 |
| `userContent` | `Content?` | ✅ 取れる | LLM input — **trace に保存しない** (KICKOFF §5.2) |
| `state` | `Readonly<State>` | ✅ 取れる | session state — trace に保存しない |
| `eventActions` | `EventActions` | ✅ (`Context` のみ) | trace 用途では使わない |

**adapter 視点の補足**: 上記は ADK 型定義上の話。adapter (`toSkillContext`) は **`ctx: Context | undefined` で受ける** ため、テスト helper 経由の場合に `ctx` 自体が undefined になりうる。実装上は `ctx?.invocationId` 等の optional chain で扱い、全フィールドを optional として扱う方が安全。

**重要な実装上の知見** (Step 1 から継続):

- `Object.create(Context.prototype)` + `Object.defineProperty(ctx, '<getterName>', { value: '...' })` で任意のフィールドだけ持つ minimum mock を生成可能
- これにより、テスト時に必要なフィールドだけセットして他は undefined のまま検証できる
- Adapter は `Context` を direct import せず `ctx?.invocationId` 等の optional chain で扱えば、テスト helper の自由度が保たれる

### 2.2 FunctionTool.runAsync の挙動

```typescript
await tool.runAsync({
  args: { symbol: 'XAU/USD' },   // ← LLM 生成相当の引数 (parameters の Zod で parse される)
  toolContext: ctx,               // ← Context (RunAsyncToolRequest 型では非 optional、必ず渡す)
});
```

補足: `RunAsyncToolRequest.toolContext: Context` は **非 optional** (= 必ず渡す)。一方で `execute` の 2 番目の引数 `tool_context?: Context` は **execute シグネチャ上は optional** (= 関数定義で受け側が省略可能)。

→ adapter の `execute` 内では `tool_context` は実態として常に渡ってくるが、テスト用 mock 等の運用都合で **optional として扱う**のが安全。

実測した挙動:

- `parameters` (Zod) が指定されていれば、`runAsync` 内部で `parameters.parse(args)` が自動実行
- parse 成功時: `execute(parsedInput, toolContext)` が呼ばれる
- parse 失敗時: `Error in tool '<name>': <Zod error>` で throw (= ADK が wrap)
- `execute` の戻り値はそのまま `runAsync` の戻り値になる
- `execute` 内 throw も `Error in tool '<name>': <message>` で wrap される

**Trace を取る最適位置**:

```typescript
// adapter の execute 内 (Step 1 で確立した位置)
execute: async (input, toolContext) => {
  // ★ ここで traceSink.record({ kind: 'adk.skill.started', ... })
  const result = await registry.invoke(skillName, input, toSkillContext(toolContext));
  // ★ ここで traceSink.record({ kind: 'adk.skill.completed' or 'adk.skill.failed', ... })
  return result;
};
```

- ADK 自動 Zod validation が成功した後でしか execute は呼ばれない → validation error は別経路の trace (後述)
- validation error 時は `execute` が呼ばれない = adapter 内では捕捉できない
  - **対応**: ADK の throw を adapter の外側で try/catch して trace する (Phase 3 で実装)、または validation error は trace しない (KICKOFF §5.4 で要相談)
  - **採用案**: Phase 3 で `tool.runAsync` 自体を adapter が wrap してしまい、外側で catch → trace `adk.skill.failed` (status: 'thrown') を出す

### 2.3 BasePlugin tool callbacks の発火条件

ADK の `BasePlugin` には以下のメソッドがある:

```typescript
abstract class BasePlugin {
  beforeToolCallback(params: { tool, toolArgs, toolContext }): Promise<...>;
  afterToolCallback(params: { tool, toolArgs, toolContext, result }): Promise<...>;
  onToolErrorCallback(params: { tool, toolArgs, toolContext, error }): Promise<...>;
}
```

**重要**: これらは **Runner / PluginManager 経由でないと発火しない**。

検証結果:

- Step 1 で実装した `tool.runAsync({ args, toolContext })` の **直接呼び出しでは plugin callbacks は発火しない** (PluginManager を介していないため)
- Step 1 等価性テストも plugin callbacks に依存しない
- Step 2 で trace を取りたい範囲 = adapter 経由の Skill 実行 = plugin callbacks ではカバーしきれない

**結論**: adapter 層の trace は **plugin システムに依存しない**。`skillRegistryToAdkTools` の `execute` 内で直接 `traceSink.record()` を呼ぶ方針。

これにより:

- ✅ Runner 経由でない直接呼び出し (Step 1 等価性テストなど) でも trace が取れる
- ✅ Step 3 で Runner 統合した際にも、同じ adapter execute から trace される (二重 trace の心配なし)
- ✅ BasePlugin の継承や PluginManager 設定が不要

### 2.4 LlmAgent.tools への FunctionTool[] 渡し (型レベル)

`LlmAgent` の型定義 (`node_modules/@google/adk/dist/types/agents/llm_agent.d.ts`):

```typescript
export type ToolUnion = BaseTool | BaseToolset;

export declare class LlmAgent extends BaseAgent {
  tools: ToolUnion[];
  // ...
}
```

`FunctionTool` は `BaseTool` を継承しているため、Step 1 の `skillRegistryToAdkTools(registry)` の戻り値 (= `FunctionTool[]`) は **そのまま `LlmAgent.tools` に渡せる**。

実機での `LlmAgent` 構築は Step 2 Phase 4 (Runner Smoke Notes) で扱う。**本 Step 2 では LlmAgent / Runner の本番統合はしない**。

### 2.5 Runner.runAsync vs Runner.runEphemeral

`Runner` (= `node_modules/@google/adk/dist/types/runner/runner.d.ts`) には 2 つの実行 API がある:

| Method | 必須引数 | 用途 | session-less 適合性 |
|--------|---------|------|---------------------|
| `runAsync` | `userId` + **`sessionId`** + `newMessage` | 永続化された session への append | ⚠️ sessionId が必須 |
| `runEphemeral` | `userId` + `newMessage` | その場限りの一時 session | ✅ 永続 session 不要 |

両方とも `RunnerConfig.sessionService: BaseSessionService` は必須 (Runner 構築時)。これは:

- `runAsync`: 既存 session を取得 / append する用途
- `runEphemeral`: 内部で in-memory session を作って捨てる用途

→ **`InMemorySessionService` を渡せば、`DatabaseSessionService` 不採用の方針 (ADK_ADOPTION.md §2.2) を保ったまま Runner を利用可能**。

### 2.6 session-less 方針との衝突点

| シナリオ | 衝突有無 | 対応 |
|----------|---------|------|
| `FunctionTool` 単独呼び出し (Step 1 確立済み) | ✅ 衝突なし | session 不要 |
| `Runner.runEphemeral` 経由 | ✅ 衝突なし | `InMemorySessionService` で OK |
| `Runner.runAsync` 経由 | ⚠️ 衝突あり | sessionId 必須 → Step 3 で扱う場合は dummy session を作る or runAsync を避ける |
| `DatabaseSessionService` | ❌ 採用しない | ADK_ADOPTION.md §2.2 厳守 |

Step 3 の Runner smoke では `runEphemeral + InMemorySessionService` で進めるのが安全。

### 2.7 ADK 公式 tracing (`telemetry/tracing.ts`) の利用可否

ADK SDK 内部の tracing 実装 (`node_modules/@google/adk/dist/types/telemetry/tracing.d.ts`):

```typescript
export declare const tracer: import("@opentelemetry/api").Tracer;

export function traceToolCall(params: {
  tool: BaseTool;
  args: Record<string, unknown>;
  functionResponseEvent: Event;
}): void;

// 他に traceAgentInvocation / traceCallLlm / traceSendData / traceMergedToolCalls 等
```

**実態**:

- `tracer` は OpenTelemetry の global tracer。アクセスできるが、OTel SDK の追加導入と設定 (exporter / processor) が必要 → Step 3 以降の判断
- `traceToolCall` 等の関数は **Runner 内部で自動呼び出しされる前提** で書かれている (`functionResponseEvent` を要求するなど、外部から手動呼び出しするのは想定外)
- 上記関数の引数構造は internal 寄りで、SDK 更新で変わる可能性がある

**結論**: 本 Step 2 では ADK 公式 tracing には直接依存しない。

- 代わりに **自前の `TraceSink` interface で抽象化**
- 将来 Cloud Trace / Datadog / OTel exporter を追加するなら、`TraceSink` の実装クラスを増やすだけ
- 公式 tracing が安定して TS 側でも利用可能になった時点で、`OtelExporterTraceSink` 等を別途追加

---

## 3. Phase 2 / Phase 3 で採用する設計

### 3.1 trace event の最小構造 (案)

```typescript
export interface AdkTraceEvent {
  readonly kind: 'adk.skill.started' | 'adk.skill.completed' | 'adk.skill.failed';
  readonly traceId: string;             // adapter 側で生成 (UUID)
  readonly parentTraceId?: string;       // 連続イベントの紐付け用 (started → completed/failed)
  readonly invocationId?: string;        // Context.invocationId (取れる場合のみ)
  readonly functionCallId?: string;      // Context.functionCallId (取れる場合のみ)
  readonly agentName: string;            // Context.agentName または ADK_DEFAULT_CALLER_AGENT
  readonly skillName: string;            // adapter が把握している Skill 名
  readonly callerReason: string;         // ADK_DEFAULT_CALLER_REASON 固定 (Step 1 で確立)
  readonly startedAt: Date;
  readonly endedAt?: Date;
  readonly durationMs?: number;
  readonly status: 'started' | 'ok' | 'error' | 'thrown';
  readonly errorCode?: string;           // SkillResult.error.code (失敗時のみ)
  readonly errorMessage?: string;        // SkillResult.error.message (失敗時のみ、短縮あり)
  readonly argsSummary?: TracePayloadSummary;
  readonly resultSummary?: TracePayloadSummary;
}

export interface TracePayloadSummary {
  readonly fieldCount?: number;
  readonly topLevelKeys?: readonly string[];
  readonly primitiveType?: string;
  readonly redacted: true;
}
```

### 3.2 TraceSink interface

```typescript
export interface TraceSink {
  record(event: AdkTraceEvent): void | Promise<void>;
}
```

実装:

- `NoopTraceSink`: 何もしない (production default)
- `InMemoryTraceSink`: 配列に push (tests / local spike 用)

### 3.3 adapter integration (Phase 3)

```typescript
export function skillRegistryToAdkTools(
  registry: SkillRegistry,
  options?: { traceSink?: TraceSink },
): FunctionTool<z.ZodObject<z.ZodRawShape>>[];
```

- `traceSink` 未指定 → 既存挙動 (Step 1 の等価性テストが壊れない)
- `traceSink` 指定 → execute 前後で 2 つの event を record
- `traceSink.record` の失敗は **adapter 内で catch して握りつぶす** (Skill 実行を壊さない)

### 3.4 status 値の対応関係

| シナリオ | trace event | status |
|---------|------------|--------|
| Skill が成功 (`SkillResult.ok === true`) | `adk.skill.completed` | `'ok'` |
| Skill が失敗 (`SkillResult.ok === false`) | `adk.skill.failed` | `'error'` |
| Zod validation error (ADK が throw) | `adk.skill.failed` | `'thrown'` |
| Unexpected throw (Skill 内部の bug) | `adk.skill.failed` | `'thrown'` |

`'thrown'` の場合は、adapter が `tool.runAsync` を wrap して外側で catch する形で記録する。

---

## 4. 未解決事項 (Step 3 以降)

- **OTel exporter**: 本格的に外部 observability backend に流す場合の `OtelTraceSink` 実装。Step 3 以降の判断材料
- **Runner 経由でも trace が機能するか**: Phase 4 Runner Smoke Notes で言及、実機検証は Step 3
- **trace ID 体系**: 現状 adapter 側で UUID 生成だが、ADK の `invocationId` を root として階層化する案もある (Step 3 で再検討)
- **summary 上限**: `topLevelKeys` の配列長やキー文字列長の上限は Phase 2 実装時に確定 (デフォルト N=20 程度を想定)

---

## 5. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_2_KICKOFF.md`](./STEP_2_KICKOFF.md) | Step 2 全体の作業指示書 (Nekoさん作成) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 採用計画 (§2.2 で DatabaseSessionService 不採用を確定) |
| [`STEP_1_SUMMARY.md`](./STEP_1_SUMMARY.md) | Step 1 完了サマリー (adapter 設計の前提) |
| [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) | adapter 設計書 (Step 1) |
| [`scripts/adk_tracing_spike.ts`](../../scripts/adk_tracing_spike.ts) | 本 spike の実行スクリプト (Phase 5 で削除) |
