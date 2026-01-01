#!/bin/bash

# TradeAssist API Test Script
# This script demonstrates the core functionality of the system

BASE_URL="http://localhost:3000"

echo "════════════════════════════════════════════════════"
echo "  TradeAssist - API Test Script"
echo "════════════════════════════════════════════════════"
echo ""

# Health check
echo "1. Testing Health Endpoint..."
curl -s "$BASE_URL/health" | jq '.'
echo ""

# Import trades from CSV
echo "2. Importing Trades from CSV..."
curl -s -X POST "$BASE_URL/api/trades/import/csv" \
  -H "Content-Type: application/json" \
  -d '{"filename": "sample_trades.csv"}' | jq '.'
echo ""

# Get all trade notes
echo "3. Retrieving All Trade Notes..."
curl -s "$BASE_URL/api/trades/notes" | jq '.'
echo ""

# Check for matches
echo "4. Checking for Market Matches..."
curl -s -X POST "$BASE_URL/api/matching/check" | jq '.'
echo ""

# Get notifications
echo "5. Retrieving Notifications..."
curl -s "$BASE_URL/api/notifications" | jq '.'
echo ""

# Get match history
echo "6. Retrieving Match History..."
curl -s "$BASE_URL/api/matching/history" | jq '.'
echo ""

echo "════════════════════════════════════════════════════"
echo "  Test Complete"
echo "════════════════════════════════════════════════════"
