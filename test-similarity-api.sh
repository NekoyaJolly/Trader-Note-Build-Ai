#!/bin/bash
# 横断類似ノート検索 API テストスクリプト
# 使用方法: ./test-similarity-api.sh

BASE_URL="http://localhost:3100"

echo "==================================="
echo "横断類似ノート検索 API テスト"
echo "==================================="
echo ""

# 1. ヘルスチェック
echo "1. ヘルスチェック: GET /api/similarity/health"
curl -s -X GET "${BASE_URL}/api/similarity/health" | jq '.'
echo ""
echo ""

# 2. 特徴ベクトルでの検索
echo "2. 特徴ベクトルでの検索"
curl -s -X POST "${BASE_URL}/api/similarity/search-cross" \
  -H "Content-Type: application/json" \
  -d '{
    "featureVector": [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    "topK": 5,
    "minSimilarity": 0.5
  }' | jq '.'
echo ""
echo ""

# 3. OHLCVデータでの検索
echo "3. OHLCVデータでの検索"
curl -s -X POST "${BASE_URL}/api/similarity/search-cross" \
  -H "Content-Type: application/json" \
  -d '{
    "ohlcvData": [
      {
        "timestamp": "2024-01-01T00:00:00Z",
        "open": 100.5,
        "high": 101.2,
        "low": 100.1,
        "close": 100.8,
        "volume": 1500
      },
      {
        "timestamp": "2024-01-01T01:00:00Z",
        "open": 100.8,
        "high": 101.5,
        "low": 100.6,
        "close": 101.2,
        "volume": 1600
      }
    ],
    "topK": 10,
    "minSimilarity": 0.3
  }' | jq '.'
echo ""
echo ""

# 4. シンボルフィルタ付き検索
echo "4. シンボルフィルタ付き検索 (EURUSD)"
curl -s -X POST "${BASE_URL}/api/similarity/search-cross" \
  -H "Content-Type: application/json" \
  -d '{
    "featureVector": [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    "symbol": "EURUSD",
    "topK": 5,
    "minSimilarity": 0.4
  }' | jq '.'
echo ""
echo ""

# 5. TradeNoteのみ検索
echo "5. TradeNoteのみ検索"
curl -s -X POST "${BASE_URL}/api/similarity/search-cross" \
  -H "Content-Type: application/json" \
  -d '{
    "featureVector": [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    "searchTradeNotes": true,
    "searchAITradeNotes": false,
    "topK": 5
  }' | jq '.'
echo ""
echo ""

# 6. バリデーションエラーテスト（両方未指定）
echo "6. バリデーションエラーテスト"
curl -s -X POST "${BASE_URL}/api/similarity/search-cross" \
  -H "Content-Type: application/json" \
  -d '{
    "topK": 5
  }' | jq '.'
echo ""
echo ""

echo "==================================="
echo "テスト完了"
echo "==================================="
