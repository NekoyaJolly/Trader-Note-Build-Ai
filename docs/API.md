# API ドキュメント

## ベース URL
```
http://localhost:3000
```

## 認証
現在、認証は不要です。本番環境では JWT または API キー認証を実装してください。

---

## エンドポイント

### ヘルスチェック

#### GET /health
サーバーヘルスとスケジューラーステータスを確認します。

**応答:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-21T11:18:38.099Z",
  "schedulerRunning": true
}
```

---

### トレードインポートとノート

#### POST /api/trades/import/csv
`data/trades/` ディレクトリ内の CSV ファイルからトレードをインポートします。

**リクエストボディ:**
```json
{
  "filename": "sample_trades.csv"
}
```

**応答:**
```json
{
  "success": true,
  "tradesImported": 5,
  "notesGenerated": 5,
  "notes": [
    {
      "id": "2554ddb3-7424-42b6-bb91-37c75a9ef635",
      "symbol": "BTCUSDT",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

#### GET /api/trades/notes
保存されているすべてのトレードノートを取得します。

#### GET /api/trades/notes/:id
ID で特定のトレードノートを取得します。

---

### マッチング

#### POST /api/matching/check
現在の市場条件に対してマッチングチェックを手動でトリガーします。

#### GET /api/matching/history
検出されたすべてのマッチの履歴を取得します。

---

### 通知

#### GET /api/notifications
すべての通知を取得します（クエリパラメータ: 未読のみの場合 `unreadOnly=true`）。

#### PUT /api/notifications/:id/read
通知を既読にマークします。

#### PUT /api/notifications/read-all
すべての通知を既読にマークします。

#### DELETE /api/notifications/:id
特定の通知を削除します。

#### DELETE /api/notifications
すべての通知をクリアします。

---

### 注文

#### GET /api/orders/preset/:noteId
マッチしたトレードノートに基づいて注文プリセットを生成します。

#### POST /api/orders/confirmation
Get order confirmation details before execution.

**リクエストボディ:**
```json
{
  "symbol": "BTCUSDT",
  "side": "buy",
  "price": 42500,
  "quantity": 0.1
}
```

See full API documentation with request/response examples in the README.
