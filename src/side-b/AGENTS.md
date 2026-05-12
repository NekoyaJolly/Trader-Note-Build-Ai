> ## 最優先 5 原則 (全エージェント / 全ディレクトリ共通)
> 1. **勝手に決めない**: 設計判断はユーザーに必ず確認する
> 2. **`any` 型も `unknown` 型も書かない** (テスト・スクリプトのみ例外。外部入力は Zod で即具体型に narrow する)
> 3. **指定範囲を超えない**: 「ついで」「ちなみに」の追加実装は禁止
> 4. **既存APIを壊さない**: 後方互換必須。破壊的変更はユーザー承認が必要
> 5. **このファイルを読んだ後、ルート `/AGENTS.md` も必ず読む**

---

# AGENTS.md (side-b) - Side-B 自律トレーディング AI 固有ルール

> **位置づけ**: 本ファイルは `/src/side-b/` 配下での作業に適用される**特化ルール**である。汎用ルールは ルート `/AGENTS.md` (正本)、ADK 採用範囲・不可侵領域の詳細は `docs/architecture/ADK_ADOPTION.md` を参照。
> **設計の正本**: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` および `docs/design/phase_N_specification.md`

---

## このディレクトリの位置づけ

`/src/side-b/` は Side-B (自律トレーディング AI) の中核実装ディレクトリ。**AI が自律的に市場を観察し、仮説を立て、検証し、エッジ台帳を育てながら運用する**システムへの段階的進化を目指す (詳細はルート `/AGENTS.md` ドメイン原則を参照)。

不明点があれば必ず `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` に戻る。

---

## ファイル配置の規則

> **由来**: 旧 `/CLAUDE.md` の「実装の基本作法 > ファイル配置の規則」を文言保持で移植 (Ticket A4)。

- 新規レンズ: `src/side-b/lenses/{lens_name}Lens.ts`
- 新規エージェント: `src/side-b/agents/{agent_name}Agent.ts`
- エージェントのシステムプロンプト: `src/side-b/prompts/{agent_name}.md`
- 戦略 DSL 関連: `src/side-b/strategy_dsl/`
- 進化ループ関連: `src/side-b/evolution/`

### 既存サブディレクトリの目安

| ディレクトリ | 用途 |
|-------------|------|
| `agent/` | 単数形: PDCA ループ、エージェントメモリ等の中核実装 |
| `agents/` | 複数形: 個別エージェント実装 |
| `lenses/` | レンズ群 (副作用なし・依存なし・決定性ありの純粋関数) |
| `prompts/` | エージェントのシステムプロンプト (外部ファイル化必須) |
| `strategy_dsl/` | 戦略 DSL |
| `evolution/` | 進化ループ・進化的探索 |
| `ledger/` | エッジ台帳 |
| `knowledge/` | 知識ベース |
| `orchestrator/` | エージェント間調整 |
| `skills/` | スキル (ADK FunctionTool 対応予定) |
| `models/` | 型定義 (新規型はここに追加) |
| `services/`, `controllers/`, `routes/` | API レイヤー |
| `validation/`, `repositories/`, `bridge/`, `jobs/`, `cli/`, `config/`, `constants/`, `utils/` | 補助実装 |
| `tests/`, `__tests__/` | ユニットテスト・統合テスト |
| `adk/` | **ADK サイドカー** (`adk/AGENTS.md` を別途参照) |

---

## 既存実装との統合ポイント

> **由来**: 旧 `/CLAUDE.md` の「実装の基本作法 > 既存との統合ポイント」を文言保持で移植 (Ticket A4)。

- PDCA ループ (`src/side-b/agent/pdcaLoop.ts`): 新エージェントを統合する場合はここに呼び出しを追加
- AgentMemory (`src/side-b/agent/agentMemory.ts`): EdgeHypothesis 型の保存先はここに統合
- strategyBacktestService: Edge Validator は必ずこれを経由する
- walkForwardService: エッジ検証は必ずこれを経由する

---

## 型定義の原則

> **由来**: 旧 `/CLAUDE.md` の「実装の基本作法 > 型定義の原則」を文言保持で移植。

- 新規型は `src/side-b/models/` に追加
- 既存の型を拡張する場合はオプショナルフィールドとして追加 (必須フィールド追加禁止)
- 型には JSDoc コメントを必ず付ける

---

## テスト

> **由来**: 旧 `/CLAUDE.md` の「実装の基本作法 > テスト」を文言保持で移植。

- 新規ロジックには最低1つのユニットテストを `src/side-b/tests/` または対応ディレクトリ (`__tests__/`) に置く
- レンズには「同じ入力で同じ出力を返す」決定性テストを含める

---

## プロンプトを編集する時の注意

> **由来**: 旧 `/CLAUDE.md` の同セクションを文言保持で移植。

### エージェントのシステムプロンプトは `src/side-b/prompts/*.md` にある

コード内にハードコードしない。将来の進化的探索でプロンプト自体を変異対象にする可能性があるため、常に外部ファイルから読み込む設計にする。

### プロンプト編集時の確認事項

- そのエージェントの役割が設計書と一致しているか
- 「禁止事項」セクションが残っているか (Hypothesis Generator 等)
- 出力形式 (JSON スキーマ) が受け手のエージェントと整合しているか
- 日本語で書かれているか (このプロジェクトの既定言語)

---

## 不可侵領域 (ADK 段階導入中)

ADK (Google Agent Development Kit) の段階導入中、以下の領域は**既存実装をそのまま残し、ADK 経由で改変してはならない**。詳細・撤退基準・採用範囲は `docs/architecture/ADK_ADOPTION.md` §6 を参照。

| 領域 | 該当ディレクトリ / ファイル | 理由 |
|------|---------------------------|------|
| PromptRegistry | `src/side-b/prompts/` 周辺 | 進化的探索でプロンプト自体を変異対象にするため |
| SkillRegistry API | `src/side-b/skills/` | スキル登録 API は ADK 採用しない |
| AgentLoop / PDCALoop 内部 | `src/side-b/agent/pdcaLoop.ts` | 中核ループ、ADK でラップは可だが内部書き換え禁止 |
| AIProvider 内部 | AI 呼び出しラッパー | OpenRouter 経由の reasoning_effort 等を保つ |
| strategy_dsl | `src/side-b/strategy_dsl/` | 戦略 DSL の仕様は独立 |
| EdgeLedger | `src/side-b/ledger/` | エッジ台帳昇格判定 (PF / WF) を保つ |
| Lens 群 | `src/side-b/lenses/` | 副作用なし・依存なし・決定性ありの純粋関数特性 |
| Evolution 探索アルゴリズム | `src/side-b/evolution/` | 進化的探索の決定論性 |

---

## 作業着手前宣言

`/src/side-b/` 配下で作業を始める前に、以下の3点を宣言する:

1. **最優先5原則を確認しました** (本ファイル冒頭 blockquote)
2. **本ファイル (`/src/side-b/AGENTS.md`) を読了しました**
3. **ルート `/AGENTS.md` も確認しました**

ADK 領域 (`/src/side-b/adk/`) に触れる場合は、追加で `/src/side-b/adk/AGENTS.md` および `docs/architecture/ADK_ADOPTION.md` を読み、その旨を宣言する。

---

> **最終更新**: 2026-05-12 (Ticket A4 で新規作成、旧 /CLAUDE.md からの移植を文言保持で実施)
