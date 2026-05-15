# GCP デプロイ完了レポート

> **完了日時**: 2026年2月2日  
> **対象**: TradeAssist バックエンド API  
> **デプロイ先**: Google Cloud Run (asia-northeast1)

---

## ✅ デプロイ成功

### サービス情報

- **Service URL**: https://trader-note-571157808050.asia-northeast1.run.app
- **リージョン**: asia-northeast1 (東京)
- **イメージ**: gcr.io/ai-note-486020/trader-note:latest
- **リビジョン**: trader-note-00015-jd8
- **ステータス**: ✅ Running (100% traffic)

### ヘルスチェック結果

```json
{
  "status": "ok",
  "timestamp": "2026-02-02T13:18:32.531Z",
  "schedulerRunning": false
}
```

---

## 📋 実施した作業

### 1. Prisma 環境整備
- Prisma 6.19.2 に統一（7.x を回避）
- `npm install` で依存関係を再インストール
- マイグレーションファイルを確認（22 migrations）

### 2. Dockerfile 作成
- **特徴**:
  - 2段階ビルド（builder / runtime）
  - フロントエンド依存関係を事前インストール
  - `prisma/` ディレクトリを同梱
  - マイグレーションは Cloud Run Job に分離

### 3. Cloud Build
- コンテナイメージをビルド
- サイズ: 圧縮後 3.2MB
- ビルド時間: 約3分

### 4. Cloud Run Job（マイグレーション）
- Job名: `trader-note-migrate`
- コマンド: `npx prisma migrate deploy`
- 実行結果: **成功** (No pending migrations)
- 既存マイグレーション: 22件

### 5. Database 認証修正
- Secret Manager の `DATABASE_PASSWORD` を取得
- Cloud SQL ユーザー `tradeassist_user` のパスワードを更新
- `DATABASE_URL` シークレットを正しい形式で再生成

### 6. Cloud Run Service デプロイ
- **設定**:
  - メモリ: 2Gi
  - CPU: 2
  - タイムアウト: 3600秒
  - 最小インスタンス: 0（コスト最適化）
  - 最大インスタンス: 10
  - 認証: 不要（--allow-unauthenticated）

- **環境変数**:
  ```
  NODE_ENV=production
  MARKET_API_URL=https://api.twelvedata.com
  ```

- **シークレット（Secret Manager 連携）**:
  - DATABASE_URL
  - JWT_SECRET
  - JWT_REFRESH_SECRET
  - CTRADER_CLIENT_ID
  - CTRADER_CLIENT_SECRET
  - CTRADER_REDIRECT_URI
  - VAPID_PUBLIC_KEY
  - VAPID_PRIVATE_KEY
  - AI_API_KEY
  - MARKET_API_KEY (TWELVE_DATA_API_KEY)
  - CRON_SECRET

