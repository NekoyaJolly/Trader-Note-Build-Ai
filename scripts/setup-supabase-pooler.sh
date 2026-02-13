#!/usr/bin/env bash
# Supabase Transaction モード（プーラー）で DATABASE_URL を更新するスクリプト
# 前提: DIRECT_URL が Supabase 直接接続（5432）を指していること

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-ai-note-486020}"

echo "[Supabase Pooler] DIRECT_URL からプーラー用 DATABASE_URL を生成します..."

# DIRECT_URL を取得（postgresql://user:pass@host:5432/db 形式）
DIRECT_URL=$(gcloud secrets versions access latest --secret=DIRECT_URL --project="$PROJECT_ID" 2>/dev/null) || {
  echo "エラー: DIRECT_URL シークレットを取得できません"
  exit 1
}

# 形式チェック（Supabase の db.xxx.supabase.co であること）
if ! echo "$DIRECT_URL" | grep -q 'supabase\.co'; then
  echo "警告: DIRECT_URL が Supabase 形式ではありません: $(echo "$DIRECT_URL" | sed 's/:[^:@]*@/:***@/g')"
  echo "Supabase の場合は続行します。それ以外の DB の場合は中断してください。"
  read -r -p "続行しますか？ (y/N): " ans
  [[ "${ans,,}" != "y" ]] && exit 1
fi

# 5432 → 6543 に置換し、?pgbouncer=true を付与
POOLER_URL=$(echo "$DIRECT_URL" | sed 's/:5432\//:6543\//')
case "$POOLER_URL" in
  *\?) POOLER_URL="${POOLER_URL}&pgbouncer=true" ;;
  *)   POOLER_URL="${POOLER_URL}?pgbouncer=true" ;;
esac

echo "[Supabase Pooler] 生成した DATABASE_URL (マスク済み): $(echo "$POOLER_URL" | sed 's/:[^:@]*@/:***@/g')"

# DATABASE_URL シークレットの新バージョンを作成
echo -n "$POOLER_URL" | gcloud secrets versions add DATABASE_URL \
  --data-file=- \
  --project="$PROJECT_ID"

echo "[Supabase Pooler] DATABASE_URL シークレットを更新しました。"
echo "Cloud Run サービスを再デプロイして反映してください:"
echo "  gcloud run services update trader-note --region asia-northeast1 --project $PROJECT_ID --update-secrets DATABASE_URL=DATABASE_URL:latest"
