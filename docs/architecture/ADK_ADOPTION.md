# ADK_ADOPTION.md - Google ADK 段階導入の計画と実装状況

> **目的**: Google ADK (Agent Development Kit) を TradeAssist プロジェクト (主に Side-B) に段階導入する際の、採用範囲・撤退基準・不可侵領域・実装状況を**単一のドキュメント**で管理する。
> **対象**: 全エージェント・全作業者
> **位置づけ**: ルート `/AGENTS.md`、`/src/side-b/AGENTS.md`、`/src/side-b/adk/AGENTS.md` から参照される正本

---

## 1. 目的と背景

### 1.1 目的

Side-B 自律トレーディング AI における **エージェントオーケストレーション層** に ADK を導入し、以下を実現する:

- **Tracing**: エージェント呼び出し階層と LLM 呼び出しの可視化
- **構造化されたエージェント合成**: Sequential / Parallel / Loop による複雑なフローの宣言的記述
- **FunctionTool 統合**: 既存スキルを ADK ツールとして再利用可能にする

### 1.2 背景

Side-B には既に独自実装の `PDCALoop` `AgentLoop` `SkillRegistry` `PromptRegistry` 等の中核実装が存在する。これらは**進化的探索**を前提とした特殊な設計 (プロンプトの外部ファイル化、レンズの決定性、エッジ台帳の厳格な昇格判定等) を持っており、ADK の標準パターンに置き換えると失われる価値がある。

そのため、**ADK は既存実装を置き換えるのではなく、既存実装をラップしオーケストレーションとトレースを上乗せする「サイドカー」として導入する**。

---

## 2. 採用範囲

### 2.1 採用する

| 機能 | 用途 | 配置 |
|------|------|------|
| **Runner** | エージェント実行のエントリポイント | `src/side-b/adk/agents/` |
| **SequentialAgent** | Plan → Do → Check → Act の順次実行を宣言的に表現 | `src/side-b/adk/agents/` |
| **ParallelAgent** | 複数レンズの並列実行 (副作用なし・依存なしの特性に合致) | `src/side-b/adk/agents/` |
| **LoopAgent** | 進化ループの一部 (撤退基準が満たされない条件下) | `src/side-b/adk/agents/` |
| **FunctionTool** | 既存スキル (`src/side-b/skills/`) のラップ | `src/side-b/adk/adapters/` |
| **Tracing** | OpenTelemetry 経由のスパン / イベント収集 | `src/side-b/adk/tracing/` |

### 2.2 採用しない

以下は **ADK の機能を採用せず、既存実装を維持する**:

| 領域 | 既存実装 | 採用しない理由 |
|------|----------|---------------|
| **PromptRegistry** | `src/side-b/prompts/*.md` + 読み込み機構 | 進化的探索でプロンプト自体を変異対象にする。ADK の `instruction` フィールドにハードコードしてしまうと変異できない |
| **strategy_dsl** | `src/side-b/strategy_dsl/` | 独自 DSL。ADK の Agent モデルとは独立 |
| **EdgeLedger 昇格判定** | `src/side-b/ledger/` | PF / WF 等の決定論的判定。LLM やエージェントに任せない |
| **Lens 群** | `src/side-b/lenses/` | 副作用なし・依存なし・決定性ありの純粋関数。ADK Agent ではなく単純な関数のまま保つ |
| **Evolution 探索アルゴリズム** | `src/side-b/evolution/` | 進化的探索の決定論性を保つため、ADK Agent でラップしない |
| **SkillRegistry の API** | `src/side-b/skills/` | スキル登録の既存 API を保つ。ADK FunctionTool は**アダプター経由**で利用 |
| **AgentLoop / PDCALoop の内部** | `src/side-b/agent/pdcaLoop.ts` | 中核ループ、内部書き換え禁止。ADK では Custom Agent で**合成 (composition) によりラップ**するのみ |
| **AIProvider** | AI 呼び出しラッパー | OpenRouter 経由の reasoning_effort 等を保つため、ADK Model 抽象に置き換えない |
| **ADK `DatabaseSessionService` 系** (永続化・セッション) | 既存 `src/side-b/agent/agentMemory.ts` (Prisma 経由)、必要に応じ Prisma ベース自作 | `@google/adk@1.1.0` の peer dependency が MikroORM を要求しているため。**プロジェクト全体で ORM は Prisma 単独** (Nekoさん判断 2026-05-12)。MikroORM を入れると ORM 二重管理になりエージェントが迷う |

### 2.3 peer dependency 対応方針 (2026-05-12 確定)

`@google/adk@1.1.0` の `peerDependencies` は `@mikro-orm/{mariadb,mssql,mysql,postgresql,sqlite}: ^6.6.6` のいずれかを要求するが、本プロジェクトでは **MikroORM を導入しない**。対応:

- **インストール方法**: `npm install @google/adk --legacy-peer-deps` (`@google/adk` 導入時は peer dependencies を解決対象から外してインストールする)
  - **`.npmrc` の扱い**: チーム共有設定としての `legacy-peer-deps=true` 追記は **任意（推奨）**。未追記でも、上記インストールコマンドを明示的に用いる方針で整合する
- **コード上の制約**:
  - ✅ OK: `Runner`, `SequentialAgent`, `ParallelAgent`, `LoopAgent`, `FunctionTool`, `Tracing` の利用
  - ❌ 禁止: `DatabaseSessionService` および ADK 内部の永続化 API の呼び出し
- **セッション / 状態管理の代替**:
  - 既存 `src/side-b/agent/agentMemory.ts` (Prisma ベース) を継続活用
  - 新規でセッション層が必要になった場合、**Prisma ベースで自作** (急がない、Step 後半で必要に応じて対応)

