# STEP_2_KICKOFF.md — ADK 段階導入 Step 2: Tracing / Telemetry 統合

> **対象**: Claude Code / 実装エージェント  
> **発注者**: Nekoさん  
> **作成日**: 2026-05-13  
> **対象プロジェクト**: `Trader-Note-Build-Ai`  
> **位置づけ**: ADK 段階導入 Step 2  
> **前提**: Step 0 設計ガード完了、Step 1 Skill → ADK FunctionTool アダプター完了  
> **完了条件**: 本ドキュメント §7 の DoD をすべて満たすこと  
> **実行戦略**: Phase 完了ごとに PR、Copilot レビュー対応、Nekoさん確認後に次 Phase へ進行  

---

## 1. このドキュメントの目的

本ドキュメントは、Google ADK 段階導入の **Step 2: Tracing / Telemetry 統合** の作業指示書である。

Step 1 では、既存 `SkillRegistry` を ADK `FunctionTool[]` として露出する adapter 層を実装した。Step 2 では、その adapter 層を対象に、ADK 経由の Skill 実行を追跡できる **最小の観測基盤** を構築する。

本 Step の主目的は以下である。

1. ADK TypeScript 実行時に取得できる trace / invocation / tool call 関連情報を実測する
2. プロジェクト内で扱う trace event 契約を定義する
3. `skillRegistryToAdkTools()` 経由の FunctionTool 実行前後を計測可能にする
4. 既存 SkillRegistry 直接実行と ADK adapter 経由実行の等価性を壊さない
5. Step 3 以降の Runner / LlmAgent 統合に向けて、観測可能性の土台を作る

重要: **本 Step は Runner / LlmAgent の本番統合ではない。**  
まず観測層を整え、次 Step で ADK Runner 統合を安全に判断できる状態にする。

---

## 2. 前提となる確定事項

### 2.1 Step 1 完了済み事項

Step 1 では以下が完了している前提で作業する。

- `@google/adk@1.1.0` 導入済み
- `jsonSchemaToZod()` 実装済み
- `toSkillContext()` 実装済み
- `skillRegistryToAdkTools()` 実装済み
- `SkillRegistry` → ADK `FunctionTool[]` の等価性検証テスト実装済み
- 既存 `/src/side-b/skills/` および `/src/side-b/agent/` の改変ゼロ
- ADK SDK internal / private API 依存ゼロ
- `any` / `unknown` 違反ゼロ

### 2.2 Step 1 から継続する設計方針

以下の方針は本 Step でも継続する。

- ADK 関連コードは原則 `/src/side-b/adk/` 配下に閉じる
- 依存方向は `adk → 既存` のみ
- 既存 `SkillRegistry` / `Skill` / `SkillContext` の API は改変しない
- 既存 `AgentLoop` / `PDCALoop` / `EvolutionLoop` から ADK adapter を直接呼び出さない
- ADK `DatabaseSessionService` は採用しない
- 状態管理は既存 Prisma / agentMemory 方針を維持する
- ADK SDK の public API のみ使用する
- 本番コードで `any` / `unknown` を書かない
- `@ts-ignore` / `@ts-nocheck` は禁止
- `@ts-expect-error` を使う場合は 10 文字以上の説明を必須とする

### 2.3 本 Step の基本判断

本 Step では、ADK を既存ループに接続する前に、**何が起きたかを観測できる状態** を作る。

つまり、実装順序は以下を守る。

1. 観測できるようにする
2. テストで壊れていないことを確認する
3. ドキュメントに実測結果を残す
4. Runner / LlmAgent 統合は Step 3 に回す

---

## 3. スコープ

### 3.1 本 Step でやること

- ADK TypeScript の tracing / context / tool invocation 関連 API の実測
- `AdkTraceEvent` 型の設計
- `TraceSink` interface の設計
- `NoopTraceSink` の実装
- `InMemoryTraceSink` の実装
- trace payload の redaction / summary 方針の設計
- `skillRegistryToAdkTools()` に optional tracing を追加
- 成功 / SkillResult error / validation error / unexpected throw の trace 記録
- Step 1 の等価性検証テストの維持
- Step 2 の実測結果と設計判断を README / SUMMARY に反映

