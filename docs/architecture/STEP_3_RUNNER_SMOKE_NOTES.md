# STEP_3_RUNNER_SMOKE_NOTES.md — ADK Runner / LlmAgent 実機 Smoke 実測結果

> **作成日**: 2026-05-13
> **対象**: `@google/adk@1.1.0`
> **位置づけ**: Step 3 Phase 1 (`STEP_3_KICKOFF.md` §5 Phase 1) の成果物 — Runner / LlmAgent / InMemorySessionService + `skillRegistryToAdkTools()` の実機 smoke 実測結果
> **完了条件**: KICKOFF §5.4 Phase 1 DoD をすべて満たすこと
> **次フェーズ**: Step 3 Phase 2 (`STEP_3_SEQUENTIAL_AGENT_NOTES.md`) に SequentialAgent 用知見として引き継ぐ

---

## 1. 結論サマリー (先出し)

KICKOFF §5.3 LLM 呼び出し方針の優先順位に従い、**LLM 呼び出しを発生させずに** Phase 1 smoke を完了させた。

| 項目 | 採用結果 |
|------|---------|
| Runner 構築 | `new Runner({ appName, agent, sessionService })` の最小 4 引数で実行可能 |
| 実行 API | `Runner.runEphemeral({ userId, newMessage })` のみ採用 (sessionId 不要、session-less 維持) |
| session service | `InMemorySessionService` のみ採用 (DatabaseSessionService 不採用継続) |
| LLM 呼び出し回避方法 | KICKOFF §5.3 順位 2 採用 — `BaseLlm` を継承した `StubFunctionCallLlm` をテストから注入 |
| traceSink 統合 | Runner 経由でも adapter `execute` 内の `traceSink.record()` がそのまま発火 (Step 2 Phase 1 spike §2.3 の予測通り) |
| 既存挙動互換 | `traceSink` 未指定時は何も記録されず、Runner も問題なく完走 |
| raw payload 漏出 | `argsSummary` / `resultSummary` 経由のみ、JSON 化しても skill 内 secret 値は含まれない (KICKOFF §6.3 厳守) |
| ADK Context 伝播 | `invocationId` / `agentName` ともに adapter execute 内の trace event に到達 |

実装場所:

- 本番コード: `/src/side-b/adk/agents/runnerSmoke.ts`
- テスト: `/src/side-b/tests/adk/agents/runnerSmoke.test.ts` (11 cases, 全 pass)
- adk 領域全体テスト数: Step 1 (71) + Step 2 (59) + Step 3 Phase 1 (11) = **141 cases 全 pass**

---

## 2. 採用構成

KICKOFF §5.2 / §6.1 で示した構成を実機で組んだ最小フロー:

```
SkillRegistry (テスト用 1-skill registry / 本番では buildDefaultSkillRegistry)
   ↓ skillRegistryToAdkTools(registry, { traceSink })   (Step 1 + Step 2)
FunctionTool[]
   ↓ new LlmAgent({ name, model, instruction, tools })  (本 Phase で確認)
LlmAgent
   ↓ new Runner({ appName, agent, sessionService: new InMemorySessionService() })
Runner
   ↓ runner.runEphemeral({ userId, newMessage })
AsyncGenerator<Event>
   ↓ for await ... 全 Event 回収
Event[]                                                 (Runner からの event stream)
```

並行して、adapter 内部で:

```
adapter.execute (Step 2 Phase 3)
  └── traceSink.record(adk.skill.started)
  └── registry.invoke(skillName, input, toSkillContext(toolContext))
  └── traceSink.record(adk.skill.completed | adk.skill.failed)
```

→ Runner 経由 / 直接呼び出しのどちらでも同じ adapter execute が走るため、Step 2 で組んだ tracing がそのまま機能する。

---

## 3. 実装上の発見事項

### 3.1 `LlmAgentConfig.model` は **optional** だが、実行には必須