---

## 3. 段階導入ロードマップ

| Step | 内容 | 期間目安 | 状態 |
|------|------|---------|------|
| **Step 0** | 設計ガード (L1/L2/L3 多層防御の整備、ADK 採用範囲の明文化) | 約 8 時間 (3 セッション) | ✅ 完了 (2026-05-12) |
| **Step 1** | Skill → ADK FunctionTool アダプター | 数日 | ✅ 完了 (2026-05-13) |
| **Step 2** | Tracing / Telemetry 統合 (内部 TraceSink interface、OTel exporter は Step 3 以降の判断) | 数日 | ✅ 完了 (2026-05-13) |
| **Step 3** | Runner Smoke + PDCALoop の SequentialAgent dry-run ラップ (既存内部は不可侵) | 数日 | ✅ 完了 (2026-05-14) |
| **Step 4** | Lens 並列実行の ParallelAgent ラップ (前提: Phase 7 完了で Lens 8 本へ拡張済み、詳細: [`../design/phase_7_summary.md`](../design/phase_7_summary.md)) | 数日 | ✅ 完了 (2026-05-14) |
| **Step 5** | 進化ループの LoopAgent ラップ (条件付き) | 1〜2 週 | ⬜ 未着手 |
| **Step 6** | 評価: ADK 継続採用 / 撤退 / 部分採用の判断 | 1 週 | ⬜ 未着手 |

各 Step の詳細仕様は別途 `docs/architecture/STEP_N_*.md` で管理する。

---

## 4. 各 Step の DoD と検証指標

| Step | DoD | 検証指標 |
|------|-----|----------|
| Step 0 | ガードレール (AGENTS.md 群、ADK_ADOPTION.md、ESLint/tsc strict、CI ゲート) が整備されている | ① Gate 1〜3 全て承認、② B1/B2 違反レポート提出、③ C2 dry-run 成功 |
| Step 1 | 既存スキルを変更せずに `adapters/SkillToFunctionToolAdapter` 経由で ADK Runner から呼び出せる | スキル単体テストが ADK 経由で全て通過 |
| Step 2 | adapter 層に自前 `TraceSink` interface が組み込まれ、`skillRegistryToAdkTools()` 経由の Skill 実行が trace event として記録できる (raw payload は保存しない方針)。Step 3 以降で OTel exporter / Jaeger / Cloud Trace に流す土台が確保されている | adapter テストで成功・失敗・throw の trace が記録されることを `InMemoryTraceSink` で検証 |
| Step 3 | ① Runner / LlmAgent の最小 smoke が `runEphemeral` + `InMemorySessionService` で動く、② SequentialAgent の sub-agent 単位を `adk.subagent.*` trace event として観測できる、③ 既存 PDCALoop を**合成によりラップ**した dry-run wrapper が public API のみで観測可能。pdcaLoop.ts / agentMemory.ts / agentLoop.ts の **git diff ゼロ** | adk 領域テスト 177 cases 全 pass (Step 1: 71 + Step 2: 59 + Step 3: 47) + `STEP_3_INTEGRATION_DECISION.md` 作成 + 既存 SideBScheduler / Express server 接続なし |
| Step 4 | Lens 群が ParallelAgent で並列実行され、各レンズが独立スパンとして観測できる。レンズの決定性が崩れていない | 既存決定性テスト全 pass + 並列実行で同入力同出力 |
| Step 5 | 進化ループの一部 (撤退基準が満たされない範囲) が LoopAgent でラップされる | エッジ昇格率 (PF/WF) が ADK 採用前後で 10% 以内の差 |
| Step 6 | ADK の継続採用 / 撤退 / 部分採用の判断ドキュメントが作成されている | ユーザー承認 |

---

## 5. 撤退基準

以下の**いずれか1つ**が満たされた時点で、ADK 採用を全面撤退する。撤退手順は `/src/side-b/adk/AGENTS.md` §撤退手順を参照。

| # | 基準 | 検証方法 |
|---|------|---------|
| 1 | **OpenRouter 経由で `reasoning_effort` が正しく伝達されない事案発生** | LLM 呼び出しログで `reasoning_effort` パラメータが欠落・誤値になっている事案を1件でも観測 |
| 2 | **PromptRegistry スコアリングが ADK 経由で 10% 以上劣化** | ADK 採用前後で同一仮説に対するスコアを比較し、平均スコアが 10% 以上低下 |
| 3 | **ADK TypeScript SDK が 6ヶ月間メジャー更新されない** | `@google/adk` の最新リリース日が現在から 6ヶ月以上前 |
| 4 | **Google が ADK を deprecated 宣言** | 公式ドキュメント / リリースノートで deprecated / EOL の宣言 |
| 5 | **ユーザー判断で継続不適切と判断** | ユーザー (Neko さん) の明示的判断。理由は問わない |

撤退時の保証: 既存 `/src/side-b/` 直下の実装は ADK に依存しない (依存方向の制約 — `/src/side-b/adk/AGENTS.md` 参照) ため、`git rm -rf src/side-b/adk/` と `npm uninstall @google/adk` のみで完全撤退できる。

---

## 6. 不可侵領域

以下は ADK 段階導入中、**既存実装を改変してはならない**領域 (`/src/side-b/AGENTS.md` §不可侵領域 と同一):

