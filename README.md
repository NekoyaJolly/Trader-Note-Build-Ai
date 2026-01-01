# TradeAssist

TradeAssist は、トレード履歴を自動的に構造化したトレードノートとして生成し、リアルタイム市場データとマッチングさせることで、実行可能なインサイトを提供する**ノート主体のインテリジェント取引支援システム**です。

## コンセプト

> **「過去の自分のトレードを"定義済みの知識資産（ノート）"へ変換し、現在市場と照合して"再現可能な優位性"を通知・発注導線で即実行できる状態にする」**

自動売買は一切行いません。判断の質を高める支援ツールとして設計されています。

## Core Features

### 1. ノート自動生成（Automatic Trade Note Generation）
- CSV / Exchange API からのトレード履歴インポート
- 12次元特徴量ベクトルによる市場状況の構造化
- AI によるトレードサマリー自動生成
- ノートは「評価の主語」として設計（NoteEvaluator アーキテクチャ）

### 2. リアルタイム市場マッチング（Real-Time Market Matching）
- 15分 / 1時間足のリアルタイム市場データ取得
- **NoteEvaluator 経由**でノートと現在市場を比較評価
- 12次元コサイン類似度 + ルールベースチェック
- 閾値超過時に通知発火

### 3. スマート通知（Smart Notifications）
- プッシュ通知 / アプリ内通知
- 既読・未読管理
- 冪等性・クールダウン・重複抑制による再通知防止

### 4. 発注支援 UI（Order Support UI）
- マッチしたノートから注文プリセット生成
- 価格・数量のサジェスト表示
- **自動発注なし** - すべての注文にユーザー確認が必要

### 5. バックテスト機能（Backtest）
- 過去データでのノート有効性検証
- NoteEvaluator 経由での統一評価
- 戦略別パフォーマンス分析

## Installation

### Backend

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration
# - AI_API_KEY: Your AI service API key (OpenAI, etc.)
# - MARKET_API_KEY: Your market data API key
# - PUSH_NOTIFICATION_KEY: Your push notification service key
# - DATABASE_URL: PostgreSQL 接続文字列（例: postgresql://postgres:postgres@localhost:5432/tradeassist）

# Prisma クライアントと初期マイグレーションを適用
npm run prisma:generate
npm run prisma:migrate
```

### Frontend (Phase5 UI)

```bash
# フロントエンドディレクトリに移動
cd src/frontend

# 依存関係インストール
npm install

# 環境変数設定
cp .env.example .env.local

# .env.local を編集してバックエンド URL を設定
# NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

## Usage

### Development Mode

#### Backend のみ起動

```bash
npm run dev:backend
```

#### Frontend のみ起動

```bash
npm run dev:frontend
```

#### Backend + Frontend 同時起動

```bash
npm run dev
```

* Backend: http://localhost:3100 (環境変数 `BACKEND_PORT` で変更可)
* Frontend: http://localhost:3001 (デフォルト)

### Production Mode

```bash
# Build the project
npm run build

# Start the server
npm start
```

## API Endpoints

### Trade Import & Notes

**Import trades from CSV（ノート自動生成）**
```
POST /api/trades/import/csv
Body: { "filename": "sample_trades.csv" }
Response: { 
  "success": true, 
  "tradesImported": 5, 
  "tradesSkipped": 0,
  "importErrors": [],
  "insertedIds": ["uuid-1", "uuid-2", ...],
  "notesGenerated": 5,
  "noteIds": ["note-uuid-1", "note-uuid-2", ...]
}
```

**Upload CSV text（クライアントからCSVを送信）**
```
POST /api/trades/import/upload-text
Body: { 
  "filename": "my_trades.csv", 
  "csvText": "timestamp,symbol,side,...\n..." 
}
Response: { 
  "success": true, 
  "tradesImported": 1, 
  "noteIds": ["note-uuid-1"]
}
```

**Get all trade notes**
```
GET /api/trades/notes
```

**Get specific trade note**
```
GET /api/trades/notes/:id
```

### Matching

**Manually trigger match check**
```
POST /api/matching/check
```

