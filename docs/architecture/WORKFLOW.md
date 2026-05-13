# WORKFLOW.md - 開発ワークフロー

> **対象**: Code (Claude Code / Cursor / Gemini など実装エージェント)、Nekoさん
> **位置づけ**: 運用ドキュメント。設計書ではない
> **最終更新**: 2026-05-13

---

## 1. 基本フロー

```
[Code] 実装
  ↓
[Code] PR 作成 (または main 直接 commit)
  ↓
[Copilot bot] レビュー (PR の場合)
  ↓
[Code] レビュー対応 (修正 → commit → push → サマリコメント投稿)
  ↓
[Code] マージ自動確認 polling 開始 (背景タスク)
  ↓
[Nekoさん] マージ判断 (GitHub UI / スマホ等から)
  ↓
[Code] polling が MERGED を検出 → 次 Phase へ自動着手
```

**Nekoさんの役割**: マージ判断のみ。コードは書かない。マージ完了の口頭報告も不要 (Code が自動検出する)。

---

## 2. PR vs main 直接 commit の判断基準

### PR が必要な作業 (= 重め)

- 多段 Phase 構成の Phase 完了 (Step KICKOFF の Phase 1 / Phase 2 等)
- 複数ファイル / 複数ロジックに渡るコード変更
- 設計判断や仕様変更を伴う
- 本番動作に影響する変更
- Nekoさんが明示的に PR を求めた作業

### main 直接 commit で OK (= 軽量)

- ドキュメント 1 つの追加・更新
- 軽微なタイポ / 表記揺れ修正
- 設計書のクロージング作業 (サマリー作成等)
- Code 側から「軽い」と判断できる作業

**迷ったら Nekoさんに確認**。全てを PR にすると重たくなる。

---

## 3. PR ワークフロー詳細

### 3.1 PR 作成

```bash
git checkout -b <step>/<phase>-<scope>      # 例: step1/phase2-adk-adapter-impl
# 実装 → 段階的 commit (チケット単位)
git push -u origin <branch>
gh pr create --base main --head <branch> --title "..." --body "..."
```

**コミットメッセージ形式**:
- 通常実装: `feat(scope): 内容` / `fix(scope): 内容` / `refactor(scope): 内容` / `test(scope): 内容` / `docs(scope): 内容` / `chore(scope): 内容`
- レビュー対応: `fix(review): Copilot レビュー対応 (PR #N)`
- Step 0 等チケット単位: `chore(step0): <内容> (Ticket {ID})`

### 3.2 Copilot レビュー対応 (PR 作成と同ターンで実行)

`gh pr create` 完了後、**Nekoさんへ応答を返さず同じターン内で連続実行**:

1. **30〜60 秒間隔で Copilot レビュー polling**
   ```bash
   gh api repos/{owner}/{repo}/pulls/{N}/reviews    # overview
   gh api repos/{owner}/{repo}/pulls/{N}/comments   # inline 指摘
   ```
   `user.login` が `copilot-pull-request-reviewer` または `Copilot` のもの。
2. **最大 10 分待機**。timeout したら PR コメントで「未着、次回確認時に対応」と残して終了
3. レビューが届いたら **`copilot-review-responder` スキルは呼ばず inline で対応**:
   - 各指摘を分類: 軽微 (typo / lint / 小さなロジック) / 設計判断 (大きな変更要求)
   - 軽微: `edit → commit → push`
   - 設計判断: **修正せず保留**、サマリで「ユーザー確認待ち」と明示
4. **`suppressed (low confidence)` 指摘も内容を見て対応する** (実態としてしばしば正当な指摘)
5. ローカル検証 (`tsc + jest`) を commit 前に実行
6. **サマリコメント 1 件投稿** (フォーマットは §3.3 参照)

#### Stop hook / UserPromptSubmit / Skill 起動は禁止

