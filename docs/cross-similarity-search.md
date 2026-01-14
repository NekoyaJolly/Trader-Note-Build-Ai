# 横断類似ノート検索 API

## 概要

Side-A（TradeNote）と Side-B（AITradeNote）を横断して類似ノートを検索する統合APIです。

## 主な機能

- **横断検索**: TradeNote と AITradeNote の両方を対象に類似パターンを検索
- **統一スコアリング**: コサイン類似度による統一的な評価
- **柔軟な入力**: OHLCVデータまたは12次元特徴ベクトルの両方に対応
- **由来区別**: レスポンスに `noteType` フィールドで TradeNote / AITradeNote を明示
- **高度なフィルタリング**: シンボル、類似度閾値、検索対象の細かい制御

## エンドポイント

### POST /api/similarity/search-cross

Side-A と Side-B を横断して類似ノートを検索します。

#### リクエスト例（特徴ベクトル）

```bash
curl -X POST http://localhost:3100/api/similarity/search-cross \
  -H "Content-Type: application/json" \
  -d '{
    "featureVector": [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    "topK": 10,
    "minSimilarity": 0.5,
    "searchTradeNotes": true,
    "searchAITradeNotes": true
  }'
```

#### リクエスト例（OHLCVデータ）

```bash
curl -X POST http://localhost:3100/api/similarity/search-cross \
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
      }
    ],
    "symbol": "EURUSD",
    "topK": 5,
    "minSimilarity": 0.6
  }'
```

#### レスポンス例

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "noteId": "abc-123",
        "noteType": "tradeNote",
        "similarity": 0.92,
        "distance": 0.28,
        "symbol": "EURUSD",
        "date": "2024-01-15",
        "direction": "long",
        "outcome": "win",
        "pnl": 45.2,
        "metadata": {
          "tradeId": "def-456",
          "timeframe": "1h"
        }
      },
      {
        "noteId": "ghi-789",
        "noteType": "aiTradeNote",
        "similarity": 0.88,
        "distance": 0.35,
        "symbol": "EURUSD",
        "date": "2024-01-10",
        "direction": "long",
        "outcome": "win",
        "pnl": 38.5,
        "metadata": {
          "virtualTradeId": "jkl-012",
          "planId": "mno-345",
          "riskRewardActual": 2.1
        }
      }
    ],
    "totalCount": 2,
    "searchStats": {
      "tradeNotesSearched": 150,
      "aiTradeNotesSearched": 75,
      "tradeNotesMatched": 1,
      "aiTradeNotesMatched": 1
    }
  }
}
```

## リクエストパラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|-----------|-----|------|-----------|------|
| `ohlcvData` | `OHLCVData[]` | ※ | - | OHLCV データ配列（特徴量自動抽出） |
| `featureVector` | `number[]` | ※ | - | 12次元特徴ベクトル（直接指定） |
| `symbol` | `string` | 任意 | - | シンボルフィルタ（例: "EURUSD"） |
| `topK` | `number` | 任意 | 10 | 取得件数（最大100） |
| `minSimilarity` | `number` | 任意 | 0.5 | 最小類似度（0-1） |
| `searchTradeNotes` | `boolean` | 任意 | true | TradeNote を検索対象に含める |
| `searchAITradeNotes` | `boolean` | 任意 | true | AITradeNote を検索対象に含める |

※ `ohlcvData` または `featureVector` のいずれかが必須

## レスポンスフィールド

### results配列

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `noteId` | `string` | ノートID |
| `noteType` | `"tradeNote" \| "aiTradeNote"` | ノート種別 |
| `similarity` | `number` | コサイン類似度（0-1） |
| `distance` | `number` | ユークリッド距離 |
| `symbol` | `string` | 通貨ペア/銘柄 |
| `date` | `string` | 日付（ISO形式） |
| `direction` | `"long" \| "short"` | ポジション方向 |
| `outcome` | `string` | 成績（"win", "loss", "breakeven"） |
| `pnl` | `number` | 損益 |
| `metadata` | `object` | 追加メタデータ |

### searchStats

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `tradeNotesSearched` | `number` | 検索対象TradeNote数 |
| `aiTradeNotesSearched` | `number` | 検索対象AITradeNote数 |
| `tradeNotesMatched` | `number` | マッチしたTradeNote数 |
| `aiTradeNotesMatched` | `number` | マッチしたAITradeNote数 |

## 使用例

### 1. 現在の市場状況から類似ノートを探す

```javascript
// OHLCVデータを取得（仮）
const currentOHLCV = await fetchMarketData('EURUSD', '1h', 20);