**Get match history（DBから取得）**
```
GET /api/matching/history?symbol=BTCUSDT&limit=50
Response: {
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
      "evaluatedAt": "2025-12-27T01:27:30Z"
    }
  ]
}
```

### Notifications

**Get all notifications**
```
GET /api/notifications?unreadOnly=true
```

**Check and notify（再通知防止適用）**
```
POST /api/notifications/check
※ 現在の実装ではリクエストボディは無視され、サーバ側で最新のマッチングを再実行します。

Response: { 
  "processed": 5,
  "notified": 2,
  "skipped": 3,
  "shouldNotify": true,
  "results": [
    { "noteId": "uuid", "shouldNotify": true, "status": "sent" },
    { "noteId": "uuid", "shouldNotify": false, "status": "skipped", "skipReason": "クールダウン中" }
  ]
}
```

**Get notification logs**
```
GET /api/notifications/logs?symbol=BTCUSDT&limit=50
```

**Mark notification as read**
```
PUT /api/notifications/:id/read
```

**Mark all as read**
```
PUT /api/notifications/read-all
```

**Delete notification**
```
DELETE /api/notifications/:id
```

### Orders

**Generate order preset**
```
GET /api/orders/preset/:noteId
```

**Get order confirmation**
```
POST /api/orders/confirmation
Body: {
  "symbol": "BTCUSDT",
  "side": "buy",
  "price": 42500,
  "quantity": 0.1
}
```

### Health Check

**Check server status**
```
GET /health
```

### Backtest

**バックテスト実行**
```
POST /api/backtest
Body: {
  "noteId": "uuid",        // 対象ノートID
  "symbol": "BTCUSDT",     // シンボル（省略可、ノートのsymbolを使用）
  "from": "2024-01-01",    // 開始日（省略可）
  "to": "2024-12-31",      // 終了日（省略可）
  "limit": 100             // 最大データ件数（省略可）
}
Response: {
  "success": true,
  "results": [...],       // 評価結果配列
  "summary": {
    "totalEvaluations": 100,
    "triggeredCount": 15,
    "averageSimilarity": 0.68
  }
}
```

**バックテスト履歴取得**
```
GET /api/backtest/results?noteId=uuid&limit=50
```

## Architecture

### NoteEvaluator アーキテクチャ

TradeAssist は「ノート主体」の設計を採用しています。

```
┌─────────────────────────────────────────────────────────┐
│                      NoteEvaluator                       │
│  ノートを「評価の主語」として扱う抽象インターフェース     │
├─────────────────────────────────────────────────────────┤
│  getRequiredIndicators(): IndicatorSpec[]               │
│  buildEntryVector(snapshot): number[]                    │
│  evaluate(snapshot): EvaluationResult                    │
└─────────────────────────────────────────────────────────┘
         ▲                              ▲
         │                              │
┌────────┴────────┐           ┌────────┴────────┐
│ LegacyAdapter   │           │ UserIndicator   │
│ (12次元固定)    │           │ (可変次元)      │
└─────────────────┘           └─────────────────┘
```

**設計原則:**
- Service は類似度を直接計算しない
- Service は閾値を知らない
- Service は `NoteEvaluator.evaluate()` を呼ぶだけ
- EntryVector 構築はノート側の責務

### Services

- **TradeImportService**: CSV/API からのトレードデータ取込（自動ノート生成呼び出し）
- **TradeNoteService**: 構造化トレードノートの生成・管理（FS 保存、MarketDataService 経由でインジケーター取得）
- **AISummaryService**: AI によるトレードサマリー生成
- **MarketDataService**: リアルタイム市場データ取得（indicatorService 経由で RSI/MACD/BB/SMA/EMA 計算）
- **FeatureVectorService**: 12次元特徴量ベクトルの生成・比較
- **NoteEvaluatorAdapter**: NoteEvaluator インターフェースの実装（Legacy/UserIndicator）
- **MatchingService**: NoteEvaluator 経由でノートと現在市場を評価（MatchResult を DB 永続化）
- **BacktestService**: NoteEvaluator 経由で過去データ評価
- **NotificationService**: 通知管理（プッシュ & アプリ内、FS 保存）
- **NotificationTriggerService**: 通知判定・冪等性・クールダウン・重複抑制（NotificationLog を DB 永続化）