### 3.2 本 Step でやらないこと

- 既存 `AgentLoop` / `PDCALoop` / `EvolutionLoop` の ADK 置換
- `SideBScheduler` から ADK Runner を呼ぶこと
- 本番 `LlmAgent` / `Runner` 統合
- ADK `DatabaseSessionService` 導入
- Prisma schema 変更
- agentMemory の構造変更
- UI 追加
- Cloud Logging / Cloud Trace / Grafana / Datadog など外部 observability backend への本番接続
- ESLint 既存違反の大量修正
- tsconfig audit 既存違反の大量修正
- unrelated refactor

---

## 4. 推奨ディレクトリ構成

以下を基本とする。既存構成と衝突する場合は、作業前に代替案を明記する。

```text
/src/side-b/adk/
  adapters/
    skillRegistryToAdkTools.ts        # Step 1 実装済み。Step 2 で optional traceSink を追加
    skillContext.ts                   # Step 1 実装済み。改変は最小限
    README.md                         # Step 2 の tracing 方針を追記
  tracing/
    traceTypes.ts                     # TraceEvent 型定義
    traceSink.ts                      # TraceSink interface
    noopTraceSink.ts                  # default sink
    inMemoryTraceSink.ts              # test / local 用 sink
    traceSummaries.ts                 # args/result summary と redaction
    index.ts                          # public export
  AGENTS.md                           # 必要なら tracing 領域ルールを追記

/tests/adk/
  tracing/
    traceTypes.test.ts
    traceSummaries.test.ts
    inMemoryTraceSink.test.ts
    skillRegistryToAdkTools.tracing.test.ts

/scripts/
  adk_tracing_spike.ts                # Phase 1 のみ。最終 PR までに削除

/docs/architecture/
  STEP_2_ADK_TRACING_SPIKE.md
  STEP_2_SUMMARY.md
```

禁止:

- `/src/side-b/skills/` に tracing 実装を入れない
- `/src/side-b/agent/` に ADK tracing 実装を入れない
- 既存 loop に tracing を直挿ししない
- spike script を最終成果物として残さない

---

## 5. Trace 設計の基本方針

### 5.1 最小 TraceEvent

本 Step で扱う trace は、まず adapter 層の tool invocation を追跡するための内部 event とする。

想定する情報:

```typescript
/** ADK adapter 経由の Skill 実行を表す内部 trace event。 */
export interface AdkTraceEvent {
  readonly kind: AdkTraceEventKind;
  readonly traceId: string;
  readonly parentTraceId?: string;
  readonly invocationId?: string;
  readonly functionCallId?: string;
  readonly agentName: string;
  readonly skillName: string;
  readonly callerReason: string;
  readonly startedAt: Date;
  readonly endedAt?: Date;
  readonly durationMs?: number;
  readonly status: AdkTraceStatus;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly argsSummary?: TracePayloadSummary;
  readonly resultSummary?: TracePayloadSummary;
}

/** trace event の種類。 */
export type AdkTraceEventKind =
  | 'adk.skill.started'
  | 'adk.skill.completed'
  | 'adk.skill.failed';

/** trace event の結果状態。 */
export type AdkTraceStatus = 'started' | 'ok' | 'error' | 'thrown';

/** payload を直接保存しないための要約型。 */
export interface TracePayloadSummary {
  readonly fieldCount?: number;
  readonly topLevelKeys?: readonly string[];
  readonly primitiveType?: string;
  readonly redacted: true;
}
```

上記は方向性であり、実装時は既存 lint / 型制約に合わせて調整する。ただし、**raw args / raw result を trace event に保存しない** こと。

### 5.2 raw payload 保存禁止

trace には以下を保存してはならない。

- LLM prompt 全文
- LLM response 全文
- 売買仮説の全文
- バックテスト結果の詳細 payload
- DB row 全体
- API key / token / cookie
- user input 全文
- 個人情報になり得る値
- 取引ロジックの完全な条件式

