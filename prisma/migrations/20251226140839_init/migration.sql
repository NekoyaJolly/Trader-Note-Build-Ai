-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('unread', 'read', 'deleted');

-- CreateTable
CREATE TABLE "Trade" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "fee" DECIMAL(18,8),
    "exchange" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeNote" (
    "id" UUID NOT NULL,
    "tradeId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "side" "TradeSide" NOT NULL,
    "indicators" JSONB,
    "featureVector" DOUBLE PRECISION[],
    "timeframe" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TradeNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISummary" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "model" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AISummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8) NOT NULL,
    "indicators" JSONB NOT NULL,
    "fetchedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "marketSnapshotId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "trendMatched" BOOLEAN NOT NULL,
    "priceRangeMatched" BOOLEAN NOT NULL,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "matchResultId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'unread',
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPreset" (
    "id" UUID NOT NULL,
    "matchResultId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "suggestedPrice" DECIMAL(18,8) NOT NULL,
    "suggestedQuantity" DECIMAL(18,8) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "feesEstimate" DECIMAL(18,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_trade_symbol_timestamp" ON "Trade"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TradeNote_tradeId_key" ON "TradeNote"("tradeId");

-- CreateIndex
CREATE INDEX "idx_tradenote_symbol" ON "TradeNote"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "AISummary_noteId_key" ON "AISummary"("noteId");

-- CreateIndex
CREATE INDEX "idx_snapshot_symbol_timeframe" ON "MarketSnapshot"("symbol", "timeframe");

-- CreateIndex
CREATE UNIQUE INDEX "uq_snapshot_symbol_timeframe_fetched" ON "MarketSnapshot"("symbol", "timeframe", "fetchedAt");

-- CreateIndex
CREATE INDEX "idx_match_symbol_decided" ON "MatchResult"("symbol", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_match_note_snapshot" ON "MatchResult"("noteId", "marketSnapshotId");

-- CreateIndex
CREATE INDEX "idx_notification_status_sent" ON "Notification"("status", "sentAt");

-- CreateIndex
CREATE INDEX "idx_orderpreset_symbol_created" ON "OrderPreset"("symbol", "createdAt");

-- AddForeignKey
ALTER TABLE "TradeNote" ADD CONSTRAINT "TradeNote_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISummary" ADD CONSTRAINT "AISummary_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_marketSnapshotId_fkey" FOREIGN KEY ("marketSnapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPreset" ADD CONSTRAINT "OrderPreset_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