| 領域 | 該当ディレクトリ / ファイル | 改変禁止の理由 |
|------|---------------------------|----------------|
| **PromptRegistry** | `src/side-b/prompts/` 周辺 | 進化的探索でプロンプト自体を変異対象にするため、外部 `.md` ファイル化と読み込み機構を保つ |
| **SkillRegistry API** | `src/side-b/skills/` | スキル登録 API は既存。ADK 統合はアダプター経由 |
| **AgentLoop / PDCALoop 内部** | `src/side-b/agent/pdcaLoop.ts` | 中核ループ。ADK は**合成によるラップ**のみ可、内部書き換え禁止 |
| **AIProvider 内部** | AI 呼び出しラッパー | OpenRouter 経由の `reasoning_effort` 等の透過を保つ |
| **strategy_dsl** | `src/side-b/strategy_dsl/` | 戦略 DSL の仕様独立性 |
| **EdgeLedger 昇格判定** | `src/side-b/ledger/` | PF > 1.5, WF < 0.3 等の決定論的判定 |
| **Lens 群** | `src/side-b/lenses/` | 副作用なし・依存なし・決定性ありの純粋関数特性 |
| **Evolution 探索アルゴリズム** | `src/side-b/evolution/` | 進化的探索の決定論性 |

これらの改変が必要になった場合、ADK 段階導入とは独立した PR / 設計議論を立ち上げ、ユーザー承認を得ること。

---

## 7. 実装状況

> **最終更新**: 2026-05-17 (ORCH WBS Phase 0〜10 完了、Step 4 までは 2026-05-14 時点)

### Step 進捗

- [x] Step 0: 設計ガード (完了 2026-05-12)
- [x] Step 1: Skill → ADK FunctionTool アダプター (完了 2026-05-13)
- [x] Step 2: Tracing / Telemetry 統合 (完了 2026-05-13)
- [x] Step 3: Runner Smoke + PDCALoop SequentialAgent dry-run ラップ (完了 2026-05-14)
- [x] Step 4: Lens 並列実行の ParallelAgent ラップ (完了 2026-05-14)
- [x] **ORCH (ADK Orchestrator + RunLedger + StrategyDraft WBS): Phase 0〜10 完了 (2026-05-17)** ← Step 5 と独立した実行ハブ分離 PR シーケンス
- [ ] Step 5: 進化ループの LoopAgent ラップ (条件付き)
- [ ] Step 6: ADK 継続採用 / 撤退 / 部分採用の判断

### ORCH WBS 完了 (2026-05-17)

`SideBScheduler` の実行ハブ責務を **ADK Orchestrator Wrapper** (外側の順序制御) /
**RunLedgerService** (run/step の永続台帳) / **StrategyDraftService** (Evolution 候補の
Draft lifecycle) に分離した。詳細は [`adk_run_ledger_summary.md`](./adk_run_ledger_summary.md)
を参照。Phase 0〜10 を PR #216〜#225 + Phase 10 docs PR で完結。

- WBS: [`adk_run_ledger_strategy_draft_完全版wbs.md`](./adk_run_ledger_strategy_draft_完全版wbs.md)
- Phase 0 棚卸し: [`adk_run_ledger_phase_0_棚卸し.md`](./adk_run_ledger_phase_0_棚卸し.md)
- 完了サマリー: [`adk_run_ledger_summary.md`](./adk_run_ledger_summary.md)

撤退時の削除対象: `src/side-b/adk/` + **`src/side-b/tests/adk/`** + Bridge (`sideBSchedulerOrchestratorBridge.ts` + 関連 test) + Scheduler の `runOrchestratedCycleNow` メソッド + Bridge import + `package.json`/`package-lock.json` から `@google/adk`。
詳細な実行手順 (5 ステップ + 検証 + 完了記録) は [`adk_run_ledger_summary.md`](./adk_run_ledger_summary.md) §6.1 を参照。既存 Job / PDCALoop / Lens / Evolution / EdgeLedger は本 WBS で改変していないため、上記削除のみで完全撤退できる。

### 完了した Step の詳細

#### Step 0: 設計ガード (完了 2026-05-12)

**実装場所**:
- ルート設計書群: `/AGENTS.md` (正本), `/CLAUDE.md` `/.cursorrules` `/GEMINI.md` (シム), `/src/side-b/AGENTS.md`, `/src/side-b/adk/AGENTS.md`
- ADK サイドカー scaffold: `/src/side-b/adk/{adapters,tracing,agents}/`
- ADK 採用計画: 本書 `docs/architecture/ADK_ADOPTION.md`
- Step 0 監査ドキュメント群: `docs/architecture/STEP_0_*.md`

**検証結果**:
- **Phase A (Gate 1 approved)**: PR #155 マージ済み (2026-05-12)
  - Ticket A1: 既存設計書棚卸し (`STEP_0_ANALYSIS.md`)、Q1〜Q7 ユーザー承認
  - Ticket A2: ルート `/AGENTS.md` 正本版作成
  - Ticket A3: `/CLAUDE.md` / `/.cursorrules` / `/GEMINI.md` シム化
  - Ticket A4: `/src/side-b/AGENTS.md` 作成
  - Ticket A5: `/src/side-b/adk/` サイドカー scaffold
  - Ticket A6: 本書作成
- **Phase B (Gate 2 approved)**: PR #156 マージ済み (2026-05-12)
  - Ticket B1: tsconfig.audit.json (root + frontend) 分離方式採用。audit 値 = 1044 + 379 = 1423 errors (`STEP_0_TSCONFIG_AUDIT.md`)、本番 tsconfig は 0 errors 維持
  - Ticket B2: ESLint 5 規則 warn→error 格上げ、`ban-ts-comment` 追加 (tests/scripts も有効)。`STEP_0_ESLINT_AUDIT.md` (488 errors 残存、別 PR で順次解消)。**unknown 禁止方針** を案B (規約強化) として確定し AGENTS.md 群に反映
  - Ticket B3: CI 状況報告 (`STEP_0_CI_STATUS.md`)。ESLint は root に lint script 不在で未実行、main は保護未設定 → ユーザー対応依頼