---

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────┐
│  Cloud Run Service (FE + BE 統合)       │
│ https://trader-note-...run.app          │
│  - Express API サーバー (/api/*)         │
│  - Next.js standalone (UI: /*)           │
│  - Node.js 22 Alpine                     │
│  - Prisma Client 6.19.2                  │
│  - NODE_ENV=production                   │
└─────────────────┬───────────────────────┘
                  │ Supabase Connection Pooler
                  ▼
┌─────────────────────────────────────────┐
│       Supabase PostgreSQL               │
│  - Database: postgres                    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Cloud Run Job (マイグレーション専用)    │
│  trader-note-migrate                    │
│  - 実行: npx prisma migrate deploy      │
│  - トリガー: 手動実行                    │
└─────────────────────────────────────────┘
```

---

## 📂 作成したファイル

| ファイル | 説明 |
|---------|------|
| [Dockerfile](Dockerfile) | コンテナイメージ定義 |
| [scripts/cloud-run-job-deploy.ps1](scripts/cloud-run-job-deploy.ps1) | Job 作成スクリプト (PowerShell) |
| [scripts/cloud-run-job-deploy.sh](scripts/cloud-run-job-deploy.sh) | Job 作成スクリプト (Bash) |
| [docs/GCP_PRISMA_BEST_PRACTICES.md](docs/GCP_PRISMA_BEST_PRACTICES.md) | ベストプラクティス概要 |
| [QUICKSTART_GCP_DEPLOYMENT.md](QUICKSTART_GCP_DEPLOYMENT.md) | デプロイ手順書 |
| [docs/IMPLEMENTATION_REPORT_GCP_BEST_PRACTICES.md](docs/IMPLEMENTATION_REPORT_GCP_BEST_PRACTICES.md) | 実装レポート |

---

## 🔐 セキュリティ

- サービスアカウント: `cloud-run-trader-note@ai-note-486020.iam.gserviceaccount.com`
- 権限:
  - `roles/cloudsql.client` - Cloud SQL 接続
  - `roles/logging.logWriter` - ログ出力
  - `roles/secretmanager.secretAccessor` - シークレット読み取り
- Cloud SQL 接続: Unix Socket（/cloudsql/...）
- 認証情報: Secret Manager で一元管理

---

## 💰 コスト最適化

- **最小インスタンス: 0**
  - リクエストがない時はインスタンス停止
  - コールドスタート時に数秒の遅延あり
- **最大インスタンス: 10**
  - 高負荷時の自動スケーリング上限
- **CPU: 2, メモリ: 2Gi**
  - バックエンド処理に十分なリソース

---

## 📝 運用手順

### スキーマ更新時

1. **ローカルでマイグレーション作成**
   ```bash
   npx prisma migrate dev --name <migration_name>
   ```

2. **Git commit & push**
   ```bash
   git add prisma/migrations
   git commit -m "feat: DBスキーマ更新"
   git push
   ```

3. **イメージ再ビルド**
   ```bash
   gcloud builds submit --tag gcr.io/ai-note-486020/trader-note:latest .
   ```

4. **マイグレーション適用**
   ```bash
   gcloud run jobs execute trader-note-migrate --region asia-northeast1
   ```

5. **サービス再デプロイ**
   ```bash
   gcloud run deploy trader-note --image gcr.io/ai-note-486020/trader-note:latest --region asia-northeast1
   ```

### ログ確認

```bash
# Service ログ
gcloud run services logs read trader-note --region asia-northeast1 --limit 50

# Job ログ
gcloud run jobs executions list trader-note-migrate --region asia-northeast1
```

### 環境変数追加

```bash
# Secret Manager に追加
echo -n "secret-value" | gcloud secrets create NEW_SECRET --data-file=- --project ai-note-486020

# Service に紐付け
gcloud run services update trader-note --region asia-northeast1 --update-secrets "NEW_ENV_VAR=NEW_SECRET:latest"
```

---

## 🎯 次のステップ

### 1. cTrader OAuth Redirect URI 更新

cTrader アプリ設定で Redirect URI を Cloud Run URL に更新:

```
https://trader-note-571157808050.asia-northeast1.run.app/auth/ctrader/callback
```

### 2. モニタリング設定

- Cloud Monitoring でアラート設定
- Error Reporting の有効化
- Uptime Check の設定

---

## ⚠️ 注意事項

### Prisma バージョン
- **必ず 6.19.2 を使用**
- 7.x にアップグレードしない（`datasource.url` プロパティが廃止）

### マイグレーション
- Service 起動時にマイグレーション実行しない
- Cloud Run Job で分離実行

### フロントエンド
- Cloud Run で Next.js standalone として統合ホスティング
- `NODE_ENV=production` が必須（Dockerfile および Cloud Run で設定）

---

## 📚 参考資料

- [Prisma Deploy to production](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-production)
- [Google Cloud: Running database migrations with Cloud Run Jobs](https://cloud.google.com/blog/topics/developers-practitioners/running-database-migrations-cloud-run-jobs/)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)

---

**ステータス**: ✅ デプロイ完了・稼働中  
**最終更新**: 2026年2月2日 22:18 JST
