-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('draft', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "BacktestStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "BacktestOutcome" AS ENUM ('win', 'loss', 'timeout');

-- CreateEnum
CREATE TYPE "PushLogStatus" AS ENUM ('pending', 'sent', 'failed', 'retrying');

-- AlterTable
ALTER TABLE "TradeNote" ADD COLUMN     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN     "lastEditedAt" TIMESTAMPTZ(6),
ADD COLUMN     "marketContext" JSONB,
ADD COLUMN     "rejectedAt" TIMESTAMPTZ(6),
ADD COLUMN     "status" "NoteStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "userNotes" TEXT;

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "matchThreshold" DOUBLE PRECISION NOT NULL,
    "takeProfit" DECIMAL(18,8) NOT NULL,
    "stopLoss" DECIMAL(18,8) NOT NULL,
    "maxHoldingMinutes" INTEGER NOT NULL DEFAULT 1440,
    "tradingCost" DECIMAL(18,8),
    "status" "BacktestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestResult" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "setupCount" INTEGER NOT NULL,
    "winCount" INTEGER NOT NULL,
    "lossCount" INTEGER NOT NULL,
    "timeoutCount" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "totalProfit" DECIMAL(18,8) NOT NULL,
    "totalLoss" DECIMAL(18,8) NOT NULL,
    "averagePnL" DECIMAL(18,8) NOT NULL,
    "expectancy" DECIMAL(18,8) NOT NULL,
    "maxDrawdown" DECIMAL(18,8),
    "completedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestEvent" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entryTime" TIMESTAMPTZ(6) NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "exitTime" TIMESTAMPTZ(6),
    "exitPrice" DECIMAL(18,8),
    "outcome" "BacktestOutcome" NOT NULL,
    "pnl" DECIMAL(18,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'default',
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastPushedAt" TIMESTAMPTZ(6),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushLog" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "notificationId" UUID,
    "status" "PushLogStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchDetail" (
    "id" UUID NOT NULL,
    "matchResultId" UUID NOT NULL,
    "featureName" TEXT NOT NULL,
    "noteValue" DOUBLE PRECISION,
    "snapshotValue" DOUBLE PRECISION,
    "similarity" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "contribution" DOUBLE PRECISION NOT NULL,
    "isAnomaly" BOOLEAN NOT NULL DEFAULT false,
    "anomalyDetail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_backtestrun_noteid" ON "BacktestRun"("noteId");

-- CreateIndex
CREATE INDEX "idx_backtestrun_status_created" ON "BacktestRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BacktestResult_runId_key" ON "BacktestResult"("runId");

-- CreateIndex
CREATE INDEX "idx_backtestevent_run_entry" ON "BacktestEvent"("runId", "entryTime");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "idx_pushsub_user_active" ON "PushSubscription"("userId", "active");

-- CreateIndex
CREATE INDEX "idx_pushlog_sub_created" ON "PushLog"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_pushlog_status_created" ON "PushLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_matchdetail_matchresult" ON "MatchDetail"("matchResultId");

-- CreateIndex
CREATE INDEX "idx_tradenote_status" ON "TradeNote"("status");

-- CreateIndex
CREATE INDEX "idx_tradenote_symbol_status" ON "TradeNote"("symbol", "status");

-- AddForeignKey
ALTER TABLE "BacktestRun" ADD CONSTRAINT "BacktestRun_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestResult" ADD CONSTRAINT "BacktestResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BacktestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestEvent" ADD CONSTRAINT "BacktestEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BacktestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