| 観点 | 内容 |
|-----|------|
| 型定義 | `LlmAgentConfig.model?: string | BaseLlm` (`@google/adk` 1.1.0) |
| 実行時 | Runner が LlmAgent を走らせる際、内部で `agent.canonicalModel` を参照する。`model` 未設定だと "親 agent から継承" するロジックに入り、root agent に model がなければ resolve 失敗する |
| 本 Phase での扱い | テストでは必ず stub `BaseLlm` を注入する。`runnerSmoke.ts` の API では `model: BaseLlm` を **必須** にして責任境界を明示 |
| Phase 2 への含意 | SequentialAgent の sub-agent でも、各 LlmAgent には何らかの `model` が必要。SequentialAgent 自体は model 不要なら sub-agent 内に閉じる |

### 3.2 LLM 呼び出し回避: `BaseLlm` 継承 stub アプローチ

KICKOFF §5.3 の優先順位:

1. ~~LLM 呼び出しなしで Runner / LlmAgent / tool wiring だけ確認~~ — `LlmAgent` 実行時に model.generateContentAsync が必ず呼ばれるため、純粋な「LLM なし」はランタイム上不可能
2. ✅ **stub / mock model が ADK public API 上許容されるならそれを使う** — `BaseLlm` が `abstract` で `export declare` されており、継承して `generateContentAsync` を deterministic に実装できる → **これを採用**
3. tool call を必要としない短い入力で `runEphemeral()` を確認 — 採用しない (tool 経路の検証ができない)
4. どうしても必要なら低コストモデルで実行 — 採用しない

`StubFunctionCallLlm` の構造 (テスト内):

```typescript
class StubFunctionCallLlm extends BaseLlm {
  static override readonly supportedModels: Array<string | RegExp> = [];
  private callCount = 0;
  constructor(toolName: string, toolArgs: Record<string, unknown>) {
    super({ model: 'stub-function-call-llm' });
  }
  override async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
    // 1 ターン目: function_call を返す
    // 2 ターン目以降: text "done" を返して終了
  }
  override async connect(): Promise<never> { throw new Error('not implemented'); }
}
```

採否:

- ✅ `BaseLlm` は `export declare abstract class` で公開 API のため継承可能
- ✅ `generateContentAsync` を deterministic に実装、`connect()` は smoke で呼ばれないため unimplemented
- ✅ ADK SDK の internal / private API には依存しない (継承のみ)
- ⚠️ Phase 2 (SequentialAgent) で sub-agent ごとに異なる挙動の stub が必要になる可能性 → Phase 2 で再評価

### 3.3 `Runner.runEphemeral()` の引数構造と返り値

```typescript
runner.runEphemeral({
  userId: string;          // 必須
  newMessage: Content;     // 必須 (@google/genai の Content)
  stateDelta?: Record<string, unknown>;  // 未使用 (Phase 1 では渡さない)
  runConfig?: RunConfig;   // 未使用
}): AsyncGenerator<Event, void, undefined>;
```

実測:

