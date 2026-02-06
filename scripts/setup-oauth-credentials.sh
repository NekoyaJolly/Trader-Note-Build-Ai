#!/bin/bash

# GCP OAuth クライアント情報を保存するスクリプト
# 使用方法: ./scripts/setup-oauth-credentials.sh /path/to/client_secret.json

set -e

CONFIG_DIR="$HOME/.config/tradeassist-drive-sync"
CLIENT_FILE="$CONFIG_DIR/oauth-client.json"

INPUT_PATH="$1"
if [ -z "$INPUT_PATH" ]; then
  read -p "OAuth クライアントJSONのパスを入力してください: " INPUT_PATH
fi

if [ ! -f "$INPUT_PATH" ]; then
  echo "❌ ファイルが見つかりません: $INPUT_PATH"
  exit 1
fi

mkdir -p "$CONFIG_DIR"

# JSONから client_id / client_secret を抽出して保存
python3 - "$INPUT_PATH" "$CLIENT_FILE" <<'PY'
import json, sys
input_path = sys.argv[1]
output_path = sys.argv[2]
with open(input_path, 'r', encoding='utf-8') as f:
  data = json.load(f)
client = data.get('installed') or data.get('web')
if not client:
  raise SystemExit('OAuth クライアント情報が見つかりません')
payload = {
  "client_id": client.get("client_id", ""),
  "client_secret": client.get("client_secret", "")
}
with open(output_path, 'w', encoding='utf-8') as f:
  json.dump(payload, f, ensure_ascii=False, indent=2)
PY

chmod 600 "$CLIENT_FILE"

echo "✅ OAuth クライアント情報を保存しました: $CLIENT_FILE"
