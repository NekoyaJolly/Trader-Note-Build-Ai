#!/bin/bash
# CSVアップロード→Draftノート生成のE2E検証スクリプト

API_BASE="http://localhost:3100"
CSV_FILE="data/trades/sample_trades.csv"

echo "=== E2E検証開始 ==="
echo ""

# 1. ヘルスチェック
echo "[1] ヘルスチェック"
curl -s "${API_BASE}/health" | python3 -m json.tool
echo ""

# 2. CSV読み込み
if [ ! -f "$CSV_FILE" ]; then
  echo "エラー: ${CSV_FILE} が見つかりません"
  exit 1
fi

CSV_CONTENT=$(cat "$CSV_FILE")
echo "[2] CSV読み込み完了 ($(echo "$CSV_CONTENT" | wc -l) 行)"
echo ""

# 3. アップロード→ノート生成
echo "[3] CSV アップロード→ノート生成"
UPLOAD_RESPONSE=$(curl -s -X POST "${API_BASE}/api/trades/import/upload-text" \
  -H "Content-Type: application/json" \
  -d "{\"filename\":\"sample_trades.csv\",\"csvText\":$(echo "$CSV_CONTENT" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))')}")

echo "$UPLOAD_RESPONSE" | python3 -m json.tool
echo ""

# noteIds を抽出
NOTE_ID=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('noteIds', [])[0] if data.get('noteIds') else '')")

if [ -z "$NOTE_ID" ]; then
  echo "警告: noteIds が空です。処理を終了します。"
  exit 0
fi

echo "生成されたノートID: $NOTE_ID"
echo ""

# 4. ノート詳細取得
echo "[4] ノート詳細取得"
curl -s "${API_BASE}/api/trades/notes/${NOTE_ID}" | python3 -m json.tool
echo ""

# 5. ノート承認
echo "[5] ノート承認"
curl -s -X POST "${API_BASE}/api/trades/notes/${NOTE_ID}/approve" | python3 -m json.tool
echo ""

echo "=== E2E検証完了 ==="
