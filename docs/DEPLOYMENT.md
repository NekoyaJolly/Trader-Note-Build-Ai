# Trader-Note-Build-Ai デプロイガイド

> GCP (Cloud Run) + Supabase 構成での本番デプロイ手順 + ベストプラクティス + DB 接続設定をまとめた窓口。

---

## 1. アーキテクチャ概要

```
開発 (ローカル)         → git push origin main
                          ↓
CI (.github/workflows)   → tests / lint / type-check
                          ↓
Cloud Build              → イメージビルド (prisma/ 同梱)
                          ↓
Cloud Run Job (migrate)  → prisma migrate deploy  ※マイグレーション差分があるときのみ
                          ↓
Cloud Run Service        → アプリ起動 (起動時 migrate は実行しない)
```

### Cloud Run 構成
| サービス | 役割 |
|---|---|
| `trader-note` | メイン API (Express) |
| `trader-note-analysis-engine` | Python FastAPI (Side-A backtest / Side-B research) |
| `trader-note-migrate` | Cloud Run Job — Prisma マイグレーション専用 |

リージョン: `asia-northeast1` (東京) / プロジェクト: `ai-note-486020`

---

## 2. クイックスタート (手動デプロイ)

> 通常は GitHub Actions (`.github/workflows/deploy.yml`) が main マージ時に自動デプロイする。
> 手動でやる必要がある場合のみ以下:

### 2.1 イメージビルド
```bash
gcloud builds submit \
  --tag gcr.io/<PROJECT_ID>/trader-note:latest . \
  --timeout=30m
```

### 2.2 Cloud Run Job 作成 (初回のみ)
```bash
./scripts/cloud-run-job-deploy.ps1
```

### 2.3 マイグレーション実行
```bash
gcloud run jobs execute trader-note-migrate \
  --region <REGION> \
  --project <PROJECT_ID>
```

### 2.4 Cloud Run Service デプロイ
```bash
gcloud run deploy trader-note \
  --image gcr.io/<PROJECT_ID>/trader-note:latest \
  --region <REGION> \
  --set-cloudsql-instances <PROJECT_ID>:<REGION>:<INSTANCE> \
  --service-account <SERVICE_ACCOUNT> \
  --memory 2Gi --cpu 2 \
  --timeout 3600 \
  --max-instances 10 --min-instances 1 \
  --no-cpu-throttling \
  --allow-unauthenticated \
  --update-secrets=DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,CTRADER_CLIENT_ID=CTRADER_CLIENT_ID:latest,CTRADER_CLIENT_SECRET=CTRADER_CLIENT_SECRET:latest,OAUTH_ENCRYPTION_KEY=OAUTH_ENCRYPTION_KEY:latest,VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest,NEXTAUTH_SECRET=NEXTAUTH_SECRET:latest,NEXT_PUBLIC_API_URL=NEXT_PUBLIC_API_URL:latest,FRONTEND_URL=FRONTEND_URL:latest
```

### 2.5 動作確認
```bash
curl https://<SERVICE_URL>/health
```

---

## 3. Prisma + GCP ベストプラクティス

### 推奨アーキテクチャ
| 役割 | コンポーネント | 理由 |
|---|---|---|
| 本番 migrate 実行 | **Cloud Run Job** (`trader-note-migrate`) | Prisma 公式が `migrate deploy` を Job で動かすことを推奨。複数インスタンス起動時の競合を回避 |
| アプリ実行 | **Cloud Run Service** (`trader-note`) | 起動時に migrate を呼ばない。`CMD` にもマイグレーションを含めない |
| DB | **Supabase Postgres** | §4 で Transaction モード (pgBouncer) を使う |

### NG パターン
- ❌ Service の起動時に `migrate deploy` を実行 (複数インスタンスでの競合 / 起動時間の浪費)
- ❌ ローカルから本番 DB へ直接マイグレーション

### Dockerfile のポイント
- `prisma/` ディレクトリを必ずイメージに同梱
- `CMD` (もしくは起動 entrypoint) にマイグレーションを含めない

### 環境変数の扱い
- 値は **Secret Manager に登録**
- Service / Job 側は `--update-secrets` / `--set-secrets` で参照

### 参考リンク
- Prisma: Deploy to production
- Google Cloud: Running database migrations with Cloud Run Jobs

---

## 4. Supabase Transaction モード (プーラー) 設定

Cloud Run の DB 接続枯渇対策。詳細は `docs/TROUBLESHOOTING.md §2` を参照。

### 接続文字列の対応
| 用途 | 接続先 | ポート | パラメータ |
|---|---|---|---|
| **アプリ実行** (`DATABASE_URL`) | Transaction モード | 6543 | `?pgbouncer=true` |
| **マイグレーション** (`DIRECT_URL`) | 直接接続 | 5432 | なし |

```
# DATABASE_URL
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:6543/postgres?pgbouncer=true

# DIRECT_URL
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

`?pgbouncer=true` は Prisma の prepared statements を無効化するために必須 (Transaction モード非対応のため)。

---

## 5. デプロイのよくある詰まりどころ

| 症状 | 一次切り分け | 詳細 |
|---|---|---|
| 起動直後にコンテナがクラッシュ | DB 接続枯渇 | §4 と `docs/TROUBLESHOOTING.md §2` |
| ログイン後に「認証エラー」 | DB 接続枯渇 or Redirect URI 不一致 | `docs/TROUBLESHOOTING.md §1` |
| Prisma migrate が失敗 | DIRECT_URL が直接接続 (5432) になっているか | §4 |
| `connect timeout` | Cloud Run の VPC connector / `--set-cloudsql-instances` | gcloud run service describe で設定確認 |
