# TradeAssist アーキテクチャ

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        TradeAssist                              │
│                                                                 │
│  Core Value:                                                    │
│  1. Auto-generate & save structured trade notes                │
│  2. Match notes with real-time market conditions               │
│  3. Notify on high-confidence matches (no auto-trading)        │
│                                                                 │
│  Core Concept: 「ノートを評価の主語として扱う」                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 市場データソース

### Side-A: リアルタイム通知

- **cTrader Open API（WebSocket / Tick）** を使用
- OAuth 2.0 認証（ユーザーの cTrader ID で認証）
- 60秒ローリングウィンドウで Tick → OHLCV 集約
- 遅延: 1〜3秒（最大5秒）

### Side-B: バックテスト / 日次バッチ

- **Twelve Data REST API（無料枠）** を使用
- 800回/日、8回/分の制限内で運用

### 抽象化レイヤー

```typescript
interface IMarketDataProvider {
  getOHLCV(symbol: string, interval: string, limit?: number): Promise<OHLCVBar[]>;
  subscribeToTicks?(symbols: string[], callback: (tick: TickData) => void): void;
}
```

実装:
- `TwelveDataProvider` - Side-B用（REST）
- `CTraderProvider` - Side-A用（WebSocket）

---

## NoteEvaluator アーキテクチャ（正式仕様）

### 設計思想

TradeAssist は「ノート主体」の設計を採用しています。

- **市場**は「入力」
- **ノート**は「評価器」
- **特徴量ベクトル**はノート固有（次元数可変）

### インターフェース

```typescript
interface NoteEvaluator {
  readonly noteId: string;
  readonly symbol: string;
  
  // ノートが必要とするインジケーターを宣言
  requiredIndicators(): IndicatorSpec[];
  
  // 市場スナップショットからノート固有の特徴量ベクトルを構築
  buildFeatureVector(snapshot: MarketSnapshot): number[];
  
  // 類似度計算（デフォルト: コサイン類似度）
  similarity(vectorA: number[], vectorB: number[]): number;
  
  // 発火条件判定
  isTriggered(similarity: number): boolean;
  
  // 一括評価（便利メソッド）
  evaluate(snapshot: MarketSnapshot): EvaluationResult;
}
```

### 実装クラス

| クラス | 用途 | ベクトル次元 |
|--------|------|-------------|
| `LegacyNoteEvaluator` | 既存ノート互換 | 12次元固定 |
| `UserIndicatorNoteEvaluator` | ユーザー定義インジケーター | 可変 |

### ファクトリ関数

```typescript
// indicatorConfig の有無で自動切替
const evaluator = createNoteEvaluator(note);

// note.indicatorConfig が null → LegacyNoteEvaluator
// note.indicatorConfig が設定済み → UserIndicatorNoteEvaluator
```

### Service との連携

```
Service（matchingService, backtestService）
    │
    │  ① NoteEvaluator を生成
    ▼
createNoteEvaluator(note)
    │
    │  ② 必要なインジケーターを取得
    ▼
evaluator.requiredIndicators()
    │
    │  ③ 市場データ取得
    ▼
marketDataService.fetch(symbol, specs)
    │
    │  ④ 評価実行
    ▼
evaluator.evaluate(snapshot)
    │
    │  ⑤ 結果に基づき通知判定
    ▼
if (result.triggered) notify()
```

**重要なルール:**
- Service は類似度を直接計算しない
- Service は閾値を知らない
- Service は `NoteEvaluator.evaluate()` を呼ぶだけ

### 関連ファイル

- `src/domain/noteEvaluator.ts` - インターフェース定義
- `src/services/legacyNoteEvaluatorAdapter.ts` - 実装クラス
- `src/services/matchingService.ts` - マッチング処理
- `src/services/backtestService.ts` - バックテスト処理

---

## Architecture Diagram