理由: trace は後から外部 observability backend に流れる可能性がある。最初から情報を絞る。ログを便利なゴミ箱にすると、あとで情報漏洩博物館になる。

### 5.3 TraceSink 方針

trace の出力先は interface に分離する。

```typescript
/** ADK trace event の出力先。 */
export interface TraceSink {
  record(event: AdkTraceEvent): void | Promise<void>;
}
```

実装する sink:

- `NoopTraceSink`: 何もしない。production default
- `InMemoryTraceSink`: tests / local spike 用。記録済み event を配列で保持

本 Step では Cloud Trace / OTel exporter への直接接続はしない。外部送信は Step 3 以降の判断材料にする。

### 5.4 既存挙動との互換性

`skillRegistryToAdkTools(registry)` の既存挙動は変えない。

追加する場合は optional options とする。

```typescript
/** SkillRegistry を ADK FunctionTool 配列へ変換する。 */
export function skillRegistryToAdkTools(
  registry: SkillRegistry,
  options?: SkillRegistryToAdkToolsOptions,
): FunctionTool[];

/** ADK Tool 変換時の追加オプション。 */
export interface SkillRegistryToAdkToolsOptions {
  readonly traceSink?: TraceSink;
}
```

`traceSink` 未指定時は `NoopTraceSink` 相当として扱い、Step 1 の等価性テストが壊れないこと。

---

## 6. Phase 構成

## Phase 1: ADK TypeScript Tracing Spike

### 目的

ADK TypeScript SDK の public API で、tool invocation の追跡に使える情報を実測する。

### 作業対象

- `scripts/adk_tracing_spike.ts`
- `docs/architecture/STEP_2_ADK_TRACING_SPIKE.md`

### 確認項目

1. `Context` / `ReadonlyContext` から取得できる値
   - `agentName`
   - `invocationId`
   - `functionCallId`
   - `sessionId`
   - `userId`
2. `FunctionTool.runAsync()` 実行時に渡せる / 取れる情報
3. `beforeToolCallback` / `afterToolCallback` の利用可否
4. `LlmAgent.tools` に Step 1 の `FunctionTool[]` を渡せるか
5. `Runner.runAsync()` と `Runner.runEphemeral()` の差分
6. session-less 方針と Runner API の衝突点
7. `OTelHooks` の TypeScript 実利用可否
8. ADK 公式 tracing が TypeScript でどこまで利用可能か

### 実装条件

- spike script は `/scripts/` 配下に置く
- 本番コードから spike script を import しない
- ADK public API のみ使用する
- internal / private API を見つけても使用しない
- 実測結果を markdown に残す
- spike script は最終 PR までに削除する

### 成果物

- `docs/architecture/STEP_2_ADK_TRACING_SPIKE.md`
- 実測結果表
- Step 2 Phase 2 以降で採用する trace 方針

### DoD

- [ ] ADK TypeScript public API だけで確認している
- [ ] `Context` から取得可能な値が表で整理されている
- [ ] `functionCallId` / `invocationId` の扱い方が決まっている
- [ ] Runner の session 要件と session-less 方針の関係が整理されている
- [ ] `OTelHooks` を今 Step で使うか、将来扱いにするか明記されている
- [ ] spike script が最終的に削除対象として記録されている

---

## Phase 2: Trace Contract 実装

### 目的

ADK adapter 層で使う trace event 契約と sink interface を定義する。

### 作業対象

- `/src/side-b/adk/tracing/traceTypes.ts`
- `/src/side-b/adk/tracing/traceSink.ts`
- `/src/side-b/adk/tracing/noopTraceSink.ts`
- `/src/side-b/adk/tracing/inMemoryTraceSink.ts`
- `/src/side-b/adk/tracing/traceSummaries.ts`
- `/src/side-b/adk/tracing/index.ts`
- `/tests/adk/tracing/*.test.ts`

### 作業手順

