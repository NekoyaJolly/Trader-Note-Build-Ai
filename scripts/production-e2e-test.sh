#!/bin/bash

# 本番 E2E テストスクリプト
# 目的: 本番環境（GCP Cloud Run 統合）で API → DB → UI フローが正常に動作することを検証
#
# 実行手順:
# 1. GCP Cloud Run と Vercel にデプロイ済みであることを確認
# 2. 環境変数 PRODUCTION_API_URL, PRODUCTION_UI_URL を設定
# 3. bash scripts/production-e2e-test.sh

# 設定
PRODUCTION_API_URL="${PRODUCTION_API_URL:-https://trader-note-571157808050.asia-northeast1.run.app}"
PRODUCTION_UI_URL="${PRODUCTION_UI_URL:-https://trader-note-build-ai.vercel.app}"


# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}================================${NC}"
echo -e "${YELLOW}本番 E2E テスト開始${NC}"
echo -e "${YELLOW}================================${NC}"
echo ""
echo "API URL: $PRODUCTION_API_URL"
echo "UI URL: $PRODUCTION_UI_URL"
echo ""

# テスト結果を記録
TESTS_PASSED=0
TESTS_FAILED=0

# ヘルパー関数
test_endpoint() {
  local name=$1
  local method=$2
  local endpoint=$3
  local expected_status=$4
  local body=$5

  echo -n "テスト: $name ... "

  if [ -z "$body" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$PRODUCTION_API_URL$endpoint" 2>&1)
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$PRODUCTION_API_URL$endpoint" \
      -H "Content-Type: application/json" \
      -d "$body" 2>&1)
  fi

  http_code=$(echo "$response" | tail -1)
  response_body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "$expected_status" ]; then
    echo -e "${GREEN}✓ (HTTP $http_code)${NC}"
    ((TESTS_PASSED++))
  else
    echo -e "${RED}✗ (期待: HTTP $expected_status, 実際: HTTP $http_code)${NC}"
    echo "レスポンス: $response_body"
    ((TESTS_FAILED++))
  fi
}

# =========================================
# API 疎通テスト
# =========================================
echo -e "${YELLOW}[1] API 疎通テスト${NC}"
echo ""

# ヘルスチェックは Cloud Run コールドスタートが完了するまで 503 を返すことがあるため、
# 短いバックオフでリトライしてからテスト判定する。最大 6 回 (= 約 30 秒) 待つ。
# 後続テストはこれが通った時点でウォーム済み前提のため retry なしで OK。
#
# curl の堅さ:
#   - body と http_code を別ファイルに分けることで、stderr 混入や順序崩れに耐える
#   - --max-time でハング防止 (10 秒)
#   - curl の終了コード非 0 (= 接続失敗 / タイムアウト) は HTTP 000 として扱い、リトライ継続
echo -n "テスト: ヘルスチェック (cold-start 対応リトライ) ... "
HEALTH_OK=0
HEALTH_LAST_CODE=""
HEALTH_LAST_BODY=""
HEALTH_BODY_FILE=$(mktemp)
trap 'rm -f "$HEALTH_BODY_FILE"' EXIT
for attempt in 1 2 3 4 5 6; do
  HEALTH_LAST_CODE=$(curl -s --max-time 10 -o "$HEALTH_BODY_FILE" -w "%{http_code}" \
    -X GET "$PRODUCTION_API_URL/health" 2>/dev/null)
  curl_exit=$?
  if [ "$curl_exit" -ne 0 ]; then
    HEALTH_LAST_CODE="000"
  fi
  HEALTH_LAST_BODY=$(cat "$HEALTH_BODY_FILE" 2>/dev/null || echo '')
  if [ "$HEALTH_LAST_CODE" = "200" ]; then
    HEALTH_OK=1
    break
  fi
  sleep 5
done
if [ $HEALTH_OK -eq 1 ]; then
  echo -e "${GREEN}✓ (HTTP 200, ${attempt}/6 試行で成功)${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${RED}✗ (期待: HTTP 200, 実際: HTTP ${HEALTH_LAST_CODE} after 6 retries)${NC}"
  echo "レスポンス: $HEALTH_LAST_BODY"
  ((TESTS_FAILED++))
fi
test_endpoint "Ready チェック" "GET" "/ready" "200"

echo ""

# =========================================
# 認証境界テスト
# =========================================
echo -e "${YELLOW}[2] 認証境界テスト${NC}"
echo ""

test_endpoint "ノート一覧は未認証で拒否" "GET" "/api/trades/notes" "401"
test_endpoint "通知一覧は未認証で拒否" "GET" "/api/notifications" "401"
test_endpoint "マッチング実行は未認証で拒否" "POST" "/api/matching/check" "401"

echo ""

# =========================================
# Webhook 境界テスト
# =========================================
echo -e "${YELLOW}[3] Webhook 境界テスト${NC}"
echo ""

test_endpoint "mail webhook は token なしで拒否" "POST" "/api/mail/receive" "401" '{"from":"smoke@example.com","subject":"smoke","text":"ACTION: STOP"}'

echo ""

# =========================================
# Cron 境界テスト
# =========================================
echo -e "${YELLOW}[4] Cron 境界テスト${NC}"
echo ""

test_endpoint "cron は secret なしで拒否" "GET" "/api/cron/matching-pipeline" "401"

echo ""

# =========================================
# 存在しない公開ルート
# =========================================
echo -e "${YELLOW}[5] 存在しない公開ルート${NC}"
echo ""

test_endpoint "存在しないルートは404" "GET" "/api/not-found-smoke" "404"

echo ""

# =========================================
# フロントエンド配信テスト（Vercel）
# =========================================
echo -e "${YELLOW}[6] フロントエンド配信テスト (Vercel)${NC}"
echo ""

# Vercel UI URL にアクセスして HTML が返ることを確認
echo -n "テスト: フロントエンド HTML 配信 ... "
UI_RESPONSE=$(curl -s -w "\n%{http_code}" "$PRODUCTION_UI_URL/" 2>&1)
UI_STATUS=$(echo "$UI_RESPONSE" | tail -1)
UI_BODY=$(echo "$UI_RESPONSE" | sed '$d')

if [ "$UI_STATUS" = "200" ] && echo "$UI_BODY" | grep -iq "html"; then
  echo -e "${GREEN}✓ (HTTP $UI_STATUS, HTML確認 - $PRODUCTION_UI_URL)${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${RED}✗ (HTTP $UI_STATUS, HTMLなし - UI URL: $PRODUCTION_UI_URL)${NC}"
  ((TESTS_FAILED++))
fi

echo ""

# =========================================
# テスト結果サマリー
# =========================================
echo -e "${YELLOW}================================${NC}"
echo -e "${YELLOW}テスト結果${NC}"
echo -e "${YELLOW}================================${NC}"
echo -e "合格: ${GREEN}$TESTS_PASSED${NC}"
echo -e "失敗: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ すべてのテストが合格しました${NC}"
  exit 0
else
  echo -e "${RED}❌ $TESTS_FAILED 個のテストが失敗しました${NC}"
  exit 1
fi