### 12次元特徴量ベクトル

市場状況を数値化するための統一ベクトル形式：

```
[0]  RSI(14) 正規化値
[1]  MACD ヒストグラム正規化値
[2]  MACD シグナルクロス状態
[3]  BB 位置（%B）
[4]  BB バンド幅正規化値
[5]  SMA(20) 乖離率
[6]  EMA(12) 乖離率
[7]  価格変化率（直近N本）
[8]  出来高変化率
[9]  トレンド方向（-1/0/1）
[10] ボラティリティ正規化値
[11] モメンタム複合指標
```

### Matching Algorithm

1. **特徴量抽出**: NoteEvaluator がノートと市場から特徴量ベクトルを構築
2. **コサイン類似度**: 12次元ベクトル間の類似度計算（NaN/Infinity 防御付き）
3. **ルールベースチェック**: トレンド一致・価格範囲の追加検証
4. **スコア統合**: 類似度 + トレンド + 価格範囲 → 最終スコア（重み: 0.6 / 0.3 / 0.1）
5. **閾値フィルタ**: 設定閾値超過時のみ通知発火
6. **通知抑制**: 冪等性（noteId×snapshotId×channel）、クールダウン（1時間）、重複抑制（5秒）

### Scheduler

The matching scheduler runs automatically at configured intervals (default: 15 minutes) to:
- Check all stored trade notes against current market conditions
- Generate match scores for each symbol
- Send notifications for matches above threshold

## CSV Format

Place CSV files in `data/trades/` directory with the following format:

```csv
timestamp,symbol,side,price,quantity,fee,exchange
2024-01-15T10:30:00Z,BTCUSDT,buy,42500.00,0.1,4.25,Binance
```

## Configuration

Edit `.env` to configure:

- `BACKEND_PORT` / `PORT`: Server port (default: 3100)
- `DATABASE_URL`: PostgreSQL connection string (required)
- `AI_API_KEY`: Your AI service API key
- `AI_MODEL`: AI model to use (default: gpt-5-mini)
- `AI_BASE_URL`: AI API base URL (default: https://api.openai.com/v1)
- `MARKET_API_URL`: Market data API URL
- `MARKET_API_KEY`: Market data API key
- `MATCH_THRESHOLD`: Match score threshold (0-1, default: 0.75)
- `CHECK_INTERVAL_MINUTES`: Matching check interval (default: 15)
- `CRON_ENABLED`: Enable scheduler (default: true)
- `PUSH_NOTIFICATION_KEY`: Push notification service key

## Web UI

TradeAssist は統合された Web UI を提供しています。

### 実装画面

| パス | 機能 |
|------|------|
| `/` | ホーム画面（システム概要、ナビゲーション） |
| `/onboarding` | 初回セットアップウィザード |
| `/import` | CSV インポート画面 |
| `/notes` | ノート一覧 |
| `/notes/:id` | ノート詳細（特徴量・サマリー・バックテスト） |
| `/notifications` | 通知一覧（未読/既読管理） |
| `/notifications/:id` | 通知詳細（判定理由可視化） |
| `/backtest` | バックテスト実行・結果表示 |
| `/orders` | 注文プリセット・確認 |
| `/settings` | ユーザー設定（閾値・インジケーター） |
| `/strategies` | 戦略管理 |

### 設計原則

* **判断はユーザーが行う**: 自動売買は一切行いません
* **UI は説明責任を果たす**: 判定理由を完全可視化
* **「当たる」より「納得できる」**: 理解可能な通知を優先

詳細は [src/frontend/README.md](src/frontend/README.md) を参照。

## Testing

```bash
# 全テスト実行
npm test

# 特定ファイルのみ
npm test -- src/services/__tests__/featureVectorService.test.ts

# カバレッジ付き
npm test -- --coverage
```

現在のテスト数: **365 テスト** 全パス

## Contributing

開発ガイドラインは [AGENTS.md](AGENTS.md) を参照してください。

主なルール:
- すべてのコメントは**日本語**で記述
- テスト未実装の変更は未完了扱い
- 新規ライブラリ追加時は人間確認必須

## License

ISC