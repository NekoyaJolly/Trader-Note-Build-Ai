-- CreateEnum
CREATE TYPE "RevaluationJobType" AS ENUM ('note_regenerate', 'feature_recalculate', 'ai_summary_regenerate', 'full_reprocess');

-- CreateEnum
CREATE TYPE "RevaluationJobStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "OHLCVCandle" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "open" DECIMAL(18,8) NOT NULL,
    "high" DECIMAL(18,8) NOT NULL,
    "low" DECIMAL(18,8) NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OHLCVCandle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeNoteRaw" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "rawData" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TradeNoteRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevaluationJob" (
    "id" UUID NOT NULL,
    "jobType" "RevaluationJobType" NOT NULL,
    "targetNoteId" UUID,
    "targetSymbol" TEXT,
    "status" "RevaluationJobStatus" NOT NULL DEFAULT 'pending',
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RevaluationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ohlcv_symbol_timeframe_timestamp" ON "OHLCVCandle"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "idx_ohlcv_symbol_timestamp" ON "OHLCVCandle"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ohlcv_symbol_timeframe_timestamp" ON "OHLCVCandle"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TradeNoteRaw_noteId_key" ON "TradeNoteRaw"("noteId");

-- CreateIndex
CREATE INDEX "idx_tradenoteraw_noteid" ON "TradeNoteRaw"("noteId");

-- CreateIndex
CREATE INDEX "idx_revaluationjob_status_created" ON "RevaluationJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_revaluationjob_type_status" ON "RevaluationJob"("jobType", "status");
