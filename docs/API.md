# API ドキュメント

## ベース URL
```
http://localhost:3100
```

> **注意**: デフォルトポートは `3100` です。`BACKEND_PORT` または `PORT` 環境変数で変更可能です。

## 認証
現在、認証は不要です。本番環境では JWT または API キー認証を実装してください。

---

## 環境変数

| 変数名 | 説明 | デフォルト値 |
|--------|------|--------------|
| `BACKEND_PORT` / `PORT` | バックエンドサーバーのポート | `3100` |
| `DATABASE_URL` | PostgreSQL 接続文字列 | （必須） |
| `AI_API_KEY` | AI サービス API キー | （空文字） |
| `AI_MODEL` | AI モデル名 | `gpt-5-mini` |
| `AI_BASE_URL` | AI API ベース URL | `https://api.openai.com/v1` |
| `MARKET_API_URL` | 市場データ API URL | （空文字） |
| `MARKET_API_KEY` | 市場データ API キー | （空文字） |
| `MATCH_THRESHOLD` | 一致判定しきい値 | `0.75` |
| `CHECK_INTERVAL_MINUTES` | 定期マッチング間隔（分） | `15` |
| `CRON_ENABLED` | スケジューラ有効化フラグ | `true` |
| `PUSH_NOTIFICATION_KEY` | プッシュ通知サービスキー | （空文字） |

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
`data/trades/` ディレクトリ内の CSV ファイルからトレードをインポートし、ノートを自動生成します。

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
  "tradesSkipped": 0,
  "importErrors": [],
  "insertedIds": ["uuid-1", "uuid-2", "..."],
  "notesGenerated": 5,
  "noteIds": ["note-uuid-1", "note-uuid-2", "..."]
}
```

---

#### POST /api/trades/import/upload-text
クライアントから CSV テキストを受け取り、サーバー側でファイル保存→取り込み→Draft ノート生成まで一気通貫で実行します。

**リクエストボディ:**
```json
{
  "filename": "my_trades.csv",
  "csvText": "timestamp,symbol,side,price,quantity,fee,exchange\n2024-01-15T10:30:00Z,BTCUSDT,buy,42500.00,0.1,4.25,Binance"
}
```

**応答:**
```json
{
  "success": true,
  "tradesImported": 1,
  "tradesSkipped": 0,
  "importErrors": [],
  "insertedIds": ["uuid-1"],
  "notesGenerated": 1,
  "noteIds": ["note-uuid-1"]
}
```

---

#### GET /api/trades/notes
保存されているすべてのトレードノートを取得します。

**クエリパラメータ:**
- `status`: ステータスでフィルタ（`draft` / `approved` / `rejected`）

**応答:**
```json
{
  "notes": [
    {
      "id": "uuid",
      "tradeId": "trade-uuid",
      "symbol": "BTCUSDT",
      "side": "buy",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "aiSummary": "RSI が売られすぎ水準...",
      "status": "draft",
      "createdAt": "2024-01-15T10:35:00.000Z"
    }
  ]
}
```

---

#### GET /api/trades/notes/status-counts
ステータス別のノート件数を取得します。ダッシュボード表示用。

**応答:**
```json
{
  "draft": 5,
  "approved": 10,
  "rejected": 2,
  "total": 17
}
```

---

#### GET /api/trades/notes/:id
ID で特定のトレードノートを取得します。

**応答:**
```json
{
  "id": "uuid",
  "tradeId": "trade-uuid",
  "symbol": "BTCUSDT",
  "side": "buy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "entryConditions": "...",
  "exitConditions": "...",
  "aiSummary": "RSI が売られすぎ水準...",
  "status": "draft",
  "createdAt": "2024-01-15T10:35:00.000Z",
  "userNotes": "ユーザーによる追記",
  "tags": ["レンジ相場", "RSI反転"]
}
```

---

#### PUT /api/trades/notes/:id
ノートの内容を更新します（AI 要約、ユーザーメモ、タグ）。

**リクエストボディ:**
```json
{
  "aiSummary": "更新されたAI要約",
  "userNotes": "ユーザーによる追記メモ",
  "tags": ["レンジ相場", "RSI反転"]
}
```

**応答:**
```json
{
  "success": true,
  "note": {
    "id": "uuid",
    "aiSummary": "更新されたAI要約",
    "userNotes": "ユーザーによる追記メモ",
    "tags": ["レンジ相場", "RSI反転"],
    "lastEditedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

---

#### POST /api/trades/notes/:id/approve
ノートを承認状態に変更します。承認済みノートのみがマッチング対象となります。

**応答:**
```json
{
  "success": true,
  "status": "approved",
  "note": {
    "id": "uuid",
    "status": "approved",
    "approvedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

**エラー応答（404）:**
```json
{
  "error": "ノートが見つかりませんでした"
}
```

---

#### POST /api/trades/notes/:id/reject
ノートを非承認（rejected）にします。非承認のノートはマッチング対象外となります。

**応答:**
```json
{
  "success": true,
  "status": "rejected",
  "note": {
    "id": "uuid",
    "status": "rejected",
    "rejectedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

---

#### POST /api/trades/notes/:id/revert-to-draft
ノートを下書き状態に戻します。承認済み/非承認から編集モードに戻す際に使用。

**応答:**
```json
{
  "success": true,
  "status": "draft",
  "note": {
    "id": "uuid",
    "status": "draft"
  }
}
```

---

### マッチング

#### POST /api/matching/check
現在の市場条件に対してマッチングチェックを手動でトリガーします。

**応答:**
```json
{
  "success": true,
  "matchCount": 2,
  "notificationsGenerated": 2
}
```

---

#### GET /api/matching/history
検出されたすべてのマッチの履歴を取得します。

**クエリパラメータ:**
- `symbol`: シンボルでフィルタ
- `limit`: 取得件数（デフォルト: 50）
- `offset`: オフセット（ページング用）
- `minScore`: 最小スコアでフィルタ

**応答:**
```json
{
  "success": true,
  "count": 2,
  "matches": [
    {
      "id": "uuid",
      "noteId": "note-uuid",
      "symbol": "BTCUSDT",
      "matchScore": 0.85,
      "threshold": 0.75,
      "trendMatched": true,
      "priceRangeMatched": true,
      "reasons": [...],
      "evaluatedAt": "2025-12-27T01:27:30Z",
      "createdAt": "2025-12-27T01:27:30Z",
      "marketSnapshotId": "snapshot-uuid"
    }
  ]
}
```

---

### 通知

#### GET /api/notifications
すべての通知を取得します。

**クエリパラメータ:**
- `unreadOnly`: `true` の場合、未読通知のみ取得

**応答:**
```json
{
  "notifications": [...]
}
```

---

#### GET /api/notifications/:id
特定の通知を取得します。

**応答:**
```json
{
  "id": "uuid",
  "matchResultId": "uuid",
  "sentAt": "2025-12-27T01:27:38Z",
  "channel": "in_app",
  "isRead": false,
  "matchResult": { "score": 0.82, "evaluatedAt": "2025-12-27T01:27:30Z" },
  "tradeNote": { "id": "note-uuid", "symbol": "BTCUSDT", "side": "BUY", "timeframe": "15m" },
  "reasonSummary": "スコア: 0.820"
}
```

---

#### PUT /api/notifications/:id/read
通知を既読にマークします。

---

#### PUT /api/notifications/read-all
すべての通知を既読にマークします。

---

#### DELETE /api/notifications/:id
特定の通知を削除します。

---

#### DELETE /api/notifications
すべての通知をクリアします。

---

### Phase4: 通知トリガ・ログ

#### POST /api/notifications/check
通知を評価し、配信・記録します（再通知防止ロジック適用）。

> **重要**: 現在の実装ではリクエストボディの `matchResultId` / `channel` は参照されません。
> サーバー側で最新のマッチングを再実行し、`channel` は `in_app` 固定です。

**再通知防止ルール:**
- **冪等性**: 同一 noteId × snapshotId × channel の組み合わせは再送しない
- **クールダウン**: 同一 noteId への通知は 1 時間のクールダウン
- **重複抑制**: 同一スナップショットへの通知は 5 秒のデバウンス

**リクエストボディ:**
```json
{}
```
> 注: 現在の実装ではリクエストボディは無視されます。

**応答:**
```json
{
  "processed": 5,
  "notified": 2,
  "skipped": 3,
  "shouldNotify": true,
  "results": [
    {
      "noteId": "uuid",
      "shouldNotify": true,
      "status": "sent",
      "notificationLogId": "log-uuid"
    },
    {
      "noteId": "uuid",
      "shouldNotify": false,
      "status": "skipped",
      "skipReason": "クールダウン中"
    }
  ]
}
```

---

#### GET /api/notifications/logs
通知ログを取得します。

**クエリパラメータ:**
- `symbol`: シンボルでフィルタ
- `noteId`: ノート ID でフィルタ
- `status`: `sent` | `skipped` | `failed` でフィルタ
- `limit`: 最大件数（デフォルト: 50）

> **注意**: フィルタを指定しない場合は失敗ログ（`status=failed`）のみを返します。
> 全件取得する場合は `status=sent` または `status=skipped` を明示的に指定してください。

**応答:**
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

---

#### GET /api/notifications/logs/:id
指定 ID の通知ログを取得します。

---

#### DELETE /api/notifications/logs/:id
指定 ID の通知ログを削除します。

---

### 注文

#### GET /api/orders/preset/:noteId
マッチしたトレードノートに基づいて注文プリセットを生成します。

> **重要**: 本システムは自動売買を行いません。参考情報のみを提供します。

**応答:**
```json
{
  "preset": {
    "symbol": "BTCUSDT",
    "side": "buy",
    "suggestedPrice": 42500.00,
    "suggestedQuantity": 0.1,
    "basedOnNoteId": "note-uuid",
    "confidence": 0.8
  }
}
```

---

#### POST /api/orders/confirmation
注文確認情報を取得します（参考値）。

> **重要**: 本システムは自動売買を行いません。以下は参考情報です。

**リクエストボディ:**
```json
{
  "symbol": "BTCUSDT",
  "side": "buy",
  "price": 42500,
  "quantity": 0.1
}
```

**応答:**
```json
{
  "confirmation": {
    "symbol": "BTCUSDT",
    "side": "buy",
    "price": 42500,
    "quantity": 0.1,
    "estimatedCost": 4250,
    "estimatedFee": 4.25,
    "total": 4254.25,
    "warning": "これは参考情報です。本システムは自動売買を行いません。実際の注文は取引所で行ってください。"
  }
}
```

---

## CORS 設定

デフォルトで以下のオリジンからのリクエストを許可しています:
- `http://localhost:3001`
- `http://localhost:3102`

---

## スケジューラ

マッチングスケジューラは `CRON_ENABLED=true`（デフォルト）の場合、設定された間隔（デフォルト: 15分）で自動実行されます。

- 全ノートを現在の市場状況と照合
- しきい値を超えた一致に対して通知を生成
- 再通知防止ルールを適用
