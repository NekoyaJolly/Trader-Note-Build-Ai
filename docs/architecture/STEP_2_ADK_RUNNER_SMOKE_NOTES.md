# STEP_2_ADK_RUNNER_SMOKE_NOTES.md — ADK Runner / LlmAgent Smoke Scope 整理

> **作成日**: 2026-05-13
> **対象**: `@google/adk@1.1.0`
> **位置づけ**: Step 2 Phase 4 成果物 — Step 3 で `Runner` / `LlmAgent` 統合を行う際の最小構成と衝突点を文書化したもの。本 Step では Runner 本番統合は**しない**
> **前提**: [`STEP_2_ADK_TRACING_SPIKE.md`](./STEP_2_ADK_TRACING_SPIKE.md) §2.4-§2.7 で実測した API 仕様
> **完了条件**: KICKOFF (`STEP_2_KICKOFF.md`) §6 Phase 4 の DoD を満たすこと

---

## 1. このドキュメントの目的

Step 2 では `skillRegistryToAdkTools()` に optional tracing を統合した (Phase 3、PR #170)。次の Step 3 では、その `FunctionTool[]` を **ADK `Runner` / `LlmAgent` 経由** で実行する smoke 構成を試したい。

本書は、Step 3 着手前に確定しておくべき以下の判断を文書化する。

1. `LlmAgent.tools` への FunctionTool[] 受け渡しが型・実装の双方で破綻しないこと
2. `Runner` の 2 つの実行 API (`runAsync` / `runEphemeral`) のうち、どちらが session-less 方針と整合するか
3. `DatabaseSessionService` を採用せずに Runner を構築する具体的な構成
4. Runner 経由でも Phase 3 で組み込んだ `traceSink` が機能するか
5. Step 2 と Step 3 の境界 (= 本 Step で**しないこと**) を明確にする

実機検証 (実際に `Runner.runEphemeral()` を呼んでイベントを取る) は **Step 3 で行う**。本書は spike 実測 (`STEP_2_ADK_TRACING_SPIKE.md`) と d.ts 確認に基づく **設計判断のメモ**である。

---

## 2. 最小 smoke 構成 (Step 3 着手用)

### 2.1 構成要素

Step 3 の最初の smoke では、以下の最小 4 要素で構成する。

```
┌────────────────────────────────────────────────────────┐
│ Step 3 smoke (session-less, ephemeral)                 │
│                                                        │
│  buildDefaultSkillRegistry()                           │
│      ↓                                                 │
│  skillRegistryToAdkTools(registry, { traceSink })      │← Step 2 Phase 3 成果
│      ↓ FunctionTool[]                                  │
│  new LlmAgent({                                        │
│    name, model, instruction, tools                     │
│  })                                                    │
│      ↓                                                 │
│  new Runner({                                          │
│    appName,                                            │
│    agent,                                              │
│    sessionService: new InMemorySessionService(),       │← DatabaseSessionService 不採用
│  })                                                    │
│      ↓                                                 │
│  runner.runEphemeral({ userId, newMessage })           │← session-less smoke
└────────────────────────────────────────────────────────┘
```

### 2.2 各要素の根拠

| 要素 | 採用理由 | 根拠ドキュメント |
|------|---------|----------------|
| `skillRegistryToAdkTools(registry, { traceSink })` | Step 2 Phase 3 で確立した optional tracing 統合点 | `STEP_2_KICKOFF.md` §5.4、`adapters/README.md` |
| `LlmAgent.tools = FunctionTool[]` | `ToolUnion = BaseTool \| BaseToolset` で `FunctionTool extends BaseTool` のため型レベルで受け取り可能 | `STEP_2_ADK_TRACING_SPIKE.md` §2.4 |
| `InMemorySessionService` | `RunnerConfig.sessionService` が必須。`DatabaseSessionService` 不採用方針 (ADK_ADOPTION.md §2.2) を保ったまま Runner を構築できる | `STEP_2_ADK_TRACING_SPIKE.md` §2.5 |
| `runner.runEphemeral()` | 永続 session が不要。session-less 方針との衝突なし | `STEP_2_ADK_TRACING_SPIKE.md` §2.5-§2.6 |

### 2.3 想定する smoke 検証項目 (Step 3 で実機実行)

Step 3 の最初の smoke 実行で以下を確認する。本書時点では未実行。

1. `LlmAgent` が `FunctionTool[]` を受理してインスタンス生成できる (型・実行時の両方)
2. `Runner.runEphemeral()` が `userId` + `newMessage` のみで実行を開始する
3. LLM が tool call を返した際、adapter の `execute` が呼ばれる
4. `traceSink` (例: `InMemoryTraceSink`) に `adk.skill.started` / `adk.skill.completed` が記録される
5. Skill 実行結果が Runner の event stream に正しく伝播する
6. session 永続化が一切起きていない (`InMemorySessionService` の挙動確認)

---

## 3. session-less 方針との衝突点

ADK_ADOPTION.md §2.2 / §2.3 で確定済みの session-less 方針 (= `DatabaseSessionService` 不採用、状態は既存 Prisma `agentMemory` で管理) と、Runner API の関係を整理する。

### 3.1 衝突点マトリクス

| シナリオ | session 必要性 | session-less 方針との衝突 | 採否 (Step 3) |
|---------|---------------|--------------------------|--------------|
| `FunctionTool` 単独呼び出し (Step 1 確立) | 不要 | なし | ✅ Step 1 / Step 2 で利用済み |
| `Runner.runEphemeral({ userId, newMessage })` | 内部で一時 session を生成・破棄 | なし (永続化されない) | ✅ Step 3 smoke の本命 |
| `Runner.runAsync({ userId, sessionId, newMessage })` | **`sessionId` 必須** | ⚠️ 永続 session を前提とする API | ❌ Step 3 では使わない (理由は §3.2) |
| `DatabaseSessionService` | Runner 構築時に sessionService として渡す | ❌ ADK_ADOPTION.md §2.2 で**採用しない**と確定済み | ❌ 採用禁止 |

### 3.2 `Runner.runAsync` を採用しない理由

`runAsync` は `sessionId` 必須。session-less 方針のもとで `sessionId` を扱うには 2 案ある。

| 案 | 内容 | 評価 |
|---|------|------|
| A. dummy session を毎回作る | `InMemorySessionService.createSession()` で都度生成して即破棄 | 実質的に `runEphemeral` の手動版にしかならない。冗長 |
| B. `runAsync` を使わない | smoke は `runEphemeral` のみで完結させる | ✅ シンプル。本 Step では採用 |

**結論**: 案 B を採用。Step 3 smoke では `runAsync` を呼ばない。将来 `runAsync` が必要になるユースケース (例: 複数ターン会話の永続化) が出てきた時点で、Prisma ベースの自作 `BaseSessionService` 実装を検討する (= ADK_ADOPTION.md §2.2 の「Prisma ベースで自作」方針)。

### 3.3 `InMemorySessionService` 採用の妥当性

`@google/adk@1.1.0` の `BaseSessionService` 系には:

- `InMemorySessionService` — プロセス内 Map で session を保持。プロセス終了で消える
- `DatabaseSessionService` — **不採用** (ADK_ADOPTION.md §2.2)
- `VertexAISessionService` — Vertex AI 連携、本プロジェクト未使用

このうち、`InMemorySessionService` は:

- ✅ ADK 公式 public API
- ✅ Prisma に依存しない (= 既存 `agentMemory` と疎結合)
- ✅ Runner 構築のための必須引数を満たすだけの最小実装
- ✅ プロセス終了で session が消える挙動は session-less 方針と整合

→ Step 3 smoke の `RunnerConfig.sessionService` には `InMemorySessionService` を採用する。

---

## 4. Runner 経由での traceSink 機能性

Step 2 Phase 3 で adapter (`skillRegistryToAdkTools()`) の `execute` 内に traceSink 呼び出しを組み込んだ。これが Runner 経由でも機能するかを検証する。

### 4.1 検証ロジック (設計上の確認)

Phase 1 spike (`STEP_2_ADK_TRACING_SPIKE.md` §2.3) で確認した重要事実:

> ADK の `BasePlugin.*ToolCallback` は **Runner / PluginManager 経由でないと発火しない**。adapter 層の trace は plugin システムに依存しない方針 (= adapter の `execute` 内で直接 `traceSink.record()` を呼ぶ)。

この方針の帰結:

- adapter execute は **Runner 経由でも直接呼び出しでも同じ位置に存在**する
- LLM が tool call を選択 → ADK 内部で `FunctionTool.runAsync()` 起動 → `execute` が呼ばれる → adapter 内の `traceSink.record()` が**そのまま発火**する
- PluginManager 経由 / 非経由の分岐がない

→ **理論上、Runner 経由でも traceSink は機能するはず**。

### 4.2 Step 3 で実機確認すべきこと

ただし以下は実機で確認しないと断言できない。Step 3 smoke の DoD に含める。

- [ ] LLM が tool call を返した際、本当に `adapter.execute` が呼ばれるか (= Runner が tool dispatch を正しく行うか)
- [ ] `Context` の `invocationId` / `agentName` / `functionCallId` が Runner 経由でも adapter に到達するか
- [ ] 同一 Runner 実行内で複数 tool call があった場合、各 trace event の `invocationId` が共通化されるか
- [ ] Runner が中断・エラー終了した場合に `adk.skill.started` が `adk.skill.completed/failed` で閉じられるか (= adapter 内 try/finally で担保済みのはず)

### 4.3 OTel 統合は Step 3 以降の判断

`@google/adk` 内部の `telemetry/tracing.ts` (`tracer`, `traceToolCall`, `traceAgentInvocation`, ...) は OpenTelemetry global tracer に依存する。Step 3 smoke では:

- ✅ 自前の `InMemoryTraceSink` で event を確認する (依存追加なし)
- ❌ OTel SDK / exporter は導入しない (Cloud Trace / Datadog / Jaeger 等は Step 3 以降の判断)

将来 OTel を導入する場合は、自前 `TraceSink` interface を実装する `OtelTraceSink` を追加するだけで済む (= Step 2 で自前 interface に逃げ場を作った理由)。

---

## 5. Step 2 と Step 3 の境界

### 5.1 Step 2 (本 Step) で**やらないこと**

KICKOFF §3.2 / §8 の禁止事項と整合させる。

| 項目 | Step 2 ステータス |
|------|------------------|
| `LlmAgent` の本番インスタンス化 | ❌ しない (本書は型レベル確認まで) |
| `Runner.runEphemeral()` の実機呼び出し | ❌ しない (Step 3 smoke で実行) |
| `InMemorySessionService` の実機呼び出し | ❌ しない (Step 3 smoke で実行) |
| 既存 `AgentLoop` / `PDCALoop` / `EvolutionLoop` への Runner 接続 | ❌ しない (Step 3 以降でも段階的) |
| `SideBScheduler` への ADK 接続 | ❌ しない (Step 3 以降でも要設計判断) |
| `DatabaseSessionService` 導入 | ❌ 採用しない (ADK_ADOPTION.md §2.2 で確定済み) |
| OTel SDK / exporter 導入 | ❌ しない (Step 3 以降の判断) |
| Prisma schema 変更 | ❌ しない (ADK_ADOPTION.md §6 不可侵領域) |

### 5.2 Step 3 で扱う候補 (= 本 Step では着手しない)

KICKOFF §11 を再掲しつつ、本書での追加判断を反映:

1. 最小 `LlmAgent` を構築し、Step 1 の `FunctionTool[]` を `tools` に渡す
2. `Runner.runEphemeral()` + `InMemorySessionService` で session-less smoke を実行する (本書 §2.1 の構成)
3. `Runner.runAsync()` **は使わない** (本書 §3.2)。必要性が出てきたら別途設計議論
4. Runner 経由でも `TraceSink` が event を記録できるか実機確認 (本書 §4.2)
5. 既存 Side-B loop との接続可否を**設計判断する** (=実装ではなく判断)
6. 接続する場合でも、まず read-only / dry-run entrypoint に限定する (KICKOFF §11.6)

**Step 3 でも禁止**: いきなり既存 `EvolutionLoop` / `PDCALoop` の置換に入らないこと (KICKOFF §11 末尾、ADK_ADOPTION.md §6 不可侵領域)。

### 5.3 一時 script の扱い

本書は spike 実測 (Phase 1 で取得済み) と d.ts 読みに基づく**設計判断ノート**であり、Phase 4 内で新規 spike script を追加しない。Phase 1 で作成した `scripts/adk_tracing_spike.ts` は Phase 5 cleanup で削除する (KICKOFF §6 Phase 5、本 PR に含む)。

---

## 6. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_2_KICKOFF.md`](./STEP_2_KICKOFF.md) | Step 2 全体作業指示書 (本書は §6 Phase 4 の成果物) |
| [`STEP_2_ADK_TRACING_SPIKE.md`](./STEP_2_ADK_TRACING_SPIKE.md) | Phase 1 実測結果 (本書 §2-§4 の根拠) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | §2.2 session-less 方針 / §6 不可侵領域 |
| [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) | Phase 3 で組み込んだ traceSink 統合点 |
| [`STEP_2_SUMMARY.md`](./STEP_2_SUMMARY.md) | Step 2 全体完了サマリー (Phase 5 で作成) |

---

## 7. Phase 4 DoD 確認

KICKOFF (`STEP_2_KICKOFF.md`) §6 Phase 4 の DoD と本書の対応:

- [x] Step 3 で Runner smoke を行う場合の最小構成が文書化されている → §2.1
- [x] session-less 方針との衝突点が明記されている → §3
- [x] 本 Step では Runner 本番統合をしていない → §5.1
- [x] 一時 script が削除されている → 本 PR の Phase 5 cleanup で `scripts/adk_tracing_spike.ts` を削除 (§5.3 参照)
