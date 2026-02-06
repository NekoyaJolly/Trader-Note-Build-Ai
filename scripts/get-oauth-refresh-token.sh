#!/bin/bash

# OAuth リフレッシュトークンを取得するスクリプト
# 使用方法: ./scripts/get-oauth-refresh-token.sh

set -e

CONFIG_DIR="$HOME/.config/tradeassist-drive-sync"
CLIENT_FILE="$CONFIG_DIR/oauth-client.json"
TOKEN_FILE="$CONFIG_DIR/drive-token.json"

if [ ! -f "$CLIENT_FILE" ]; then
  echo "❌ OAuth クライアント情報がありません。先に setup-oauth-credentials.sh を実行してください。"
  exit 1
fi

CLIENT_ID=$(python3 - "$CLIENT_FILE" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
  data = json.load(f)
print(data["client_id"])
PY
)

CLIENT_SECRET=$(python3 - "$CLIENT_FILE" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
  data = json.load(f)
print(data["client_secret"])
PY
)

echo "🌐 ブラウザ認証を開始します..."
rclone authorize "drive" "$CLIENT_ID" "$CLIENT_SECRET" > "$TOKEN_FILE"

if [ ! -s "$TOKEN_FILE" ]; then
  echo "❌ トークン取得に失敗しました（空のレスポンス）"
  exit 1
fi
chmod 600 "$TOKEN_FILE"

REFRESH_TOKEN=$(python3 - "$TOKEN_FILE" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
  data = json.load(f)
print(data.get("refresh_token", ""))
PY
)

if [ -z "$REFRESH_TOKEN" ]; then
  echo "❌ リフレッシュトークンが取得できませんでした"
  exit 1
fi

echo "✅ リフレッシュトークン取得完了"
