#!/bin/bash

# ローカル E2E テストスクリプト
# 目的: 開発環境でローカルホストのサーバーに対して E2E テストを実行
#
# 実行手順:
# 1. npm run dev でサーバーを起動（別ターミナル）
# 2. bash scripts/local-e2e-test.sh

# 設定
API_URL="${API_URL:-http://localhost:3100}"
WAIT_TIME="${WAIT_TIME:-2}"

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}================================${NC}"
echo -e "${YELLOW}ローカル E2E テスト開始${NC}"
echo -e "${YELLOW}================================${NC}"
echo ""
echo "API URL: $API_URL"
echo ""

# サーバーの起動確認
echo "サーバーの起動確認中..."
for i in {1..30}; do
  if curl -s "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ サーバーが起動しています${NC}"
    break
  fi
  
  if [ $i -eq 30 ]; then
    echo -e "${RED}✗ サーバーが起動していません（タイムアウト）${NC}"
    exit 1
  fi
  
  echo "待機中... ($i/30)"
  sleep 1
done

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
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" 2>&1)
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" \
      -H "Content-Type: application/json" \
      -d "$body" 2>&1)
  fi

  # レスポンスを分割（最後の行が HTTP code）
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
sleep $WAIT_TIME

# =========================================
# トレードノートエンドポイントテスト
# =========================================
echo -e "${YELLOW}[2] トレードノートエンドポイントテスト${NC}"
echo ""

test_endpoint "ノート一覧取得（空でも OK）" "GET" "/api/trades/notes" "200"

echo ""
sleep $WAIT_TIME

# =========================================
# マッチングエンドポイントテスト
# =========================================
echo -e "${YELLOW}[3] マッチングエンドポイントテスト${NC}"
echo ""

test_endpoint "マッチング実行（結果は空でも OK）" "POST" "/api/matching/check" "200"
test_endpoint "マッチング履歴取得（空でも OK）" "GET" "/api/matching/history" "200"

echo ""
sleep $WAIT_TIME

# =========================================
# 通知エンドポイントテスト
# =========================================
echo -e "${YELLOW}[4] 通知エンドポイントテスト${NC}"
echo ""

test_endpoint "通知一覧取得（空でも OK）" "GET" "/api/notifications" "200"

echo ""
sleep $WAIT_TIME

# =========================================
# BarLocator エンドポイントテスト
# =========================================
echo -e "${YELLOW}[5] BarLocator エンドポイントテスト${NC}"
echo ""

# 無効なパラメータでのエラーハンドリングをテスト
test_endpoint "BarLocator (POST) - 必須フィールド不足" "POST" "/api/bars/locate" "400" '{}'
test_endpoint "BarLocator (GET) - 無効パラメータ" "GET" "/api/bars/locate/INVALID/INVALID/INVALID" "400"

echo ""
sleep $WAIT_TIME

# =========================================
# バリデーションテスト
# =========================================
echo -e "${YELLOW}[6] バリデーションテスト${NC}"
echo ""

test_endpoint "無効なエンドポイント" "GET" "/api/nonexistent" "404"


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
  echo ""
  echo "次のステップ:"
  echo "1. GitHub Actions CI/CD の設定"
  echo "2. 本番環境（Railway + Vercel）へのデプロイ"
  exit 0
else
  echo -e "${RED}❌ $TESTS_FAILED 個のテストが失敗しました${NC}"
  exit 1
fi
