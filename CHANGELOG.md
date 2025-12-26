# 変更ログ

All notable changes to TradeAssist MVP will be documented in this file.

## [1.0.0] - 2025-12-21

### 追加 - 初期 MVP リリース

#### コア機能
- **トレード インポート システム**
  - CSV ファイル インポート機能
  - トレード データ検証とパース
  - 取引所 API 統合のプレースホルダー

- **Trade Note Generation**
  - Automatic structured note creation from trades
  - Market context capture (timeframe, trend, indicators)
  - Feature vector extraction for matching
  - Persistent JSON storage

- **AI Summary Service**
  - Token-efficient AI summary generation
  - Fallback to basic summaries when AI unavailable
  - Configurable AI model support

- **Market Data Service**
  - Real-time market data fetching (simulated)
  - Support for 15m and 1h timeframes
  - Technical indicator calculation (RSI, MACD)
  - Trend determination

- **Matching System**
  - Cosine similarity-based feature matching
  - Rule-based trend and price range checks
  - Configurable match threshold
  - Weighted scoring algorithm

- **Notification System**
  - In-app notification storage
  - Push notification framework (ready for integration)
  - Notification read/unread status
  - Notification history management

- **Order Support UI**
  - Order preset generation from matched notes
  - Order confirmation with cost estimates
  - Safety warnings and user confirmation workflow
  - No automatic trade execution

- **Scheduler**
  - Periodic matching checks (configurable interval)
  - Automatic notification on matches
  - Graceful start/stop

#### API Endpoints
- `GET /health` - Health check
- `POST /api/trades/import/csv` - Import trades from CSV
- `POST /api/trades/import/api` - Import from API (placeholder)
- `GET /api/trades/notes` - Get all notes
- `GET /api/trades/notes/:id` - Get specific note
- `POST /api/matching/check` - Manual match check
- `GET /api/matching/history` - Match history
- `GET /api/notifications` - Get notifications
- `PUT /api/notifications/:id/read` - Mark as read
- `PUT /api/notifications/read-all` - Mark all as read
- `DELETE /api/notifications/:id` - Delete notification
- `DELETE /api/notifications` - Clear all
- `GET /api/orders/preset/:noteId` - Generate order preset
- `POST /api/orders/confirmation` - Get order confirmation

#### Documentation
- Comprehensive README with feature overview
- API documentation (docs/API.md)
- User guide (docs/USER_GUIDE.md)
- Sample trade CSV data
- Environment configuration examples

#### Infrastructure
- TypeScript implementation
- Express.js REST API
- File-based data storage (JSON)
- Environment-based configuration
- Development and production build scripts

### Design Decisions
- **No Auto-Trading**: System provides judgment support only
- **Low Frequency Focus**: 15m/1h timeframes for stability
- **Threshold-Based**: Only high-confidence matches notify users
- **Token Efficiency**: Minimal AI API usage to reduce costs
- **Accountability**: All notes include context and reasoning

### Known Limitations
- Market data is currently simulated (requires real API integration)
- AI summaries use placeholder implementation (requires OpenAI key)
- Push notifications framework ready but not connected to service
- Exchange API import is placeholder only
- No database (uses file storage)
- No authentication/authorization
- No rate limiting

### Future Roadmap
- Real market data API integration
- Full OpenAI integration for summaries
- Push notification service integration (FCM, APNs)
- Exchange API connections (Binance, Coinbase, etc.)
- Database backend (PostgreSQL, MongoDB)
- User authentication and authorization
- WebSocket support for real-time updates
- Advanced technical analysis indicators
- Backtesting capabilities
- Portfolio management
- Risk management tools
