#!/bin/bash
# Railway デプロイ状態確認スクリプト

echo "=========================================="
echo "Railway Production デプロイテスト"
echo "=========================================="
echo ""

RAILWAY_URL="https://trader-note-build-ai-production.up.railway.app"

echo "[1/3] Health Check..."
echo "URL: $RAILWAY_URL/health"
echo ""

HEALTH_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$RAILWAY_URL/health")
HTTP_STATUS=$(echo "$HEALTH_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
RESPONSE_BODY=$(echo "$HEALTH_RESPONSE" | sed '/HTTP_STATUS/d')

echo "Status Code: $HTTP_STATUS"
echo "Response: $RESPONSE_BODY"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Health check 成功"
else
  echo "❌ Health check 失敗 (Status: $HTTP_STATUS)"
  echo ""
  echo "デバッグ情報:"
  echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
  exit 1
fi

echo ""
echo "[2/3] cTrader 認証 URL 取得..."
echo "URL: $RAILWAY_URL/api/auth/ctrader/url"
echo ""

AUTH_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$RAILWAY_URL/api/auth/ctrader/url")
HTTP_STATUS=$(echo "$AUTH_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
RESPONSE_BODY=$(echo "$AUTH_RESPONSE" | sed '/HTTP_STATUS/d')

echo "Status Code: $HTTP_STATUS"
echo "Response: $RESPONSE_BODY"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ cTrader 認証 URL 取得成功"
else
  echo "❌ cTrader 認証 URL 取得失敗 (Status: $HTTP_STATUS)"
fi

echo ""
echo "[3/3] ユーザー情報取得（認証なし）..."
echo "URL: $RAILWAY_URL/api/auth/me"
echo ""

ME_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$RAILWAY_URL/api/auth/me")
HTTP_STATUS=$(echo "$ME_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
RESPONSE_BODY=$(echo "$ME_RESPONSE" | sed '/HTTP_STATUS/d')

echo "Status Code: $HTTP_STATUS"
echo "Response: $RESPONSE_BODY"
echo ""

if [ "$HTTP_STATUS" = "401" ]; then
  echo "✅ 認証エラー（期待通り）"
else
  echo "⚠️ 予期しないステータス (Status: $HTTP_STATUS)"
fi

echo ""
echo "=========================================="
echo "テスト完了"
echo "=========================================="