過去 (2026-05-11 PR #152 後の議論) に試したが timing 不安定で動かず。Nekoさん判断で「Claude が user 入力を待たずに自分でポーリングして処理する」運用に確定。

### 3.3 サマリコメントの統一フォーマット

```markdown
## Copilot レビュー N 件 → 対応完了 (commit <短縮sha>)

| # | 指摘 | 対応 |
|---|---|---|
| (1) | <Copilot 指摘の要約 1 行> | <修正内容 or 判断理由 1-2 行> |
| (2) | ... | ... |

## ローカル検証
- 型チェック: クリーン
- 単体テスト: XX/XX PASS
```

過去実例: PR #148 / PR #156 / PR #164 / PR #165 等。

### 3.4 マージ自動確認 polling (★ 自走の核)

サマリコメント投稿後、**Nekoさんのマージを待たず**に自動 polling を仕掛ける:

```bash
PR_NUMBER=<N>
while true; do
  state=$(gh pr view $PR_NUMBER --json state --jq .state 2>/dev/null || echo "")
  if [ "$state" = "MERGED" ]; then
    echo "MERGED at $(date)"; exit 0
  elif [ "$state" = "CLOSED" ]; then
    echo "CLOSED_WITHOUT_MERGE at $(date)"; exit 0
  fi
  sleep 60
done
```

**実行方法**: `Bash run_in_background: true` + `timeout: 600000` (10 min)。

#### 通知結果に応じた分岐

| 通知 | 意味 | Code の対応 |
|------|------|------------|
| `MERGED` | Nekoさんが承認マージ | 次 PR / 次 Phase に自動着手 |
| `CLOSED` (without merge) | Nekoさんが問題を見つけて閉じた | **停止して Nekoさんに報告** |
| `TIMEOUT` (10 min 未マージ) | Nekoさんがまだマージしていない | **同じ polling を再起動**して延長 |

#### TIMEOUT 延長戦略

- 最大回数の制限なし (Nekoさんが外出から戻るまで)
- 1 分間隔の `gh API` 呼び出しのみで負荷は極小
- Code は notification 待ちで他作業可能

### 3.5 マージ後の次 Phase 着手

```bash
git checkout main
git pull --ff-only origin main
git checkout -b <next-branch>   # 次 Phase
# 実装着手
```

多段 Phase 全 PR が完了するまで自走可能。

---

## 4. なぜこの形か (Why)

### 4.1 Nekoさんが外出中でも進行する

スマホ等から `gh pr merge` または GitHub UI でマージするだけで Code が検出して次 PR へ進む。ローカル環境前にいる必要がない。

### 4.2 「マージ完了」の手動報告不要

Nekoさんが Code に対して「マージ完了」と打ち込まなくても、polling で自動検出する。Nekoさんの認知負荷を最小化。

### 4.3 マージ判断の主体は Nekoさん

Code は「マージされたか」を**検出するだけ**。マージ可否の判断 (内容を読む / Copilot レビューを確認 / 他作業との優先度) は GitHub 上で Nekoさんが行う。

### 4.4 軽量作業まで PR にしない

ドキュメント 1 つの追加で PR を作るのは過剰。main 直接 commit で十分。判断は Code 側で行う (迷ったら確認)。

---

## 5. 禁止事項

- **main への直接 push** (軽量 commit でも push 自体は問題ないが、`git push --force` 系は禁止)
- **`--no-verify` で hook をスキップする**
- **`git push --force` / `git reset --hard origin/...` で履歴を上書きする** (Nekoさんが明示指示した場合のみ)
- **Copilot 指摘の設計判断系を独断で修正する** (必ず保留してサマリで明示)
- **Nekoさん承認なしに PR をマージする**
- **`Skill` tool で `copilot-review-responder` を呼ぶ** (inline 実行ルール、§3.2 参照)
- **Stop hook / UserPromptSubmit hook に polling を委ねる** (§3.2 参照)

---

## 6. 軽量作業 (main 直接 commit) の手順

```bash
git checkout main && git pull --ff-only origin main
# 編集
git add <files>
git commit -m "<type>(<scope>): <内容>"
git push origin main
```

PR と違って Copilot レビューは走らない。push 後の CI fail には注意。

---

## 7. 関連ドキュメント / リソース

| リソース | 内容 |
|---------|------|
| `.claude/skills/copilot-review-responder/` | Copilot レビュー対応スキル定義 (本書 §3.2 の inline 実行を仕様化したもの) |
| `.github/workflows/lint-fix-on-merge.yml` | 本書 §8 の自動 lint 修正 workflow 本体 |
| `/AGENTS.md` | 全エージェント共通ルール (正本) |
| `docs/architecture/ADK_ADOPTION.md` | ADK 採用計画 (Step 進捗管理) |
| `docs/architecture/STEP_*_KICKOFF.md` / `STEP_*_SUMMARY.md` | 各 Step の作業手順書 / 完了サマリー |

---

## 8. 自動 lint 修正ワークフロー (Copilot Coding Agent)

実装 PR が main にマージされたタイミングで、変更ファイルの 1 階層親ディレクトリに対して ESLint / tsc 違反を **Copilot Coding Agent** に自動修正させる仕組み。

### 8.1 目的

Step 0 完了時点で「ユーザー対応依頼」として残っていた **ESLint 488 errors / tsconfig audit 1423 errors** を、Nekoさん負担ゼロで継続的に減らす。実装 1 PR ごとに少しずつ lint 修正 PR が生まれて、Nekoさんはマージ判断するだけ。

### 8.2 フロー

```
[実装 PR が main にマージ]
  ↓ GH Actions trigger
  ↓ (excludes copilot/* and chore/lint-fix-*)
[Action が PR diff から TS/JS ファイルを抽出 → 1 階層親ディレクトリ算出]
  ↓
[Action が Issue 自動作成]
  - title: "[lint-fix] PR #N の影響範囲を lint 修正"
  - body: 対象ディレクトリ + 厳守事項 + 検証手順
  - assignee: Copilot ← Coding Agent
  ↓
[Copilot Coding Agent が PR 作成]
  - branch: copilot/lint-fix-N (デフォルト命名)
  ↓
[Copilot レビュー + Nekoさんマージ判断]
```

### 8.3 修正範囲・深さ

| 項目 | 採用 |
|------|------|
| 修正範囲 | マージ PR が触れた TS/JS ファイルの **1 階層親ディレクトリのみ** (作りながら段階拡張) |
| 修正の深さ | ESLint auto-fixable + 型注釈追加 (any 残置 / 戻り値型欠落) + 未使用 import 削除 |
| 対象外 | `unknown` の具体型化 (人間判断が必要なため別途対応)、設計判断を伴うリファクタ |
| ファイル種別 | `.ts` / `.tsx` / `.js` / `.jsx` のみ (.md / .yml / .json 等は対象外) |

### 8.4 Copilot への厳守事項 (Issue body にテンプレ化)

- **既存機能・ロジック・テスト結果を一切変更しない**
- **デザイン・UI の見た目を一切変更しない**
- **フォーマット規約・命名規約も変更しない**
- **修正前後で `npx jest` が同じ結果になること**
- **直せなかったもの** (unknown 残置、副作用が読めなかったもの) は **PR description にレポート**

### 8.5 無限ループ予防 (3 重)

| 予防 | 条件 |
|------|------|
| (1) close-only を除外 | `pull_request.merged == true` のみトリガー |
| (2) Copilot 自身の PR を除外 | `head.ref` が `copilot/` で始まらないこと |
| (3) 手動 lint-fix PR を除外 | `head.ref` が `chore/lint-fix-` で始まらないこと |

→ Copilot Coding Agent が出す lint 修正 PR (`copilot/lint-fix-N`) がマージされても、もう一度 lint エージェントは起動しない。

### 8.6 起動条件

- マージされた PR に **TS/JS ファイル変更が 1 件以上ある** こと
- 0 件なら Issue を作らずに workflow 終了 (無駄起動の予防)

### 8.7 動作確認・調整

- 初回実走で Copilot の修正品質を観察
- プロンプト調整は Issue body テンプレ (workflow YAML) を更新する形で
- 修正範囲を 2 階層 / 3 階層に広げる場合は workflow YAML の `dirname` ロジックを変更

---

## 9. Production Deployment 失敗の早期検出フロー (2026-05-14 追加)

PR #184 (deploy #457〜#472 の 15 連続失敗) の振り返りで、deploy 失敗を merge から最大 15 PR ぶん見逃した事例が発生したため、確認フローを **pre-merge 強化 + post-merge 瞬間チェック** の 2 段構えに整理する。

### 9.1 目的

- 各 PR の merge 後に走る Production Deployment の失敗を、**次 Phase 着手前に検出**する
- ただし、毎 PR で deploy success まで待つと ~12 分 / PR の追加待機が発生するため、待ち時間を最小化する
- Step 完了 PR (Phase 5 cleanup) のような区切り PR でだけ完全に待つ運用も検討した (§9.5 参照) が、各 Phase 着手時の瞬間チェックの方が遅延が小さく済む

### 9.2 pre-merge ゲート (`docker build` を CI Pipeline 内で実行)

`.github/workflows/ci.yml` の `docker-build` ジョブで `docker build .` を実行する。

- 過去 (PR #184) の Dockerfile drift (`.npmrc` の COPY 抜け) のような **ローカル `npm ci` は通るが Docker 内 `npm ci` で落ちる** 食い違いを pre-merge で捕捉する
- ローカル `.npmrc` の `legacy-peer-deps=true` が効くため `npm ci` / `tsc` / `jest` ベースの既存 CI ジョブはすり抜けるが、`docker build` は Docker context で実行されるため `.npmrc` の不在等を確実に検出する
- ジョブ追加による CI 時間増加は GitHub Actions cache (`type=gha`) で最小化

### 9.3 post-merge 瞬間チェック (次 Phase 着手時)

各 Phase の作業着手の **冒頭**で、最新 Production Deployment の状態を 2 秒で確認する。

```bash
gh run list --workflow=deploy.yml --limit=1 --json conclusion,number,headSha,status,createdAt
```

判定:

| 最新 deploy の状態 | 着手判断 |
|------------------|----------|
| `success` | ✅ 次 Phase 着手 OK |
| `in_progress` | ✅ 次 Phase 着手 OK (in_progress は後で見直す。並走で別 Phase を進める間に結果が出るのが普通) |
| `failure` で headSha が直近 1〜2 commit 以内 | ❌ **次 Phase 着手せず Nekoさんに即時報告**。原因調査 PR を先行 |
| `failure` だが headSha が古い (= 既に修正済み or 失敗が放置されていない) | 状況を Nekoさんに確認 |

これにより、deploy 失敗の検出遅延は **最大で 1 Phase ぶん (= 次 PR まで)** に抑えられる。Step 3 のように 5 Phase 構成でも、検出が「Phase 1 失敗 → Phase 2 着手時に検知」で済む。

### 9.4 §3.4 (merge polling) との関係

§3.4 の merge polling は引き続き「MERGED 検出 → 次 Phase へ自動着手」のままで変更しない。本 §9.3 の瞬間チェックは「次 Phase 着手の冒頭ステップ」として追加される。

合算した流れ:

```
[Code] サマリコメント投稿 → merge polling 起動
  ↓
[Nekoさん] merge
  ↓
[Code] polling MERGED 検出
  ↓
[Code] git checkout main && git pull --ff-only origin main
  ↓
[Code] ★ 最新 deploy 状態を瞬間チェック (本 §9.3)
  ↓ success / in_progress
[Code] git checkout -b <next-phase-branch>
  ↓
[Code] 次 Phase 実装着手
```

### 9.5 採用しなかった案 (記録)

| 案 | 採否 | 理由 |
|---|------|------|
| 毎 PR で deploy success まで完全待機 | ❌ | 各 PR ~12 分追加、ESLint 厳格化後はさらに伸びる |
| Step 完了 PR (Phase 5) のみ deploy success まで待つ | ❌ | Phase 1〜4 で壊れた場合 Step 末尾まで検出が遅れる (Step 3 の場合 ~5 PR 分) |
| 全 PR で CI Pipeline (6 分) のみ待つ | ❌ | Production Deploy 自体の失敗は検出できない |
| post-merge polling を background で常時走らせる | ❌ | 失敗時の判断 (継続 / 停止) が曖昧、通知混入で混乱しやすい |
| 採用: pre-merge `docker build` + 次 Phase 着手時瞬間チェック | ✅ | 待ち時間ゼロ近く、検出遅延 1 Phase 以内 |

---

## 10. 履歴

- **2026-05-11** (PR #152 後): Stop hook / UserPromptSubmit hook 経由の自動発火が timing 不安定 → Claude が同ターン内で inline polling する方式に Nekoさん判断で確定
- **2026-05-12**: PR/コミット使い分け + マージ自動確認の運用が以後の標準ワークフローとして確定 (Step 0 進行中)
- **2026-05-13** (commit 3ea62e6): 本書 (`WORKFLOW.md`) としてリポジトリに正式文書化 (それまでは Claude のメモリにのみ存在)
- **2026-05-13** (commit b66ca30): §8 自動 lint 修正ワークフロー追加 (`.github/workflows/lint-fix-on-merge.yml`)。Copilot Coding Agent ベース、ESLint 488 / tsconfig audit 1423 の段階解消を Nekoさん負担ゼロで継続するため
- **2026-05-13**: 本書 (`WORKFLOW.md`) としてリポジトリに正式文書化 (それまでは Claude のメモリにのみ存在)
- **2026-05-14** (PR #184 振り返り): §9 Production Deployment 失敗の早期検出フロー追加。pre-merge `docker build` ゲート + 次 Phase 着手時の瞬間チェックの 2 段構成。deploy #457〜#472 の 15 連続失敗を merge から検知まで放置した事例を踏まえた再発防止
