# GCP デプロイ クイックスタート

> **前提**: gcloud CLI が設定済みで、Secret Manager に必要な環境変数が登録済み

---

## 1. イメージビルド

```
gcloud builds submit --tag gcr.io/<PROJECT_ID>/trader-note:latest . --timeout=30m
```

---

## 2. Cloud Run Job 作成

```
./scripts/cloud-run-job-deploy.ps1
```

---

## 3. マイグレーション実行

```
gcloud run jobs execute trader-note-migrate --region <REGION> --project <PROJECT_ID>
```

---

## 4. Cloud Run Service デプロイ

```
gcloud run deploy trader-note \
  --image gcr.io/<PROJECT_ID>/trader-note:latest \
  --region <REGION> \
  --set-cloudsql-instances <PROJECT_ID>:<REGION>:<INSTANCE> \
  --service-account <SERVICE_ACCOUNT> \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 10 \
  --min-instances 1 \
  --no-cpu-throttling \
  --allow-unauthenticated \
  --update-secrets=DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,CTRADER_CLIENT_ID=CTRADER_CLIENT_ID:latest,CTRADER_CLIENT_SECRET=CTRADER_CLIENT_SECRET:latest,OAUTH_ENCRYPTION_KEY=OAUTH_ENCRYPTION_KEY:latest,VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest,NEXTAUTH_SECRET=NEXTAUTH_SECRET:latest,NEXT_PUBLIC_API_URL=NEXT_PUBLIC_API_URL:latest,FRONTEND_URL=FRONTEND_URL:latest
```

---

## 5. 動作確認

```
curl https://<SERVICE_URL>/health
```

---

## 注意
- 本番では `migrate deploy` を Cloud Run Job で実行
- Service 起動時にマイグレーションは実行しない
