#!/bin/bash
# Phase 7 本番環境デプロイ後の疎通確認スクリプト
# 使用方法: ./scripts/phase7-verify.sh <RAILWAY_API_URL> <VERCEL_UI_URL>

set -e

API_URL="${1}"
UI_URL="${2}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "${BLUE}═════════════════════════════════════════${NC}"
echo "${BLUE}  Phase 7 本番環境疎通確認スクリプト${NC}"
echo "${BLUE}═════════════════════════════════════════${NC}"
echo ""

# 入力チェック
if [ -z "${API_URL}" ] || [ -z "${UI_URL}" ]; then
  echo "${RED}エラー: API_URL と UI_URL を指定してください${NC}"
  echo ""
  echo "使用方法:"
  echo "  ./scripts/phase7-verify.sh https://api-url.railway.app https://ui-url.vercel.app"
  echo ""
  exit 1
fi

echo "${YELLOW}確認対象${NC}:"
echo "  API URL: ${API_URL}"
echo "  UI URL: ${UI_URL}"
echo ""

# ===============================================
# Test 1: API /health エンドポイント確認
# ===============================================
echo "${BLUE}【Test 1】API /health エンドポイント確認${NC}"
echo "リクエスト: GET ${API_URL}/health"
echo ""

if response=$(curl -s -w "\n%{http_code}" "${API_URL}/health"); then
  http_code=$(echo "${response}" | tail -n 1)
  body=$(echo "${response}" | head -n -1)
  
  if [ "${http_code}" = "200" ]; then
    echo "${GREEN}✓ ステータスコード: 200 OK${NC}"
    echo "${GREEN}✓ レスポンス:${NC}"
    echo "  ${body}" | python3 -m json.tool 2>/dev/null || echo "  ${body}"
    echo ""
  else
    echo "${RED}✗ ステータスコード: ${http_code}${NC}"
    echo "${RED}エラー応答:${NC}"
    echo "  ${body}"
    echo ""
  fi
else
  echo "${RED}✗ リクエスト失敗 (ネットワーク接続確認)${NC}"
  echo ""
fi

# ===============================================
# Test 2: API /notifications エンドポイント確認
# ===============================================
echo "${BLUE}【Test 2】API /notifications エンドポイント確認${NC}"
echo "リクエスト: GET ${API_URL}/api/notifications"
echo ""

if response=$(curl -s -w "\n%{http_code}" "${API_URL}/api/notifications"); then
  http_code=$(echo "${response}" | tail -n 1)
  body=$(echo "${response}" | head -n -1)
  
  if [ "${http_code}" = "200" ]; then
    echo "${GREEN}✓ ステータスコード: 200 OK${NC}"
    echo "${GREEN}✓ レスポンス:${NC}"
    echo "  ${body}" | python3 -m json.tool 2>/dev/null || echo "  ${body}"
    echo ""
  else
    echo "${RED}✗ ステータスコード: ${http_code}${NC}"
    echo ""
  fi
else
  echo "${RED}✗ リクエスト失敗${NC}"
  echo ""
fi

# ===============================================
# Test 3: UI ページ表示確認
# ===============================================
echo "${BLUE}【Test 3】UI ページ表示確認${NC}"
echo "リクエスト: GET ${UI_URL}"
echo ""

if response=$(curl -s -w "\n%{http_code}" -I "${UI_URL}"); then
  http_code=$(echo "${response}" | tail -n 1)
  
  if echo "${http_code}" | grep -q "^200\|^301\|^302"; then
    echo "${GREEN}✓ ステータスコード: ${http_code}${NC}"
    echo "${GREEN}✓ ページは正常に表示されます${NC}"
    echo ""
  else
    echo "${RED}✗ ステータスコード: ${http_code}${NC}"
    echo ""
  fi
else
  echo "${RED}✗ リクエスト失敗${NC}"
  echo ""
fi

# ===============================================
# Test 4: CORS ヘッダー確認
# ===============================================
echo "${BLUE}【Test 4】CORS ヘッダー確認${NC}"
echo "リクエスト: OPTIONS ${API_URL}/api/notifications (CORS Preflight)"
echo ""

if response=$(curl -s -w "\n%{http_code}" -X OPTIONS \
  -H "Origin: ${UI_URL}" \
  -H "Access-Control-Request-Method: GET" \
  "${API_URL}/api/notifications" 2>/dev/null); then
  
  http_code=$(echo "${response}" | tail -n 1)
  
  if [ "${http_code}" = "200" ] || [ "${http_code}" = "204" ]; then
    echo "${GREEN}✓ CORS Preflight: 成功${NC}"
    echo "${GREEN}✓ UI から API へのアクセスが可能です${NC}"
    echo ""
  else
    echo "${YELLOW}⚠ CORS Preflight: ${http_code}${NC}"
    echo "${YELLOW}注: API は CORS を許可しているか確認してください${NC}"
    echo ""
  fi
else
  echo "${YELLOW}⚠ CORS リクエスト失敗${NC}"
  echo ""
fi

# ===============================================
# Summary
# ===============================================
echo "${BLUE}═════════════════════════════════════════${NC}"
echo "${GREEN}✓ 疎通確認スクリプト完了${NC}"
echo "${BLUE}═════════════════════════════════════════${NC}"
echo ""
echo "${YELLOW}次のステップ:${NC}"
echo "1. Browser で以下の URL を開く:"
echo "   ${UI_URL}"
echo ""
echo "2. DevTools (F12) → Network タブで API リクエストを確認"
echo ""
echo "3. すべてのエンドポイントが 200 系で応答していることを確認"
echo ""
echo "詳細は以下を参照:"
echo "  docs/phase6/Phase7_本番環境動作確認ガイド.md"
echo ""

