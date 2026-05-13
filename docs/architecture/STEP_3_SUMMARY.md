# STEP_3_SUMMARY.md — Step 3 (Runner Smoke + PDCALoop SequentialAgent Dry-Run Wrapper) 完了サマリー

> **ステータス**: ✅ 完了 (2026-05-14)
> **期間**: 2026-05-13 〜 2026-05-14 (Phase 1〜5、各 Phase は別 PR)
> **完了 PR**: #177 (Phase 1) / #179 (Phase 2) / #181 (Phase 3) / 本 PR (Phase 4 + 5)
> **次ステップ**: Step 4 (ParallelAgent for Lens dry-run) を推奨 (`STEP_3_INTEGRATION_DECISION.md` §5.1)

---

## 1. Step 3 の目的

Step 1 / Step 2 (PR #164-#173) で adapter (SkillRegistry → ADK FunctionTool) と tracing (TraceSink / AdkTraceEvent) の基盤を整えた。Step 3 では、その基盤の上で:

1. ADK `Runner` / `LlmAgent` を**実機で動かす smoke 検証**を行い、Step 2 で文書化した最小構成 (`InMemorySessionService` + `Runner.runEphemeral()` + `TraceSink`) がそのまま機能することを確認する
2. ADK `SequentialAgent` の挙動を **最小サブ Agent 構成** で実機実証する
3. 既存 `PDCALoop` を **合成によりラップ**する dry-run wrapper を構築し、既存 `pdcaLoop.ts` の内部に**一切触れずに**観測可能な構造を作る
4. 接続判断ドキュメントを作成し、次 Step (Step 4 / Step 5 / Step 6) への進路を確定する。**本 Step では実機接続はしない**

実現したこと:

1. ADK `Runner` / `LlmAgent` の最小 factory (`runnerSmoke.ts`) を構築、`BaseLlm` 継承 stub で LLM 呼び出しゼロで smoke 完了
2. ADK `SequentialAgent` + toy sub-agent (`sequentialSmoke.ts`) で順序実行 / state 共有 / sub-agent 単位 trace を実機検証
3. trace 契約を additive 拡張: `adk.subagent.*` event kind を追加 (Step 1/2 既存契約 130 cases に影響ゼロ)
4. 既存 `PDCALoop` の dry-run wrapper (`pdcaDryRunWrapper.ts`) を構築、4 観測アクション (`noop-start` / `noop-stop` / `snapshot-status` / `snapshot-log`) で公開 API のみを使用
5. `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の git diff **ゼロ**、副作用ゼロ (`agentMemory.getState()` 不変) を実機実測
6. Step 3 後の進路判断ドキュメントを作成 (`STEP_3_INTEGRATION_DECISION.md`)

本 Step は「ADK を本番統合する」工程ではなく、**ADK の実行経路を既存ループの外側に隔離したまま、dry-run と trace で観測可能にする** 工程 (KICKOFF §13 最終メッセージ)。

---

## 2. Phase 構造と完了 PR

| Phase | PR | 主要成果 |
|-------|----|----------|
| **Phase 1** (Runner / LlmAgent smoke) | [#177](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/177) ✅ | `runnerSmoke.ts` (factory + runEphemeralSmoke ヘルパー) + 11 cases + `STEP_3_RUNNER_SMOKE_NOTES.md` |
| **Phase 2** (SequentialAgent smoke) | [#179](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/179) ✅ | `sequentialSmoke.ts` (`SmokeSubAgent` + factory + extractSubAgentOrder) + 18 cases + trace 契約 additive 拡張 (`adk.subagent.*`) + `STEP_3_SEQUENTIAL_AGENT_NOTES.md` |
| **Phase 3** (PDCALoop dry-run wrapper) | [#181](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/181) ✅ | `pdcaDryRunWrapper.ts` (`PdcaObservationSubAgent` + 4 アクション + createDryRunPdcaLoop) + 18 cases + `agents/README.md` 初版 + `STEP_3_PDCA_DRYRUN_NOTES.md` |
| **Phase 4 + 5** (Integration decision / Summary / Cleanup) | 本 PR | `STEP_3_INTEGRATION_DECISION.md` (7 軸評価 + 次 Step 判断) + 本書 + `ADK_ADOPTION.md` 更新 + `agents/README.md` 最終形 |

---

## 3. 確定した主要方針

Step 3 を通じて確定した方針 (Step 4 以降に継続適用):

### 3.1 ADK 実行系統は `/src/side-b/adk/agents/` 配下に閉じる

- factory 関数と sub-agent 派生クラスを `/src/side-b/adk/agents/` に集約
- 既存 `/src/side-b/agent/` (PDCALoop / AgentMemory / AgentLoop) から `adk/` への import は **ゼロ** (Step 1〜3 全 PR で維持)
- 撤退時は `/src/side-b/adk/` を `git rm -rf` するだけで完全撤退できる状態を継続

### 3.2 session-less 維持 (`Runner.runEphemeral` + `InMemorySessionService`)

- `Runner.runAsync` (sessionId 必須経路) は採用しない
- `DatabaseSessionService` は引き続き不採用 (`ADK_ADOPTION.md` §2.2)
- Phase 1/2/3 すべての smoke で sessionless 維持を実機確認

### 3.3 BaseAgent 直接 subclass パターン (LLM 非依存 sub-agent)

- Phase 1 では `BaseLlm` 継承 stub で LLM 呼び出しを回避
- Phase 2 / Phase 3 では `BaseAgent` 直接 subclass で sub-agent 自体を LLM 非依存に
- 本番 LLM 呼び出しは Step 3 範囲外、別 PR で議論

### 3.4 trace 契約の additive 拡張 (Phase 2 で確立)

- `AdkTraceEventKind` に `adk.subagent.started/completed/failed` を追加 (additive、Step 1/2 既存契約破壊なし)
- `skillName` フィールドを **step 識別子** として両系統で再利用 (`kind` を discriminant)
- 新規フィールド追加なし、Step 1/2 既存テスト 130 cases に影響ゼロ
- `callerReason` 固定値でサブシステム識別 (Skill 系 / sequential smoke / pdca dry-run の 3 系統)

### 3.5 TraceSink 失敗の握りつぶし (Step 2 から継承)

- すべての sub-agent / adapter で `safeRecord(sink, event)` パターン採用
- `TraceSink.record()` の throw / Promise reject を握りつぶし、本処理を壊さない
- Phase 2 / Phase 3 の test "record() が同期 throw / Promise reject しても実行は壊れない" で実機確認

### 3.6 errorMessage 短縮 (Step 2 から継承)

- `shortenErrorMessage(rawMessage)` で `DEFAULT_ERROR_MESSAGE_MAX = 500` 文字に短縮
- 巨大な error message が trace event に乗らないことを test で実機検証 (Phase 3 で定数 import 経由検証に強化)

### 3.7 dry-run wrapper の安全性 (Phase 3 で確立)

- `PDCALoop` は **`enabled: false`** で構築 (`createDryRunPdcaLoop()` ファクトリで強制)
- public API (`start` / `stop` / `getStatus` / `getThinkingLog`) のみ使用
- private method / private field / `as any` / `as unknown as` ゼロ (TS コンパイラで防御)
- 副作用ゼロを `agentMemory.getState()` の不変性で実機検証

### 3.8 既存実装への接続は Phase 4 で判断ドキュメント化、Step 4 以降に持ち越し

- `STEP_3_INTEGRATION_DECISION.md` で 7 軸評価 + 進路選択肢を文書化
- 本 Step では既存 SideBScheduler / Express server に **一切接続しない**
- 接続実装は Step 6 (最終評価) 以降に持ち越し

---

## 4. 実装場所

### 4.1 本番コード (`/src/side-b/adk/agents/`)

| ファイル | 役割 | Phase |
|---------|------|-------|
| `runnerSmoke.ts` | `Runner` + `LlmAgent` + `InMemorySessionService` factory | Phase 1 |
| `sequentialSmoke.ts` | `SequentialAgent` + `SmokeSubAgent` + helper | Phase 2 |
| `pdcaDryRunWrapper.ts` | `PdcaObservationSubAgent` + factory + `createDryRunPdcaLoop` | Phase 3 |
| `README.md` | agents 領域設計書 | Phase 3 初版、Phase 5 最終形 |

### 4.2 trace 契約 (`/src/side-b/adk/tracing/`)

| ファイル | 変更内容 | Phase |
|---------|---------|-------|
| `traceTypes.ts` | `AdkTraceEventKind` に `adk.subagent.*` を additive 追加 / `AdkTraceEvent.skillName` を step 識別子として汎用化 | Phase 2 |

その他 `traceTypes.ts` / `traceSink.ts` / `noopTraceSink.ts` / `inMemoryTraceSink.ts` / `traceSummaries.ts` / `index.ts` は Step 2 の実装をそのまま使用 (本 Step では traceTypes.ts のみ追加)。

### 4.3 テスト (`/src/side-b/tests/adk/agents/`)

| ファイル | テスト数 | Phase |
|---------|---------|-------|
| `runnerSmoke.test.ts` | 11 | Phase 1 |
| `sequentialSmoke.test.ts` | 18 | Phase 2 (15 + Copilot 対応で 3 追加) |
| `pdcaDryRunWrapper.test.ts` | 18 | Phase 3 |

**Step 3 増分**: 47 cases、**adk 領域累計**: Step 1 (71) + Step 2 (59) + Step 3 (47) = **177 cases 全 pass**。

### 4.4 ドキュメント (`/docs/architecture/`)

| ファイル | Phase | 内容 |
|---------|-------|------|
| `STEP_3_KICKOFF.md` | (Nekoさん作成) | 作業指示書 (PR #175 → #176 で Nekoさん正本版に差し替え) |
| `STEP_3_RUNNER_SMOKE_NOTES.md` | Phase 1 | Runner / LlmAgent 実機 smoke 実測結果 |
| `STEP_3_SEQUENTIAL_AGENT_NOTES.md` | Phase 2 | SequentialAgent 実測 + trace 契約拡張根拠 |
| `STEP_3_PDCA_DRYRUN_NOTES.md` | Phase 3 | PDCALoop 不可侵性検証 + 副作用ゼロ実測 |
| `STEP_3_INTEGRATION_DECISION.md` | Phase 4 (本 PR) | 7 軸評価 + 進路判断 (Step 4 推奨) |
| `STEP_3_SUMMARY.md` | Phase 5 (本 PR) | 本書 |
| `ADK_ADOPTION.md` | Phase 5 (本 PR) | §3 / §4 / §7 / §8 を Step 3 完了状態に更新 |

### 4.5 削除したファイル

本 Step では削除対象なし。KICKOFF §5.17 step 4 「一時 script があれば削除」は該当なし (Phase 1〜3 で spike script 生成ゼロ、すべて proper module + test として実装したため)。

---

## 5. 検証結果

### 5.1 KICKOFF §7 全体 DoD の対応

**7.1 実装 DoD**

- [x] `runnerSmoke.ts` がある (Phase 1)
- [x] `minimalSequentialAgent.ts` または `sequentialSmoke.ts` がある (Phase 2、`sequentialSmoke.ts` で実装)
- [x] `pdcaLoopAdkWrapper.ts` または `pdcaDryRunWrapper.ts` がある (Phase 3、`pdcaDryRunWrapper.ts` で実装)
- [x] `agents/README.md` がある (Phase 3 初版、本 Phase で最終形)
- [x] 既存 `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の git diff がゼロ
- [x] 本番 SideBScheduler / Express server に dry-run wrapper が組み込まれていない
- [x] dry-run wrapper を実行しても本番副作用 (取引判断・DB 書き込み・通知) が起きない (Phase 3 test 実機検証)
- [x] `Runner.runAsync()` を使っていない (`runEphemeral` のみ)
- [x] `DatabaseSessionService` を採用していない (`InMemorySessionService` のみ)
- [x] ADK SDK internal / private API に依存していない (public API のみ、grep 確認可)

**7.2 テスト DoD**

- [x] `runnerSmoke.test.ts` 11 cases pass
- [x] `sequentialSmoke.test.ts` 18 cases pass
- [x] `pdcaDryRunWrapper.test.ts` 18 cases pass
- [x] 既存 Step 1 adapter / equivalence tests (71 cases) 全 pass
- [x] 既存 Step 2 tracing tests (59 cases) 全 pass
- [x] 既存 PDCALoop / agentMemory / Side-B tests が未改変で全 pass (本 Step で `agent/` / `skills/` 改変ゼロ)
- [x] `npm run build` green
- [x] 関連 test command green

**7.3 設計 DoD**

- [x] 既存 `/src/side-b/skills/` を改変していない (git diff ゼロ)
- [x] 既存 `/src/side-b/agent/` を改変していない (`pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` すべて git diff ゼロ)
- [x] 既存 loop に ADK Runner を接続していない (Phase 4 判断のみ)
- [x] `DatabaseSessionService` を採用していない
- [x] Prisma schema を変更していない
- [x] UI を追加していない
- [x] Step 4 (または Step 6) に回す事項が明記されている (`STEP_3_INTEGRATION_DECISION.md` §7)

**7.4 ドキュメント DoD**

- [x] `STEP_3_RUNNER_SMOKE_NOTES.md` がある
- [x] `STEP_3_SEQUENTIAL_AGENT_NOTES.md` がある (KICKOFF 案では `*_REPORT.md` だったが、Nekoさん正本版で `*_NOTES.md` 命名に統一)
- [x] `STEP_3_PDCA_DRYRUN_NOTES.md` がある
- [x] `STEP_3_INTEGRATION_DECISION.md` がある (本 PR)
- [x] `STEP_3_SUMMARY.md` がある (本書)
- [x] `ADK_ADOPTION.md` が更新されている (本 PR)
- [x] `agents/README.md` が更新されている (Phase 3 初版 + 本 PR 最終形)
- [x] PR description にテスト結果と未解決事項がある

### 5.2 数値スナップショット (Step 3 完了時)

- **新規ファイル**: 3 (本番 agents) + 3 (テスト) + 5 (Step 3 docs) + 1 (agents/README.md) = **12**
- **変更ファイル**: `tracing/traceTypes.ts` (Phase 2 で event kind 追加) / `ADK_ADOPTION.md` (本 Phase で更新) = **2**
- **削除ファイル**: なし
- **既存実装の変更**: `/src/side-b/skills/` / `/src/side-b/agent/` / `prisma/schema.prisma` ともに **ゼロ** (Phase 1〜3 全 PR で git diff 確認)
- **テストケース増分**: 47 (Phase 1: 11 + Phase 2: 18 + Phase 3: 18)
- **adk 領域累計**: Step 1 (71) + Step 2 (59) + Step 3 (47) = **177 cases 全 pass**
- **any / unknown / `as any` / `as unknown as` 違反** (本番コード): **ゼロ**
- **ADK SDK internal / private API 依存**: **ゼロ** (`Runner` / `LlmAgent` / `SequentialAgent` / `BaseAgent` / `BaseLlm` / `InMemorySessionService` / `FunctionTool` / `createEvent` / `Context` / `InvocationContext` の public API のみ)
- **PDCALoop private アクセス**: **ゼロ** (TS コンパイラで防御)

---

## 6. Step 4 への引き継ぎ事項

### 6.1 確定済みの方針 (Step 4 でも継続)

- ADK 実行系統は `/src/side-b/adk/agents/` 配下に閉じる
- session-less (`Runner.runEphemeral` + `InMemorySessionService`)
- BaseAgent / BaseLlm 継承パターン (LLM 非依存 smoke)
- trace 契約 (`AdkTraceEvent` / `TraceSink`) は本 Step Phase 2 拡張版をそのまま使う
- `safeRecord` / `shortenErrorMessage` 等の補助関数は流用
- raw payload 非保存 / private アクセスゼロ / `as` 禁止
- 既存実装 (`/src/side-b/lenses/` 含む) の改変ゼロ厳守
- 本番接続ゼロ (本 Step で Phase 4 として整理)

### 6.2 Step 4 で実機検証する項目 (STEP_3_INTEGRATION_DECISION.md §5.1)

1. Lens 群が ADK_ADOPTION.md §6 不可侵領域 (純粋関数特性) を維持しているか (grep / 静的解析)
2. ADK `ParallelAgent` の並列実行モデルと Lens の純粋関数前提が整合するか
3. 並列実行で各 Lens の trace event が混線せず観測可能か (Phase 2 で確立した `extractSubAgentOrder` 相当のヘルパーが ParallelAgent で機能するか)
4. 各 Lens の input / output 型が ADK `BaseAgent` に乗せやすい形か (動的増減する I/O や副作用がないか)
5. Step 4 着手時の Phase 1 spike で問題が見つかれば、Step 4 中断 → Step 6 撤退判断に切り替え

### 6.3 未解決事項 (Step 4 以降の判断、`STEP_3_INTEGRATION_DECISION.md` §7)

- Zod validation error の Runner event stream 側からの捕捉経路 (Step 4 / Step 5 で再評価)
- `Context.functionCallId` の取得頻度 (実 LLM smoke が必要になった時点)
- OTel exporter 統合 (`OtelTraceSink` 実装追加、Step 6 直前)
- 実 LLM 呼び出し smoke の必要性 (別 PR で議論)
- 同一 ADK Runner で複数 LlmAgent を切り替える場合の trace 集約方針 (Step 4 で ParallelAgent 採用時)

### 6.4 撤退基準への影響

`ADK_ADOPTION.md` §5 撤退基準 5 項目すべてに、Step 3 の成果は**影響を与えていない**:

- ① `reasoning_effort` 透過: Step 3 では LLM 呼び出しを発生させていない (stub 採用)
- ② PromptRegistry スコアリング劣化: Step 3 では PromptRegistry に触れていない
- ③ `@google/adk` 6 ヶ月停滞 / ④ Google deprecated 宣言: 本書時点で非該当
- ⑤ ユーザー判断: 引き続き継続採用

撤退時の保証 (= `git rm -rf src/side-b/adk/` で完全撤退できる) は Step 3 でも維持されている (依存方向: `adk → 既存` のみ)。

---

## 7. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_3_KICKOFF.md`](./STEP_3_KICKOFF.md) | Step 3 作業指示書 (Nekoさん正本版) |
| [`STEP_3_RUNNER_SMOKE_NOTES.md`](./STEP_3_RUNNER_SMOKE_NOTES.md) | Phase 1 実測 |
| [`STEP_3_SEQUENTIAL_AGENT_NOTES.md`](./STEP_3_SEQUENTIAL_AGENT_NOTES.md) | Phase 2 実測 |
| [`STEP_3_PDCA_DRYRUN_NOTES.md`](./STEP_3_PDCA_DRYRUN_NOTES.md) | Phase 3 実測 |
| [`STEP_3_INTEGRATION_DECISION.md`](./STEP_3_INTEGRATION_DECISION.md) | Phase 4 進路判断 |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 採用計画 §3 ロードマップ / §7 実装状況 (本 PR で Step 3 完了反映) |
| [`STEP_1_SUMMARY.md`](./STEP_1_SUMMARY.md) | Step 1 完了サマリー |
| [`STEP_2_SUMMARY.md`](./STEP_2_SUMMARY.md) | Step 2 完了サマリー |
| [`/src/side-b/adk/agents/README.md`](../../src/side-b/adk/agents/README.md) | agents 領域設計書 (Phase 5 最終形) |
| [`/src/side-b/adk/AGENTS.md`](../../src/side-b/adk/AGENTS.md) | ADK サイドカー領域固有ルール |

---

> **Step 3 の総括**: 「ADK を本番に組み込む」工程ではなく、**ADK を既存ループに被せて、観測しながら手触りを確認する**工程は完了。既存 PDCALoop の心臓には触れず、外側から血圧計を当てる範囲で 177 cases を pass。次の Step 4 では、本 Step で確立した 3 つの建材 (`runnerSmoke.ts` / `sequentialSmoke.ts` / `pdcaDryRunWrapper.ts`) を流用しつつ、Lens 群を `ParallelAgent` で観測する dry-run wrapper を Step 3 と同じ厳格性で構築する。
