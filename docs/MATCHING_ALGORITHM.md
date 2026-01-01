# マッチングアルゴリズム詳細解説

## Overview

TradeAssist のマッチングシステムは、過去のトレードノートと現在のリアルタイム市場状況を比較し、潜在的な取引機会を特定します。本ドキュメントではアルゴリズムの詳細を解説します。

## Core Concept

システムは、過去のトレードと現在の市場データから数値特徴量を抽出し、コサイン類似度とルールベース検証を組み合わせて比較します。

---

## Feature Extraction

### 12次元統一特徴量ベクトル

トレードノートと市場データから **12次元の統一特徴量ベクトル** を抽出します。

```typescript
// 12次元特徴量ベクトルの構成
featureVector = [
  // トレンド系（5次元: index 0-4）
  sma20,           // 20期間単純移動平均
  sma50,           // 50期間単純移動平均
  sma200,          // 200期間単純移動平均
  ema20,           // 20期間指数移動平均
  ema50,           // 50期間指数移動平均
  
  // モメンタム系（2次元: index 5-6）
  macdLine,        // MACDライン
  macdSignal,      // MACDシグナル
  
  // 過熱度系（1次元: index 7）
  rsi,             // 相対力指数 (0-100)
  
  // ボラティリティ系（2次元: index 8-9）
  bbUpper,         // ボリンジャーバンド上限
  bbLower,         // ボリンジャーバンド下限
  
  // ローソク足系（1次元: index 10）
  candlePattern,   // ローソク足パターンスコア (-3〜+3)
  
  // 時間軸（1次元: index 11）
  timeContext      // 時間帯コンテキスト (0-3)
]
```

**Feature Breakdown:**

| Index | Feature       | カテゴリ        | Range         | Description                      |
|-------|---------------|-----------------|---------------|----------------------------------|
| 0     | sma20         | トレンド系      | 0-∞           | 20期間単純移動平均               |
| 1     | sma50         | トレンド系      | 0-∞           | 50期間単純移動平均               |
| 2     | sma200        | トレンド系      | 0-∞           | 200期間単純移動平均              |
| 3     | ema20         | トレンド系      | 0-∞           | 20期間指数移動平均               |
| 4     | ema50         | トレンド系      | 0-∞           | 50期間指数移動平均               |
| 5     | macdLine      | モメンタム系    | -∞ to +∞      | MACD ライン                      |
| 6     | macdSignal    | モメンタム系    | -∞ to +∞      | MACD シグナル                    |
| 7     | rsi           | 過熱度系        | 0-100         | 相対力指数                       |
| 8     | bbUpper       | ボラティリティ  | 0-∞           | ボリンジャーバンド上限           |
| 9     | bbLower       | ボラティリティ  | 0-∞           | ボリンジャーバンド下限           |
| 10    | candlePattern | ローソク足系    | -3 to +3      | ローソク足パターンスコア         |
| 11    | timeContext   | 時間軸          | 0-3           | 時間帯コンテキスト               |

### カテゴリ別説明

#### トレンド系（5次元: index 0-4）
複数の移動平均を使ってトレンドの強さと方向を捉えます。
- **SMA20/50/200**: 短期・中期・長期のトレンド方向
- **EMA20/50**: より直近の価格変動に敏感なトレンド

#### モメンタム系（2次元: index 5-6）
相場の勢いと転換点を検出します。
- **MACD Line**: 短期EMA(12) と長期EMA(26) の差
- **MACD Signal**: MACDラインの9期間EMA

#### 過熱度系（1次元: index 7）
買われすぎ・売られすぎの状態を判定します。
- **RSI**: 0-100の範囲で相対的な強さを測定

#### ボラティリティ系（2次元: index 8-9）
価格変動の幅を把握します。
- **BB Upper/Lower**: 価格の統計的な上下限（標準偏差±2σ）

#### ローソク足系（1次元: index 10）
価格パターンから相場心理を読み取ります。
- 強気パターン（ハンマー、エンガルフィング等）: +1〜+3
- 弱気パターン（シューティングスター等）: -1〜-3
- ニュートラル: 0

#### 時間軸（1次元: index 11）
取引の時間帯コンテキストを数値化します。
- 0: アジア市場 (0:00-8:00 UTC)
- 1: 欧州市場 (8:00-14:00 UTC)
- 2: 米国市場 (14:00-22:00 UTC)
- 3: その他/重複時間帯

**Example:**
```
Trade: BUY BTCUSDT at $43,000 during US session
Features: [43000, 42500, 40000, 43100, 42600, 150, 120, 52, 45000, 40000, 1, 2]

各インデックス:
  [0] SMA20: 43000
  [1] SMA50: 42500
  [2] SMA200: 40000
  [3] EMA20: 43100
  [4] EMA50: 42600
  [5] MACD Line: 150
  [6] MACD Signal: 120
  [7] RSI: 52
  [8] BB Upper: 45000
  [9] BB Lower: 40000
  [10] Candle Pattern: 1 (Bullish Engulfing)
  [11] Time Context: 2 (US Session)
```

### 後方互換性（Legacy Vector Conversion）

旧バージョンの7次元/8次元/18次元ベクトルは自動的に12次元に変換されます：

```typescript
import { convertLegacyVector } from '@/services/featureVectorService';

// 7次元: [price, quantity, rsi, macd, volume, trend, side]
// 8次元: 7次元 + histogram
// 18次元: 旧フル特徴量
// → いずれも12次元に正規化

const legacyVector = [42500, 0.1, 50, 0, 1000000, 1, 1]; // 7次元
const modernVector = convertLegacyVector(legacyVector);  // 12次元
```

## Similarity Calculation

### Step 1: Cosine Similarity

12次元特徴量ベクトル間の類似度を **コサイン類似度** で計算します。
これはベクトル間の角度を測定するため、スケールに依存しません。

**Formula:**
```
similarity = (A · B) / (||A|| × ||B||)

where:
  A · B = dot product（内積）
  ||A|| = magnitude of vector A（ベクトルAの大きさ）
  ||B|| = magnitude of vector B（ベクトルBの大きさ）
```

**Implementation:**
```typescript
import { calculateCosineSimilarity } from '@/services/featureVectorService';

// 12次元ベクトル同士の類似度計算
const similarity = calculateCosineSimilarity(vectorA, vectorB);
```

**内部実装:**
```typescript
function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
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
- 0: 完全に異なる
- 1: 完全に同一

### 類似度閾値 (Similarity Thresholds)

```typescript
// src/services/featureVectorService.ts で定義
export const SIMILARITY_THRESHOLDS = {
  STRONG: 0.90,  // 非常に類似（強い一致）
  MEDIUM: 0.80,  // 中程度の類似
  WEAK: 0.70,    // 弱い類似（最小閾値）
} as const;
```

| 閾値   | 値    | 用途                           |
|--------|-------|--------------------------------|
| STRONG | 0.90  | ほぼ同一条件、高確度マッチ     |
| MEDIUM | 0.80  | 類似条件、標準マッチ           |
| WEAK   | 0.70  | 参考レベル、探索的マッチ       |

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

閾値を超えたマッチのみが通知をトリガーします。

### 類似度閾値の選択

**推奨閾値:**

| 用途                     | 閾値   | 説明                         |
|--------------------------|--------|------------------------------|
| 類似ノート検索           | WEAK (0.70)   | 広く関連ノートを発見        |
| バックテストマッチ       | MEDIUM (0.80) | バランスの取れた精度        |
| リアルタイム通知         | STRONG (0.90) | 高確度マッチのみ通知        |

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