```
┌───────────────────────┐
│   Data Sources        │
├───────────────────────┤
│ - CSV Files           │
│ - Exchange APIs       │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│                   Import Layer                            │
│  ┌─────────────────────────────────────────────────┐     │
│  │  TradeImportService                             │     │
│  │  - Parse CSV                                    │     │
│  │  - Validate data                                │     │
│  │  - Connect to APIs                              │     │
│  └─────────────────────────────────────────────────┘     │
└───────────┬───────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│                   Processing Layer                        │
│  ┌──────────────────────┐    ┌──────────────────────┐    │
│  │ TradeNoteService     │    │  AISummaryService    │    │
│  │ - Generate notes     │◄───│  - Create summaries  │    │
│  │ - Extract features   │    │  - Token efficient   │    │
│  │ - Store notes        │    └──────────────────────┘    │
│  └──────────────────────┘                                 │
└───────────┬───────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│                   Storage Layer                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │  File System (JSON)                             │     │
│  │  - data/notes/*.json                            │     │
│  │  - data/notifications.json                      │     │
│  └─────────────────────────────────────────────────┘     │
│  ※ Trade / NotificationLog / MatchResult は Prisma 経由で DB 保存を想定しつつ、現状通知一覧と既読状態は上記ファイルストアを利用しているハイブリッド構成。短期的な整合性確保のためフロントはファイルストアを参照。│
└───────────────────────────────────────────────────────────┘

┌───────────────────────┐         ┌───────────────────────┐
│  External Services    │         │   Scheduler           │
├───────────────────────┤         ├───────────────────────┤
│ - Market Data API     │◄────────│ - Periodic checks     │
│ - AI Service (OpenAI) │         │ - 15 min interval     │
│ - Push Notifications  │         │ - Trigger matching    │
└───────────────────────┘         └───────────┬───────────┘
            │                                  │
            ▼                                  ▼
┌───────────────────────────────────────────────────────────┐
│                   Matching Layer                          │
│  ┌──────────────────────┐    ┌──────────────────────┐    │
│  │ MarketDataService    │    │  MatchingService     │    │
│  │ - Fetch real-time    │───►│  - Compare features  │    │
│  │ - Calculate RSI/MACD │    │  - Cosine similarity │    │
│  │ - Determine trend    │    │  - Rule-based checks │    │
│  └──────────────────────┘    │  - Threshold filter  │    │
│                               └──────────┬───────────┘    │
└────────────────────────────────────────┬─┴────────────────┘
                                         │
                                         ▼
┌───────────────────────────────────────────────────────────┐
│                  Notification Layer                       │
│  ┌─────────────────────────────────────────────────┐     │
│  │  NotificationService                            │     │
│  │  - Store in-app notifications                  │     │
│  │  - Trigger push notifications                  │     │
│  │  - Manage read/unread status                   │     │
│  └─────────────────────────────────────────────────┘     │
└───────────┬───────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│                     API Layer                             │
│  ┌─────────────────────────────────────────────────┐     │
│  │  Express.js REST API                            │     │
│  │  - Trade endpoints                              │     │
│  │  - Matching endpoints                           │     │
│  │  - Notification endpoints                       │     │
│  │  - Order support endpoints                      │     │
│  └─────────────────────────────────────────────────┘     │
└───────────┬───────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────┐
│   Client/User         │
│  - REST API calls     │
│  - Manual order exec  │
│  - Review suggestions │
└───────────────────────┘
```

## Data Flow

### 1. Trade Import Flow
```
CSV/API → TradeImportService → TradeNormalizationService (Phase 1)
                                      ↓
                              TradeDefinitionService (Phase 1)
                                      ↓
                                AISummaryService
                                      ↓
                              TradeNoteService
                                      ↓
                             JSON File Storage
```

#### Phase 1: Definition Pipeline（定義化パイプライン）
```
CSV → TradeImportService.importFromCSV()
         ↓
TradeNormalizationService.normalizeTradeData()
  - タイムスタンプ UTC 正規化
  - シンボル正規化（BTCUSD → BTC/USD）
  - Side 正規化（buy/sell/long/short/日本語）
  - ユーザーフレンドリーエラーメッセージ生成
         ↓
TradeDefinitionService.generateDefinition()
  - MarketDataService から市場データ取得
  - IndicatorService で 20 種インジケーター計算
  - DerivedContext 導出（trend, volatility, momentum）
  - 特徴量ベクトル生成（20 次元）
         ↓
TradeNoteService.generateNote()
  - AI 要約生成
  - TradeNote 保存
```

### 2. Matching Flow (Scheduled)
```
Scheduler (15min) → MarketDataService → Fetch Real-time Data
                           ↓
                    MatchingService → Load Historical Notes
                           ↓
                    Compare Features → Cosine Similarity
                           ↓
                    Apply Rules → Trend + Price Range
                           ↓
                    Calculate Score → If >= Threshold
                           ↓
                    NotificationService → Create Notification
                           ↓
                    Push/In-App Notify → User Alerted
```

