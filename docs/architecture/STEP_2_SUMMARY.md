# STEP_2_SUMMARY.md — Step 2 (Tracing / Telemetry 統合) 完了サマリー

> **ステータス**: ✅ 完了 (2026-05-13)
> **期間**: 2026-05-13 (Phase 1〜5 を同日進行、Phase ごとに別 PR)
> **完了 PR**: #166 (Phase 1) / #168 (Phase 2) / #170 (Phase 3) / 本 PR (Phase 4 + 5)
> **次ステップ**: Step 3 (PDCALoop の SequentialAgent ラップ) — Nekoさんが KICKOFF.md を作成予定

---

## 1. Step 2 の目的

Step 1 (PR #164 / #165) で構築した `skillRegistryToAdkTools()` アダプター層を対象に、**ADK 経由の Skill 実行を観測できる最小基盤** を作る。

実現したこと:

1. ADK TypeScript SDK の tracing / context / tool invocation 関連 API を **実測検証** し、採用方針を確定
2. ADK adapter 層で扱う trace event 契約 (`AdkTraceEvent`) と sink interface (`TraceSink`) を定義
3. `NoopTraceSink` (production default) / `InMemoryTraceSink` (tests / local) を実装
4. raw payload を保存しない `argsSummary` / `resultSummary` の redaction / summary 関数を実装
5. `skillRegistryToAdkTools()` に optional `traceSink` を統合し、Skill 実行前後の trace 記録を可能化
6. Step 1 の等価性検証テスト (deep equal) を**壊さずに維持**
7. Step 3 で Runner / LlmAgent 統合を行う際の **最小構成と衝突点** を文書化 (Phase 4)

本 Step は「ADK を動かす」工程ではなく **「ADK が動いた時に何が起きたか分かるようにする」工程** (KICKOFF §12)。Runner / LlmAgent の本番統合は Step 3 に回した。

---

## 2. Phase 構造と完了 PR

| Phase | PR | 主要成果 |
|-------|----|----------|
| **Phase 1** (Tracing Spike) | [#166](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/166) ✅ | `scripts/adk_tracing_spike.ts` で ADK TypeScript SDK の `Context` getter / `FunctionTool.runAsync` / `BasePlugin` callbacks / `Runner` API / `telemetry/tracing.ts` を実測。`STEP_2_ADK_TRACING_SPIKE.md` 作成 (Phase 2/3 設計確定の根拠) |
| **Phase 2** (Trace Contract) | [#168](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/168) ✅ | `/src/side-b/adk/tracing/` 一式: `traceTypes.ts` / `traceSink.ts` / `noopTraceSink.ts` / `inMemoryTraceSink.ts` / `traceSummaries.ts` / `index.ts`。trace 型・interface・2 実装・redaction/summary 関数を確定。テスト 42 cases (型 10 / summaries 23 / sinks 9) |
| **Phase 3** (Adapter Tracing Integration) | [#170](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/170) ✅ | `skillRegistryToAdkTools()` に optional `{ traceSink }` 統合。既存 signature 完全維持。成功 / SkillResult error の trace 記録、traceSink 失敗の握りつぶし、Step 1 等価性テスト維持。テスト追加 17 cases (`adapterTracing.test.ts`) |
| **Phase 4 + 5** (Runner Smoke Notes / Summary / Cleanup) | 本 PR | `STEP_2_ADK_RUNNER_SMOKE_NOTES.md` 作成 (Step 3 着手用最小構成・session-less 衝突点・traceSink 機能性確認項目)、`STEP_2_SUMMARY.md` 作成、`ADK_ADOPTION.md` §3 / §7 / §8 を Step 2 完了状態に更新、`scripts/adk_tracing_spike.ts` 削除 |

---

## 3. 確定した主要方針

Step 2 を通じて確定した方針 (Step 3 以降に継続適用):

### 3.1 trace を取る位置: adapter execute 内

- **採用**: `skillRegistryToAdkTools()` が生成する各 FunctionTool の `execute` 関数内で `traceSink.record()` を呼ぶ
- **不採用**: ADK `BasePlugin.beforeToolCallback` / `afterToolCallback` 経由の trace
- **理由**: BasePlugin callbacks は Runner / PluginManager 経由でないと発火しない (Phase 1 spike §2.3 で実測)。adapter execute 内で記録すれば Runner 経由 / 直接呼び出しの両方で同じ trace が取れる
- **詳細**: [`STEP_2_ADK_TRACING_SPIKE.md`](./STEP_2_ADK_TRACING_SPIKE.md) §2.3

### 3.2 raw payload を保存しない (redaction first)

- **採用**: `argsSummary` / `resultSummary` は `TracePayloadSummary` (field 数 + 上位キー名のみ + `redacted: true`) のみ保存
- **不採用**: raw args / raw result の保存、LLM prompt / response 全文の保存、error details payload の保存
- **理由**: trace は将来 Cloud Logging / Cloud Trace / Datadog 等に流れる可能性がある。最初から情報を絞る (KICKOFF §5.2: 「ログを便利なゴミ箱にすると、あとで情報漏洩博物館になる」)
- **上限**: `topLevelKeys` 配列長 = 20、キー文字列長 = 64、error message 長 = 512 (それぞれ `TOP_LEVEL_KEYS_LIMIT` / `KEY_NAME_LIMIT` / `DEFAULT_ERROR_MESSAGE_MAX` で export)

### 3.3 TraceSink interface で出力先を抽象化

- **採用**: 自前の `TraceSink { record(event): void | Promise<void> }` interface に依存
- **不採用**: ADK 内部 `telemetry/tracing.ts` の `tracer` / `traceToolCall()` 等への直接依存
- **理由**:
  - ADK 内部 tracing は OpenTelemetry global tracer 前提 (OTel SDK / exporter の追加導入が必要、Step 3 以降の判断)
  - ADK 内部 tracing 関数は Runner 内部の自動呼び出し前提で書かれており、外部から手動呼び出しするのは想定外
  - 自前 interface に逃げ場を作っておけば、将来 `OtelTraceSink` 等を**追加するだけ**で外部 backend 連携可能
- **詳細**: [`STEP_2_ADK_TRACING_SPIKE.md`](./STEP_2_ADK_TRACING_SPIKE.md) §2.7

### 3.4 既存 signature の完全維持 (Step 1 互換)

- **採用**: `skillRegistryToAdkTools(registry)` (Step 1 signature) は挙動を一切変えない
- **追加**: `skillRegistryToAdkTools(registry, { traceSink })` の 2 引数版を**追加**
- **未指定時**: `NoopTraceSink` 相当として扱い、`adk.skill.started` / `adk.skill.completed` の record は呼ばない (= zero overhead)
- **検証**: Step 1 の等価性検証テスト (7 cases) を**未改変で全 pass** することで担保

### 3.5 status 値の対応関係

| シナリオ | trace event | status | record されるか |
|---------|------------|--------|---------------|
| Skill 成功 (`SkillResult.ok === true`) | `adk.skill.started` + `adk.skill.completed` | `'ok'` | ✅ |
| Skill 失敗 (`SkillResult.ok === false`) | `adk.skill.started` + `adk.skill.failed` | `'error'` | ✅ |
| Unexpected throw (Skill 内部の bug) | `adk.skill.started` + `adk.skill.failed` | `'thrown'` | ✅ |
| Zod validation error (ADK が execute 呼び出し前に throw) | **記録されない** | — | ❌ (§3.6 参照) |

### 3.6 Zod validation error trace の意図的非記録

- **挙動**: ADK の `FunctionTool.runAsync` は `parameters` (Zod) が指定されていれば内部で `parameters.parse(args)` を自動実行し、parse 失敗時に `execute` を**呼ばずに** throw する
- **帰結**: adapter の `execute` 内で `traceSink.record('started')` を呼ぶ位置に到達しないため、validation error の trace は記録されない
- **代替案 (検討した)**: `tool.runAsync` 自体を adapter 側で wrap し、外側で `started` / `failed (thrown)` を記録する
- **不採用理由**: wrap すると LLM 用の `parameters` declaration (FunctionTool が ADK 内部で公開する schema) が崩れる。LLM が正しい引数構造を判断できなくなる
- **本 Step での扱い**: 既知の限界として明文化。Step 3 で Runner 経由統合する際、Runner 側の event stream で validation error を捕捉する別経路がないか再検討する
- **コード上の記録**: `skillRegistryToAdkTools.ts` 冒頭 JSDoc の「Step 2 Phase 3 で追加した tracing 仕様」セクション

### 3.7 traceSink 失敗の握りつぶし方針

- **採用**: `traceSink.record()` が throw / reject しても adapter は Skill 実行を**絶対に壊さない**
- **実装**: adapter 内で try/catch して握りつぶす (例外ログは出さない)
- **理由**: tracing は補助機能。production で sink の障害 (例: ネットワーク sink 失敗) が業務処理に波及してはならない
- **テスト**: `adapterTracing.test.ts` で sink throw / Promise reject の両方を検証

### 3.8 session-less 方針の継続 (Runner 統合への準備)

- ADK_ADOPTION.md §2.2 / §2.3 で確定済みの session-less 方針 (= `DatabaseSessionService` 不採用、状態は Prisma `agentMemory` で管理) を Step 2 でも維持
- Step 3 の Runner smoke では `InMemorySessionService` + `Runner.runEphemeral()` を採用予定 (本 PR の `STEP_2_ADK_RUNNER_SMOKE_NOTES.md` §2.1)
- `Runner.runAsync()` (sessionId 必須) は使わない (同 §3.2)

---

## 4. 実装場所

### 4.1 本番コード (`/src/side-b/adk/`)

| ファイル | 役割 | 新規/変更 |
|---------|------|----------|
| `tracing/traceTypes.ts` | `AdkTraceEvent` / `AdkTraceEventKind` / `AdkTraceStatus` / `TracePayloadSummary` | 新規 (Phase 2) |
| `tracing/traceSink.ts` | `TraceSink` interface | 新規 (Phase 2) |
| `tracing/noopTraceSink.ts` | production default sink (no-op) | 新規 (Phase 2) |
| `tracing/inMemoryTraceSink.ts` | tests / local 用 sink (配列保持) | 新規 (Phase 2) |
| `tracing/traceSummaries.ts` | `payloadToSummary` / `shortenErrorMessage` / 上限定数 | 新規 (Phase 2) |
| `tracing/index.ts` | 公開 API barrel | 新規 (Phase 2) |
| `adapters/skillRegistryToAdkTools.ts` | optional `{ traceSink }` 統合 | 変更 (Phase 3) |
| `adapters/README.md` | tracing 統合点の追記 | 変更 (Phase 3) |

### 4.2 テスト (`/src/side-b/tests/adk/`)

| ファイル | テスト数 | 内容 |
|---------|---------|------|
| `tracing/traceTypes.test.ts` | 10 | 型シェイプ / フィールド optional 性 / Date 型扱い |
| `tracing/traceSummaries.test.ts` | 23 | `payloadToSummary` の各種 input (object / array / primitive / null) / 上限挙動 / redaction フラグ / `shortenErrorMessage` の cutoff 挙動 |
| `tracing/sinks.test.ts` | 9 | `NoopTraceSink` no-op 確認 / `InMemoryTraceSink` 蓄積・clear・順序保持 |
| `tracing/adapterTracing.test.ts` | 17 | adapter 経由の成功 / error / throw / sink 失敗握りつぶし / 既存挙動維持 |

**合計**: tracing 関連 **59 cases**、Step 1 既存 adapter 関連 **71 cases**、**計 130 cases** (Step 1 + Step 2 の adk 領域全体)

### 4.3 ドキュメント (`/docs/architecture/`)

| ファイル | Phase | 内容 |
|---------|-------|------|
| `STEP_2_KICKOFF.md` | (Nekoさん作成) | 作業指示書 |
| `STEP_2_ADK_TRACING_SPIKE.md` | Phase 1 | API 実測結果と設計方針確定の根拠 |
| `STEP_2_ADK_RUNNER_SMOKE_NOTES.md` | Phase 4 (本 PR) | Step 3 Runner smoke 最小構成と衝突点 |
| `STEP_2_SUMMARY.md` | Phase 5 (本 PR) | 本書 |
| `ADK_ADOPTION.md` | Phase 5 (本 PR) | §3 / §7 / §8 を Step 2 完了状態に更新 |

### 4.4 削除したファイル (本 PR)

| ファイル | 削除理由 |
|---------|---------|
| `scripts/adk_tracing_spike.ts` | Phase 1 実測用の一時 script。KICKOFF §3.2 / §6 Phase 5 で削除予定と明記 |

---

## 5. 検証結果

### 5.1 全 DoD のチェック

KICKOFF §7 全体 DoD の対応状況:

**実装 DoD (§7.1)**

- [x] `TraceSink` interface がある → `tracing/traceSink.ts`
- [x] `NoopTraceSink` がある → `tracing/noopTraceSink.ts`
- [x] `InMemoryTraceSink` がある → `tracing/inMemoryTraceSink.ts`
- [x] trace event 型がある → `tracing/traceTypes.ts`
- [x] trace summary / redaction 関数がある → `tracing/traceSummaries.ts`
- [x] `skillRegistryToAdkTools()` が optional tracing に対応している → `adapters/skillRegistryToAdkTools.ts`
- [x] `traceSink` 未指定時に既存挙動が変わらない → Step 1 等価性テスト 7 cases 維持
- [x] `traceSink` 指定時に FunctionTool 実行前後が記録される → `adapterTracing.test.ts`
- [x] raw args / raw result を保存していない → `TracePayloadSummary` で field 数 + 上位キーのみ
- [x] ADK SDK internal / private API に依存していない → public API のみ (`Context` / `FunctionTool`)

**テスト DoD (§7.2)**

- [x] 全 trace 関連テスト (4 ファイル / 59 cases) green
- [x] Step 1 adapter / equivalence tests (4 ファイル / 71 cases) green
- [x] `npm run build` green
- [x] 関連 test command green

**設計 DoD (§7.3)**

- [x] 既存 `/src/side-b/skills/` を改変していない (git で確認)
- [x] 既存 `/src/side-b/agent/` を改変していない (git で確認)
- [x] 既存 loop に ADK Runner を接続していない (本 Step では Runner 統合自体しない)
- [x] `DatabaseSessionService` を採用していない (Step 3 でも採用しない方針)
- [x] Prisma schema を変更していない (ADK_ADOPTION.md §6 不可侵領域)
- [x] UI を追加していない
- [x] Step 3 に回す事項が明記されている → `STEP_2_ADK_RUNNER_SMOKE_NOTES.md` §5.2

**ドキュメント DoD (§7.4)**

- [x] `STEP_2_ADK_TRACING_SPIKE.md` がある (Phase 1)
- [x] `STEP_2_ADK_RUNNER_SMOKE_NOTES.md` がある (Phase 4、本 PR)
- [x] `STEP_2_SUMMARY.md` がある (本書、本 PR)
- [x] `ADK_ADOPTION.md` が更新されている (本 PR)
- [x] adapter README が更新されている (Phase 3 で `adapters/README.md` 更新済み、tracing 用 README は `tracing/index.ts` JSDoc で代替)

### 5.2 数値スナップショット (Step 2 完了時)

- **新規ファイル**: 6 (tracing 配下) + 4 (tracing tests) + 2 (Phase 4-5 ドキュメント) = **12**
- **変更ファイル**: `adapters/skillRegistryToAdkTools.ts` / `adapters/README.md` / `ADK_ADOPTION.md` = **3**
- **削除ファイル**: `scripts/adk_tracing_spike.ts` = **1**
- **既存実装の改変**: `/src/side-b/skills/` / `/src/side-b/agent/` / `prisma/schema.prisma` ともに **ゼロ** (git で確認可能)
- **テストケース** (adk 領域全体): Step 1 = 71 + Step 2 = 59 = **130 PASS**
- **any / unknown 違反** (本番コード): **ゼロ** (KICKOFF §8 厳守)
- **ADK SDK internal / private API 依存**: **ゼロ** (`Context` / `FunctionTool` / `BaseTool` の public API のみ)

---

## 6. Step 3 への引き継ぎ事項

### 6.1 確定済みの方針 (Step 3 でも継続)

- `TraceSink` interface 経由で trace を扱う (外部 backend 接続時は実装クラスを追加)
- raw payload は保存しない (Step 3 で trace を見る場面が増えてもこの方針は維持)
- session-less 方針を維持 (`InMemorySessionService` + `runEphemeral` 構成)
- 既存 `AgentLoop` / `PDCALoop` / `EvolutionLoop` の内部は不可侵 (合成によるラップのみ)

### 6.2 Step 3 で実機検証する項目

[`STEP_2_ADK_RUNNER_SMOKE_NOTES.md`](./STEP_2_ADK_RUNNER_SMOKE_NOTES.md) §2.3 / §4.2 にまとめた:

1. `LlmAgent` が `skillRegistryToAdkTools()` の戻り値を tools として受理できるか (実機)
2. `Runner.runEphemeral()` が `userId` + `newMessage` のみで実行を開始するか
3. LLM の tool call を経由して adapter `execute` が呼ばれるか
4. Runner 経由でも `traceSink` に event が記録されるか
5. `Context.invocationId` / `agentName` / `functionCallId` が Runner 経由でも adapter に届くか
6. 同一 Runner 実行内の複数 tool call が共通の `invocationId` を持つか

### 6.3 未解決事項 (Step 3 以降の判断)

- **OTel exporter 統合**: 外部 observability backend (Cloud Trace / Datadog / Jaeger 等) への送信が必要になったら、`OtelTraceSink` 等を `TraceSink` の実装として追加する
- **Zod validation error の trace 化**: 本 Step では意図的に未実装 (§3.6)。Step 3 で Runner 経由統合した際、Runner 側の event stream から捕捉する別経路を再検討
- **trace ID 体系**: 現状 adapter 側で UUID 生成。ADK の `invocationId` を root として階層化する案もある (Step 3 で再検討)
- **`Runner.runAsync()` 採用判断**: 複数ターン会話の永続化が必要になった時点で、Prisma ベースの自作 `BaseSessionService` を検討 (= ADK_ADOPTION.md §2.2 の「Prisma ベースで自作」方針)

### 6.4 撤退基準への影響

ADK_ADOPTION.md §5 の撤退基準 5 項目すべてに、Step 2 の成果は**影響を与えていない**:

- ① `reasoning_effort` 透過: Step 2 では LLM 呼び出しに触れていない (adapter は Skill 呼び出しのみ)
- ② PromptRegistry スコアリング劣化: Step 2 では Skill / PromptRegistry に触れていない
- ③ `@google/adk` 6 ヶ月停滞 / ④ Google deprecated 宣言: Step 2 では public API のみに依存 (撤退時は `tracing/` ディレクトリも `git rm -rf` で消える)
- ⑤ ユーザー判断: 変更なし

撤退時の保証 (= `git rm -rf src/side-b/adk/` で完全撤退できる) は Step 2 でも維持されている (依存方向: `adk → 既存` のみ、逆向きの import なし)。

---

## 7. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_2_KICKOFF.md`](./STEP_2_KICKOFF.md) | Step 2 作業指示書 (Nekoさん作成、本書の DoD 出典) |
| [`STEP_2_ADK_TRACING_SPIKE.md`](./STEP_2_ADK_TRACING_SPIKE.md) | Phase 1 実測結果 (採用方針の根拠) |
| [`STEP_2_ADK_RUNNER_SMOKE_NOTES.md`](./STEP_2_ADK_RUNNER_SMOKE_NOTES.md) | Phase 4 成果物 (Step 3 着手用最小構成) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 採用計画 §3 段階導入ロードマップ / §7 実装状況 |
| [`STEP_1_SUMMARY.md`](./STEP_1_SUMMARY.md) | Step 1 完了サマリー (Step 2 の前提) |
| [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) | adapter 設計書 (Phase 3 で tracing 統合点追記) |
| [`/src/side-b/adk/tracing/index.ts`](../../src/side-b/adk/tracing/index.ts) | tracing 公開 API barrel (使用例 JSDoc あり) |

---

> **Step 2 の総括**: 「ADK が動いた時に何が起きたか分かるようにする」工程は完了。薄く、測れる、壊さない tracing layer を構築し、既存ループの心臓には触れずに「血圧計を付けた」状態 (KICKOFF §12)。次の Step 3 では、本書で文書化した最小構成で実際に Runner / LlmAgent を動かし、観測層が機能することを実機確認する。