- **Phase C (PR #157 submitted, pending approval)**: 本 PR
  - Ticket C1: simple-git-hooks + lint-staged が既存導入されており機能等価のため husky 置き換えは不要。Mac/Windows 動作確認手順を `STEP_0_HUSKY_SETUP.md` にドキュメント化
  - Ticket C2: `@google/adk@1.1.0` dry-run 成功 (`STEP_0_ADK_INSTALL_DRYRUN.md`)。**重要発見**: peer dependency が MikroORM ファミリーを要求 (Prisma 採用の本プロジェクトと不一致)。Step 1 着手前にユーザー判断必須

**ユーザー対応依頼 (Step 0 完了後も継続)**:
1. main ブランチ保護ルール設定 (`STEP_0_CI_STATUS.md` §3.1)
2. ESLint PR ゲート化と既存違反 488 件の段階解消 (`STEP_0_CI_STATUS.md` §3.2, `STEP_0_ESLINT_AUDIT.md` §4)
3. Frontend tsc を CI に追加する判断 (`STEP_0_CI_STATUS.md` §3.3)
4. tsconfig audit 違反 1423 件の side-b 優先解消 (`STEP_0_TSCONFIG_AUDIT.md` §5.1)
5. ~~**@google/adk peer dep 対応方針 (案A/B/C のいずれか)** を Step 1 着手前に判断~~ → **✅ 確定済み (2026-05-12)**: 案A (`--legacy-peer-deps`) 採用 + `DatabaseSessionService` 系不採用 + Prisma セッション自作。詳細は §2.2 / §2.3 を参照

**3 セッション通算**:
- 全コミット数: Phase A 8 + Phase B 6 + Phase C 3 = **17 コミット** (本 PR マージ前時点では Phase C 3 コミット + Gate 3 修正分)
- 監査レポート: `STEP_0_ANALYSIS`, `STEP_0_TSCONFIG_AUDIT`, `STEP_0_ESLINT_AUDIT`, `STEP_0_CI_STATUS`, `STEP_0_HUSKY_SETUP`, `STEP_0_ADK_INSTALL_DRYRUN` の **6 件**
- 計測結果: tsconfig audit 1423 errors / ESLint 488 errors + 237 warnings / `@google/adk` peer deps 要 MikroORM

#### Step 1: Skill → ADK FunctionTool アダプター (完了 2026-05-13)

**実装場所**:
- ADK サイドカー実装: `/src/side-b/adk/adapters/`
  - `jsonSchemaToZod.ts` — SkillInputSchema (JSONSchema draft-07 subset) → Zod 変換
  - `skillContext.ts` — ADK `Context` → 既存 `SkillContext` マッピング (`ADK_DEFAULT_CALLER_REASON` / `ADK_DEFAULT_CALLER_AGENT` 定数)
  - `skillRegistryToAdkTools.ts` — `SkillRegistry` → ADK `FunctionTool[]` factory
  - `_testHelpers.ts` — テスト専用 `createMinimalAdkContext` (本番不使用)
  - `README.md` — アダプター設計書 (Nekoさん T2 / T2.5 承認、§3 §4 §6 §8 確定)
- ADK サイドカー テスト: `/src/side-b/tests/adk/`
  - `jsonSchemaToZod.test.ts` (47 cases) / `skillContext.test.ts` (8 cases) / `skillRegistryToAdkTools.test.ts` (9 cases) / `equivalence.test.ts` (7 cases) — **計 71/71 PASS**

**採用方式**:
- **方式 B (Zod)** — `parameters` 変換は `SkillInputSchema → Zod`。理由: ADK の `parameters` 型が `z3/z4 ZodObject | Schema | undefined` を受け、ADK 内部で `parse(req.args)` の自動 validation が効く。型安全性とデバッグ性が最も高い (T2.5 実測スパイク参照)
- **Context 経路**: `runAsync()` (public method) のみ使用。`execute` / `_getDeclaration` 等 private API には依存しない (Nekoさん T2.5 承認)
- **エラー伝播**: アダプター内では throw に変換せず、`SkillResult` を **そのまま return** (既存 `registry.invoke()` の挙動を完全保持、等価性検証 T7 で確認)

**検証結果**:
- **Phase 1 (PR #164 マージ済み 2026-05-13)**:
  - Ticket T1: `@google/adk@1.1.0` インストール (`--legacy-peer-deps` + `.npmrc`)
  - Ticket T2: アダプター設計書 (Nekoさん T2 approved with note: callerReason フォールバック / public API 限定テスト)
  - Ticket T2.5: ADK FunctionTool API 実測スパイク (方式 B 確定、Nekoさん T2.5 approved with note: z.any() 禁止、自前実装、throw with skill+field path)
  - Ticket T3: `jsonSchemaToZod` ユーティリティ (47 ケース PASS、実 Skill 全 8 件 inputSchema 変換確認)
  - Ticket T4: Phase 1 PR 提出 → Copilot レビュー 7 件 → 全件対応 → マージ
- **Phase 2 (PR #165 マージ済み 2026-05-13)**:
  - Ticket T5: SkillContext mapper (8 cases PASS)
  - Ticket T6: skillRegistryToAdkTools 本体 (9 cases PASS、KICKOFF §T6 6 パターン網羅)
  - Ticket T7: 等価性検証 (モック Skill 4 件、7 cases PASS、deep equal)
  - Ticket T8: スパイク + smoke test 削除
  - Ticket T9: 本ドキュメント + AGENTS.md + STEP_1_SUMMARY.md 更新

**数値スナップショット (Step 1 完了時)**:
- 新規実装: 4 ファイル (adapters 配下) + 4 ファイル (tests/adk 配下)
- 既存実装の変更: **ゼロ** (`/src/side-b/skills/`, `/src/side-b/agent/`, etc.)
- テストケース: 71/71 PASS、any/unknown 違反ゼロ (型ガード 1 箇所のみ ESLint コメントで例外宣言)
- 本番コードからの ADK SDK 内部 API (`@internal` / underscore prefix / private field) 依存: **ゼロ**

#### Step 2: Tracing / Telemetry 統合 (完了 2026-05-13)

**実装場所**:
- ADK tracing サイドカー: `/src/side-b/adk/tracing/`
  - `traceTypes.ts` — `AdkTraceEvent` / `AdkTraceEventKind` / `AdkTraceStatus` / `TracePayloadSummary`
  - `traceSink.ts` — `TraceSink` interface
  - `noopTraceSink.ts` — production default (no-op)
  - `inMemoryTraceSink.ts` — tests / local 用 (配列保持)
  - `traceSummaries.ts` — `payloadToSummary` / `shortenErrorMessage` + 上限定数 (`TOP_LEVEL_KEYS_LIMIT=20` / `KEY_NAME_LIMIT=64` / `DEFAULT_ERROR_MESSAGE_MAX=512`)
  - `index.ts` — 公開 API barrel + 使用例 JSDoc
- ADK adapter (Phase 3 で変更): `/src/side-b/adk/adapters/skillRegistryToAdkTools.ts` に optional `{ traceSink }` を追加 (既存 signature 維持)
- ADK tracing テスト: `/src/side-b/tests/adk/tracing/`
  - `traceTypes.test.ts` (10) / `traceSummaries.test.ts` (23) / `sinks.test.ts` (9) / `adapterTracing.test.ts` (17) — **計 59 cases PASS**
- 設計書群:
  - `docs/architecture/STEP_2_ADK_TRACING_SPIKE.md` (Phase 1 実測結果)
  - `docs/architecture/STEP_2_ADK_RUNNER_SMOKE_NOTES.md` (Phase 4 Runner smoke 構成ノート)
  - `docs/architecture/STEP_2_SUMMARY.md` (本 Step 完了サマリー)

**採用方式**:
- **trace を取る位置**: adapter `execute` 内 (BasePlugin callbacks には依存しない、Runner 経由 / 直接呼び出しの両方で同じ trace が取れる)
- **raw payload 保存禁止**: `TracePayloadSummary` で field 数 + 上位キー名のみ。LLM prompt / response 全文 / DB row / API key 等は一切保存しない
- **出力先抽象化**: 自前 `TraceSink` interface に依存 (ADK 内部 `telemetry/tracing.ts` には直接依存しない、OTel SDK 追加導入なし)
- **既存挙動の保持**: `traceSink` 未指定時は Step 1 と完全同挙動 (Step 1 等価性テスト 7 cases を未改変で全 pass)
- **status 体系**: `'ok'` (Skill 成功) / `'error'` (SkillResult.ok=false) / `'thrown'` (Skill 内部 throw)
- **Zod validation error trace の意図的非記録**: ADK が `execute` 呼び出し前に throw するため未記録。adapter 側で `runAsync` wrap すると LLM 用 schema 公開が崩れる、Step 3 Runner 統合時に再検討 (詳細: `STEP_2_SUMMARY.md` §3.6)
- **traceSink 失敗の握りつぶし**: `traceSink.record()` が throw / reject しても Skill 実行は絶対に壊さない (try/catch で握りつぶす)

**検証結果**:
- **Phase 1 (PR #166 マージ済み 2026-05-13)**:
  - ADK TypeScript SDK の `Context` getter / `FunctionTool.runAsync` / `BasePlugin` callbacks / `Runner` API / `telemetry/tracing.ts` を実測
  - 実測結果に基づき Phase 2 / Phase 3 の採用方針を確定 (`STEP_2_ADK_TRACING_SPIKE.md` §3)
- **Phase 2 (PR #168 マージ済み 2026-05-13)**:
  - trace 型 / sink interface / Noop / InMemory / summaries の各 unit 実装と test 計 42 cases (型 10 / summaries 23 / sinks 9)
- **Phase 3 (PR #170 マージ済み 2026-05-13)**:
  - `skillRegistryToAdkTools()` に optional `{ traceSink }` 統合
  - adapter 経由の成功 / SkillResult error / unexpected throw / sink 失敗握りつぶし / 既存挙動維持を 17 cases で網羅
- **Phase 4 + 5 (本 PR)**:
  - `STEP_2_ADK_RUNNER_SMOKE_NOTES.md` 作成 (Step 3 Runner smoke 用最小構成: `InMemorySessionService` + `Runner.runEphemeral()` + 既存 `traceSink` 維持)
  - `STEP_2_SUMMARY.md` 作成 (本書 §7 / §8 / 上記 §3 §4 のソース)
  - 本書 (`ADK_ADOPTION.md`) §3 / §4 / §7 / §8 を Step 2 完了状態に更新
  - `scripts/adk_tracing_spike.ts` 削除 (Phase 1 用一時 script、KICKOFF §6 Phase 5 で削除予定と明記)

**Step 3 への引き継ぎ事項**:
1. `InMemorySessionService` + `Runner.runEphemeral()` で session-less smoke を実機実行 (`Runner.runAsync()` は使わない、sessionId 必須のため)
2. Runner 経由でも `traceSink` に event が記録されることを実機確認
3. `LlmAgent.tools` への `FunctionTool[]` 受理を実機確認 (型レベルは Phase 1 で確認済み)
4. Zod validation error trace の捕捉経路 (Runner event stream 側) を再検討
5. OTel exporter 統合は別タスク (`OtelTraceSink` を `TraceSink` の実装として追加するだけで済む構造を Step 2 で確保済み)

**数値スナップショット (Step 2 完了時)**:
- 新規実装: 6 ファイル (tracing 配下) + 4 ファイル (tests/adk/tracing 配下) + 2 ドキュメント (RUNNER_SMOKE_NOTES / SUMMARY)
- 変更ファイル: `adapters/skillRegistryToAdkTools.ts` / `adapters/README.md` / 本書 = 3
- 削除ファイル: `scripts/adk_tracing_spike.ts` = 1
- 既存実装 (`/src/side-b/skills/`, `/src/side-b/agent/`, `prisma/schema.prisma`) の変更: **ゼロ**
- テストケース (Step 2 増分): 59/59 PASS、Step 1 既存 71 cases も全 PASS → **adk 領域累計 130 cases**
- 本番コードの any / unknown 違反: **ゼロ**
- 本番コードからの ADK SDK 内部 API 依存: **ゼロ** (`Context` / `FunctionTool` / `BaseTool` の public API のみ)

#### Step 3: Runner Smoke + PDCALoop SequentialAgent Dry-Run Wrapper (完了 2026-05-14)

**実装場所**:
- ADK agents サイドカー: `/src/side-b/adk/agents/`
  - `runnerSmoke.ts` — Runner / LlmAgent / InMemorySessionService の最小 factory (Phase 1)
  - `sequentialSmoke.ts` — SequentialAgent + `SmokeSubAgent` (BaseAgent 直接 subclass、LLM 非依存) + `extractSubAgentOrder` (Phase 2)
  - `pdcaDryRunWrapper.ts` — `PdcaObservationSubAgent` + 4 観測アクション + `createDryRunPdcaLoop` (Phase 3)
  - `README.md` — agents 領域設計書 (Phase 3 初版、Phase 5 で最終形)
- trace 契約拡張: `/src/side-b/adk/tracing/traceTypes.ts`
  - `AdkTraceEventKind` に `adk.subagent.*` を **additive 追加** (Phase 2)
  - `AdkTraceEvent.skillName` を「step 識別子」として汎用化 (Skill 名 / sub-agent 名の両用途、`kind` で discriminant)
  - Step 1/2 既存テスト 130 cases に影響ゼロ
- ADK agents テスト: `/src/side-b/tests/adk/agents/`
  - `runnerSmoke.test.ts` (11) / `sequentialSmoke.test.ts` (18) / `pdcaDryRunWrapper.test.ts` (18) — **計 47 cases PASS**
- 設計書群: `STEP_3_RUNNER_SMOKE_NOTES.md` / `STEP_3_SEQUENTIAL_AGENT_NOTES.md` / `STEP_3_PDCA_DRYRUN_NOTES.md` / `STEP_3_INTEGRATION_DECISION.md` / `STEP_3_SUMMARY.md`

**採用方式**:
- **Runner / Session**: `Runner.runEphemeral` + `InMemorySessionService` のみ採用、`runAsync` (sessionId 必須) と `DatabaseSessionService` は不採用継続
- **LLM 呼び出し回避**: Phase 1 では `BaseLlm` 継承 stub、Phase 2/3 では `BaseAgent` 直接 subclass で smoke を完了 (実 LLM 呼び出しゼロ)
- **trace 契約拡張**: additive で `adk.subagent.*` event kind 追加。`skillName` フィールドを step 識別子として両系統で再利用、新規フィールド追加なし
- **PDCALoop ラップ方針**: 合成ラップのみ、`enabled: false` で構築した PDCALoop を public API (`start` / `stop` / `getStatus` / `getThinkingLog`) 経由で観測。private method / private field / `as any` / `as unknown as` 完全ゼロ (TS コンパイラで防御)
- **副作用ゼロ実証**: dry-run wrapper 実行前後で `agentMemory.getState()` / `pdcaLoop.getStatus()` の不変性を test で実機検証
- **既存実装の不可侵性**: Phase 1〜3 全 PR で `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma` の git diff 常にゼロ

**検証結果**:
- **Phase 1 (PR #177 マージ済み 2026-05-13)**: Runner / LlmAgent 最小 smoke、`BaseLlm` 継承 stub model 採用、Runner 経由でも adapter 内 traceSink がそのまま発火することを実機確認
- **Phase 2 (PR #179 マージ済み 2026-05-13)**: SequentialAgent + toy `SmokeSubAgent` の 18 cases、sub-agent 順序保証 / error 伝播 / orphan started なし / trace 契約 additive 拡張を実機確認
- **Phase 3 (PR #181 マージ済み 2026-05-14)**: `PdcaObservationSubAgent` 18 cases、PDCALoop 公開 API 4 アクションすべての副作用ゼロ + agentMemory state 不変を実機検証
- **Phase 4 (本 PR)**: `STEP_3_INTEGRATION_DECISION.md` 作成。KICKOFF §5.13 の 7 軸 (安定性 / 観測性 / 侵襲性 / 撤退性 / 型安全 / session 整合 / コスト) すべて採用寄り、撤退基準 5 項目すべて非該当 → **Step 4 (Lens ParallelAgent dry-run) を推奨**
- **Phase 5 (本 PR)**: `STEP_3_SUMMARY.md` 作成、本書 §3 / §4 / §7 / §8 を Step 3 完了状態に更新、agents/README.md 最終形

**Step 4 への引き継ぎ事項**:
1. Lens 群が ADK_ADOPTION.md §6 不可侵領域 (純粋関数特性) を維持しているか Step 4 Phase 1 spike で確認
2. ADK `ParallelAgent` の並列実行モデルが Lens の純粋関数前提と整合するか実機検証
3. Step 3 で確立した 3 つの建材 (`runnerSmoke.ts` / `sequentialSmoke.ts` / `pdcaDryRunWrapper.ts`) を流用
4. trace 契約は本 Step Phase 2 拡張版をそのまま使う (`adk.subagent.*` を ParallelAgent でも再利用)
5. Step 4 spike で問題が見つかれば Step 6 (撤退判断) へ切り替え可能な体制を維持

**数値スナップショット (Step 3 完了時)**:
- 新規ファイル: 3 (agents 配下) + 3 (tests/adk/agents 配下) + 5 (Step 3 docs) + 1 (agents/README.md) = **12**
- 変更ファイル: `tracing/traceTypes.ts` (Phase 2) / 本書 (Phase 5) = **2**
- 削除ファイル: なし
- 既存実装 (`/src/side-b/skills/`, `/src/side-b/agent/`, `prisma/schema.prisma`) の変更: **ゼロ**
- テストケース (Step 3 増分): 47/47 PASS、Step 1 既存 71 cases + Step 2 既存 59 cases も全 PASS → **adk 領域累計 177 cases**
- 本番コードの any / unknown / `as any` / `as unknown as` 違反: **ゼロ**
- 本番コードからの ADK SDK 内部 API 依存: **ゼロ** (`Runner` / `LlmAgent` / `SequentialAgent` / `BaseAgent` / `BaseLlm` / `InMemorySessionService` / `FunctionTool` / `createEvent` / `Context` / `InvocationContext` の public API のみ)
- PDCALoop private アクセス: **ゼロ** (TS コンパイラで防御)

#### Step 4: Lens ParallelAgent Dry-run (完了 2026-05-14)

**実装場所**:
- ADK agents サイドカー: `/src/side-b/adk/agents/`
  - `lensParallelSmoke.ts` — `LensSubAgent` + `createLensSubAgent` + `LensParallelSmokeConfig` / `Artifacts` / `ExecutionResult` + `buildLensParallelSmoke` + `runLensParallelSmoke` + `createDryRunLensParallelAgent`
- ADK agents テスト: `/src/side-b/tests/adk/agents/lensParallelSmoke.test.ts` (49 cases pass)
- 設計書群: `STEP_4_KICKOFF.md` / `STEP_4_LENS_PARALLEL_AGENT_REPORT.md` / `STEP_4_SUMMARY.md`

**採用方式**:
- **Lens sub-agent**: `BaseAgent` 直接 subclass、Step 3 `SmokeSubAgent` と同パターン。`lens.compute(input)` の呼び出し境界を ADK で薄くラップするだけで、新たな相場判断を持たない (KICKOFF §4.1)
- **failure isolation**: ADK `ParallelAgent.runAsyncImpl` は内部で `Promise.race` (`mergeAgentRuns`) を使うため 1 sub-agent throw で全体が止まる。`LensSubAgent.isolateFailure: true` で例外を握りつぶし、`getError()` に保存。`runLensParallelSmoke` 側が後から `successes` / `failures` を集約する形で「1 Lens 失敗が他 Lens を巻き込まない」を実現 (KICKOFF Phase 3 DoD)
- **trace event 契約**: Step 3 の `adk.subagent.{started,completed,failed}` をそのまま再利用 (新規 kind ゼロ)、`skillName` を Lens 名として再利用、`callerReason = 'lens_parallel_dry_run'` の固定値で Step 4 系統を識別
- **raw payload 非保存**: `resultSummary.fieldCount` (= features 数) と `redacted: true` マーカーのみ。features の中身 / Lens dependencies / OHLCV / API key は trace に乗せない (KICKOFF §4.3)
- **決定性検証**: `stripVolatile(feature)` ヘルパーで `computedAt` / `computeDurationMs` を除外して features を比較し、**ADK 経由実行と Lens 直接実行で features が完全一致** することを実 Lens (`TimeSessionLens`) 含む 3 ケースで実機確認 (Phase 4)
- **既存実装の不可侵性**: Phase 0-6 全 PR で `src/side-b/lenses/` / `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma` の git diff 常にゼロ

**検証結果**:
- **PR #194 (Phase 0+1+2、マージ済み 2026-05-14)**: 棚卸し + 静的確認 + 単体 Lens sub-agent wrapper。Copilot レビュー 4 件対応済 (throw 正規化 / コメント整合 / KICKOFF テスト配置表記)
- **PR #196 (Phase 3、マージ済み 2026-05-14)**: ParallelAgent dry-run wrapper、failure isolation 実装。Copilot レビュー 1 件対応済 (`runAsyncImpl` 冒頭で result/error reset)
- **PR 3 (Phase 4+5+6、本 PR)**: 決定性 / failure isolation 実機再検証 + side-b 全体 regression (1678/1682 PASS、128 suites) + `STEP_4_SUMMARY.md` / 本書 §3 / §7 / §8 / `agents/README.md` 更新
- **撤退基準 9 項目すべて非該当** (`STEP_4_SUMMARY.md` §4)

**Step 5 への引き継ぎ事項**:
1. `LensSubAgent` (isolateFailure 含む) を LoopAgent 配下 sub-agent としても再利用可能 — `Promise.race` 経路を吸収する設計が継続採用される
2. `buildLensParallelSmoke` / `runLensParallelSmoke` を LoopAgent の評価フェーズに組み込む選択肢あり
3. Step 4 で確立した `adk.subagent.*` trace event kind と `skillName` 再利用パターンを LoopAgent でも使う (additive 拡張なし)
4. Step 5 着手前に「LoopAgent が進化的探索の決定論性を壊さないか」spike が必要 (Step 6 撤退判断と直結)
5. Step 4 で確認した制約: 同名 Lens 拒否 / 失敗時 result/error 状態混入リセット (`runAsyncImpl` 冒頭)

**数値スナップショット (Step 4 完了時)**:
- 新規ファイル: 3 (agents/lensParallelSmoke.ts + tests/adk/agents/lensParallelSmoke.test.ts + STEP_4_LENS_PARALLEL_AGENT_REPORT.md) + 2 (STEP_4_KICKOFF + STEP_4_SUMMARY) + agents/README.md 追記 = **5 ファイル touch (純粋新規) + 2 ファイル更新 (ADK_ADOPTION 本書 + agents/README.md)**
- 既存実装 (`/src/side-b/lenses/` / `/src/side-b/agent/` / `/src/side-b/skills/` / `prisma/schema.prisma`) の変更: **ゼロ**
- テストケース (Step 4 増分): 49/49 PASS、Step 1-3 既存 177 cases も全 PASS → **adk 領域累計 226 cases**
- side-b 全体 regression: 128 suites、**1678/1682 PASS** (4 skipped、failure ゼロ)
- 本番コードの any / unknown / `as any` / `as unknown as` 違反: **ゼロ**
- 本番コードからの ADK SDK 内部 API 依存: **ゼロ** (`ParallelAgent` / `BaseAgent` / `Runner` / `InMemorySessionService` / `createEvent` / `InvocationContext` / `Event` の public API のみ)
- Copilot レビュー累計指摘: 5 件 (PR #194: 4 / PR #196: 1)、全件対応済

---

## 8. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [/AGENTS.md](../../AGENTS.md) | 全エージェント共通ルール (正本) |
| [/src/side-b/AGENTS.md](../../src/side-b/AGENTS.md) | side-b 固有ルール |
| [/src/side-b/adk/AGENTS.md](../../src/side-b/adk/AGENTS.md) | ADK サイドカー領域固有ルール |
| [docs/design/STEP_0_KICKOFF.md](../design/STEP_0_KICKOFF.md) ※ 本 PR 時点では untracked、後続 PR で commit 予定 | Step 0 のキックオフドキュメント (作業手順書) |
| [docs/architecture/STEP_0_ANALYSIS.md](./STEP_0_ANALYSIS.md) | 既存設計書の棚卸し結果 (Ticket A1 成果物) |
| [docs/architecture/STEP_1_SUMMARY.md](./STEP_1_SUMMARY.md) | Step 1 完了サマリー (adapter 設計の前提) |
| [docs/architecture/STEP_2_KICKOFF.md](./STEP_2_KICKOFF.md) | Step 2 作業指示書 (Nekoさん作成) |
| [docs/architecture/STEP_2_ADK_TRACING_SPIKE.md](./STEP_2_ADK_TRACING_SPIKE.md) | Step 2 Phase 1 実測結果 (採用方針の根拠) |
| [docs/architecture/STEP_2_ADK_RUNNER_SMOKE_NOTES.md](./STEP_2_ADK_RUNNER_SMOKE_NOTES.md) | Step 2 Phase 4 成果物 (Step 3 Runner smoke 着手用構成) |
| [docs/architecture/STEP_2_SUMMARY.md](./STEP_2_SUMMARY.md) | Step 2 完了サマリー (本 §7 Step 2 詳細の出典) |
| [docs/architecture/STEP_3_KICKOFF.md](./STEP_3_KICKOFF.md) | Step 3 作業指示書 (Nekoさん作成) |
| [docs/architecture/STEP_3_RUNNER_SMOKE_NOTES.md](./STEP_3_RUNNER_SMOKE_NOTES.md) | Step 3 Phase 1 実測結果 (Runner / LlmAgent 実機 smoke) |
| [docs/architecture/STEP_3_SEQUENTIAL_AGENT_NOTES.md](./STEP_3_SEQUENTIAL_AGENT_NOTES.md) | Step 3 Phase 2 実測結果 (SequentialAgent + trace 契約拡張) |
| [docs/architecture/STEP_3_PDCA_DRYRUN_NOTES.md](./STEP_3_PDCA_DRYRUN_NOTES.md) | Step 3 Phase 3 実測結果 (PDCALoop dry-run wrapper) |
| [docs/architecture/STEP_3_INTEGRATION_DECISION.md](./STEP_3_INTEGRATION_DECISION.md) | Step 3 Phase 4 進路判断 (Step 4 推奨、撤退基準非該当) |
| [docs/architecture/STEP_3_SUMMARY.md](./STEP_3_SUMMARY.md) | Step 3 完了サマリー (本 §7 Step 3 詳細の出典) |
| [docs/architecture/STEP_4_KICKOFF.md](./STEP_4_KICKOFF.md) | Step 4 作業指示書 (Nekoさん作成) |
| [docs/architecture/STEP_4_LENS_PARALLEL_AGENT_REPORT.md](./STEP_4_LENS_PARALLEL_AGENT_REPORT.md) | Step 4 Phase 0-6 結果の集約 report |
| [docs/architecture/STEP_4_SUMMARY.md](./STEP_4_SUMMARY.md) | Step 4 完了サマリー (本 §7 Step 4 詳細の出典) |
| [/src/side-b/adk/agents/README.md](../../src/side-b/adk/agents/README.md) | agents 領域設計書 (Step 3-4 で構築した建材の使用例) |
| [docs/design/DESIGN_DOC_autonomous_trading_architecture.md](../design/DESIGN_DOC_autonomous_trading_architecture.md) | Side-B 自律 AI 設計の正本 |
