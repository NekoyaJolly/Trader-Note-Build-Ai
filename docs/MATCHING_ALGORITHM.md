# マッチングアルゴリズム詳細解説

## Overview

The TradeAssist MVP matching system compares historical trade notes with current real-time market conditions to identify potential trading opportunities. This document explains the algorithm in detail.

## Core Concept

The system extracts numerical features from both historical trades and current market data, then compares them using mathematical similarity metrics combined with rule-based validation.

---

## Feature Extraction

### Historical Trade Features

From each trade note, we extract a 7-dimensional feature vector:

```typescript
features = [
  trade.price,              // Entry price
  trade.quantity,           // Position size
  rsi || 50,               // RSI indicator (default: 50)
  macd || 0,               // MACD indicator (default: 0)
  volume || 0,             // Trading volume
  trendValue,              // -1 (bearish), 0 (neutral), 1 (bullish)
  sideValue                // -1 (sell), 1 (buy)
]
```

**Example:**
```
Trade: BUY 0.1 BTCUSDT at $42,500
Features: [42500, 0.1, 50, 0, 0, 0, 1]
```

### Current Market Features

From real-time market data, we extract a similar feature vector:

```typescript
features = [
  market.close,             // Current price
  market.volume,            // Current volume
  market.indicators.rsi,    // Current RSI
  market.indicators.macd,   // Current MACD
  market.volume,            // Volume (repeated for consistency)
  trendValue,              // Current trend encoding
  0                        // Neutral for current market
]
```

**Example:**
```
Market: BTCUSDT at $42,550, RSI=55, Bullish
Features: [42550, 1000000, 55, 0.5, 1000000, 1, 0]
```

---

## Similarity Calculation

### Step 1: Cosine Similarity

We use cosine similarity to compare the feature vectors. This measures the angle between vectors, making it scale-invariant.

**Formula:**
```
similarity = (A · B) / (||A|| × ||B||)

where:
  A · B = dot product
  ||A|| = magnitude of vector A
  ||B|| = magnitude of vector B
```

**Implementation:**
```typescript
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**Result Range:** 0 to 1
- 0: Completely dissimilar
- 1: Identical conditions

---

## Rule-Based Checks

### Step 2: Trend Match

We check if the current market trend matches the historical trade trend.

```typescript
function checkTrendMatch(note: TradeNote, market: MarketData): boolean {
  return note.marketContext.trend === market.indicators.trend;
}
```

**Examples:**
- Historical: Bullish, Current: Bullish → Match ✓
- Historical: Bullish, Current: Bearish → No Match ✗
- Historical: Neutral, Current: Neutral → Match ✓

**Weight in Final Score:** 30%

---

### Step 3: Price Range Check

We verify the current price is within 5% of the historical entry price.

```typescript
function checkPriceRange(note: TradeNote, market: MarketData): boolean {
  const priceDeviation = Math.abs(market.close - note.entryPrice) / note.entryPrice;
  return priceDeviation < 0.05; // Within 5%
}
```

**Examples:**
- Historical: $42,500, Current: $43,000 → 1.2% deviation → Match ✓
- Historical: $42,500, Current: $50,000 → 17.6% deviation → No Match ✗

**Weight in Final Score:** 10%

---

## Final Score Calculation

The final match score is a weighted combination:

```typescript
finalScore = (
  cosineSimilarity * 0.6 +        // 60% weight
  (trendMatch ? 0.3 : 0) +        // 30% weight
  (priceRangeMatch ? 0.1 : 0)     // 10% weight
)
```

**Example Calculation:**

Given:
- Cosine similarity = 0.85
- Trend match = true (same trend)
- Price range match = true (within 5%)

```
finalScore = (0.85 × 0.6) + 0.3 + 0.1
          = 0.51 + 0.3 + 0.1
          = 0.91