- `sessionId` を要求されない (= `runAsync` の session 経路に進まない、KICKOFF §5.4 DoD #3)
- `for await` で全 Event を回収できる (1 invocation で複数 event が yield される: user message → function_call → function_response → final text 等)
- 全 Event が同一 `invocationId` を持つ (実機確認、test "runEphemeral の event stream に Runner からの Event 列が yield される" 参照)
- Runner 内部で session を自動生成・破棄 (`InMemorySessionService.createSession` → `deleteSession` 相当の流れ、外部観測不要)

### 3.4 Runner 経由でも adapter `execute` 内の `traceSink.record()` が発火する

Step 2 Phase 1 spike §2.3 の予測:

> ADK の `BasePlugin.*ToolCallback` は **Runner / PluginManager 経由でないと発火しない**。adapter 層の trace は plugin システムに依存しない方針 (= adapter の `execute` 内で直接 `traceSink.record()` を呼ぶ)。

実機確認:

- ✅ Runner 経由でも adapter `execute` が呼ばれる (LLM が function_call を返した → Runner が tool dispatch → adapter execute 起動)
- ✅ adapter 内の `traceSink.record(started)` / `record(completed)` がそのまま発火
- ✅ Step 2 で組んだ trace contract (`AdkTraceEvent` / `TracePayloadSummary` / redaction) がそのまま使える
- ✅ Plugin 経路と直接呼び出し経路で二重 trace される心配なし

### 3.5 ADK Context 識別子の伝播状況

adapter `execute` の `toolContext` から取得できる値 (Runner 経由実機実測):

| 識別子 | Runner 経由で取れるか | adapter 内 trace event のフィールド名 | 備考 |
|-------|-------------------|-----------------------------------|------|
| `agentName` | ✅ 必ず取れる | `event.agentName` | LlmAgent.name そのまま |
| `invocationId` | ✅ 必ず取れる (非空文字列) | `event.invocationId` | 同一 runEphemeral 内で共通 |
| `functionCallId` | ⚠️ 取れる場合あり / undefined もあり | `event.functionCallId` | ADK 型定義上も optional (Step 2 spike §2.1) |
| `sessionId` | ✅ 内部生成あり | (trace event には含めず) | session-less 方針のため event には載せない |
| `userId` | ✅ runEphemeral に渡したもの | (trace event には含めず) | 同上 |

Skill 実行側に届く `SkillContext` (`toSkillContext()` の戻り値):

- `callerAgent`: LlmAgent.name (実機: `phase1-smoke-agent`)
- `callerReason`: `ADK_DEFAULT_CALLER_REASON = 'invoked-via-adk-runner'` (Step 1 で確立した定数、本 Phase でも変わらず)
- `timestamp`: `new Date()` (Registry 側でフォールバック)

### 3.6 raw payload 非保存の実機検証

テスト "raw payload が trace event に保存されていない (redacted summary のみ)" の assertion:

- 全 trace event を JSON.stringify
- skill の `secret` プロパティ値 (`TOP-SECRET-1234567890`) が文字列に含まれないことを検証
- skill 入力 `msg: 'leak-test'` の値も含まれないことを検証 (raw args 非保存)

結果: **両方とも含まれない**。Step 2 Phase 2 の `payloadToSummary` 関数が field 数 + 上位キー名のみに redaction していることを実機経路で再確認。

### 3.7 LLM 経由の Zod validation error 経路は本 Phase で扱わず

KICKOFF §5.4 DoD には Zod validation error の明示的 DoD はない。Step 2 Phase 3 で「Zod validation error は意図的に未記録」と決定済み (`STEP_2_SUMMARY.md` §3.6) のため本 Phase でも変えない。

ただし KICKOFF §5.2 step 6 で「`Context.functionCallId` の取得状況を記録」とあるため、Step 3 Phase 4 (Integration decision) で「Runner event stream 側で validation error を観測する経路」を検討する余地は残る。本書 §3.5 で取得状況を記録した。

---

## 4. KICKOFF §5.4 Phase 1 DoD 対応

| # | DoD | 対応 |
|---|-----|------|
| 1 | `Runner.runEphemeral()` が最小構成で実行できる | ✅ `buildRunnerSmoke()` + `runEphemeralSmoke()`、テスト 11 cases pass |
| 2 | `InMemorySessionService` を使用している | ✅ `runnerSmoke.ts` 内でハードコード採用、test "DatabaseSessionService 不採用" でも検証 |
| 3 | `Runner.runAsync()` の sessionId 必須経路に進んでいない | ✅ `runEphemeralSmoke()` は `runEphemeral` のみ呼ぶ、`runAsync` の API 表面は本ファイルから一切呼ばない |
| 4 | `skillRegistryToAdkTools()` 由来の tools を LlmAgent に渡せる | ✅ `buildRunnerSmoke()` 内で `LlmAgent({ tools: skillRegistryToAdkTools(...) })`、test で長さ確認 |
| 5 | traceSink ありで trace event が記録される | ✅ test "traceSink あり: 成功時に adk.skill.started + completed が記録される" で実機確認 |
| 6 | traceSink なしで既存挙動が壊れない | ✅ test "traceSink なし: smoke が壊れず、event 記録もされない" で確認 |
| 7 | raw payload が trace に保存されない | ✅ test "raw payload が trace event に保存されていない" で確認 (JSON.stringify で secret 値検索) |
| 8 | ADK Context の実測結果が notes に記録されている | ✅ 本書 §3.5 |
| 9 | 本番 Side-B loop に接続していない | ✅ `runnerSmoke.ts` は `SideBScheduler` / Express server に import / 組み込みなし (本ファイル grep 確認) |
| 10 | 既存 `/src/side-b/skills/` を改変していない | ✅ git diff で確認 (本 PR の変更ファイルは `adk/agents/` 配下 + tests + docs のみ) |

---

## 5. Phase 2 (SequentialAgent) への引き継ぎ事項

### 5.1 Runner 経由でも adapter trace が機能することを確認した

Phase 2 で SequentialAgent を導入しても、sub-agent が `LlmAgent` で `skillRegistryToAdkTools` 由来の tool を持つ限り、Phase 1 で確認した adapter 内 trace 経路はそのまま使える。

### 5.2 LLM stub アプローチが SequentialAgent でも使えるか確認が必要

Phase 1 の `StubFunctionCallLlm` は 1 種類の挙動 (function_call → text) しか持たない。SequentialAgent で複数 sub-agent をそれぞれ異なる挙動でテストする場合:

- 案 A: sub-agent ごとに別 stub を渡す (LlmAgent 単位で model を差し替える)
- 案 B: 1 stub に複数挙動を embed する (sub-agent 名で分岐)

→ Phase 2 着手時に再評価。

### 5.3 Stub LlmResponse の格納先 (test helper) を Phase 2 で共通化検討

`StubFunctionCallLlm` は現状テストファイル内に inline 定義。Phase 2 で再利用するなら `/src/side-b/adk/agents/_testHelpers.ts` のような形に切り出す案がある (`/src/side-b/adk/adapters/_testHelpers.ts` の前例)。本 Phase ではテストファイル内に閉じ込めて Phase 2 で判断する。

### 5.4 SequentialAgent.subAgents が共有する Invocation Context

Phase 2 §5.6 step 4「同一 execution 内で state / context がどう共有されるか確認」を実機で確認する際、Phase 1 で確認した「同一 `runEphemeral` 内の全 event が共通 `invocationId` を持つ」性質を起点にする。

### 5.5 Step 3 Phase 4 (Integration decision) で再評価する未確定事項

- Zod validation error の Runner event stream 側からの捕捉経路 (本書 §3.7)
- `functionCallId` の取得頻度 (本書 §3.5: 取れる場合とそうでない場合がある)
- 実 LLM 呼び出し smoke の必要性 (本 Phase では stub で完結したため未実施)

---

## 6. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_3_KICKOFF.md`](./STEP_3_KICKOFF.md) | Step 3 作業指示書 (本書は §5 Phase 1 の成果物) |
| [`STEP_2_SUMMARY.md`](./STEP_2_SUMMARY.md) | Step 2 完了サマリー (adapter / tracing の前提) |
| [`STEP_2_ADK_TRACING_SPIKE.md`](./STEP_2_ADK_TRACING_SPIKE.md) | Step 2 Phase 1 spike 実測結果 (本書の予測根拠) |
| [`STEP_2_ADK_RUNNER_SMOKE_NOTES.md`](./STEP_2_ADK_RUNNER_SMOKE_NOTES.md) | Step 2 Phase 4 Runner smoke 構成案 (本書で実機検証) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 採用計画 §2.2 session-less 方針 / §6 不可侵領域 |
| [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) | adapter 設計書 (Step 1 + Step 2 Phase 3) |
| [`/src/side-b/adk/agents/runnerSmoke.ts`](../../src/side-b/adk/agents/runnerSmoke.ts) | 本書で扱った Phase 1 実装 |
