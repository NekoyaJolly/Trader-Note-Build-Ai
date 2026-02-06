#!/bin/bash

# Google Drive フォルダURLからIDを抽出するスクリプト
# 使用方法: ./scripts/get-drive-folder-id.sh "https://drive.google.com/drive/folders/XXXX"

set -e

INPUT="$1"
if [ -z "$INPUT" ]; then
  read -p "Google Drive フォルダURLまたはIDを入力: " INPUT
fi

FOLDER_ID=$(python3 - <<'PY'
import re, sys
text = sys.argv[1]
# URL形式
m = re.search(r"/folders/([a-zA-Z0-9_-]+)", text)
if m:
    print(m.group(1))
    sys.exit(0)
# パラメータ形式 id=...
m = re.search(r"id=([a-zA-Z0-9_-]+)", text)
if m:
    print(m.group(1))
    sys.exit(0)
# そのままIDとして扱う
print(text)
PY
"$INPUT")

if [ -z "$FOLDER_ID" ]; then
  echo "❌ フォルダIDを抽出できませんでした"
  exit 1
fi

echo "✅ Folder ID: $FOLDER_ID"