const response = await fetch('http://localhost:3100/api/similarity/search-cross', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ohlcvData: currentOHLCV,
    symbol: 'EURUSD',
    topK: 5,
    minSimilarity: 0.7
  })
});

const { data } = await response.json();
console.log(`類似ノート ${data.totalCount} 件見つかりました`);
data.results.forEach(note => {
  console.log(`- ${note.noteType}: 類似度 ${note.similarity.toFixed(2)}, 成績 ${note.outcome}`);
});
```

### 2. 特定の特徴量パターンを検索

```javascript
// 12次元特徴ベクトルを手動で指定
const targetPattern = [
  0.7,  // トレンド方向（上昇傾向）
  0.8,  // トレンド強度（強い）
  0.6,  // トレンド整合性
  0.5,  // モメンタム
  0.6,  // クロスオーバー
  0.7,  // RSI値（やや買われ気味）
  0.5,  // RSIゾーン
  0.5,  // BBポジション
  0.5,  // BB幅
  0.6,  // ローソク足実体
  1.0,  // ローソク足方向（強気）
  0.5   // セッション
];

const response = await fetch('http://localhost:3100/api/similarity/search-cross', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    featureVector: targetPattern,
    topK: 10,
    minSimilarity: 0.8
  })
});
```

### 3. TradeNoteのみを検索（AIノートは除外）

```javascript
const response = await fetch('http://localhost:3100/api/similarity/search-cross', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    featureVector: myPattern,
    searchTradeNotes: true,
    searchAITradeNotes: false,  // AIノートを除外
    topK: 5
  })
});
```

## テスト

### 単体テスト

```bash
npm test -- src/backend/tests/crossSimilarityService.test.ts
```

### 手動テスト

テストスクリプトを実行（サーバー起動中）:

```bash
./test-similarity-api.sh
```

## 技術詳細

### アーキテクチャ

```
┌─────────────────────────────────────────┐
│  POST /api/similarity/search-cross      │
│  (similarityRoutes.ts)                  │
└──────────────┬──────────────────────────┘
               │ Zodバリデーション
               ▼
┌─────────────────────────────────────────┐
│  CrossSimilarityService                 │
│  (crossSimilarityService.ts)            │
└──────┬─────────────────────┬────────────┘
       │                     │
       ▼                     ▼
┌──────────────┐      ┌──────────────────┐
│ TradeNote    │      │ AITradeNote      │
│ 検索         │      │ 検索             │
│ (Side-A)     │      │ (Side-B)         │
└──────┬───────┘      └──────┬───────────┘
       │                     │
       └──────────┬──────────┘
                  ▼
       ┌─────────────────────┐
       │ 結果マージ・ソート   │
       │ コサイン類似度計算   │
       └─────────────────────┘
```

### 類似度計算

- **コサイン類似度**: `featureVectorService.calculateCosineSimilarity` を使用
- **ユークリッド距離**: 補助的な距離指標として提供
- **次元統一**: 12次元ベクトルに統一（次元不一致時はパディング）

### AITradeNote の特徴量抽出

AITradeNote は現状 `featureVector` を持たないため、以下の情報から簡易ベクトルを生成:

- direction（方向）
- result.outcome（勝敗）
- result.riskRewardActual（リスクリワード比）
- result.holdingDuration（保有時間）
- entryAnalysis.timing（エントリータイミング）
- exitAnalysis.timing（決済タイミング）
- planEvaluation.scenarioAccuracy（プラン精度）

## パフォーマンス

- **並列検索**: TradeNote と AITradeNote を並列検索（Promise.all）
- **早期フィルタリング**: 最小類似度で早期に候補を絞り込み
- **topK制限**: ソート後に上位K件のみ返却

## 今後の拡張予定

- [ ] AITradeNote にも `featureVector` カラムを追加
- [ ] pgvector を使った高速ベクトル検索
- [ ] キャッシング機構（頻繁に検索されるパターン）
- [ ] 類似度計算アルゴリズムの追加（L2距離、マンハッタン距離等）
- [ ] バッチ検索API（複数パターンを一度に検索）

## 関連ファイル

- **サービス**: `src/services/crossSimilarityService.ts`
- **ルート**: `src/routes/similarityRoutes.ts`
- **スキーマ**: `src/schemas/api/similarity.ts`
- **テスト**: `src/backend/tests/crossSimilarityService.test.ts`
- **ドキュメント**: `docs/API.md` の「横断類似ノート検索」セクション
