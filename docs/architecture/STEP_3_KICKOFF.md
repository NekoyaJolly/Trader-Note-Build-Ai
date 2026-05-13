# STEP_3_KICKOFF.md — ADK 段階導入 Step 3: Runner Smoke + PDCALoop SequentialAgent ラップ

> **対象**: Claude Code / 実装エージェント
> **発注者**: Nekoさん
> **作成日**: 2026-05-13
> **対象プロジェクト**: `Trader-Note-Build-Ai`
> **位置づけ**: ADK 段階導入 Step 3
> **前提**: Step 0 設計ガード完了 / Step 1 Skill → ADK FunctionTool アダプター完了 / Step 2 Tracing 基盤完了
> **完了条件**: 本ドキュメント §7 の DoD をすべて満たすこと
> **実行戦略**: Phase 完了ごとに PR、Copilot レビュー対応、Nekoさんマージ判断後に次 Phase へ進行

---

## 1. このドキュメントの目的

本ドキュメントは、Google ADK 段階導入の **Step 3** の作業指示書である。

Step 2 (PR #166 / #168 / #170 / #173) で、`skillRegistryToAdkTools()` に optional tracing を統合し、自前 `TraceSink` interface 経由で adapter 経由の Skill 実行を観測できる土台を整えた。Step 3 では、その土台の上で:

1. ADK `Runner` / `LlmAgent` を**実機で動かす smoke 検証**を行い、Step 2 で文書化した最小構成 (`InMemorySessionService` + `Runner.runEphemeral()` + `TraceSink`) がそのまま機能することを確認する
2. ADK `SequentialAgent` の挙動を **最小サブ Agent 構成**で確認し、決定論的な sub-step 連結に使えることを実機で実証する
3. 既存 `PDCALoop` (`src/side-b/agent/pdcaLoop.ts`) の **内部に一切触れずに**、その挙動を ADK `SequentialAgent` で**合成によりラップ**する dry-run wrapper を構築する。pdcaLoop の各 state ハンドラー実行が個別 span として観測できる状態にする
4. 既存 Side-B ループ (`AgentLoop` / `PDCALoop` / `EvolutionLoop`) を ADK 経由に**接続するかしないかの設計判断**を、検証結果に基づいて文書化する。本 Step では接続自体は**しない**

重要: **本 Step は既存 `PDCALoop.ts` の置換ではない。** dry-run の合成ラッパーを `/src/side-b/adk/agents/` 配下に新規追加し、既存ループとは**並走**できる構造を維持する。撤退時は `src/side-b/adk/` を `git rm -rf` するだけで完全撤退できる状態を保つ (ADK_ADOPTION.md §5 撤退基準、`/src/side-b/adk/AGENTS.md` §撤退手順)。

---

## 2. 前提となる確定事項

### 2.1 Step 2 完了済み事項

Step 2 では以下が完了している前提で作業する (`STEP_2_SUMMARY.md` §4 / §5)。

- `/src/side-b/adk/tracing/` 一式実装済み: `traceTypes` / `traceSink` interface / `NoopTraceSink` / `InMemoryTraceSink` / `traceSummaries` / `index` barrel
- `skillRegistryToAdkTools(registry, { traceSink })` の optional tracing 統合済み (既存 signature 維持)
- ADK 経由の Skill 実行が `adk.skill.started` / `adk.skill.completed` / `adk.skill.failed` の trace event として記録できる
- raw payload は `TracePayloadSummary` (field 数 + 上位キーのみ) に redaction
- traceSink 失敗の握りつぶし方針確定
- Zod validation error は意図的に未記録 (Step 3 で Runner event stream 側からの捕捉経路を再検討)
- adk 領域テスト 130/130 PASS (Step 1: 71 + Step 2: 59)
- 既存実装の変更ゼロ (`/src/side-b/skills/`, `/src/side-b/agent/`, `prisma/schema.prisma`)
- ADK SDK internal / private API 依存ゼロ
- `any` / `unknown` 違反ゼロ
- `STEP_2_ADK_RUNNER_SMOKE_NOTES.md` で Step 3 着手用最小構成と衝突点を文書化済み

### 2.2 Step 1 / 2 から継続する設計方針

以下の方針は本 Step でも厳守する。

- ADK 関連コードは原則 `/src/side-b/adk/` 配下に閉じる
- 依存方向: `adk → 既存` のみ (`既存 → adk` への import は禁止、`/src/side-b/adk/AGENTS.md` 依存方向の制約)
- 既存 `SkillRegistry` / `Skill` / `SkillContext` の API は改変しない
- 既存 `AgentLoop` / `PDCALoop` / `EvolutionLoop` の**内部**を改変しない (ADK_ADOPTION.md §6 不可侵領域)
- ADK 化は**合成によるラップ**のみ可 (継承や内部書き換えは禁止)
- ADK `DatabaseSessionService` は採用しない (`InMemorySessionService` のみ)
- 状態管理は既存 Prisma / `agentMemory` 方針を維持する
- ADK SDK の public API のみ使用する
- 本番コードで `any` / `unknown` を書かない (tests / scripts のみ例外)
- `@ts-ignore` / `@ts-nocheck` は禁止
- `@ts-expect-error` を使う場合は 10 文字以上の description 必須
- raw payload (LLM prompt / response 全文 / DB row / API key 等) を trace / log に保存しない
- `TraceSink` interface 経由で trace を扱う (ADK 内部 `telemetry/tracing.ts` への直接依存禁止)

### 2.3 本 Step の基本判断

Step 2 までで「観測できる土台」が整った。Step 3 では「動かしてみて、それを使う側 (`SequentialAgent`) も観測できる状態を作る」工程に進む。

実装順序は以下を守る。

1. まず Runner / LlmAgent を **実機で動かす** (= Step 2 の minimum smoke 構成の実機検証)
2. 次に SequentialAgent を **最小構成** で動かす (toy sub-agents で挙動確認)
3. それらが OK なら、**PDCALoop の dry-run wrapper** を構築 (`/src/side-b/adk/agents/` 配下、合成によるラップのみ)
4. 接続可否は**判断ドキュメント**として残し、本 Step では接続しない

---

## 3. スコープ

### 3.1 本 Step でやること

- `Runner.runEphemeral()` + `InMemorySessionService` + `LlmAgent` + `skillRegistryToAdkTools()` の実機 smoke
- Runner 経由でも `TraceSink` に event が記録されることを実機検証
- ADK `Context.invocationId` / `agentName` / `functionCallId` が Runner 経由で adapter execute に届くか実機確認
- ADK `SequentialAgent` の挙動を最小サブ Agent 構成で検証
- `/src/side-b/adk/agents/` 配下に PDCALoop dry-run wrapper を構築 (合成によるラップ)
- pdcaLoop の各 state ハンドラー実行が個別 span (trace event) として観測可能になる構造を作る
- 既存 Side-B loop との接続可否の設計判断ドキュメント (実装はしない)
- Step 1 / Step 2 のテストを未改変で全 pass で維持

### 3.2 本 Step でやらないこと

- 既存 `pdcaLoop.ts` / `agentLoop.ts` / `agentMemory.ts` の**内部改変** (公開 API の利用は可、改変は禁止)
- `SideBScheduler` から ADK Runner を呼ぶこと
- 既存ループの ADK 置換 (本 Step は dry-run wrapper の追加のみ)
- ADK `DatabaseSessionService` 導入
- ADK `LoopAgent` / `ParallelAgent` の本番統合 (Step 4 / Step 5 で扱う)
- Prisma schema 変更
- `agentMemory` の構造変更
- 既存 `Skill` の追加・改変
- 新規 LLM プロンプトの追加 (`PromptRegistry` 不可侵)
- UI 追加
- Cloud Trace / Datadog / Grafana など外部 observability backend への本番接続
- ESLint / tsconfig audit の既存違反の大規模修正 (別 PR で扱う)
- unrelated refactor

### 3.3 「dry-run wrapper」とは何か (本 Step での定義)

本書で `dry-run wrapper` と言うときは以下を意味する:

- `/src/side-b/adk/agents/` 配下に新規追加される ADK `SequentialAgent` (またはそれを構築する factory 関数)
- 内部で**既存 PDCALoop の公開 API** (例: `pdcaLoop.start()` / `pdcaLoop.stop()` / 公開された getter) のみを使う
- 既存 PDCALoop の **private メソッド (`handleMonitoring` 等) を呼ばない**。private を呼びたい場合は、Step 3 では諦めて公開 API のラップに留める
- 実行しても**取引判断・DB 書き込み・通知などの副作用が起きない** read-only / 観測専用の構成
- 本番 SideBScheduler / Express server には組み込まない (script / test からのみ実行)

private な state handler を SequentialAgent の sub-agent として個別に span 化するには、pdcaLoop.ts 側に何らかの hook が必要になるが、それは**不可侵領域の改変にあたる**。本 Step では pdcaLoop の挙動を「外から観測可能な範囲で」ラップするに留め、より細かい span 化は Step 4 以降の判断とする (§9 オープン課題で扱う)。

---

## 4. 推奨ディレクトリ構成

以下を基本とする。既存構成と衝突する場合は、作業前に代替案を明記する。

```text
/src/side-b/adk/
  adapters/                              # Step 1 / 2 で実装済み (本 Step では touch しない、test 観点での再利用のみ)
  tracing/                               # Step 2 で実装済み (本 Step では touch しない、test 観点での再利用のみ)
  agents/                                # Step 3 で新規構築
    runnerSmoke.ts                       # Phase 1: runEphemeral smoke の factory + 実行関数
    minimalSequentialAgent.ts            # Phase 2: 最小 SequentialAgent の構築例
    pdcaLoopAdkWrapper.ts                # Phase 3: PDCALoop の dry-run wrapper (SequentialAgent ベース)
    README.md                            # agents 領域の設計書 (Phase 3 完了時に確定)

/src/side-b/tests/adk/
  agents/
    runnerSmoke.test.ts                  # Phase 1 単体テスト
    minimalSequentialAgent.test.ts       # Phase 2 単体テスト
    pdcaLoopAdkWrapper.test.ts           # Phase 3 単体テスト (read-only / dry-run)

/scripts/
  adk_runner_smoke.ts                    # Phase 1 のみ。最終 PR までに削除
  adk_sequential_smoke.ts                # Phase 2 のみ。最終 PR までに削除

/docs/architecture/
  STEP_3_RUNNER_SMOKE_REPORT.md          # Phase 1 実測結果
  STEP_3_SEQUENTIAL_AGENT_REPORT.md      # Phase 2 実測結果
  STEP_3_PDCALOOP_WRAP_DESIGN.md         # Phase 3 設計書 + 結果
  STEP_3_INTEGRATION_DECISION.md         # Phase 4 接続可否判断ドキュメント
  STEP_3_SUMMARY.md                      # Phase 5 完了サマリー
```

禁止:

- `/src/side-b/agent/` 配下に ADK 実装を入れない (既存実装と ADK 実装は **必ず分離**)
- `/src/side-b/adk/agents/` から `/src/side-b/agent/` 内部の private 関数を import しない (公開 API のみ)
- spike script を最終成果物として残さない (Phase 5 cleanup で必ず削除)
- 本番 SideBScheduler / Express server に dry-run wrapper を組み込まない

---

## 5. 基本方針

### 5.1 Runner / LlmAgent 構成

本 Step で扱う構成は `STEP_2_ADK_RUNNER_SMOKE_NOTES.md` §2.1 で文書化したものに揃える。

```typescript
const registry = buildDefaultSkillRegistry();
const traceSink = new InMemoryTraceSink();
const tools = skillRegistryToAdkTools(registry, { traceSink });

const agent = new LlmAgent({
  name: 'pdca-smoke-agent',
  model: /* 既存 AIProvider 経由のモデル指定。本 Step 内では実 LLM 呼び出しを避ける構成も可 */,
  instruction: /* PromptRegistry 経由で取得した最小 instruction。ハードコード禁止 */,
  tools,
});

const runner = new Runner({
  appName: 'trader-note-build-ai',
  agent,
  sessionService: new InMemorySessionService(),
});

await runner.runEphemeral({
  userId: 'smoke-user',
  newMessage: /* 最小 user input */,
});
```

採否:

- ✅ `Runner.runEphemeral()` のみ採用
- ❌ `Runner.runAsync()` は採用しない (sessionId 必須、session-less 方針と衝突、`STEP_2_ADK_RUNNER_SMOKE_NOTES.md` §3.2)
- ❌ `DatabaseSessionService` は採用しない
- ❌ ADK 内部 `telemetry/tracing.ts` の `tracer` 直接利用は採用しない (Step 2 と同様、`TraceSink` 経由で抽象化)

### 5.2 LLM 呼び出しの扱い

本 Step では実 LLM (OpenRouter 経由) を呼ばずに smoke を完了させる構成を**優先する**。

理由:

- LLM 呼び出しは時間・料金・非決定性が大きく、smoke の信頼性を下げる
- Step 3 で確認したいのは「ADK の配線が動くこと」と「trace が取れること」であり、LLM の判定品質ではない
- 実 LLM smoke は Step 3 完了後、別 PR で `STEP_3_LLM_SMOKE.md` 等を建てて議論する

具体的には:

- LlmAgent の `model` には mock / stub を渡せるなら渡す
- ADK の `LlmAgent` 構築自体に LLM 呼び出しが必須なら、LLM 呼び出しが起きない経路 (= LLM が tool call を返さないシナリオ) のみで smoke する
- LLM を **呼ばずに** FunctionTool を直接 dispatch する経路 (= adapter 単体実行) は Step 1 / 2 で確認済み、本 Step では再確認しない

§9 で「LLM 呼び出しなしで Runner smoke を完了させる構成」をオープン課題として明示する。

### 5.3 SequentialAgent の使い方

ADK `SequentialAgent` は決定論的な sub-agent 連結に使うコンポーネント。

```typescript
const sequential = new SequentialAgent({
  name: 'pdca-sequential-dry-run',
  subAgents: [
    /* sub-agent 1: monitoring stage observer */,
    /* sub-agent 2: evaluation stage observer */,
    /* sub-agent 3: reflection stage observer */,
  ],
});
```

採否:

- ✅ 決定論的な sub-agent 連結のため採用
- ✅ 各 sub-agent の実行を個別 span (trace event) として観測する
- ❌ `LoopAgent` (Step 5 で扱う) / `ParallelAgent` (Step 4 で扱う) は本 Step では使わない

### 5.4 PDCALoop ラップ方針

`pdcaLoop.ts` (725 行、`PDCALoop` クラス + 7 state handler) の**内部に触れずに**ラップする。

採用するアプローチ (Phase 3 で確定):

| アプローチ | 内容 | 採否 |
|-----------|------|------|
| A. private state handler を SequentialAgent sub-agent として個別公開 | `pdcaLoop.ts` の `handleMonitoring` 等を public 化、または getter を追加 | ❌ 不可侵領域改変、本 Step では不採用 |
| B. `pdcaLoop` の public API (`start()` / `stop()` / `getState()` 等) を sub-agent から呼ぶ合成ラッパー | `pdcaLoop.ts` 無改変、`adk/agents/pdcaLoopAdkWrapper.ts` のみ追加 | ✅ 本 Step で採用 |
| C. PDCALoop を ADK でゼロから書き直し | 既存実装の置き換え | ❌ 不可侵領域 (合成ラップのみ可)、本 Step では絶対採用しない |

→ **アプローチ B** で進行。dry-run wrapper の具体的サブ Agent 構成 (sub-agent 数・名前・責務) は Phase 3 設計書 (`STEP_3_PDCALOOP_WRAP_DESIGN.md`) で確定する。

### 5.5 既存テストの維持

Step 1 (71 cases) + Step 2 (59 cases) + 既存 side-b テスト群はすべて未改変で全 pass を維持する。本 Step の変更によって既存テストが壊れた場合は、原因究明と修正を本 PR スコープに含める (= 既存テスト壊しを後回しにしない)。

---

## 6. Phase 構成

## Phase 1: Runner / LlmAgent 実機 Smoke

### 目的

Step 2 で文書化した最小構成 (`STEP_2_ADK_RUNNER_SMOKE_NOTES.md` §2.1) が、実機で本当に動作することを確認する。`TraceSink` が Runner 経由で機能するか、`Context` の各 ID が adapter execute に届くかを実測する。

### 作業対象

- `/src/side-b/adk/agents/runnerSmoke.ts`
- `/src/side-b/tests/adk/agents/runnerSmoke.test.ts`
- `scripts/adk_runner_smoke.ts` (Phase 5 で削除)
- `docs/architecture/STEP_3_RUNNER_SMOKE_REPORT.md`

### 確認項目

1. `Runner.runEphemeral()` + `InMemorySessionService` 構成でランナーがインスタンス化できる
2. LlmAgent.tools に Step 1 の `FunctionTool[]` を実機で渡せる
3. (LLM 呼び出しなしの経路で) FunctionTool が adapter 経由で呼ばれる場合、`traceSink` に `adk.skill.started` / `adk.skill.completed` が記録される
4. Runner 経由でも `Context.invocationId` / `agentName` / `functionCallId` が adapter execute に届く
5. 同一 Runner 実行内の複数 tool call が共通の `invocationId` を持つ
6. session 永続化が一切起きない (`InMemorySessionService` がプロセス内で完結)
7. Runner が中断・エラー終了した場合に `adk.skill.started` が `adk.skill.completed` / `adk.skill.failed` で閉じられる
8. Zod validation error 時、Runner event stream 側で error を捕捉できるか (Step 2 の意図的未記録の代替経路)

### 実装条件

- `runnerSmoke.ts` は factory 関数 + runner 起動関数のみ公開 (本番ループへの接続なし)
- spike script (`scripts/adk_runner_smoke.ts`) からのみ実行可能
- `LlmAgent.model` は mock / stub または LLM 呼び出しが起きない構成
- ADK public API のみ使用
- 実測結果を `STEP_3_RUNNER_SMOKE_REPORT.md` に記録

### 成果物

- `runnerSmoke.ts` (本番コード)
- `runnerSmoke.test.ts` (単体テスト、最低 5 cases)
- `STEP_3_RUNNER_SMOKE_REPORT.md` (実測結果表)

### DoD

- [ ] `Runner` インスタンス化が成功する
- [ ] `LlmAgent.tools` に `skillRegistryToAdkTools()` の戻り値を渡せる
- [ ] Runner 経由で trace event が記録される (最低 1 ケース実機確認)
- [ ] `Context.invocationId` 等が adapter execute に到達する
- [ ] session 永続化が起きない
- [ ] Zod validation error 経路の取り扱いを実測結果として記録 (Step 2 の意図的未記録の妥当性確認)
- [ ] spike script が Phase 5 で削除対象として記録されている
- [ ] ADK SDK internal / private API 依存ゼロ
- [ ] 本番コードに `any` / `unknown` がない

---

## Phase 2: 最小 SequentialAgent 検証

### 目的

ADK `SequentialAgent` の挙動を、最小サブ Agent 構成 (toy) で実機確認する。Phase 3 で PDCALoop をラップする前に、SequentialAgent 単体が決定論的に動くことを実証する。

### 作業対象

- `/src/side-b/adk/agents/minimalSequentialAgent.ts`
- `/src/side-b/tests/adk/agents/minimalSequentialAgent.test.ts`
- `scripts/adk_sequential_smoke.ts` (Phase 5 で削除)
- `docs/architecture/STEP_3_SEQUENTIAL_AGENT_REPORT.md`

### 確認項目

1. `SequentialAgent` に `subAgents` を渡してインスタンス化できる
2. sub-agent が宣言順に決定論的に実行される
3. 各 sub-agent の実行が個別 span として観測できる (`traceSink` 経由 or Runner event stream 経由)
4. 任意の sub-agent が throw した場合の Sequential 全体の挙動 (中断 / スキップ / 続行)
5. SequentialAgent を Runner 経由で実行した場合の `invocationId` 階層構造
6. SequentialAgent と FunctionTool の組み合わせ (= sub-agent が FunctionTool を呼ぶ場合の trace 連結)

### 実装条件

- toy sub-agents は副作用なし・決定性ありの純粋関数で構成
- 実取引判定や DB 書き込みは一切起こさない
- spike script (`scripts/adk_sequential_smoke.ts`) からのみ実行可能
- ADK public API のみ使用

### 成果物

- `minimalSequentialAgent.ts` (本番コード)
- `minimalSequentialAgent.test.ts` (単体テスト、最低 4 cases)
- `STEP_3_SEQUENTIAL_AGENT_REPORT.md` (実測結果表 + Phase 3 で採用する sub-agent 構成方針)

### DoD

- [ ] SequentialAgent インスタンス化が成功する
- [ ] sub-agent が宣言順に実行されることを実機確認
- [ ] 各 sub-agent の実行が個別 span として観測できる
- [ ] sub-agent throw 時の Sequential 全体の挙動が文書化されている
- [ ] Phase 3 で採用する PDCALoop ラップ用 sub-agent 構成の方向性が決まっている
- [ ] spike script が Phase 5 で削除対象として記録されている

---

## Phase 3: PDCALoop SequentialAgent Dry-Run Wrapper

### 目的

既存 `pdcaLoop.ts` (725 行、`PDCALoop` クラス + 7 state handler) の **内部に一切触れずに**、その挙動を ADK `SequentialAgent` で**合成によりラップ**する dry-run wrapper を構築する。pdcaLoop の実行が個別 span (trace event) として観測可能になる構造を作る。

### 作業対象

- `/src/side-b/adk/agents/pdcaLoopAdkWrapper.ts`
- `/src/side-b/adk/agents/README.md`
- `/src/side-b/tests/adk/agents/pdcaLoopAdkWrapper.test.ts`
- `docs/architecture/STEP_3_PDCALOOP_WRAP_DESIGN.md`

### 確認項目

1. `pdcaLoop.ts` の内部に**一切**触れずに wrapper を構築できる (git diff で確認)
2. 既存 PDCALoop の公開 API (`start()` / `stop()` / `getState()` / 等) のみで wrapper が機能する
3. wrapper を実行しても**副作用が起きない** (取引判断・DB 書き込み・通知が一切起きない、dry-run)
4. wrapper の実行が `traceSink` に span として記録される
5. SequentialAgent の sub-agent 構成は Phase 2 で確定した方向性に従う
6. 既存 PDCALoop テストが未改変で全 pass を維持する
7. wrapper の単体テストが green

### 実装条件

- `pdcaLoop.ts` を**変更しない** (git diff で確認できること)
- `agentMemory.ts` も変更しない (`pdcaLoop` の private state を読みたい場合でも、`agentMemory` 公開 API 経由のみ)
- wrapper は read-only / dry-run。本番 SideBScheduler / Express server に組み込まない
- private state handler (`handleMonitoring` 等) を呼ばない (= 公開 API での観測に留める)
- ADK public API のみ使用

### 成果物

- `pdcaLoopAdkWrapper.ts` (本番コード)
- `agents/README.md` (Step 3 agents 領域の設計書)
- `pdcaLoopAdkWrapper.test.ts` (単体テスト、最低 6 cases)
- `STEP_3_PDCALOOP_WRAP_DESIGN.md` (sub-agent 構成・観測粒度・既存ループとの並走方針)

### DoD

- [ ] `pdcaLoop.ts` の git diff がゼロ
- [ ] `agentMemory.ts` の git diff がゼロ
- [ ] wrapper を実行しても本番副作用が起きない (取引判断・DB 書き込み・通知ゼロ)
- [ ] wrapper の実行が `traceSink` に span として記録される
- [ ] 既存 PDCALoop / pdcaLoop tests が全 pass
- [ ] wrapper 単体テストが green (最低 6 cases)
- [ ] ADK SDK internal / private API 依存ゼロ
- [ ] 本番コードに `any` / `unknown` がない
- [ ] agents/README.md に wrapper の設計と利用例が明記されている

---

## Phase 4: 既存ループ接続可否の設計判断

### 目的

Phase 1〜3 の検証結果に基づき、既存 Side-B ループ (`AgentLoop` / `PDCALoop` / `EvolutionLoop`) を ADK 経由に**接続するかしないか**を判断する。本 Step では接続自体は**しない**。判断ドキュメントのみ作成する。

### 作業対象

- `docs/architecture/STEP_3_INTEGRATION_DECISION.md`

### 確認項目

1. Phase 1〜3 で確認した実機挙動 (動く / 動かない / 部分的に動く)
2. Step 4 / 5 へ進むか、Step 6 (撤退判断) へ進むか
3. 接続するなら、どの entry point から (read-only / dry-run の段階的開放 vs. 直接置換)
4. ADK_ADOPTION.md §5 撤退基準への該当有無
5. Step 4 (ParallelAgent for Lens 並列) / Step 5 (LoopAgent for 進化ループ) へ進む際の前提条件

### 禁止事項

- 既存ループから ADK Runner / SequentialAgent を呼ばない (本 Step では絶対に接続しない)
- 本番 SideBScheduler を変更しない
- 本番 Express server を変更しない
- Prisma schema を変更しない
- agentMemory を変更しない

### DoD

- [ ] Phase 1〜3 の実機検証結果が判断ドキュメントにまとまっている
- [ ] Step 4 / Step 5 / Step 6 のいずれに進むかの判断が明文化されている
- [ ] 接続する場合の段階的開放プランが文書化されている (本 Step では実装しない)
- [ ] ADK_ADOPTION.md §5 撤退基準への該当有無が記載されている
- [ ] 本 Step で接続が実装されていない (git diff で `/src/side-b/agent/` 配下が無変更)

---

## Phase 5: Documentation / Summary / Cleanup

### 目的

Step 3 の成果をドキュメントに閉じ、Step 4 (または Step 6) に引き継げる状態にする。

### 作業対象

- `/src/side-b/adk/agents/README.md` (Phase 3 で初版作成、本 Phase で最終形に整える)
- `docs/architecture/ADK_ADOPTION.md`
- `docs/architecture/STEP_3_SUMMARY.md`
- spike script 削除 (`scripts/adk_runner_smoke.ts` / `scripts/adk_sequential_smoke.ts`)

### 更新内容

- Step 3 の完了状態
- Runner / LlmAgent / SequentialAgent の採用方針
- PDCALoop dry-run wrapper の構造
- 既存ループ接続判断の結論
- session-less 方針の維持
- 撤退基準への影響
- Step 4 (または Step 6) への引き継ぎ事項

### DoD

- [ ] `STEP_3_SUMMARY.md` が作成されている
- [ ] `ADK_ADOPTION.md` が Step 3 完了状態に更新されている (§3 ロードマップ / §4 DoD / §7 実装状況 / §8 関連ドキュメント)
- [ ] `agents/README.md` が更新されている
- [ ] spike script が削除されている (`adk_runner_smoke.ts` / `adk_sequential_smoke.ts`)
- [ ] 不要な console log が残っていない
- [ ] PR description にテスト結果が記載されている

---

## 7. 全体 DoD

Step 3 は以下をすべて満たした場合に完了とする。

### 7.1 実装 DoD

- [ ] `runnerSmoke.ts` がある
- [ ] `minimalSequentialAgent.ts` がある
- [ ] `pdcaLoopAdkWrapper.ts` がある
- [ ] `agents/README.md` がある
- [ ] 既存 `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の git diff がゼロ
- [ ] 本番 SideBScheduler / Express server に dry-run wrapper が組み込まれていない
- [ ] dry-run wrapper を実行しても本番副作用 (取引判断・DB 書き込み・通知) が起きない
- [ ] `Runner.runAsync()` を使っていない (`runEphemeral` のみ)
- [ ] `DatabaseSessionService` を採用していない (`InMemorySessionService` のみ)
- [ ] ADK SDK internal / private API に依存していない

### 7.2 テスト DoD

- [ ] `runnerSmoke.test.ts` がある (最低 5 cases)
- [ ] `minimalSequentialAgent.test.ts` がある (最低 4 cases)
- [ ] `pdcaLoopAdkWrapper.test.ts` がある (最低 6 cases)
- [ ] 既存 Step 1 adapter / equivalence tests (71 cases) が全 pass
- [ ] 既存 Step 2 tracing tests (59 cases) が全 pass
- [ ] 既存 PDCALoop / agentMemory / Side-B tests が未改変で全 pass
- [ ] `npm run build` green
- [ ] 関連 test command green

### 7.3 設計 DoD

- [ ] 既存 `/src/side-b/skills/` を改変していない
- [ ] 既存 `/src/side-b/agent/` を改変していない (`pdcaLoop.ts` / `agentMemory.ts` 含む)
- [ ] 既存 loop に ADK Runner を接続していない (Phase 4 判断のみ)
- [ ] `DatabaseSessionService` を採用していない
- [ ] Prisma schema を変更していない
- [ ] UI を追加していない
- [ ] Step 4 (または Step 6) に回す事項が明記されている

### 7.4 ドキュメント DoD

- [ ] `STEP_3_RUNNER_SMOKE_REPORT.md` がある
- [ ] `STEP_3_SEQUENTIAL_AGENT_REPORT.md` がある
- [ ] `STEP_3_PDCALOOP_WRAP_DESIGN.md` がある
- [ ] `STEP_3_INTEGRATION_DECISION.md` がある
- [ ] `STEP_3_SUMMARY.md` がある
- [ ] `ADK_ADOPTION.md` が更新されている
- [ ] `agents/README.md` が更新されている
- [ ] PR description にテスト結果と未解決事項がある

---

## 8. 禁止事項

本 Step では以下を禁止する。

- 既存 `pdcaLoop.ts` の内部改変 (合成ラップのみ可)
- 既存 `agentMemory.ts` / `agentLoop.ts` の内部改変
- 既存 `Skill` / `SkillRegistry` / `SkillContext` の API 変更
- 既存 `AgentLoop` / `PDCALoop` / `EvolutionLoop` への ADK Runner 接続
- SideBScheduler への ADK 接続
- 本番 Express server への ADK 接続
- ADK `DatabaseSessionService` 導入
- ADK `LoopAgent` / `ParallelAgent` の本番統合 (Step 4 / Step 5 で扱う)
- MikroORM 導入
- Prisma schema 変更
- raw payload (LLM prompt / response 全文 / DB row / API key) を trace / log に保存
- `any` / `unknown` の本番コード使用
- `@ts-ignore` / `@ts-nocheck`
- ADK SDK private / internal API 依存
- 実 LLM 呼び出しを smoke の DoD 条件に含めること (LLM smoke は別 PR で議論)
- 新規 LLM プロンプトの追加 (PromptRegistry 不可侵)
- spike script を最終成果物として残すこと
- unrelated refactor
- ESLint / tsconfig audit の既存違反の大規模修正を本 Step に混ぜること

---

## 9. オープン課題 (Phase 着手前に Nekoさん確認)

本 KICKOFF 起案時点で確定していない判断。Phase 着手前にレビューで確定したい。

### 9.1 LLM 呼び出しなしで Runner smoke を完了できる構成

ADK の `LlmAgent` は `model` 引数が必須に見えるが、実機 smoke では実 LLM を呼ばずに完了させたい (§5.2)。具体的に取れる選択肢:

| 案 | 内容 | 確認すべき点 |
|---|------|-------------|
| A | `model` に stub / mock を渡す | ADK 側で `model` の型が許容するか (Step 3 Phase 1 で実測) |
| B | 既存 `AIProvider` の dummy 実装を `model` 経路に挟む | OpenRouter を経由しない構成が可能か |
| C | LLM が tool call を返さない経路だけで完結させる | newMessage を「tool call が必要ない短い入力」にして smoke 終了 |
| D | 実 LLM を呼ぶ (低 cost なモデル) | コスト / 非決定性 / Step 3 内に閉じない問題 |

**現時点の推奨**: 案 C → 案 A の順で試す。Phase 1 着手前に Nekoさん確認したい。

### 9.2 PDCALoop の sub-agent 分解粒度

Phase 3 で PDCALoop をラップする際の sub-agent 数:

| 案 | sub-agent 数 | 粒度 | 評価 |
|---|------|------|------|
| A | 1 | PDCALoop 全体を 1 sub-agent でラップ (span は粗い) | ✅ 安全、観測価値は低い |
| B | N (state 数 = 7) | state ごとに sub-agent | ❌ private state handler への access が必要、不可侵領域改変 |
| C | M (公開 API レベル = `start` / `tick` / `stop` ぐらい) | 公開 API レベルで分割 | ✅ 不可侵領域に触れずに span を細かくできる |

**現時点の推奨**: 案 C。Phase 2 完了後に Phase 3 着手前で再確認。

### 9.3 既存ループ接続を Step 3 内で**判断のみ**にする妥当性

KICKOFF 起案時点では「本 Step では接続しない」前提で書いたが、Phase 1〜3 が順調に進めば「Step 3 内で read-only 接続まで実装する」拡張案もあり得る。

**現時点の推奨**: KICKOFF 通り Phase 4 は判断ドキュメントのみ。実機接続は Step 4 以降。

### 9.4 既存 SideBScheduler との関係

`SideBScheduler` は本書の §6 / §7 で言及していないが、PDCALoop は SideBScheduler の起動経路の一部に組み込まれている可能性がある (要確認)。dry-run wrapper を試す際、SideBScheduler を**起動しないこと**を Phase 1 から徹底する。

**現時点の推奨**: Phase 1 着手時に SideBScheduler の起動条件 (env 変数 / config フラグ) を確認し、smoke script では起動しないことを明示する。

---

## 10. 推奨 PR 分割

### PR (Phase 1): Runner / LlmAgent 実機 Smoke

目的:

- Runner / LlmAgent 構成の実機検証
- `STEP_3_RUNNER_SMOKE_REPORT.md` 作成

含めるもの:

- `runnerSmoke.ts` + test
- spike script + smoke report

最終的に削除するもの:

- spike script (Phase 5 で削除)

### PR (Phase 2): 最小 SequentialAgent 検証

目的:

- SequentialAgent の挙動実機確認
- Phase 3 用 sub-agent 構成方針確定

含めるもの:

- `minimalSequentialAgent.ts` + test
- spike script + smoke report

### PR (Phase 3): PDCALoop SequentialAgent Dry-Run Wrapper

目的:

- 既存 PDCALoop を**合成によりラップ**する dry-run wrapper 構築
- pdcaLoop.ts 無改変で span 観測可能化

含めるもの:

- `pdcaLoopAdkWrapper.ts` + test
- `agents/README.md`
- `STEP_3_PDCALOOP_WRAP_DESIGN.md`

### PR (Phase 4): 既存ループ接続可否判断

目的:

- Phase 1〜3 結果に基づく Step 4 / 5 / 6 進路判断

含めるもの:

- `STEP_3_INTEGRATION_DECISION.md` のみ

### PR (Phase 5): Documentation / Summary / Cleanup

目的:

- Step 3 サマリー
- ADK_ADOPTION.md 更新
- spike 削除

含めるもの:

- `STEP_3_SUMMARY.md`
- `ADK_ADOPTION.md` 更新
- `agents/README.md` 最終形
- spike script 削除

PR 番号は実際の進行に合わせて変更してよい。ただし、**Phase 単位で差分を小さく保つ** こと。

---

## 11. 実装時のレビュー観点

Copilot / Claude Code 自己レビュー時は、以下を必ず確認する。

### 11.1 不可侵領域の遵守

- `pdcaLoop.ts` の git diff がゼロか
- `agentMemory.ts` の git diff がゼロか
- `agentLoop.ts` の git diff がゼロか
- `/src/side-b/skills/` の git diff がゼロか
- 既存 `/src/side-b/agent/` から `/src/side-b/adk/` への import が増えていないか

### 11.2 副作用なし (dry-run)

- wrapper 実行時に取引判断 / DB 書き込み / 通知が起きないか
- 本番 SideBScheduler / Express server に dry-run wrapper が組み込まれていないか
- `agentMemory.setState()` 等の状態変更を起こしていないか (read-only)

### 11.3 観測性

- Runner / SequentialAgent / PDCALoop wrapper の各実行が `traceSink` に記録されるか
- 記録される event に raw payload が含まれていないか (redaction)
- error ケースでも `started` が `completed` / `failed` で閉じるか

### 11.4 型安全

- 本番コードに `any` がないか
- 本番コードに `unknown` がないか
- 型ガードが過剰に緩くないか
- `as` による雑な型逃げがないか

### 11.5 ADK 依存

- public API だけを使っているか
- `_getDeclaration` など underscore prefix method に依存していないか
- private field を読んでいないか
- SDK 更新で壊れやすい前提を書いていないか

### 11.6 テスト

- Step 1 / Step 2 テスト (130 cases) が全 pass
- 既存 Side-B テストが未改変で全 pass
- 新規テストが trace あり / なし両方を確認しているか
- error / throw ケースを確認しているか

---

## 12. Step 4 (または Step 6) への引き継ぎ事項

Step 3 完了後の進路候補:

### 12.1 Step 4 (ParallelAgent for Lens 並列実行) へ進む場合

- Step 3 で確立した Runner / SequentialAgent / TraceSink 構成を流用
- Lens (`/src/side-b/lenses/`) は不可侵領域 (純粋関数特性を維持)
- `ParallelAgent` で各 Lens を並列実行し、各 Lens の実行を個別 span として観測する dry-run wrapper を構築

### 12.2 Step 5 (LoopAgent for 進化ループ) へ進む場合 (条件付き)

- Step 3 で確立した構成を流用
- Evolution 探索アルゴリズム (`/src/side-b/evolution/`) は不可侵領域 (決定論性を維持)
- 撤退基準への該当有無を毎 Phase で確認

### 12.3 Step 6 (撤退判断) へ進む場合

- Step 3 の実機検証で ADK_ADOPTION.md §5 撤退基準のいずれかに該当した場合
- `git rm -rf src/side-b/adk/` で完全撤退可能な状態を Step 3 でも維持していること

---

## 13. 最終メッセージ

Step 3 は「ADK を本番に組み込む」工程ではなく、**ADK を既存ループに被せて、観測しながら手触りを確認する**工程である。

ここを飛ばして本番統合に進むと、既存 PDCALoop が壊れた時に「ADK が原因か / 既存実装が原因か」の切り分けが付かなくなる。本 Step では、既存ループの心臓には触れず、外から血圧計を当てる範囲に留める (Step 2 の延長線)。

dry-run wrapper は実行されても何も壊さない。だが、span は取れる。それがあれば、Step 4 / Step 5 / Step 6 の判断は実測で行える。実測の前に判断しない、というのが本 Step の核である。
