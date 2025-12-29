# GitHub Actions CI/CD パイプライン設定ガイド

## 概要

このプロジェクトは以下の GitHub Actions ワークフローを自動実行します：

1. **CI パイプライン（ci.yml）** - PR・push 時に実行
2. **本番デプロイ（deploy.yml）** - main ブランチへのマージ時に実行
3. **品質・セキュリティチェック（quality.yml）** - 定期的に実行

---

## 1. CI パイプライン（ci.yml）

### 実行トリガー

- PR 作成・更新時（main/develop ブランチへ）
- push 時（main/develop ブランチへ）

### 実行ジョブ

#### 1.1 lint-and-build
- **目的**: TypeScript コンパイル確認
- **実行内容**:
  - Node.js 18 環境セットアップ
  - `npm ci`（正確な依存関係インストール）
  - `npx tsc --noEmit`（コンパイルチェック）
  - ESLint チェック（存在する場合）

#### 1.2 test
- **目的**: ユニット・統合テスト実行
- **実行内容**:
  - PostgreSQL テスト用インスタンス起動
  - Jest テスト実行（カバレッジ付き）
  - Codecov へのカバレッジアップロード

#### 1.3 e2e-local
- **目的**: ローカル環境での E2E テスト
- **実行内容**:
  - npm run dev で開発サーバー起動
  - サーバーの起動確認（最大 30 秒待機）
  - `bash scripts/local-e2e-test.sh` 実行
  - 8 個の API エンドポイント検証

#### 1.4 build
- **目的**: ビルド成功確認
- **実行内容**:
  - `npm run build` 実行（存在する場合）

#### 1.5 notify-deployment
- **目的**: main ブランチマージ時の本番デプロイ準備通知
- **実行条件**: main ブランチへの push のみ

---

## 2. 本番デプロイ（deploy.yml）

### 実行トリガー

- **自動**: main ブランチへの push （src/, prisma/, package.json 変更時）
- **手動**: GitHub Actions UI からワークフロー実行

### 実行ジョブ

#### 2.1 pre-deployment-checks
- **目的**: デプロイ前の最終確認
- **実行内容**:
  - TypeScript コンパイル確認
  - ユニットテスト実行
  - 本番環境 URL へルスチェック

#### 2.2 deploy-railway
- **目的**: API を Railway へデプロイ
- **必要なシークレット**:
  - `RAILWAY_TOKEN`: Railway API トークン
  - `RAILWAY_PROJECT_ID`: Railway プロジェクト ID

#### 2.3 deploy-vercel
- **目的**: UI を Vercel へデプロイ
- **必要なシークレット**:
  - `VERCEL_TOKEN`: Vercel API トークン
  - `VERCEL_ORG_ID`: Vercel 組織 ID
  - `VERCEL_PROJECT_ID`: Vercel プロジェクト ID

#### 2.4 e2e-production
- **目的**: 本番環境の E2E テスト
- **実行内容**:
  - Railway API ヘルスチェック
  - Vercel UI アクセス確認
  - `bash scripts/production-e2e-test.sh` 実行

#### 2.5 deployment-summary
- **目的**: デプロイ完了レポート
- **出力**: デプロイ成功時のリンク・次ステップ情報

---

## 3. セキュリティ・品質チェック（quality.yml）

### 実行トリガー

- PR 作成・更新時
- push 時（main/develop）
- **定期実行**: 毎日午前 2 時

### 実行ジョブ

#### 3.1 security-audit
- **目的**: npm 依存関係のセキュリティチェック
- **実行内容**: `npm audit --audit-level=moderate`

#### 3.2 code-quality
- **目的**: コード品質メトリクス
- **実行内容**:
  - TypeScript ファイル統計
  - テストカバレッジ確認

#### 3.3 env-validation
- **目的**: 環境変数テンプレート確認
- **確認項目**: .env.example または .env.template の存在

#### 3.4 documentation
- **目的**: ドキュメント完全性チェック
- **確認項目**: README.md, docs/API.md 存在確認

#### 3.5 commit-lint
- **目的**: コミットメッセージ形式確認
- **実行条件**: PR 作成時のみ

---

## セットアップ手順

### 前提条件

- GitHub リポジトリが設定済み
- Railway アカウント・Vercel アカウント設定済み

### ステップ 1: GitHub Secrets 設定

`Settings` → `Secrets and variables` → `Actions` で以下を追加：

#### Railway 用
```
RAILWAY_TOKEN: <Railway API トークン>
RAILWAY_PROJECT_ID: <Railway プロジェクト ID>
```

