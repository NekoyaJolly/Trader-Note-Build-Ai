---
name: copilot-review-responder
description: |
  GitHub Copilot がプレディクティブに付けた PR レビューを検知し、対応するスキル。
  「Copilot レビュー対応」「PR のレビューに返事」「PR #N のコメント対応」と言われたら使用する。
  または PR 作成・push 直後に自動的に起動して未対応コメントの有無を確認するときにも使う。
  軽微な修正は自律で commit & push、設計判断が必要な指摘は対応せず保留してコメントで明記する。
  最終的に PR 上に「## Copilot レビュー N 件 → 対応完了 (commit <sha>)」のフォーマットで 1 つのサマリコメントを投稿する。
---

# Copilot レビュー対応スキル

## 目的

PR 作成後に GitHub Copilot (`copilot-pull-request-reviewer` ボット) が自動で出すレビューを検知し、各指摘に対する対応 (修正コミット or 保留判断) を行い、PR 上に統一フォーマットのサマリコメントを 1 つ投稿する。

このプロジェクトの過去 PR (#144, #145, #148 等) で確立されている対応パターンを忠実に再現する。

## 出力フォーマット (厳守)

レビュー対応の最終アウトプットは PR コメント 1 件のみ。形式は以下:

```markdown
## Copilot レビュー N 件 → 対応完了 (commit <sha>)

| # | 指摘 | 対応 |
|---|---|---|
| (1) | <Copilot 指摘の要約 (1 行)> | <修正内容 or 判断理由 (1-2 行)> |
| (2) | ... | ... |

(任意セクション、必要な時だけ追加)

## 📋 マージ後の手順
- <ユーザーが手で行う必要がある操作 (Variables 設定、env 追加等)>

## 🛑 緊急停止の流れ (= 今後)
- <設定したパラメータの停止方法>

## 安全な挙動 (= フォールバック)
- <未設定時の安全な動作>

## ローカル検証
- <型チェック、テスト結果>
```

過去 PR の実例: https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/148#issuecomment-4412780925

## 実行手順

### 1. 対象 PR の特定

```bash
# 現在ブランチに紐づく PR 番号を取得
PR_NUMBER=$(gh pr view --json number -q .number)
# または引数で明示的に渡された PR 番号を使う
```

### 2. レビュー取得

```bash
# Copilot のレビュー本体 (overview 等)
gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/reviews --paginate \
  | jq '[.[] | select(.user.login == "copilot-pull-request-reviewer")]'

# 行コメント (個別指摘)
gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/comments --paginate \
  | jq '[.[] | select(.user.login == "copilot-pull-request-reviewer")]'
```

両方をマージして N 件の指摘リストを構築する。

### 3. 既対応判定

以下のいずれかなら **既対応扱いで skip**:
- そのコメントスレッドに自分 (PR 作者) の返信が既にある
- PR 上に既に「## Copilot レビュー N 件 → 対応完了 (commit <sha>)」サマリが投稿済みで、その commit より古いレビュー
- コメントが GitHub UI 上で resolved になっている

### 4. 各指摘の分類

| 種別 | 例 | 対応 |
|---|---|---|
| **typo / lint / 軽微なバグ** | 変数名の typo、import 漏れ、null チェック漏れ | 自律で edit → commit → push |
| **小規模なロジック修正** | 条件式の改善、エラーハンドリング追加 | 自律で edit → commit → push |
| **テスト追加要求** | 「このケースのテストが無い」 | 該当テスト追加 → commit → push |
| **設計判断 / 大きな変更** | 「アーキテクチャを変えるべき」「別方針を検討すべき」 | **対応せず保留**。サマリの「対応」列に「ユーザー確認待ち: <理由>」と書く |
| **質問・確認** | 「これは意図通り?」 | コードを読んで日本語で回答 (必要なら追加コミットなし) |

### 5. 修正と commit

複数指摘をまとめて 1 commit にしてよい。commit message は以下の形式:

```
fix(review): Copilot レビュー対応 (PR #<N>)

- <指摘1の要約> → <修正内容>
- <指摘2の要約> → <修正内容>
```

### 6. push

```bash
git push origin <current-branch>
```

`main` への直接 push は **絶対禁止**。force push も禁止。

### 7. ローカル検証 (commit 前/後)

最低限以下を実行し、結果をサマリの「ローカル検証」セクションに記載:

```bash
npx tsc --noEmit -p tsconfig.json   # 型チェック
npm run test:unit                    # 単体テスト (DB 不要)
```

失敗したら commit せず修正してから commit。

### 8. サマリコメント投稿

最後に 1 件だけコメントを投稿する。

```bash
COMMIT_SHA=$(git rev-parse --short HEAD)
gh pr comment $PR_NUMBER --body "$(cat <<EOF
## Copilot レビュー N 件 → 対応完了 (commit ${COMMIT_SHA})

| # | 指摘 | 対応 |
|---|---|---|
| (1) | ... | ... |

## ローカル検証
- 型チェック: クリーン
- 単体テスト: XXX/XXX PASS
EOF
)"
```

## 厳守事項

- **`main` ブランチへの直接 push 禁止**。作業は対象 PR のフィーチャブランチのみ
- **destructive operations 禁止**: `git push --force`, `git reset --hard`, `git branch -D`
- **`--no-verify` で hook をスキップしない**
- **設計判断系の指摘は絶対に勝手にコード変更しない** — 必ずサマリで「ユーザー確認待ち」と保留
- **応答・コミットメッセージ・コメントは全て日本語**
- 既に対応済みのコメントには **絶対に重複返信しない** (= サマリ済みなら新規は無し)

## 既知の例外パターン

- Copilot レビューが 0 件 → 何もしない (サマリも投稿しない)
- 全件が既対応 → 何もしない
- 全件が「設計判断」で保留 → サマリは投稿するが commit なし、各行を「ユーザー確認待ち」で埋める

## 引数

- 引数なし: 現在ブランチの PR を対象
- `PR #149` 等 PR 番号指定: 指定 PR を対象

## 終了条件

サマリコメント投稿が成功した時点で完了。完了したらユーザーに「PR #N にレビュー対応完了サマリを投稿しました (commit <sha>)」と短く報告する。
