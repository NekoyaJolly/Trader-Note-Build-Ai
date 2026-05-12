# STEP_0_HUSKY_SETUP.md - pre-commit hook (simple-git-hooks + lint-staged) セットアップ

> **チケット**: Ticket C1 (KICKOFF.md §C1 で「任意」と指定)
> **作成日**: 2026-05-12
> **位置づけ**: 既存導入の確認と Mac/Windows 両環境での動作確認手順の文書化

---

## 1. 採用ライブラリ (現状)

KICKOFF.md §C1 は **husky + lint-staged** の導入を想定していたが、本リポジトリでは既に **`simple-git-hooks` + `lint-staged`** の組み合わせが導入されている。両者は機能的に等価 (pre-commit hook で lint-staged を走らせる) であり、本チケットでは**既存の simple-git-hooks 構成を維持**し、追加の husky 導入は行わない。

### 1.1 husky vs simple-git-hooks の比較

| 項目 | husky | simple-git-hooks |
|------|-------|------------------|
| インストール時の挙動 | `.husky/` ディレクトリと shell スクリプトを生成 | `.git/hooks/` 配下のスクリプトを直接書き換え |
| 依存関係 | 単独 (devDep) | 単独 (devDep)、本リポジトリ採用バージョン v2.13.1 |
| 設定方法 | `.husky/pre-commit` 内の shell 命令 | `package.json` の `simple-git-hooks` セクション |
| Mac/Windows 対応 | 両対応 (shell スクリプトベース) | 両対応 (フックは Node 経由で起動可能) |
| 機能要件への適合 | ✅ pre-commit 起動可能 | ✅ pre-commit 起動可能 |

→ **どちらでも本チケットの機能要件 (pre-commit で lint-staged 起動) は満たせる**。本リポジトリは simple-git-hooks を選択済み。

---

## 2. 現状の設定 (package.json)

```jsonc
{
  "scripts": {
    "prepare": "node scripts/install-git-hooks.js"
  },
  "devDependencies": {
    "lint-staged": "^16.4.0",
    "simple-git-hooks": "^2.13.1"
  },
  "simple-git-hooks": {
    "pre-commit": "npx lint-staged"
  },
  "lint-staged": {
    "src/**/*.ts": [
      "eslint"
    ]
  }
}
```

### 2.1 動作フロー

```
git commit
  ↓
.git/hooks/pre-commit (simple-git-hooks が登録)
  ↓
npx lint-staged
  ↓
src/**/*.ts のうち staged されているファイルに対して eslint 実行
  ↓
ESLint が non-zero exit → commit 中止
ESLint が pass → commit 成立
```

### 2.2 install-git-hooks.js の役割

`scripts/install-git-hooks.js` は `prepare` script で `npm install` 直後に呼ばれる:

1. `.git` が存在しない (CI / shallow clone) 場合は skip
2. `npx simple-git-hooks` を実行して `.git/hooks/pre-commit` を登録
3. 失敗した場合はエラーを**握りつぶさず** non-zero exit (セットアップ失敗を即検知)

Windows では `spawnSync` の `shell: true` を有効化し、`npx` の解決を保証。

---

## 3. Mac/Windows 両環境での動作確認手順

### 3.1 共通の前提

```bash
# 1. 依存関係をインストール (prepare が自動で simple-git-hooks 登録)
npm install

# 2. 登録結果の確認
cat .git/hooks/pre-commit
# → npx lint-staged を呼ぶ shell スクリプトが書かれていれば OK
```

### 3.2 動作確認テスト

#### 3.2.1 lint 違反を含む変更をテストファイルに作る

```bash
# テスト用ファイル作成 (root 直下に置く)
mkdir -p src/_precommit_test
cat > src/_precommit_test/sample.ts <<'EOF'
// pre-commit hook テスト用 (commit 後に削除すること)
const x: any = "any 型を意図的に使用";  // ESLint error 想定
console.log(x);
EOF
```

#### 3.2.2 stage して commit を試みる

```bash
git add src/_precommit_test/sample.ts
git commit -m "test: pre-commit hook 動作確認"
```

**期待動作**:
- lint-staged が起動し、`src/**/*.ts` パターンに該当する `sample.ts` を eslint にかける
- `@typescript-eslint/no-explicit-any` error で commit が中止される
- ターミナルに ESLint エラーメッセージが表示される

#### 3.2.3 後片付け

```bash
git restore --staged src/_precommit_test/sample.ts
rm -rf src/_precommit_test
```

### 3.3 Mac 固有の確認ポイント

- `node` および `npm` が `nvm` または system 経由で PATH 上に存在することを確認
- フックスクリプトは shebang (`#!/bin/sh`) で sh 経由で起動する
- 通常は問題なし

### 3.4 Windows 固有の確認ポイント

- Git Bash / WSL / PowerShell の **いずれの環境からも commit 可能**であること
- `scripts/install-git-hooks.js` 内の `shell: process.platform === 'win32'` により、Windows でも `npx` が解決される
- `lint-staged` は cross-platform 対応 (内部で `cross-spawn` 等を利用)
- CRLF 改行混在の場合: `.gitattributes` で行末正規化されていれば lint-staged の挙動に影響なし

### 3.5 トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `.git/hooks/pre-commit` が無い | `prepare` script が走らなかった (`--ignore-scripts` 指定など) | `node scripts/install-git-hooks.js` を手動実行 |
| commit 時に何も起こらない | フックが登録されていない / 無効化されている | `git config --get core.hooksPath` で `core.hooksPath` がカスタムパスに上書きされていないか確認 |
| `lint-staged could not find any staged files matching configured tasks.` | staged されているファイルが `src/**/*.ts` パターンに一致しない | 警告のみで commit は成立する (例: 設計書だけの commit)。**問題ではない** |
| Windows で `npx` not found | PATH に Node.js が無い、または bin パスが反映されていない | Git Bash を再起動、または `where npx` で確認 |

---

## 4. KICKOFF.md §C1 DoD との照合

| DoD 項目 | 状態 |
|----------|------|
| husky と lint-staged が dev dependency に追加されている | ⚠️ husky は無いが **機能等価の simple-git-hooks** が導入済み。lint-staged は導入済み |
| pre-commit hook がコミット時に走る | ✅ 既存設定で機能している (実 commit ログでも lint-staged が起動している) |
| Mac/Windows 両方での動作確認手順がドキュメント化されている | ✅ 本ドキュメントの §3 で対応 |

**判定**: 機能要件を満たしており、追加対応は不要。husky への置き換えは行わない (既存運用の安定性を優先)。

---

## 5. 監査スナップショット

- 確認日: 2026-05-12
- pre-commit ライブラリ: `simple-git-hooks` v2.13.1
- lint-staged: v16.4.0
- インストール経路: `npm install` → `prepare` script → `node scripts/install-git-hooks.js` → `npx simple-git-hooks`
- 検証: feature/step0-phase-a, feature/step0-phase-b の commit 群で `lint-staged could not find any staged files matching configured tasks.` 警告が確認されており、フック自体は起動している
