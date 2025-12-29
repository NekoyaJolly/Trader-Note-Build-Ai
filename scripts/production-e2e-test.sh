#!/bin/bash

# 本番 E2E テストスクリプト
# 目的: 本番環境（Railway + Vercel）で API → DB → UI フローが正常に動作することを検証
#
# 実行手順:
# 1. Railway と Vercel にデプロイ済みであることを確認
# 2. 環境変数 PRODUCTION_API_URL, PRODUCTION_UI_URL を設定
# 3. bash scripts/production-e2e-test.sh

# 設定
PRODUCTION_API_URL="${PRODUCTION_API_URL:-https://trader-note-api.up.railway.app}"
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

test_endpoint "ヘルスチェック" "GET" "/health" "200"

echo ""

# =========================================
# トレードノートエンドポイントテスト
# =========================================
echo -e "${YELLOW}[2] トレードノートエンドポイントテスト${NC}"
echo ""

test_endpoint "ノート一覧取得" "GET" "/api/trades/notes" "200"

echo ""

# =========================================
# マッチングエンドポイントテスト
# =========================================
echo -e "${YELLOW}[3] マッチングエンドポイントテスト${NC}"
echo ""

test_endpoint "マッチング実行" "POST" "/api/matching/check" "200"
test_endpoint "マッチング履歴取得" "GET" "/api/matching/history" "200"

echo ""

# =========================================
# 通知エンドポイントテスト
# =========================================
echo -e "${YELLOW}[4] 通知エンドポイントテスト${NC}"
echo ""

test_endpoint "通知一覧取得" "GET" "/api/notifications" "200"

echo ""

# =========================================
# BarLocator エンドポイントテスト
# =========================================
echo -e "${YELLOW}[5] BarLocator エンドポイントテスト${NC}"
echo ""

test_endpoint "BarLocator (POST)" "POST" "/api/bars/locate" "400" '{}'
test_endpoint "BarLocator (GET - 無効パラメータ)" "GET" "/api/bars/locate/INVALID/INVALID/INVALID" "400"

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
