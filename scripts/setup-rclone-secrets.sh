#!/bin/bash

# rclone.conf を生成して GitHub Secrets に登録するスクリプト
# 使用方法: ./scripts/setup-rclone-secrets.sh

set -e

CONFIG_DIR="$HOME/.config/tradeassist-drive-sync"
CLIENT_FILE="$CONFIG_DIR/oauth-client.json"
TOKEN_FILE="$CONFIG_DIR/drive-token.json"
RCLONE_CONF_FILE="$CONFIG_DIR/rclone.conf"

# 必要に応じて手動指定（環境変数があれば優先）
REPO_OWNER="${REPO_OWNER:-}"
REPO_NAME="${REPO_NAME:-}"

if ! command -v gh &> /dev/null; then
  echo "❌ GitHub CLI (gh) がインストールされていません"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  echo "❌ GitHub CLI にログインしていません"
  echo "   gh auth login を実行してください"
  exit 1
fi

if [ ! -f "$CLIENT_FILE" ] || [ ! -f "$TOKEN_FILE" ]; then
  echo "❌ OAuth情報が不足しています。setup-oauth-credentials.sh と get-oauth-refresh-token.sh を先に実行してください。"
  exit 1
fi

if [ -z "$REPO_OWNER" ] || [ -z "$REPO_NAME" ]; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
  if [[ "$REMOTE_URL" =~ github.com[:/](.+)/(.+)(\.git)?$ ]]; then
    REPO_OWNER="${BASH_REMATCH[1]}"
    REPO_NAME="${BASH_REMATCH[2]}"
  fi
fi

if [ -z "$REPO_OWNER" ] || [ -z "$REPO_NAME" ]; then
  echo "❌ リポジトリ情報を取得できません。REPO_OWNER/REPO_NAME を設定してください。"
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

TOKEN_JSON=$(python3 - "$TOKEN_FILE" <<'PY'
import json, sys
path = sys.argv[1]
text = open(path, 'r', encoding='utf-8').read().strip()

def extract_json(s: str) -> str:
  start = s.find('{')
  end = s.rfind('}')
  if start == -1 or end == -1 or end < start:
    raise SystemExit('トークンJSONが見つかりません')
  return s[start:end+1]

try:
  obj = json.loads(text)
except json.JSONDecodeError:
  obj = json.loads(extract_json(text))

print(json.dumps(obj, ensure_ascii=False))
PY
)

cat > "$RCLONE_CONF_FILE" <<EOF
[gdrive]
type = drive
client_id = $CLIENT_ID
client_secret = $CLIENT_SECRET
token = $TOKEN_JSON
EOF

chmod 600 "$RCLONE_CONF_FILE"

RCLONE_CONF_BASE64=$(base64 < "$RCLONE_CONF_FILE" | tr -d '\n')

echo "$RCLONE_CONF_BASE64" | gh secret set RCLONE_CONF --repo "$REPO_OWNER/$REPO_NAME"

echo "📂 Google Drive フォルダIDを入力してください"
read -p "Folder ID: " GOOGLE_DRIVE_FOLDER_ID

if [ -z "$GOOGLE_DRIVE_FOLDER_ID" ]; then
  echo "❌ フォルダIDが未入力です"
  exit 1
fi

echo "$GOOGLE_DRIVE_FOLDER_ID" | gh secret set GOOGLE_DRIVE_FOLDER_ID --repo "$REPO_OWNER/$REPO_NAME"

echo "✅ Secrets 登録完了: $REPO_OWNER/$REPO_NAME"