### 3. Order Support Flow
```
User Receives Match Notification
         ↓
View Order Preset (based on matched note)
         ↓
Review Suggestion (price, quantity, confidence)
         ↓
Get Order Confirmation (cost, fees, total)
         ↓
User Reviews Warning
         ↓
Manual Execution on Exchange (NO AUTO-TRADE)
```

## Component Responsibilities

### Services

**TradeImportService**
- Import trades from CSV files
- Parse and validate trade data
- Placeholder for exchange API integration

**TradeNormalizationService** (Phase 1)
- タイムスタンプ UTC 正規化
- シンボル名の標準化（表記揺れ吸収）
- Side 値の正規化（buy/sell/long/short/日本語対応）
- ユーザーフレンドリーなバリデーションエラー生成

**TradeDefinitionService** (Phase 1)
- Trade + MarketSnapshot + IndicatorSet を統合
- 特徴量ベクトル生成（pgvector 対応用）
- 派生コンテキスト導出（trend, volatility, momentum）
- バッチ処理対応

**IndicatorService** (Phase 1 拡張)
- 20 種類のテクニカル指標をサポート
  - Momentum: RSI, Stochastic, Williams%R, ROC, MFI
  - Trend: SMA, EMA, DEMA, TEMA, MACD, Aroon, CCI, PSAR, Ichimoku
  - Volatility: ATR, BB, KC
  - Volume: OBV, VWAP, CMF
- 同一インジケーター複数期間対応
- indicatorts ライブラリをラップ

**TradeNoteService**
- Generate structured notes from trades
- Extract feature vectors
- Manage note persistence (CRUD operations)

**AISummaryService**
- Generate concise AI summaries
- Token-efficient prompts
- Fallback to basic summaries

**MarketDataService**
- Fetch real-time market data
- Calculate technical indicators (RSI, MACD)
- Determine market trends

**CTraderProvider** (Side-A リアルタイム)
- cTrader Open API WebSocket 接続
- OAuth 2.0 認証（CTraderAuthService 経由）
- 複数シンボル Tick 購読
- 自動再接続 / エラーハンドリング

**CTraderAuthService**
- OAuth トークン交換・リフレッシュ
- CTraderToken テーブルへの永続化
- トークン期限管理

**RollingWindowService**
- 60秒ローリングウィンドウ管理
- Tick → OHLCV 集約
- シンボル別バッファ

**RealtimeSimilarityService**
- リアルタイム類似度チェック
- ノート評価 → 通知トリガー
- 24時間上限制御

**MatchingService**
- Compare historical notes with current market
- Feature vector comparison (cosine similarity)
- Rule-based validation
- Threshold filtering

**NotificationService**
- Create and store notifications
- Push notification framework
- Notification lifecycle management

### Controllers

**TradeController**
- Handle trade import requests
- Serve trade notes

**MatchingController**
- Trigger manual match checks
- Serve match history

**NotificationController**
- Serve notifications
- Update notification status

**OrderController**
- Generate order presets
- Provide order confirmations

### Utilities

**MatchingScheduler**
- Periodic matching checks
- Configurable intervals
- Graceful start/stop

## Key Design Decisions

### 1. File-Based Storage
- **Why**: Simplicity for MVP
- **Benefit**: No database setup required
- **Trade-off**: Limited scalability
- **Future**: Migrate to PostgreSQL/MongoDB

### 2. Feature Vector Matching
- **Why**: Numerical comparison of market conditions
- **Method**: Cosine similarity
- **Components**: Price, volume, RSI, MACD, trend, side
- **Benefit**: Objective, quantifiable matches

### 3. Threshold-Based Filtering
- **Why**: Reduce noise, focus on high-confidence matches
- **Default**: 0.75 (75% similarity)
- **Configurable**: Via environment variable
- **Benefit**: User controls sensitivity

### 4. No Auto-Trading
- **Why**: Safety and regulatory compliance
- **How**: All orders require manual user confirmation
- **Benefit**: User maintains full control
- **Key**: Judgment support, not automation

### 5. Low Frequency Focus
- **Why**: Stability over high-frequency noise
- **Timeframes**: 15 minutes, 1 hour
- **Benefit**: More reliable signals
- **Trade-off**: Slower to react

