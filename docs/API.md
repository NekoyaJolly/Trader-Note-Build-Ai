# API Documentation

## Base URL
```
http://localhost:3000
```

## Authentication
Currently no authentication is required. In production, implement JWT or API key authentication.

---

## Endpoints

### Health Check

#### GET /health
Check server health and scheduler status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-21T11:18:38.099Z",
  "schedulerRunning": true
}
```

---

### Trade Import & Notes

#### POST /api/trades/import/csv
Import trades from a CSV file in the `data/trades/` directory.

**Request Body:**
```json
{
  "filename": "sample_trades.csv"
}
```

**Response:**
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
Get all stored trade notes.

#### GET /api/trades/notes/:id
Get a specific trade note by ID.

---

### Matching

#### POST /api/matching/check
Manually trigger a match check against current market conditions.

#### GET /api/matching/history
Get history of all matches found.

---

### Notifications

#### GET /api/notifications
Get all notifications (query param: `unreadOnly=true` for unread only).

#### PUT /api/notifications/:id/read
Mark a notification as read.

#### PUT /api/notifications/read-all
Mark all notifications as read.

#### DELETE /api/notifications/:id
Delete a specific notification.

#### DELETE /api/notifications
Clear all notifications.

---

### Orders

#### GET /api/orders/preset/:noteId
Generate an order preset based on a matched trade note.

#### POST /api/orders/confirmation
Get order confirmation details before execution.

**Request Body:**
```json
{
  "symbol": "BTCUSDT",
  "side": "buy",
  "price": 42500,
  "quantity": 0.1
}
```

See full API documentation with request/response examples in the README.
