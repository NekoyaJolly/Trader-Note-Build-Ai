#!/bin/bash
# Railway CLI で DATABASE_URL を設定するスクリプト

# PostgreSQL SERVICE_ID
POSTGRES_SERVICE_ID="26ca62ed-2722-4236-bfab-151db1d8e6b5"

# Node.js SERVICE_ID（これを見つける必要がある）
# railway service list で確認

# PostgreSQL の DATABASE_URL（外部接続用）
DB_URL="postgresql://postgres:YJtRQLNgBFxGopFxRHMCZURURdxIwWrN@switchyard.proxy.rlwy.net:32154/railway?sslmode=require"

# Node.js サービスに DATABASE_URL を設定
# railway variables set DATABASE_URL "$DB_URL" --service <NODE_SERVICE_ID>

echo "データベース接続文字列:"
echo "$DB_URL"
echo ""
echo "上記の値を Railway ダッシュボードの Node.js サービスの DATABASE_URL に設定してください"
