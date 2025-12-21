# TradeAssist MVP User Guide

## Getting Started

### Prerequisites
- Node.js 16+ installed
- Basic knowledge of trading concepts
- (Optional) API keys for AI services and market data

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Trader-Note-Build-Ai
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your API keys and preferences
```

4. Start the server:
```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

---

## Core Workflows

### 1. Import Trade History

**Option A: From CSV File**

1. Prepare your CSV file with the following format:
```csv
timestamp,symbol,side,price,quantity,fee,exchange
2024-01-15T10:30:00Z,BTCUSDT,buy,42500.00,0.1,4.25,Binance
```

2. Place the file in `data/trades/` directory

3. Import via API:
```bash
curl -X POST http://localhost:3000/api/trades/import/csv \
  -H "Content-Type: application/json" \
  -d '{"filename": "your_trades.csv"}'
```

**Option B: From Exchange API** (Coming Soon)

API integration for direct import from exchanges will be added in future versions.

---

### 2. Generate and View Trade Notes

Trade notes are automatically generated during import. Each note includes:
- Trade details (symbol, side, price, quantity)
- Market context (timeframe, trend, indicators)
- AI-generated summary
- Feature vector for matching

**View all notes:**
```bash
curl http://localhost:3000/api/trades/notes
```

**View specific note:**
```bash
curl http://localhost:3000/api/trades/notes/{note-id}
```

Notes are stored as JSON files in `data/notes/` directory.

---

### 3. Monitor Market Matches

The system automatically checks for matches every 15 minutes (configurable).

**Manual match check:**
```bash
curl -X POST http://localhost:3000/api/matching/check
```

**How matching works:**
1. Fetches current market data for each symbol in your notes
2. Extracts features from current market state
3. Compares with historical note features using cosine similarity
4. Applies rule-based checks (trend match, price range)
5. Calculates final match score (0-1)
6. Triggers notification if score exceeds threshold (default: 0.75)

---

### 4. Receive and Manage Notifications

When a match is found above the threshold:
- A notification is created
- Push notification is sent (if configured)
- In-app notification is stored

**View notifications:**
```bash
# All notifications
curl http://localhost:3000/api/notifications

# Unread only
curl http://localhost:3000/api/notifications?unreadOnly=true
```

**Mark as read:**
```bash
curl -X PUT http://localhost:3000/api/notifications/{id}/read
```

**Clear notifications:**
```bash
curl -X DELETE http://localhost:3000/api/notifications
```

---

### 5. Use Order Support Features

When you receive a match notification, you can:

**Generate order preset:**
```bash
curl http://localhost:3000/api/orders/preset/{note-id}
```

This returns suggested order parameters based on:
- Historical trade from the note
- Current market conditions
- Confidence score

**Get order confirmation:**
```bash
curl -X POST http://localhost:3000/api/orders/confirmation \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSDT",
    "side": "buy",
    "price": 42500,
    "quantity": 0.1
  }'
```

This returns:
- Estimated cost
- Estimated fees
- Total amount
- Warning message

**Important:** The system NEVER executes trades automatically. You must:
1. Review the suggested order
2. Confirm the details
3. Manually execute on your exchange

---

## Configuration

### Environment Variables

Edit `.env` to configure:

**Server Settings:**
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

**AI Configuration:**
- `AI_API_KEY`: Your AI service API key (OpenAI, etc.)
- `AI_MODEL`: Model to use (default: gpt-4o-mini)

**Market Data:**
- `MARKET_API_URL`: Market data provider URL
- `MARKET_API_KEY`: API key for market data

**Matching Settings:**
- `MATCH_THRESHOLD`: Score threshold for matches (0-1, default: 0.75)
- `CHECK_INTERVAL_MINUTES`: How often to check for matches (default: 15)

**Notifications:**
- `PUSH_NOTIFICATION_KEY`: Push notification service key

### Adjusting Match Sensitivity

The `MATCH_THRESHOLD` determines how similar current market conditions must be to trigger a notification:

- `0.9-1.0`: Very strict (only very similar conditions)
- `0.75-0.9`: Moderate (recommended)
- `0.5-0.75`: Loose (more notifications)
- `<0.5`: Very loose (many false positives)

---

## Best Practices

### Trade Import
1. Keep CSV files organized in `data/trades/`
2. Use consistent timestamp format (ISO 8601)
3. Include all available trade details

### Note Management
1. Periodically review generated notes
2. Verify AI summaries are accurate
3. Archive old notes if needed

### Matching
1. Start with default threshold (0.75) and adjust based on results
2. Monitor match quality over time
3. Use manual checks to test configuration changes

### Order Execution
1. **Always** review suggested orders carefully
2. Check current market conditions
3. Consider additional factors (news, trends, risk)
4. Never blindly follow suggestions
5. Use appropriate position sizing

---

## Troubleshooting

### No matches found
- Check if you have imported trades
- Verify market data is being fetched
- Lower the `MATCH_THRESHOLD`
- Check server logs for errors

### Import fails
- Verify CSV format matches expected structure
- Check file permissions
- Ensure file is in `data/trades/` directory

### AI summaries are generic
- Add your AI API key to `.env`
- Verify API key is valid
- Check AI service status

### Server won't start
- Check port 3000 is not in use
- Verify all dependencies are installed
- Check `.env` file exists
- Review error messages in console

---

## Data Privacy & Security

### Important Notes
1. All data is stored locally in `data/` directory
2. No trade data is sent to external services (except AI summaries)
3. In production, implement authentication
4. Secure your API keys
5. Do not commit `.env` to version control

### Recommended Production Setup
1. Use environment-based secrets management
2. Implement API authentication (JWT)
3. Add rate limiting
4. Use HTTPS
5. Regular backups of `data/` directory
6. Monitor for suspicious activity

---

## Support & Contribution

For issues, questions, or contributions, please refer to the project repository.

### Common Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Import sample trades (for testing)
curl -X POST http://localhost:3000/api/trades/import/csv \
  -H "Content-Type: application/json" \
  -d '{"filename": "sample_trades.csv"}'

# Check server health
curl http://localhost:3000/health
```
