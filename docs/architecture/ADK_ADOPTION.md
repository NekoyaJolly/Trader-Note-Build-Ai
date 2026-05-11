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

> **最終更新**: 2026-05-12

### Step 進捗

- [ ] Step 0: 設計ガード (進行中、本書および AGENTS.md 群を整備中)
- [ ] Step 1: Skill → ADK FunctionTool アダプター
- [ ] Step 2: Tracing / Telemetry 統合
- [ ] Step 3: PDCALoop の SequentialAgent ラップ
- [ ] Step 4: Lens 並列実行の ParallelAgent ラップ
- [ ] Step 5: 進化ループの LoopAgent ラップ (条件付き)
- [ ] Step 6: ADK 継続採用 / 撤退 / 部分採用の判断

### Step 0 詳細 (進行中)

- **着手日**: 2026-05-12
- **完了予定**: Phase A〜C の Gate を順次通過、Final Gate 承認時に完了
- **進捗**:
  - Phase A (Session 1, 設計書層): 進行中
    - [x] Ticket A1: 既存設計書の棚卸し (`docs/architecture/STEP_0_ANALYSIS.md` 完了、ユーザー承認済み)
    - [x] Ticket A2: ルート `/AGENTS.md` 正本版作成
    - [x] Ticket A3: `/CLAUDE.md` / `/.cursorrules` / `/GEMINI.md` シム化
    - [x] Ticket A4: `/src/side-b/AGENTS.md` 作成
    - [x] Ticket A5: `/src/side-b/adk/` サイドカー scaffold
    - [x] Ticket A6: `docs/architecture/ADK_ADOPTION.md` 作成 (本書)
    - [ ] Gate 1 承認待ち
  - Phase B (Session 2, CI/CD 層): 未着手
    - [ ] Ticket B1: tsconfig.json strict 化確認
    - [ ] Ticket B2: ESLint 規則強化
    - [ ] Ticket B3: CI PR ゲート確認
    - [ ] Gate 2 承認待ち
  - Phase C (Session 3, IDE 層と環境準備): 未着手
    - [ ] Ticket C1: husky + lint-staged (任意)
    - [ ] Ticket C2: `@google/adk` dry install 確認
    - [ ] Gate 3 承認待ち
    - [ ] Final Gate 承認待ち

### 完了した Step の詳細

(Step 0 完了時に追記される)

---

## 8. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [/AGENTS.md](../../AGENTS.md) | 全エージェント共通ルール (正本) |
| [/src/side-b/AGENTS.md](../../src/side-b/AGENTS.md) | side-b 固有ルール |
| [/src/side-b/adk/AGENTS.md](../../src/side-b/adk/AGENTS.md) | ADK サイドカー領域固有ルール |
| [docs/design/STEP_0_KICKOFF.md](../design/STEP_0_KICKOFF.md) | Step 0 のキックオフドキュメント (作業手順書) |
| [docs/architecture/STEP_0_ANALYSIS.md](./STEP_0_ANALYSIS.md) | 既存設計書の棚卸し結果 (Ticket A1 成果物) |
| [docs/design/DESIGN_DOC_autonomous_trading_architecture.md](../design/DESIGN_DOC_autonomous_trading_architecture.md) | Side-B 自律 AI 設計の正本 |
