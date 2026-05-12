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
| **Step 0** | 設計ガード (L1/L2/L3 多層防御の整備、ADK 採用範囲の明文化) | 約 8 時間 (3 セッション) | 🟡 進行中 |
| **Step 1** | Skill → ADK FunctionTool アダプター | 数日 | ⬜ 未着手 |
| **Step 2** | Tracing / Telemetry 統合 (OpenTelemetry エクスポーター) | 数日 | ⬜ 未着手 |
| **Step 3** | PDCALoop の SequentialAgent ラップ (既存内部は不可侵) | 数日 | ⬜ 未着手 |
| **Step 4** | Lens 並列実行の ParallelAgent ラップ | 数日 | ⬜ 未着手 |
| **Step 5** | 進化ループの LoopAgent ラップ (条件付き) | 1〜2 週 | ⬜ 未着手 |
| **Step 6** | 評価: ADK 継続採用 / 撤退 / 部分採用の判断 | 1 週 | ⬜ 未着手 |

各 Step の詳細仕様は別途 `docs/architecture/STEP_N_*.md` で管理する。

---

## 4. 各 Step の DoD と検証指標

| Step | DoD | 検証指標 |
|------|-----|----------|
| Step 0 | ガードレール (AGENTS.md 群、ADK_ADOPTION.md、ESLint/tsc strict、CI ゲート) が整備されている | ① Gate 1〜3 全て承認、② B1/B2 違反レポート提出、③ C2 dry-run 成功 |
| Step 1 | 既存スキルを変更せずに `adapters/SkillToFunctionToolAdapter` 経由で ADK Runner から呼び出せる | スキル単体テストが ADK 経由で全て通過 |
| Step 2 | OTel Exporter が SpanCollector からデータを受け取り、Jaeger / Tempo 等で可視化できる | 1 PDCA サイクルの全スパンがツリー表示される |
| Step 3 | PDCALoop が SequentialAgent でラップされ、Plan/Do/Check/Act の各フェーズが個別スパンとして観測できる。既存 `pdcaLoop.ts` の内部は変更されていない | 既存テスト全 pass + 新規 Sequential ラップテスト pass |
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

> **最終更新**: 2026-05-12 (Step 0 全 Phase 完了、Final Gate 提出)

### Step 進捗

- [x] Step 0: 設計ガード (完了 2026-05-12)
- [ ] Step 1: Skill → ADK FunctionTool アダプター
- [ ] Step 2: Tracing / Telemetry 統合
- [ ] Step 3: PDCALoop の SequentialAgent ラップ
- [ ] Step 4: Lens 並列実行の ParallelAgent ラップ
- [ ] Step 5: 進化ループの LoopAgent ラップ (条件付き)
- [ ] Step 6: ADK 継続採用 / 撤退 / 部分採用の判断

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

---

## 8. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [/AGENTS.md](../../AGENTS.md) | 全エージェント共通ルール (正本) |
| [/src/side-b/AGENTS.md](../../src/side-b/AGENTS.md) | side-b 固有ルール |
| [/src/side-b/adk/AGENTS.md](../../src/side-b/adk/AGENTS.md) | ADK サイドカー領域固有ルール |
| [docs/design/STEP_0_KICKOFF.md](../design/STEP_0_KICKOFF.md) ※ 本 PR 時点では untracked、後続 PR で commit 予定 | Step 0 のキックオフドキュメント (作業手順書) |
| [docs/architecture/STEP_0_ANALYSIS.md](./STEP_0_ANALYSIS.md) | 既存設計書の棚卸し結果 (Ticket A1 成果物) |
| [docs/design/DESIGN_DOC_autonomous_trading_architecture.md](../design/DESIGN_DOC_autonomous_trading_architecture.md) | Side-B 自律 AI 設計の正本 |