```

**Result:** 91% match → Exceeds threshold (75%) → MATCH!

---

## Threshold Filtering

Only matches that exceed the configured threshold trigger notifications.

**Default Threshold:** 0.75 (75%)

**Configuration:**
```env
MATCH_THRESHOLD=0.75
```

**Interpretation:**
- 0.90 - 1.00: Excellent match (highly similar conditions)
- 0.75 - 0.90: Good match (similar enough to notify)
- 0.50 - 0.75: Weak match (too different, no notification)
- 0.00 - 0.50: Poor match (very different conditions)

---

## Complete Matching Flow

### 1. Load Historical Notes
```typescript
const notes = await noteService.loadAllNotes();
```

### 2. Group by Symbol
```typescript
const notesBySymbol = new Map();
notes.forEach(note => {
  const existing = notesBySymbol.get(note.symbol) || [];
  existing.push(note);
  notesBySymbol.set(note.symbol, existing);
});
```

### 3. For Each Symbol

```typescript
for (const [symbol, symbolNotes] of notesBySymbol.entries()) {
  // Fetch current market data
  const currentMarket = await marketDataService.getCurrentMarketData(symbol);
  
  // Check each note
  for (const note of symbolNotes) {
    const matchScore = calculateMatchScore(note, currentMarket);
    
    if (matchScore >= threshold) {
      // Create match result
      const match = {
        noteId: note.id,
        symbol,
        matchScore,
        threshold,
        isMatch: true,
        currentMarket,
        historicalNote: note,
        timestamp: new Date()
      };
      
      // Notify user
      await notificationService.notifyMatch(match);
    }
  }
}
```

---

## Optimization Strategies

### Current Implementation
- Simple linear comparison
- No caching
- All notes checked on each run

### Future Optimizations

**1. Symbol Filtering**
- Only check notes for symbols with active positions
- Skip notes older than X days

**2. Caching**
- Cache market data for 1 minute
- Cache feature vectors
- Reduce API calls

**3. Parallel Processing**
- Check multiple symbols concurrently
- Use worker threads for heavy calculations

**4. Smart Scheduling**
- Increase frequency during active trading hours
- Reduce frequency during low-activity periods

**5. Vector Database**
- Use specialized vector DB (Pinecone, Weaviate)
- Approximate nearest neighbor search
- Much faster for large datasets

---

## Example Scenarios

### Scenario 1: Strong Match

**Historical Trade:**
```
Symbol: BTCUSDT
Side: BUY
Price: $42,500
Trend: Bullish
RSI: 52
```

**Current Market:**
```
Symbol: BTCUSDT
Price: $42,550 (0.12% difference)
Trend: Bullish
RSI: 54
```

**Result:**
- Cosine similarity: ~0.95
- Trend match: ✓
- Price range: ✓
- **Final Score: 0.97** → Strong match, notify user

---

### Scenario 2: Weak Match (No Notification)

**Historical Trade:**
```
Symbol: ETHUSDT
Side: BUY
Price: $2,250
Trend: Neutral
RSI: 50
```

**Current Market:**
```
Symbol: ETHUSDT
Price: $2,600 (15.6% difference)
Trend: Bearish
RSI: 30
```

**Result:**
- Cosine similarity: ~0.45
- Trend match: ✗
- Price range: ✗
- **Final Score: 0.27** → Weak match, no notification

---

### Scenario 3: Borderline Match

**Historical Trade:**
```
Symbol: BTCUSDT
Side: SELL
Price: $43,000
Trend: Bearish
RSI: 65
```

**Current Market:**
```
Symbol: BTCUSDT
Price: $42,900 (0.23% difference)
Trend: Neutral (different)
RSI: 62
```

**Result:**
- Cosine similarity: ~0.88
- Trend match: ✗
- Price range: ✓
- **Final Score: 0.63** → Below threshold, no notification

---

## Tuning Recommendations

### For More Matches (Lower Threshold)
```env
MATCH_THRESHOLD=0.65
```
- More notifications
- More false positives
- Good for: Testing, learning patterns

### For Fewer, High-Quality Matches (Higher Threshold)
```env
MATCH_THRESHOLD=0.85
```
- Fewer notifications
- Higher confidence matches
- Good for: Conservative trading, reducing noise

### Balanced (Default)
```env
MATCH_THRESHOLD=0.75
```
- Moderate number of notifications
- Good balance of precision and recall

---

## Monitoring Match Quality

### Metrics to Track

**1. Match Rate**
- How many matches per hour/day
- Adjust threshold if too high/low

**2. False Positive Rate**
- User feedback on match quality
- Adjust weights if necessary

**3. Feature Importance**
- Which features contribute most
- Consider removing low-impact features

**4. Performance**
- Time to complete matching cycle
- Optimize if too slow

---

## Future Enhancements

### 1. Machine Learning
- Train model on successful trades
- Learn optimal weights automatically
- Personalized matching per user

### 2. Advanced Indicators
- Bollinger Bands
- Fibonacci levels
- Support/Resistance levels
- Volume Profile

### 3. Time-Based Features
- Time of day
- Day of week
- Market session (Asia, Europe, US)

### 4. Sentiment Analysis
- News sentiment
- Social media sentiment
- Fear & Greed Index

### 5. Multi-Timeframe Analysis
- Confirm signals across timeframes
- 15m, 1h, 4h alignment

---

## Conclusion

The matching algorithm provides a quantitative, reproducible method for identifying similar market conditions. By combining mathematical similarity with rule-based validation, it balances precision with recall, delivering actionable insights while minimizing false positives.

The configurable threshold allows users to tune the system to their risk tolerance and trading style, making it adaptable to different strategies and market conditions.

---

## Phase4: 通知トリガロジック

### 目的
Phase3 で確定した MatchResult を、ユーザー体験を壊さずに通知へ変換する。

### 通知トリガ条件
1. **スコア閾値チェック**
   - 最小スコア: 0.75（環境変数 `NOTIFY_THRESHOLD` で変更可）
   - スコアが閾値未満 → スキップ

2. **理由数チェック**
   - 最小理由数: 1
   - 理由がない → スキップ

3. **冪等性チェック（重複防止）**
   - noteId × marketSnapshotId × channel の組み合わせが一意か確認
   - 既に通知済み → スキップ

4. **クールダウンチェック**
   - 同一 noteId について一定時間内の再通知を防止
   - クールダウン期間: 1 時間（環境変数 `NOTIFY_COOLDOWN_MS` で変更可）
   - クールダウン中 → スキップ

5. **重複抑制チェック**
   - 同一 evaluatedAt（秒単位）の再送信を防止
   - 許容時差: 5 秒（デフォルト）
   - 重複と判定 → スキップ

### 通知ログ（NotificationLog テーブル）
配信判定とスキップ理由の永続化

```sql
CREATE TABLE "NotificationLog" (
  id UUID PRIMARY KEY,
  noteId UUID NOT NULL,           -- トレードノート ID
  marketSnapshotId UUID NOT NULL, -- マーケットスナップショット ID
  symbol VARCHAR NOT NULL,         -- シンボル（インデックス用）
  score FLOAT NOT NULL,            -- 判定時のスコア
  channel VARCHAR NOT NULL,        -- in_app | push | webhook
  status ENUM NOT NULL,            -- sent | skipped | failed
  reasonSummary VARCHAR NOT NULL,  -- 配信理由（短文）
  sentAt TIMESTAMPTZ NOT NULL,    -- 配信・判定時刻
  createdAt TIMESTAMPTZ NOT NULL,
  
  UNIQUE (noteId, marketSnapshotId, channel)  -- 冪等性保証
);
```

### 通知配信実装
- **In-App**: Notification テーブルに記録（Phase4 デフォルト）
- **Push**: スタブ実装（Phase5 以降で FCM/APNs 統合）
- **Webhook**: スタブ実装（Phase5 以降で Slack/Teams 統合）

### 設計原則
> **当たる通知より、うるさくない通知。**

再通知を完全に防ぐことを優先。ユーザーが重複通知で煩わされるリスクを完全に排除する。