#### Vercel 用
```
VERCEL_TOKEN: <Vercel API トークン>
VERCEL_ORG_ID: <Vercel 組織 ID>
VERCEL_PROJECT_ID: <Vercel プロジェクト ID>
```

### ステップ 2: リポジトリ環境設定

`Settings` → `Environments` で以下を作成：

#### 開発環境
```
Name: development
Protection rules: None
```

#### 本番 API 環境
```
Name: production-api
Protection rules: 
  - Require approval from specific people
  - （オプション：管理者の承認が必要）
```

#### 本番 UI 環境
```
Name: production-ui
Protection rules:
  - Require approval from specific people
  - （オプション：管理者の承認が必要）
```

### ステップ 3: branch protection ルール設定

`Settings` → `Branch protection rules` で main ブランチに以下を設定：

```
✅ Require a pull request before merging
✅ Require status checks to pass before merging
   - Select: All CI checks (lint-and-build, test, e2e-local, build)
✅ Require branches to be up to date before merging
✅ Include administrators
```

---

## ワークフロー実行例

### 例 1: PR 作成時の自動実行

```bash
# feature ブランチで作業
git checkout -b feature/my-feature

# 変更をコミット
git add .
git commit -m "feat: 新機能を追加"

# push
git push origin feature/my-feature

# GitHub で PR 作成
```

**自動実行**: CI パイプラインが実行
- lint-and-build ✅
- test ✅
- e2e-local ✅
- build ✅

### 例 2: main ブランチへのマージ時の本番デプロイ

```bash
# PR をマージ
# → GitHub Actions で以下が自動実行

# 1. pre-deployment-checks
# 2. deploy-railway
# 3. deploy-vercel
# 4. e2e-production
# 5. deployment-summary
```

### 例 3: 手動での本番デプロイ

`Actions` → `Production Deployment` → `Run workflow` で：

```
Branch: main
Environment: railway-api / vercel-ui / both
```

---

## トラブルシューティング

### ビルド失敗時

1. **TypeScript コンパイルエラー**
   ```bash
   npx tsc --noEmit
   ```
   ローカルで確認してから push

2. **テスト失敗**
   ```bash
   npm test
   ```
   ローカルで全テスト実行確認

### デプロイ失敗時

1. **Railway デプロイ失敗**
   - RAILWAY_TOKEN の有効期限確認
   - Railway コンソールでログ確認

2. **Vercel デプロイ失敗**
   - VERCEL_TOKEN の権限確認
   - Vercel プロジェクト設定確認

3. **本番 E2E テスト失敗**
   - `scripts/production-e2e-test.sh` をローカルで実行
   - API / UI 両方のヘルスチェック確認

---

## ベストプラクティス

### コミットメッセージ

推奨形式:
```
feat: 新機能説明
fix: バグ修正説明
docs: ドキュメント更新
test: テスト追加・修正
refactor: コードリファクタリング
```

### PR レビュー前の確認

```bash
# ローカルで CI パイプラインの内容を確認
npm run lint
npm test
npm run build
API_URL=http://localhost:3100 bash scripts/local-e2e-test.sh
```

### 本番デプロイの確認チェック

1. ✅ すべての PR が main にマージ済み
2. ✅ CI パイプライン完了
3. ✅ データベース migration 確認
4. ✅ 環境変数 (Railway/Vercel) 設定確認
5. ✅ ロールバック計画立案

---

## 実行時間の目安

| ワークフロー | 平均実行時間 | 最大時間 |
|-----------|-----------|--------|
| CI (全ジョブ) | 3-5 分 | 10 分 |
| 本番デプロイ | 5-10 分 | 20 分 |
| 品質チェック | 2-3 分 | 5 分 |

---

## モニタリング

### GitHub UI でのモニタリング

1. `Actions` タブでワークフロー実行状況確認
2. 各ジョブの詳細ログ確認
3. デプロイ失敗時は自動でアラート

### Slack 連携（オプション）

GitHub Apps → Slack で設定可能：
- PR レビュー要求通知
- デプロイ失敗通知
- セキュリティアラート

---

## 関連ドキュメント

- [README.md](../README.md) - プロジェクト概要
- [AGENTS.md](../AGENTS.md) - AI エージェント指示書
- [docs/API.md](../docs/API.md) - API ドキュメント
- [scripts/local-e2e-test.sh](../scripts/local-e2e-test.sh) - ローカル E2E テスト
- [scripts/production-e2e-test.sh](../scripts/production-e2e-test.sh) - 本番 E2E テスト
