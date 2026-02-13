#!/usr/bin/env bash
set -euo pipefail

# Cloud Run Job を作成/更新するスクリプト
# 目的: 本番DBマイグレーションを Cloud Run Job に分離

PROJECT_ID="${PROJECT_ID:-ai-note-486020}"
REGION="${REGION:-asia-northeast1}"
IMAGE="${IMAGE:-gcr.io/ai-note-486020/trader-note:latest}"
JOB_NAME="${JOB_NAME:-trader-note-migrate}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-cloud-run-trader-note@ai-note-486020.iam.gserviceaccount.com}"
# Cloud SQL 利用時のみ: --set-cloudsql-instances "$CLOUDSQL_INSTANCE" を追加
# CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-ai-note-486020:asia-northeast1:trader-note-postgres}"

printf "[Cloud Run Job] 作成/更新を開始します: %s\n" "$JOB_NAME"

if gcloud run jobs describe "$JOB_NAME" --region "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  printf "既存Jobを削除します...\n"
  gcloud run jobs delete "$JOB_NAME" --region "$REGION" --project "$PROJECT_ID" --quiet
fi

# Job 作成
# - DATABASE_URL: アプリ用（Supabase プーラーまたは直接）
# - DIRECT_URL: マイグレーション用に必須（直接接続、Prisma が migrate deploy で使用）
# - Supabase 利用時は --set-cloudsql-instances は不要（接続先が Supabase のため）
gcloud run jobs create "$JOB_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --command npx \
  --args prisma \
  --args migrate \
  --args deploy \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  --set-secrets "DIRECT_URL=DIRECT_URL:latest" \
  --service-account "$SERVICE_ACCOUNT" \
  --memory 2Gi \
  --cpu 2 \
  --task-timeout 3600

printf "Job 作成完了: %s\n" "$JOB_NAME"
printf "次のコマンドで Job を実行してください:\n"
printf "gcloud run jobs execute %s --region %s --project %s\n" "$JOB_NAME" "$REGION" "$PROJECT_ID"