1. trace 型を先にテストで固定する
2. `TraceSink` interface を定義する
3. `NoopTraceSink` を実装する
4. `InMemoryTraceSink` を実装する
5. args / result の summary 関数を実装する
6. raw payload が保存されないことをテストする
7. unsupported payload を握りつぶさず、安全な summary に落とす

### 実装注意

- 本番コードで `any` / `unknown` を使わない
- `TracePayloadSummary` は raw value を持たない
- `topLevelKeys` は必要に応じて件数上限を設ける
- error message は保存してよいが、巨大文字列は短縮する
- details payload は保存しない
- date は `Date` を使うか、ISO string にするかを Phase 1 の結果で決める

### DoD

- [ ] `TraceSink` interface が定義されている
- [ ] `NoopTraceSink` が default として使える
- [ ] `InMemoryTraceSink` がテストで使える
- [ ] raw args / raw result が trace に保存されない
- [ ] redaction / summary 方針が README に明記されている
- [ ] 本番コードに `any` / `unknown` がない
- [ ] tests green

---

## Phase 3: skillRegistryToAdkTools Tracing Integration

### 目的

Step 1 で実装した `skillRegistryToAdkTools()` に optional tracing を追加し、ADK FunctionTool 実行前後を trace 可能にする。

### 作業対象

- `/src/side-b/adk/adapters/skillRegistryToAdkTools.ts`
- `/src/side-b/adk/adapters/README.md`
- `/tests/adk/tracing/skillRegistryToAdkTools.tracing.test.ts`
- 既存 Step 1 adapter tests

### 実装方針

既存 signature を壊さない。

```typescript
/** SkillRegistry を ADK FunctionTool 配列へ変換する。 */
export function skillRegistryToAdkTools(
  registry: SkillRegistry,
  options?: SkillRegistryToAdkToolsOptions,
): FunctionTool[];
```

`options.traceSink` が未指定の場合は `NoopTraceSink` 相当として扱う。

記録する event:

1. Skill 実行開始
2. Skill 実行成功
3. SkillResult error
4. validation error / unexpected throw

### 期待する trace

成功時:

```text
adk.skill.started
adk.skill.completed
```

SkillResult error 時:

```text
adk.skill.started
adk.skill.failed
```

Zod validation error / unexpected throw 時:

```text
adk.skill.started
adk.skill.failed
```

### 重要な挙動

- `traceSink.record()` の失敗で Skill 実行自体を壊さない
- traceSink 側の例外は握りつぶすか、明示的に安全化する
- SkillResult は Step 1 の挙動を維持する
- `SkillResult` を throw に変換しない
- Zod validation error の ADK 標準挙動を壊さない
- durationMs を記録する
- `functionCallId` / `invocationId` が取れる場合は記録する
- 取れない場合は undefined を許容する

### DoD

- [ ] `skillRegistryToAdkTools(registry)` の既存挙動が変わっていない
- [ ] `skillRegistryToAdkTools(registry, { traceSink })` で trace が記録される
- [ ] 成功時 trace が記録される
- [ ] SkillResult error 時 trace が記録される
- [ ] validation error / unexpected throw 時 trace が記録される
- [ ] traceSink の失敗が Skill 実行を壊さない
- [ ] 既存 adapter tests がすべて green
- [ ] 既存 equivalence tests がすべて green
- [ ] ADK SDK internal / private API 依存ゼロ

---

## Phase 4: Runner / LlmAgent Smoke Scope の整理

### 目的

Step 3 で Runner / LlmAgent 統合へ進むために、最小 smoke の構成だけ確認する。ただし本番統合はしない。

### 作業対象

- `docs/architecture/STEP_2_ADK_RUNNER_SMOKE_NOTES.md`
- 必要なら一時 script。ただし最終 PR までに削除

### 確認すること

- `LlmAgent.tools` に `skillRegistryToAdkTools()` の結果を渡せるか
- `Runner.runEphemeral()` を session-less 方針の smoke に使えるか
- `Runner.runAsync()` が `sessionId` / `userId` を要求する場合、Step 3 でどのように扱うべきか
- 本番では `DatabaseSessionService` を採用せずに進められるか
- Runner 経由時にも traceSink が機能するか

