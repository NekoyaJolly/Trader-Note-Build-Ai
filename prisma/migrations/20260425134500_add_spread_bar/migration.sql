-- CreateTable
CREATE TABLE "SpreadBar" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "avgSpread" DECIMAL(18,8) NOT NULL,
    "maxSpread" DECIMAL(18,8) NOT NULL,
    "p95Spread" DECIMAL(18,8) NOT NULL,
    "tickCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'ctrader',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SpreadBar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_spreadbar_symbol_timeframe_timestamp" ON "SpreadBar"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "idx_spreadbar_symbol_tf_ts" ON "SpreadBar"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "idx_spreadbar_symbol_ts" ON "SpreadBar"("symbol", "timestamp");
