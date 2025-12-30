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

#### GET /api/notifications/:id
特定の通知を取得します。現状はファイルストアに保存された通知を返します。

**レスポンス例:**
```json
{
  "id": "uuid",
  "matchResultId": "uuid",
  "sentAt": "2025-12-27T01:27:38Z",
  "channel": "in_app",
  "isRead": false,
  "matchResult": { "score": 0.82, "evaluatedAt": "2025-12-27T01:27:30Z" },
  "tradeNote": { "symbol": "BTCUSDT", "side": "BUY", "timeframe": "15m" },
  "reasonSummary": "スコア: 0.820"
}
```

#### PUT /api/notifications/:id/read
通知を既読にマークします。

#### PUT /api/notifications/read-all
すべての通知を既読にマークします。

#### DELETE /api/notifications/:id
特定の通知を削除します。

#### DELETE /api/notifications
すべての通知をクリアします。

---

### Phase4: 通知トリガ・ログ

#### POST /api/notifications/check
MatchResult から通知を評価し、配信・記録する（再通知防止ロジック適用）。

**再通知防止ルール:**
- **冪等性**: 同一 noteId × snapshotId × channel の組み合わせは再送しない
- **クールダウン**: 同一 noteId への通知は 1 時間のクールダウン
- **重複抑制**: 同一スナップショットへの通知は 5 秒のデバウンス

**リクエストボディ:**
```json
{
  "matchResultId": "uuid",
  "channel": "in_app"  // 省略可（デフォルト: in_app）
}
```

**レスポンス（送信時）:**
```json
{
  "shouldNotify": true,
  "status": "sent",
  "notificationLogId": "uuid",
  "inAppNotificationId": "uuid"
}
```

**レスポンス（スキップ時 - クールダウン）:**
```json
{
  "shouldNotify": false,
  "status": "skipped",
  "skipReason": "クールダウン中: 次の通知は 2025-12-27T02:27:38Z 以降",
  "log": {
    "id": "uuid",
    "status": "skipped",
    "skipReason": "cooldown"
  }
}
```

**レスポンス（スキップ時 - 冪等性）:**
```json
{
  "shouldNotify": false,
  "status": "skipped",
  "skipReason": "冪等性: この組み合わせは既に通知済みです",
  "log": {
    "id": "uuid",
    "status": "skipped",
    "skipReason": "idempotency"
  }
}
```

**レスポンス（スキップ時 - 重複抑制）:**
```json
{
  "shouldNotify": false,
  "status": "skipped",
  "skipReason": "重複抑制: 5秒以内の再通知です",
  "log": {
    "id": "uuid",
    "status": "skipped",
    "skipReason": "duplicate_suppression"
  }
}
```

#### GET /api/notifications/logs
通知ログを取得します。

**クエリパラメータ:**
- `symbol`: シンボルでフィルタ
- `noteId`: ノート ID でフィルタ
- `status`: `sent` | `skipped` | `failed` でフィルタ
- `limit`: 最大件数（デフォルト: 50）

**レスポンス:**
```json
{
  "logs": [
    {
      "id": "uuid",
      "noteId": "uuid",
      "marketSnapshotId": "uuid",
      "symbol": "BTCUSDT",
      "score": 0.85,
      "channel": "in_app",
      "status": "sent",
      "reasonSummary": "スコア: 0.850｜トレンド一致 ｜ 価格レンジ一致",
      "sentAt": "2025-12-27T01:27:38Z",
      "createdAt": "2025-12-27T01:27:38Z"
    }
  ]
}
```

#### GET /api/notifications/logs/:id
指定 ID の通知ログを取得します。

#### DELETE /api/notifications/logs/:id
指定 ID の通知ログを削除します。

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
