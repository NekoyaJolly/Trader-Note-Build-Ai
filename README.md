# TradeAssist MVP

TradeAssist MVP は、トレード履歴を自動的に構造化したトレードノートとして生成し、リアルタイム市場データとマッチングさせることで、実行可能なインサイトを提供するインテリジェントな取引支援システムです。 that automatically generates structured trade notes and matches them with real-time market conditions to provide actionable insights.

## Core Features

### 1. Automatic Trade Note Generation
- Import trade history from CSV files or exchange APIs
- Generate structured trade notes with market context
- AI-powered summaries for each trade
- Persistent storage of all trade notes

### 2. Real-Time Market Matching
- Fetches real-time market data (15-minute and 1-hour intervals)
- Compares current market conditions with historical trade notes
- Calculates match scores using feature vectors and cosine similarity
- Triggers notifications when match threshold is exceeded

### 3. Smart Notifications
- Push notifications for high-confidence matches
- In-app notification system
- Read/unread status tracking
- Notification history

### 4. Order Support UI
- Generate order presets based on matched notes
- Display suggested prices and quantities
- User confirmation workflow
- **No automatic trading** - all orders require user approval

## Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration
# - AI_API_KEY: Your AI service API key (OpenAI, etc.)
# - MARKET_API_KEY: Your market data API key
# - PUSH_NOTIFICATION_KEY: Your push notification service key
# - DB_URL: PostgreSQL 接続文字列（例: postgresql://postgres:postgres@localhost:5432/tradeassist）

# Prisma クライアントと初期マイグレーションを適用
npm run prisma:generate
npm run prisma:migrate
```

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
# Build the project
npm run build

# Start the server
npm start
```

## API Endpoints

### Trade Import & Notes

**Import trades from CSV**
```
POST /api/trades/import/csv
Body: { "filename": "sample_trades.csv" }
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

**Get match history**
```
GET /api/matching/history
```

### Notifications

**Get all notifications**
```
GET /api/notifications?unreadOnly=true
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

## Architecture

### Services

- **TradeImportService**: Imports trade data from CSV/API
- **TradeNoteService**: Generates and manages structured trade notes
- **AISummaryService**: Generates AI-powered trade summaries
- **MarketDataService**: Fetches real-time market data
- **MatchingService**: Matches historical notes with current market
- **NotificationService**: Manages notifications (push & in-app)

### Matching Algorithm

1. **Feature Extraction**: Extracts numerical features from trade notes and market data
2. **Cosine Similarity**: Compares feature vectors to calculate base similarity
3. **Rule-Based Checks**: Additional checks for trend matching and price range
4. **Weighted Score**: Combines similarity, trend match, and price range into final score
5. **Threshold Filtering**: Only matches above configured threshold trigger notifications

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

- `PORT`: Server port (default: 3000)
- `AI_API_KEY`: Your AI service API key
- `AI_MODEL`: AI model to use (default: gpt-4o-mini)
- `MARKET_API_URL`: Market data API URL
- `MARKET_API_KEY`: Market data API key
- `MATCH_THRESHOLD`: Match score threshold (0-1, default: 0.75)
- `CHECK_INTERVAL_MINUTES`: Matching check interval (default: 15)
- `PUSH_NOTIFICATION_KEY`: Push notification service key

## Design Principles

1. **No Auto-Trading**: System provides suggestions only; user must confirm all trades
2. **Token Efficiency**: AI summaries are concise to minimize API costs
3. **Accountability**: All trade notes include context and reasoning
4. **Low Frequency**: Focus on 15m/1h intervals for stability
5. **Threshold-Based**: Only high-confidence matches trigger notifications

## Project Structure

```
src/
├── config/          # Configuration management
├── controllers/     # Route controllers
├── models/          # TypeScript interfaces
├── routes/          # API routes
├── services/        # Business logic services
└── utils/           # Utility functions (scheduler, etc.)

data/
├── trades/          # Trade CSV files
└── notes/           # Stored trade notes (JSON)
```

## License

ISC