### 禁止事項

- 既存 loop から Runner を呼ばない
- 本番コードに Runner 統合を入れない
- session 永続化を追加しない
- Prisma schema を変更しない

### DoD

- [ ] Step 3 で Runner smoke を行う場合の最小構成が文書化されている
- [ ] session-less 方針との衝突点が明記されている
- [ ] 本 Step では Runner 本番統合をしていない
- [ ] 一時 script が削除されている

---

## Phase 5: Documentation / Summary / Cleanup

### 目的

Step 2 の成果をドキュメントに閉じ、Step 3 に引き継げる状態にする。

### 作業対象

- `/src/side-b/adk/adapters/README.md`
- `/src/side-b/adk/tracing/README.md` または `index.ts` JSDoc
- `/docs/architecture/ADK_ADOPTION.md`
- `/docs/architecture/STEP_2_SUMMARY.md`
- spike script 削除

### 更新内容

- Step 2 の完了状態
- tracing architecture
- TraceSink の使い方
- redaction 方針
- Runner / LlmAgent 統合を Step 3 に回す理由
- session-less 方針の維持
- 未解決事項
- 撤退基準への影響

### DoD

- [ ] `STEP_2_SUMMARY.md` が作成されている
- [ ] `ADK_ADOPTION.md` が Step 2 完了状態に更新されている
- [ ] tracing README または adapter README が更新されている
- [ ] spike script が削除されている
- [ ] 不要な console log が残っていない
- [ ] PR description にテスト結果が記載されている

---

## 7. 全体 DoD

Step 2 は以下をすべて満たした場合に完了とする。

### 7.1 実装 DoD

- [ ] `TraceSink` interface がある
- [ ] `NoopTraceSink` がある
- [ ] `InMemoryTraceSink` がある
- [ ] trace event 型がある
- [ ] trace summary / redaction 関数がある
- [ ] `skillRegistryToAdkTools()` が optional tracing に対応している
- [ ] `traceSink` 未指定時に既存挙動が変わらない
- [ ] `traceSink` 指定時に FunctionTool 実行前後が記録される
- [ ] raw args / raw result を保存していない
- [ ] ADK SDK internal / private API に依存していない

### 7.2 テスト DoD

- [ ] trace 型のテストがある
- [ ] summary / redaction のテストがある
- [ ] `NoopTraceSink` のテストがある
- [ ] `InMemoryTraceSink` のテストがある
- [ ] 成功時 trace のテストがある
- [ ] SkillResult error 時 trace のテストがある
- [ ] validation error / unexpected throw 時 trace のテストがある
- [ ] 既存 Step 1 adapter tests が green
- [ ] 既存 equivalence tests が green
- [ ] `npm run build` が green
- [ ] 関連 test command が green

### 7.3 設計 DoD

- [ ] 既存 `/src/side-b/skills/` を改変していない
- [ ] 既存 `/src/side-b/agent/` を改変していない
- [ ] 既存 loop に ADK Runner を接続していない
- [ ] `DatabaseSessionService` を採用していない
- [ ] Prisma schema を変更していない
- [ ] UI を追加していない
- [ ] Step 3 に回す事項が明記されている

### 7.4 ドキュメント DoD

- [ ] `STEP_2_ADK_TRACING_SPIKE.md` がある
- [ ] `STEP_2_SUMMARY.md` がある
- [ ] `ADK_ADOPTION.md` が更新されている
- [ ] adapter README / tracing README が更新されている
- [ ] PR description にテスト結果と未解決事項がある

---

## 8. 禁止事項

本 Step では以下を禁止する。