### 6. Token-Efficient AI
- **Why**: Minimize API costs
- **How**: Concise prompts, essential data only
- **Fallback**: Basic summaries if AI unavailable
- **Benefit**: Cost-effective operation

## Technology Stack

### Backend
- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Storage**: File system (JSON)

### Dependencies
- `express`: Web framework
- `cors`: Cross-origin requests
- `dotenv`: Environment configuration
- `csv-parser`: CSV file parsing
- `uuid`: Unique ID generation

### Development
- `typescript`: Type safety
- `ts-node`: Development execution
- `nodemon`: Auto-restart on changes

## Configuration

### Environment Variables
```
PORT=3000
NODE_ENV=development
AI_API_KEY=<your-key>
AI_MODEL=gpt-4o-mini
MARKET_API_URL=<url>
MARKET_API_KEY=<key>
MATCH_THRESHOLD=0.75
CHECK_INTERVAL_MINUTES=15
PUSH_NOTIFICATION_KEY=<key>
```

## Security Considerations

### Current State (MVP)
- No authentication
- No rate limiting
- Local file storage
- API keys in .env (not committed)

### Production Requirements
- JWT authentication
- API rate limiting
- HTTPS only
- Encrypted data storage
- Secrets management (AWS Secrets, Vault)
- Input validation & sanitization
- SQL injection prevention (when using DB)
- CORS configuration
- Security headers

## Scalability Path

### Current Limitations
- Single server instance
- File-based storage
- No caching
- Synchronous processing

### Future Improvements
1. **Database**: PostgreSQL for relational data
2. **Caching**: Redis for frequently accessed data
3. **Queue**: Bull/RabbitMQ for async processing
4. **Workers**: Separate matching workers
5. **Load Balancer**: Multiple server instances
6. **Monitoring**: Prometheus + Grafana
7. **Logging**: ELK stack

## API Design

### REST Principles
- Resource-based URLs
- Standard HTTP methods
- JSON request/response
- Meaningful status codes

### Response Format
```json
{
  "success": true,
  "data": { /* ... */ },
  "error": null
}
```

---

## Cron監視の類似度チェック（Side-B）

### 概要

Cron監視ジョブにおいて、AIトレードノート（AITradeNote）および人間トレードノート（TradeNote）との類似度をチェックし、閾値を超えた場合に自動通知を送信する機能。

### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cron監視フロー（1時間ごと）                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  1. 市場開場チェック                    │
        │     - 休場時はスキップ                  │
        └─────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  2. 市場データ取得（1分足60本）         │
        │     - MarketDataService              │
        │     - Twelve Data API                │
        └─────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  3. エントリー/決済判定               │
        │     - pending → open                 │
        │     - open → closed                  │
        └─────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  4. AIノート類似度チェック ★NEW        │
        │     - cronSimilarityService          │
        └─────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  4.1. 特徴量ベクトル生成              │
        │     - OHLCV → IndicatorService       │
        │     - 12次元特徴量                    │
        └─────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  4.2. 横断類似検索                    │
        │     - CrossSimilarityService         │
        │     - TradeNote + AITradeNote        │
        │     - コサイン類似度計算               │
        └─────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  4.3. 閾値判定（デフォルト85%）        │
        │     - 類似度 >= threshold             │
        │     - topK件まで取得                  │
        └─────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  4.4. 通知トリガー                    │
        │     - NotificationTriggerService     │
        │     - 冪等性チェック                  │
        │     - クールダウン検査                │
        │     - 24時間上限チェック              │
        └─────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  5. 通知送信                          │
        │     - in-app / Push / webhook        │
        │     - NotificationLog記録            │
        └─────────────────────────────────────┘
```

### 主要コンポーネント

#### CronSimilarityService

**責務:**
- Cron監視における類似度チェックの統括
- OHLCVデータから特徴量ベクトル生成
- 横断検索の実行と結果フィルタリング
- 通知トリガーとの連携

**設定:**
```typescript
{
  similarityThreshold: 0.85,    // 類似度閾値（0-1）
  topK: 5,                       // 取得する類似ノートの最大件数
  minSimilarity: 0.5,            // 検索対象の最小類似度
  searchTradeNotes: true,        // TradeNoteを検索
  searchAITradeNotes: true,      // AITradeNoteを検索
  notificationChannel: 'in_app', // 通知チャネル
  debug: false,                  // デバッグモード
}
```

**主要メソッド:**
```typescript
// 単一シンボルの類似度チェック
async checkSimilarityAndNotify(input: SimilarityCheckInput): Promise<SimilarityCheckResult>

