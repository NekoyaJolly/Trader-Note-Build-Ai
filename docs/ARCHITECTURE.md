# TradeAssist MVP アーキテクチャ

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        TradeAssist MVP                          │
│                                                                 │
│  Core Value:                                                    │
│  1. Auto-generate & save structured trade notes                │
│  2. Match notes with real-time market conditions               │
│  3. Notify on high-confidence matches (no auto-trading)        │
└─────────────────────────────────────────────────────────────────┘
```

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