- 既存 Skill の実装変更
- 既存 SkillRegistry の API 変更
- 既存 SkillContext の型変更
- 既存 AgentLoop / PDCALoop / EvolutionLoop の変更
- SideBScheduler への ADK 接続
- Runner / LlmAgent の本番導入
- ADK DatabaseSessionService 導入
- MikroORM 導入
- Prisma schema 変更
- raw args / raw result の trace 保存
- LLM prompt / response 全文の trace 保存
- API key / token / secret の trace 保存
- `any` / `unknown` の本番コード使用
- `@ts-ignore` / `@ts-nocheck`
- ADK SDK private / internal API 依存
- unrelated refactor
- ESLint / tsconfig 既存違反の大規模修正を混ぜること

---

## 9. 推奨 PR 分割

### PR #166: Step 2 Phase 1 — ADK Tracing Spike

目的:

- ADK TypeScript tracing / context / invocation 実測
- `STEP_2_ADK_TRACING_SPIKE.md` 作成

含めるもの:

- spike script
- 実測結果 markdown

最終的に削除するもの:

- spike script

### PR #167: Step 2 Phase 2 — Trace Contract

目的:

- trace 型
- TraceSink interface
- Noop / InMemory sink
- redaction / summary

含めるもの:

- `/src/side-b/adk/tracing/`
- `/tests/adk/tracing/`

### PR #168: Step 2 Phase 3 — Adapter Tracing Integration

目的:

- `skillRegistryToAdkTools()` optional tracing
- 成功 / error / throw trace
- Step 1 tests 維持

含めるもの:

- adapter の最小変更
- tracing integration tests

### PR #169: Step 2 Phase 4-5 — Docs / Cleanup

目的:

- Runner smoke notes
- summary
- docs 更新
- spike 削除確認

含めるもの:

- `STEP_2_SUMMARY.md`
- `ADK_ADOPTION.md` 更新
- README 更新

PR番号は実際の進行に合わせて変更してよい。ただし、**Phase 単位で差分を小さく保つ** こと。

---

## 10. 実装時のレビュー観点

Copilot / Claude Code 自己レビュー時は、以下を必ず確認する。

### 10.1 責務分離

- tracing は `/src/side-b/adk/tracing/` に閉じているか
- adapter は traceSink を呼ぶだけになっているか
- Skill 側に tracing 責務が漏れていないか
- Scheduler / Loop 側に ADK 責務が漏れていないか

### 10.2 安全性

- raw payload を保存していないか
- error details を丸ごと保存していないか
- secret / token / key を保存する可能性がないか
- traceSink 失敗で本処理が壊れないか

### 10.3 型安全

- 本番コードに `any` がないか
- 本番コードに `unknown` がないか
- 型ガードが過剰に緩くないか
- `as` による雑な型逃げがないか

### 10.4 ADK 依存

- public API だけを使っているか
- `_getDeclaration` など underscore prefix method に依存していないか
- private field を読んでいないか
- SDK 更新で壊れやすい前提を書いていないか

### 10.5 テスト

- trace あり / なし両方を確認しているか
- 既存等価性テストが壊れていないか
- traceSink が失敗するケースを確認しているか
- validation error の扱いを確認しているか

---

## 11. Step 3 への引き継ぎ事項

Step 2 完了後、Step 3 で扱う候補は以下。

1. 最小 `LlmAgent` を構築し、Step 1 の `FunctionTool[]` を `tools` に渡す
2. `Runner.runEphemeral()` を使った session-less smoke を試す
3. `Runner.runAsync()` が必要な場合の session id / user id 方針を設計する
4. ADK Runner 経由でも TraceSink が event を記録できるか確認する
5. 既存 Side-B loop との接続可否を設計判断する
6. 接続する場合でも、まず read-only / dry-run entrypoint に限定する

Step 3 であっても、いきなり既存 `EvolutionLoop` / `PDCALoop` の置換に入らないこと。

---

## 12. 最終メッセージ

Step 2 は「ADKを動かす」工程ではなく、**ADKが動いた時に何が起きたか分かるようにする工程**である。

ここを飛ばして Runner 統合へ進むと、成功しても失敗しても原因が追えない。成功した黒箱は、失敗した黒箱より少しだけ危険である。

本 Step では、薄く、測れる、壊さない tracing layer を作る。既存ループの心臓には触らない。まず血圧計を付ける。