// 複数シンボルの一括チェック
async checkMultipleSymbols(inputs: SimilarityCheckInput[]): Promise<SimilarityCheckResult[]>
```

#### CrossSimilarityService（再利用）

Side-A/Side-Bを横断した類似ノート検索を提供。

**責務:**
- TradeNoteとAITradeNoteの統合検索
- 特徴量ベクトルからのコサイン類似度計算
- 類似度スコアによる統一ソート

#### NotificationTriggerService（再利用）

通知判定・送信・履歴管理を担当。

**責務:**
- スコア閾値判定
- 冪等性チェック（同一条件の重複通知防止）
- クールダウン検査（同一ノートの再通知抑制）
- 24時間上限チェック（過負荷防止）
- NotificationLog永続化

### SideBScheduler統合

**設定:**
```typescript
{
  autoSimilarityCheck: true,     // 類似度チェック自動実行
  similarityThreshold: 0.85,     // 類似度閾値
}
```

**executeMonitorJob フロー:**
1. 市場開場チェック
2. 期限切れトレード自動キャンセル
3. 各シンボルについて:
   - 1分足60本取得
   - pending/openトレード検証
   - **AIノート類似度チェック（autoSimilarityCheck=trueの場合）**
4. Note自動生成（決済があった場合）
5. サマリーログ出力

**監視結果:**
```typescript
{
  processed: 10,           // 処理トレード件数
  entries: 2,              // エントリー件数
  exits: 1,                // 決済件数
  expired: 0,              // 期限切れキャンセル件数
  similarityChecks: 3,     // ★類似度チェック件数
  notificationsSent: 1,    // ★通知送信件数
  errors: [],
}
```

### 通知抑制メカニズム

**1. スコア閾値**
- デフォルト: 75%（環境変数 `NOTIFY_THRESHOLD`）
- 類似度チェック閾値とは独立（通常85%）

**2. 冪等性チェック**
- キー: `noteId × marketSnapshotId × channel`
- 同一条件での重複通知を防止

**3. クールダウン**
- デフォルト: 1時間（環境変数 `NOTIFICATION_COOLDOWN_MS`）
- 同一ノートへの再通知を時間制限

**4. 重複抑制**
- 5秒以内の同一条件通知を抑止

**5. 24時間上限**
- デフォルト: 30件（環境変数 `DAILY_NOTIFICATION_LIMIT`）
- リアルタイム通知の過負荷防止

### パフォーマンス最適化

**1. APIコスト削減**
- 既存の市場データ取得を再利用（追加コストなし）
- 1時間ごとの実行（過度な頻度を回避）

**2. 検索効率化**
- `minSimilarity`で事前フィルタ（デフォルト50%）
- `topK`で取得件数制限（デフォルト5件）
- コサイン類似度による高速計算

**3. エラー耐性**
- 類似度チェック失敗時も監視ジョブ全体は継続
- シンボル単位でのエラー隔離

### 設定例

**高精度モード（閾値90%）:**
```typescript
{
  autoSimilarityCheck: true,
  similarityThreshold: 0.90,
}
```

**多通知モード（閾値70%）:**
```typescript
{
  autoSimilarityCheck: true,
  similarityThreshold: 0.70,
}
```

**無効化:**
```typescript
{
  autoSimilarityCheck: false,
}
```

---

## Testing Strategy

### Manual Testing
- Health endpoint
- CSV import
- Note generation
- Matching checks
- Notification flow
- Order presets

### Future Automated Testing
- Unit tests (Jest)
- Integration tests
- E2E tests (Supertest)
- Load testing (k6)

## Monitoring & Observability

### Current Logging
- Console logging
- Server startup/shutdown
- Import success/failure
- Match results
- Notification triggers

### Future Monitoring
- Application metrics
- Error tracking (Sentry)
- Performance monitoring
- User analytics
- Alert system

## Deployment

### Current
- Local development
- Manual start/stop

### Production Ready
- Docker containerization
- CI/CD pipeline
- Environment-specific configs
- Health checks
- Graceful shutdown
- Process manager (PM2)

## License

ISC
