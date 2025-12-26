# API 契約（Phase0 版）

## 前提
- ベース URL: http://localhost:3000
- 認証: MVP では不要。Phase1 以降で JWT/API キーを追加予定
- コンテンツタイプ: application/json
- エラーフォーマット（暫定共通）:
```json
{
  "success": false,
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

## エンドポイント一覧
- GET /health
- POST /api/trades/import/csv
- GET /api/trades/notes
- GET /api/trades/notes/:id
- POST /api/matching/check
- GET /api/matching/history
- GET /api/notifications
- PUT /api/notifications/:id/read
- PUT /api/notifications/read-all
- DELETE /api/notifications/:id
- DELETE /api/notifications
- GET /api/orders/preset/:noteId
- POST /api/orders/confirmation

## エンドポイント詳細
### GET /health
- 説明: サーバーとスケジューラー状態の簡易チェック
- レスポンス例:
```json
{
  "status": "ok",
  "timestamp": "2025-12-21T11:18:38.099Z",
  "schedulerRunning": true
}
```

### POST /api/trades/import/csv
- 説明: data/trades 配下の CSV からトレードを読み込み、ノートを生成
- リクエスト
```json
{
  "filename": "sample_trades.csv"
}
```
- 成功レスポンス
```json
{
  "success": true,
  "tradesImported": 5,
  "notesGenerated": 5,
  "notes": [{ "id": "uuid", "symbol": "BTCUSDT", "timestamp": "2024-01-15T10:30:00.000Z" }]
}
```
- 主なエラー: file_not_found, parse_error

### GET /api/trades/notes
- 説明: 全ノート一覧を取得
- クエリ: なし（将来 pagination 追加予定）
- 成功レスポンス: notes 配列（TradeNote 要約を返却）

### GET /api/trades/notes/:id
- 説明: 特定ノート詳細を取得
- パスパラメータ: id (UUID)
- 成功レスポンス: TradeNote 詳細 + AISummary + featureVector
- エラー: not_found

### POST /api/matching/check
- 説明: マッチングを即時実行し、結果を返却
- リクエスト: なし（将来 symbol フィルタ追加予定）
- 成功レスポンス
```json
{
  "success": true,
  "matches": [
    {
      "noteId": "uuid",
      "symbol": "BTCUSDT",
      "score": 0.91,
      "threshold": 0.75,
      "trendMatched": true,
      "priceRangeMatched": true,
      "marketSnapshot": { "close": 42550, "rsi": 55 }
    }
  ]
}
```

### GET /api/matching/history
- 説明: これまで検出されたマッチ履歴を取得
- クエリ: なし（将来 timeframe/symbol でフィルタ予定）
- レスポンス: MatchResult 配列

### GET /api/notifications
- 説明: 通知一覧取得
- クエリ: unreadOnly=true で未読のみ
- レスポンス: Notification 配列（id, title, message, status, sentAt, readAt）

### PUT /api/notifications/:id/read
- 説明: 通知を既読化
- レスポンス: 成功フラグ

### PUT /api/notifications/read-all
- 説明: 全通知を既読化
- レスポンス: 成功フラグ

### DELETE /api/notifications/:id
- 説明: 特定通知を削除
- レスポンス: 成功フラグ

### DELETE /api/notifications
- 説明: 全通知を削除
- レスポンス: 成功フラグ

### GET /api/orders/preset/:noteId
- 説明: ノートに基づく注文プリセットを生成
- パスパラメータ: noteId (UUID)
- レスポンス例:
```json
{
  "symbol": "BTCUSDT",
  "side": "buy",
  "suggestedPrice": 42500,
  "suggestedQuantity": 0.1,
  "confidence": 0.91,
  "feesEstimate": 4.25
}
```
- エラー: not_found, invalid_state

### POST /api/orders/confirmation
- 説明: 発注前確認情報を計算（実行は行わない）
- リクエスト
```json
{
  "symbol": "BTCUSDT",
  "side": "buy",
  "price": 42500,
  "quantity": 0.1
}
```
- レスポンス例:
```json
{
  "estimatedCost": 4250,
  "estimatedFees": 4.25,
  "total": 4254.25,
  "warning": "これは参考情報であり、自動発注は行われません"
}
```
- エラー: validation_error

## 認証・セキュリティの扱い（暫定）
- 現状: 認証なし、CORS は開発向け緩和設定を前提
- 今後: JWT or API キー、レートリミット、HTTPS、入力バリデーション強化を Phase1 で設計

## 完成度メモ（80% で停止）
- 各レスポンスのフィールド定義（型/必須/nullable）の OpenAPI 形式化は未着手
- ページネーション・フィルタリング・ソートの仕様は Phase1 で確定
