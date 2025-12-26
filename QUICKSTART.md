# クイックスタートガイド

Get TradeAssist MVP up and running in 5 minutes!

## Prerequisites

- Node.js 16 or higher
- npm (comes with Node.js)

## Installation Steps

### 1. Clone & Install

```bash
# Clone the repository
git clone <repository-url>
cd Trader-Note-Build-Ai

# Install dependencies
npm install
```

### 2. Configure

```bash
# Copy environment template
cp .env.example .env

# Optional: Edit .env to add your API keys
# nano .env
```

**Note:** The system works without API keys (uses simulated data). For production:
- Add `AI_API_KEY` for real AI summaries
- Add `MARKET_API_KEY` for real market data

### 3. Start the Server

```bash
# Development mode (auto-reload)
npm run dev

# OR Production mode
npm run build
npm start
```

You should see:
```
═══════════════════════════════════════
  TradeAssist MVP Server
═══════════════════════════════════════
  Environment: development
  Server running on port: 3000
  Match threshold: 0.75
  Check interval: 15 minutes
═══════════════════════════════════════
```

## First Steps

### Step 1: Import Sample Trades

```bash
curl -X POST http://localhost:3000/api/trades/import/csv \
  -H "Content-Type: application/json" \
  -d '{"filename": "sample_trades.csv"}'
```

Expected response:
```json
{
  "success": true,
  "tradesImported": 5,
  "notesGenerated": 5,
  "notes": [...]
}
```

### Step 2: View Generated Notes

```bash
curl http://localhost:3000/api/trades/notes | json_pp
```

You'll see structured notes with:
- Trade details (symbol, side, price, quantity)
- Market context (trend, indicators)
- AI summary
- Feature vector for matching

### Step 3: Check for Matches

```bash
curl -X POST http://localhost:3000/api/matching/check | json_pp
```

This compares your historical notes with current (simulated) market data.

### Step 4: View Notifications

```bash
curl http://localhost:3000/api/notifications | json_pp
```

If any matches were found above the threshold (75%), you'll see notifications here.

### Step 5: Get Order Preset

If you have a match, get an order preset:

```bash
# Replace {note-id} with an actual note ID from step 2
curl http://localhost:3000/api/orders/preset/{note-id} | json_pp
```

## Import Your Own Trades

### Create a CSV File

Create `data/trades/my_trades.csv`:

```csv
timestamp,symbol,side,price,quantity,fee,exchange
2024-12-20T10:00:00Z,BTCUSDT,buy,42000.00,0.1,4.20,Binance
2024-12-20T15:30:00Z,BTCUSDT,sell,42500.00,0.1,4.25,Binance
```

### Import Your Trades

```bash
curl -X POST http://localhost:3000/api/trades/import/csv \
  -H "Content-Type: application/json" \
  -d '{"filename": "my_trades.csv"}'
```

## Understanding the System

### How It Works

1. **Import**: You import your trade history
2. **Note Generation**: System creates structured notes with AI summaries
3. **Matching**: Every 15 minutes, system checks if current market conditions match your historical trades
4. **Notification**: If a match exceeds 75% similarity, you get notified
5. **Order Support**: You can review suggested orders based on matches
6. **Manual Execution**: YOU decide whether to execute (no auto-trading)

### Key Configuration

Edit `.env` to adjust:

```env
# How similar must conditions be to notify you? (0-1)
MATCH_THRESHOLD=0.75

# How often to check for matches? (minutes)
CHECK_INTERVAL_MINUTES=15
```

## Common Tasks

### Check Server Health

```bash
curl http://localhost:3000/health
```

### View All Endpoints

See README.md or docs/API.md for complete endpoint documentation.

### Stop the Server

Press `Ctrl+C` in the terminal where the server is running.

## Troubleshooting

**Server won't start on port 3000?**
- Edit `.env` and change `PORT=3000` to another port like `PORT=3001`

**Import fails?**
- Check CSV format matches the expected structure
- Ensure file is in `data/trades/` directory
- Check file permissions

**No matches found?**
- This is normal! Matches only occur when current market closely resembles your historical trades
- Try lowering `MATCH_THRESHOLD` to 0.6 for more matches
- Remember: market data is simulated without API keys

**Want real market data?**
- Sign up for a market data API (e.g., Binance, CoinGecko)
- Add API credentials to `.env`
- Modify `marketDataService.ts` to use real API

## Next Steps

1. **Read the User Guide**: `docs/USER_GUIDE.md` for detailed workflows
2. **Understand the API**: `docs/API.md` for all endpoints
3. **Learn the Algorithm**: `docs/MATCHING_ALGORITHM.md` for matching logic
4. **Review Architecture**: `docs/ARCHITECTURE.md` for system design

## Need Help?

- Check the documentation in `docs/` directory
- Review the CHANGELOG.md for known limitations
- Examine the code in `src/` for implementation details

## Development

### Run in Development Mode

```bash
npm run dev
```

Auto-reloads on file changes.

### Build for Production

```bash
npm run build
```

Creates optimized JavaScript in `dist/` directory.

### Project Structure

```
src/
├── config/          # Environment configuration
├── controllers/     # Request handlers
├── models/          # TypeScript types
├── routes/          # API routes
├── services/        # Business logic
└── utils/           # Helper utilities

data/
├── trades/          # CSV import files
└── notes/           # Generated trade notes

docs/
├── API.md          # API documentation
├── USER_GUIDE.md   # User workflows
├── ARCHITECTURE.md # System design
└── MATCHING_ALGORITHM.md  # Algorithm details
```

---

**Congratulations!** You now have a working TradeAssist MVP that:
- ✓ Auto-generates trade notes from your history
- ✓ Matches current market with historical patterns
- ✓ Notifies you of high-confidence opportunities
- ✓ Suggests orders while keeping you in control

Happy trading! 🚀
