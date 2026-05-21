---
name: codebase-review-html
description: Trader-Note-Build-Ai のコードベース全体を網羅的にレビューし、進捗状況・現状分析・改善提案を 1 つの HTML レポートにまとめる skill。「コードベースレビュー」「全体像」「進捗可視化」「現状把握」「改善 TODO」「全体レビュー」「俯瞰」「リスク洗い出し」等のキーワードで起動する。Whenever ユーザーがプロジェクトの俯瞰・進捗確認・全体リスク・改善提案を求めるときは必ずこの skill を使う。出力先は `docs/diagnostics/codebase_review_YYYY-MM-DD.html` 固定で、self-contained HTML (外部依存なし) を生成する。
---

# Codebase Review HTML Skill

長期間作業した後にコードベース全体を俯瞰し直すための skill。手動で都度集計するより、本 skill で 1 コマンドで snapshot HTML を生成する。

## いつ使うか

- ユーザーが「全体像」「現状」「進捗」「リスク」「改善案」「俯瞰」「TODO リスト」を求めた時
- 開発フェーズの節目で「今どこにいるか」を可視化したい時
- 長期作業の後に snapshot として残したい時
- 過去レポート (`docs/diagnostics/codebase_review_*.html` または `trader_note_build_ai_comprehensive_review_*.html`) の更新版が必要な時

## 出力

- 1 つの HTML ファイル: `docs/diagnostics/codebase_review_YYYY-MM-DD.html`
- self-contained (= 外部 CSS / JS 依存なし、Chrome 等で開いてそのまま閲覧可能)
- セクション構成は `template.html` 準拠 (10 section)

## 実行手順

### Step 1: プロジェクト状態を集める

並列で以下を取得:

```bash
# 直近コミット (= 進捗の前提)
git log --oneline -20

# 直近マージ済 PR (= 完了タスク)
gh pr list --state merged --limit 10 --json number,title,mergedAt

# 未解決 PR (= 進行中)
gh pr list --state open --json number,title,headRefName

# 既知の判断キュー / Issue
gh issue list --state open --limit 10 --json number,title
```

加えて、memory の `project_orchestration_roadmap.md` 等の進捗系メモリがあれば読む。

### Step 2: コードベース計測

並列で:

```bash
# TS/TSX ファイル数
find src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path '*/node_modules/*' | wc -l

# テストファイル数
find src -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) | wc -l

# Python ファイル数
find analysis-engine -type f -name '*.py' | wc -l

# Prisma model 数
grep -c '^model ' prisma/schema.prisma

# 主要ディレクトリ別ファイル数 (= 規模感の比較)
for d in src/backend src/frontend src/side-b src/services analysis-engine; do
  printf '%s: ' "$d"
  find "$d" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.py' \) 2>/dev/null | wc -l
done
```

### Step 3: 領域別レビュー

`checklist.md` を読み、以下の領域それぞれで「現状分析 → 改善提案」を作成:

1. **Frontend** (`src/frontend/`)
2. **Backend Node** (`src/backend/`, `src/app.ts`, `src/routes/`, `src/middleware/`)
3. **Backend Python** (`analysis-engine/`)
4. **Database** (`prisma/schema.prisma`)
5. **AI Agent / Side-B** (`src/side-b/`)
6. **Testing** (`src/**/tests/`, `*.test.ts`)
7. **CI / DevOps** (`.github/workflows/`, `scripts/ci/`)

各領域は **読み込み中心 (Read-only)**。コードの書き換えはしない。

### Step 4: リスク洗い出し

既知の問題を以下から集める:
- `docs/diagnostics/*.md` / `*.html` (= 既存診断文書)
- 直近 1-2 週間で作成された未解決 PR / Issue
- `gh pr checks` で CI が失敗している PR
- TODO コメント / 未着手 task (TaskList で取得可能なら)

P0 / P1 / P2 の優先度タグを付け、テーブルにまとめる。

### Step 5: ロードマップ (= 作業提案)

- **短期 (1-2 週間)**: 直近のリスク + 進行中の半着手案件
- **中期 (1-2 か月)**: 現フェーズを完了させる作業 + 次フェーズ準備
- **長期 (3-6 か月)**: 設計骨格に関わる提案 (= Phase B / C / D 等)

### Step 6: HTML 生成

`.claude/skills/codebase-review-html/template.html` を読み込み、上記 Step 1-5 で集めた内容を `{{PLACEHOLDER}}` 部分に埋め込む。完了後、`docs/diagnostics/codebase_review_<YYYY-MM-DD>.html` として **新規ファイル**で保存する (= 既存レポートは上書きせず、日付別で蓄積)。

最後にユーザーへ:
- 出力ファイルのフルパス
- レポートのハイライト (= 主要リスク 3 件、推奨アクション 3 件)
を簡潔に提示する。

## 注意事項

- レビュー対象は **read-only**。コードや設定の書き換えはしない。
- 既存テンプレ (`docs/diagnostics/trader_note_build_ai_comprehensive_review_2026-05-20.html`) と視覚的整合性を保つため、`template.html` の `<style>` ブロックは変更しないこと。
- 観点リスト (`checklist.md`) はプロジェクトの進化に合わせて更新する (新規領域追加時に追記)。
- レビュー記述は **証拠付き**: 「`src/path/to/file.ts:L42-L58` で〜」のようにファイル/行番号を添える。
- 推測は明示する: 「コードからの推測ですが〜」「未検証ですが〜」を Uncertainty 表示として使う (AGENTS.md 「AI 推論品質ガイドライン §2」準拠)。
- `any` / `unknown` 等、AGENTS.md §2 違反の検出は積極的に列挙する。
