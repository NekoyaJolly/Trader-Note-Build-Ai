-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateTable
CREATE TABLE "Strategy" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "status" "StrategyStatus" NOT NULL DEFAULT 'draft',
    "currentVersionId" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "entryConditions" JSONB NOT NULL,
    "exitSettings" JSONB NOT NULL,
    "entryTiming" TEXT NOT NULL DEFAULT 'next_open',
    "changeNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyNote" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "entryTime" TIMESTAMPTZ(6) NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "conditionSnapshot" JSONB NOT NULL,
    "indicatorValues" JSONB NOT NULL,
    "outcome" "BacktestOutcome" NOT NULL,
    "pnl" DECIMAL(18,8),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyBacktestRun" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'stage1',
    "status" "BacktestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StrategyBacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyBacktestResult" (
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

    CONSTRAINT "StrategyBacktestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyBacktestEvent" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entryTime" TIMESTAMPTZ(6) NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "indicatorValues" JSONB,
    "exitTime" TIMESTAMPTZ(6),
    "exitPrice" DECIMAL(18,8),
    "outcome" "BacktestOutcome" NOT NULL,
    "pnl" DECIMAL(18,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyBacktestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_strategy_symbol" ON "Strategy"("symbol");

-- CreateIndex
CREATE INDEX "idx_strategy_status" ON "Strategy"("status");

-- CreateIndex
CREATE INDEX "idx_strategy_symbol_status" ON "Strategy"("symbol", "status");

-- CreateIndex
CREATE INDEX "idx_strategyversion_strategyid" ON "StrategyVersion"("strategyId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_strategyversion_strategy_version" ON "StrategyVersion"("strategyId", "versionNumber");

-- CreateIndex
CREATE INDEX "idx_strategynote_strategyid" ON "StrategyNote"("strategyId");

-- CreateIndex
CREATE INDEX "idx_strategynote_strategy_outcome" ON "StrategyNote"("strategyId", "outcome");

-- CreateIndex
CREATE INDEX "idx_strategybacktestrun_strategyid" ON "StrategyBacktestRun"("strategyId");

-- CreateIndex
CREATE INDEX "idx_strategybacktestrun_status_created" ON "StrategyBacktestRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyBacktestResult_runId_key" ON "StrategyBacktestResult"("runId");

-- CreateIndex
CREATE INDEX "idx_strategybacktestevent_run_entry" ON "StrategyBacktestEvent"("runId", "entryTime");

-- AddForeignKey
ALTER TABLE "StrategyVersion" ADD CONSTRAINT "StrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyNote" ADD CONSTRAINT "StrategyNote_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyBacktestRun" ADD CONSTRAINT "StrategyBacktestRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyBacktestResult" ADD CONSTRAINT "StrategyBacktestResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StrategyBacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyBacktestEvent" ADD CONSTRAINT "StrategyBacktestEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StrategyBacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
