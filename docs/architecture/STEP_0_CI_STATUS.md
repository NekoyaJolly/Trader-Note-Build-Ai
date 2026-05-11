# STEP_0_CI_STATUS.md - CI / ブランチ保護 PR ゲート現状報告

> **チケット**: Ticket B3
> **作成日**: 2026-05-12
> **方針**: ブランチ保護ルールは管理者権限が必要なため Claude Code は変更しない。現状を報告し、ユーザー対応依頼を明示する (KICKOFF.md §B3)

---

## 1. CI 実行状況

### 1.1 workflow ファイル

`.github/workflows/ci.yml` に `lint-and-typecheck` ジョブが定義されており、PR トリガーで走る:

```yaml
on:
  pull_request:
    branches: [main, develop]
```

### 1.2 ジョブ内容 (現状)

`lint-and-typecheck` ジョブ:

| ステップ | コマンド | PR fail 条件 |
|---------|---------|-------------|
| TypeScript コンパイル確認 | `npx tsc --noEmit` | ✅ tsc が non-zero exit で fail |
| ESLint チェック | `npm run lint --if-present \|\| echo "ESLint スキップ"` | ❌ **failure を握りつぶす** (`\|\| echo` で常に exit 0) |

### 1.3 判定

KICKOFF.md §B3 の 3 パターン判定:

- **パターン B**: 片方しか実質的に走っていない (= ESLint が無効化されている)

`tsc` は正常に PR ゲートとして機能している。`ESLint` は呼び出されているが失敗を握りつぶすため、実態として PR ゲートになっていない。

### 1.4 Frontend tsc の扱い

`npx tsc --noEmit` (CI 第49行) は**ルート tsconfig.json のみ**を対象。Phase B Ticket B1 で `src/frontend/tsconfig.json` にも追加 strict オプションを適用したが、CI 上では Frontend tsc が走っていない。Frontend のビルド時に Next.js が型チェックを行うが、PR ゲートとしての保証は無い。

---

## 2. ブランチ保護ルール現状

### 2.1 確認結果

```bash
gh api repos/NekoyaJolly/Trader-Note-Build-Ai/branches/main/protection
→ {"message":"Branch not protected","status":"404"}
```

**main ブランチは保護されていない**。必須ステータスチェック・PR レビュー必須化・push 制限はすべて未設定。

### 2.2 影響

- CI が fail しても main へのマージは可能 (現状の Phase A PR #155 マージも CI チェックを経ずに完了)
- main への直接 push も技術的に可能 (workflow_phase_pr.md の運用ルールで禁止しているのみ)
- Phase 完了 PR ワークフロー (Nekoさんマージ判断) は**規約ベース**で運用されており、技術的強制力が無い

---

## 3. ユーザー対応依頼

Claude Code は GitHub Settings の権限が無いため、以下は Nekoさん側で設定をお願いします。

### 3.1 必須対応 (ブランチ保護)

GitHub Settings → Branches → Add branch protection rule for `main`:

- ✅ **Require a pull request before merging**
  - Require approvals: 1 (推奨)
  - Dismiss stale pull request approvals when new commits are pushed (推奨)
- ✅ **Require status checks to pass before merging**
  - Require branches to be up to date before merging
  - **必須チェック**: `Lint & TypeCheck` (現 ci.yml の job 名)
  - 追加候補: `Unit Tests`, `DB Integration Tests`
- ✅ **Do not allow bypassing the above settings** (推奨)
- ⚠️ **管理者にも適用するか** (Include administrators) は Nekoさん判断。Solo 開発なら off でも可

### 3.2 ESLint PR ゲート化 (Step 0 完了後の別 PR で対応)

`.github/workflows/ci.yml` 第52行を以下のように変更:

```yaml
# Before
- name: ESLint チェック
  run: npm run lint --if-present || echo "ESLint スキップ"

# After
- name: ESLint チェック
  run: npm run lint
```

**ただし即座に変更すると**: Phase B Ticket B2 の audit で計測した通り、現状 488 errors が残っており、変更直後に全 PR が CI fail で塞がる。よって以下の順序で進める:

1. Step 0 完了 (Phase C / Final Gate)
2. 別 PR で side-b 優先で ESLint 違反を段階解消 (STEP_0_ESLINT_AUDIT.md §4 推奨優先順)
3. 違反 0 件になったタイミングで `|| echo "ESLint スキップ"` を削除し PR ゲート化

### 3.3 Frontend tsc 追加 (任意、別 PR で対応)

ci.yml の `lint-and-typecheck` ジョブに以下のステップ追加を検討:

```yaml
- name: Frontend TypeScript コンパイル確認
  run: cd src/frontend && npx tsc --noEmit
```

ただし Phase B B1 で計測した通り Frontend は 379 errors を抱えているため、解消後に追加するのが現実的。

### 3.4 ブランチ保護を `develop` にも適用するか

ci.yml は `main` `develop` 両方を PR トリガーにしているが、現在 `develop` ブランチがリモートに存在しない。trunk-based であれば不要、Git Flow を採用するなら `develop` も保護対象。Nekoさん判断。

---

## 4. workflow ファイルへの変更

本チケット (B3) で `.github/workflows/ci.yml` の変更は**行わない**。理由:

- ESLint PR ゲート化は既存 488 違反の解消が前提
- 既存違反解消は Phase B の禁止事項 (「既存違反を修正しない」)
- よって CI 変更は Step 0 完了後の別 PR (ESLint 違反解消と同じ PR にまとめるのが整合的)

---

## 5. 監査スナップショット

- 計測日: 2026-05-12
- 計測コマンド: `gh api repos/.../branches/main/protection`
- ci.yml バージョン: feature/step0-phase-b checkout 時 (PR #155 マージ直後の main)
