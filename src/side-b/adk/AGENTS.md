> ## 最優先 5 原則 (全エージェント / 全ディレクトリ共通)
> 1. **勝手に決めない**: 設計判断はユーザーに必ず確認する
> 2. **`any` 型も `unknown` 型も書かない** (テスト・スクリプトのみ例外。外部入力は Zod で即具体型に narrow する)
> 3. **指定範囲を超えない**: 「ついで」「ちなみに」の追加実装は禁止
> 4. **既存APIを壊さない**: 後方互換必須。破壊的変更はユーザー承認が必要
> 5. **このファイルを読んだ後、ルート `/AGENTS.md` も必ず読む**

---

# AGENTS.md (adk) - ADK サイドカー領域固有ルール

> **位置づけ**: 本ファイルは `/src/side-b/adk/` 配下での作業に適用される**特化ルール**。
> **正本**: ルート `/AGENTS.md`、`/src/side-b/AGENTS.md`、`docs/architecture/ADK_ADOPTION.md`

---

## このディレクトリの位置づけ

`/src/side-b/adk/` は **ADK (Google Agent Development Kit) サイドカー**領域である。既存実装 (`/src/side-b/` 直下) を残したまま、ADK ベースの新実装を試す場所として段階導入を進める。

**設計思想**:
- 既存実装と ADK 実装が**並走**できる構造を取る
- 既存実装は**改変しない**。ADK で問題が出れば全て削除して撤退できる
- ADK で得られた知見が固まれば段階的に既存実装を置き換える (Step 6 以降)

---

## 必読資料

このディレクトリで作業する前に以下を順番に読む:

1. ルート `/AGENTS.md` — 全エージェント共通ルール
2. `/src/side-b/AGENTS.md` — side-b 固有ルール
3. **`docs/architecture/ADK_ADOPTION.md`** — ADK 採用範囲・撤退基準・段階導入ロードマップ
4. 該当 Step の設計書 (`docs/architecture/STEP_N_*.md`)

---

## このディレクトリでの作業ルール

### 依存方向の制約

- ✅ **`adk/` → 既存 `side-b/`**: OK (既存をラップする)
- ❌ **既存 `side-b/` → `adk/`**: 禁止 (既存実装が ADK に依存してはならない)
- 将来 `dependency-cruiser` で機械検証する

理由: ADK 撤退時、`adk/` を `git rm -rf` するだけで完全撤退できる状態を保つため。

### 既存実装の改変禁止

以下の API・内部実装を ADK 経由で変更してはならない (詳細は `docs/architecture/ADK_ADOPTION.md` §6 不可侵領域を参照):

- **SkillRegistry API** (`src/side-b/skills/`)
- **AgentLoop / PDCALoop 内部** (`src/side-b/agent/pdcaLoop.ts`)
- **AIProvider 内部** (OpenRouter 経由の reasoning_effort 等)
- **PromptRegistry** (`src/side-b/prompts/` 周辺)

**実装方針**:
- 既存実装を **Custom Agent パターンでラップする** (継承や直接呼び出しではなく、合成 (composition) でラップ)
- ADK の `instruction` フィールドにプロンプトをハードコードしない (PromptRegistry / 外部 `.md` ファイル経由で取得)

### 各ファイルの JSDoc 規約

`adk/` 配下の新規ファイルには、ファイル冒頭の JSDoc コメントで以下を明記:

- **対応する既存実装** (例: `src/side-b/agent/pdcaLoop.ts` をラップ)
- **ADK 化の目的** (Tracing 取得 / Sequential 制御 / etc.)
- **依存方向の遵守** (既存からこのファイルへの import を作らないこと)

例:
```ts
/**
 * pdcaLoop の ADK ラッパー。
 *
 * 対応する既存実装: src/side-b/agent/pdcaLoop.ts
 * ADK 化の目的: SequentialAgent による Plan/Do/Check/Act 各フェーズのトレース取得
 * 依存方向: 既存 → 本ファイルへの import 禁止 (撤退時に切り離せるようにするため)
 */
```

### サブディレクトリの目的

| サブディレクトリ | 用途 | 配置例 |
|------------------|------|--------|
| `adapters/` | 既存実装を ADK インターフェイスに適合させるアダプター | `SkillToFunctionToolAdapter.ts`、`PromptToInstructionAdapter.ts` |
| `tracing/` | ADK の Tracing / Telemetry 統合 | `OtelExporter.ts`、`SpanCollector.ts` |
| `agents/` | ADK ベースの Custom Agent / Sequential / Parallel / Loop Agent 実装 | `AdkPdcaAgent.ts`、`AdkHypothesisAgent.ts` |

各サブディレクトリは現時点では空 (`.gitkeep` のみ)。実装は Step 1 以降で行う。

---

## 撤退手順

ADK 採用を撤退する場合の手順:

```bash
# 1. このディレクトリを完全削除
git rm -rf src/side-b/adk/

# 2. 既存 side-b/ から adk/ への参照がないことを確認
#    (依存方向の制約により無いはずだが念のため)
grep -rn "side-b/adk" src/side-b/ --exclude-dir=adk

# 3. package.json から @google/adk を削除
npm uninstall @google/adk

# 4. docs/architecture/ADK_ADOPTION.md §7 実装状況に「撤退」を記録

# 5. 完了
```

撤退基準 (定量的) は `docs/architecture/ADK_ADOPTION.md` §5 を参照。

---

## 作業着手前宣言

`/src/side-b/adk/` 配下で作業を始める前に、以下を宣言する:

1. **最優先5原則を確認しました**
2. **`/src/side-b/adk/AGENTS.md` (本ファイル) を読了しました**
3. **`/src/side-b/AGENTS.md` を読了しました**
4. **ルート `/AGENTS.md` を確認しました**
5. **`docs/architecture/ADK_ADOPTION.md` の採用範囲・不可侵領域を確認しました**

---

> **最終更新**: 2026-05-12 (Ticket A5 で新規作成、ADK 段階導入の Step 0 として scaffold)
