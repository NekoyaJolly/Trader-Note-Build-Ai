-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('in_app', 'web_push');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('enabled', 'disabled', 'paused');

-- CreateEnum
CREATE TYPE "WalkForwardType" AS ENUM ('fixed_split', 'rolling_window');

-- CreateTable
CREATE TABLE "StrategyAlert" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "AlertStatus" NOT NULL DEFAULT 'enabled',
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "channels" "AlertChannel"[] DEFAULT ARRAY['in_app']::"AlertChannel"[],
    "minMatchScore" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "lastTriggeredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StrategyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyAlertLog" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "indicatorValues" JSONB NOT NULL,
    "channel" "AlertChannel" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "triggeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyAlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardRun" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "type" "WalkForwardType" NOT NULL DEFAULT 'fixed_split',
    "splitCount" INTEGER NOT NULL DEFAULT 4,
    "inSampleDays" INTEGER NOT NULL,
    "outOfSampleDays" INTEGER NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT '1h',
    "status" "BacktestStatus" NOT NULL DEFAULT 'pending',
    "overfitScore" DOUBLE PRECISION,
    "overfitWarning" BOOLEAN,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WalkForwardRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardSplit" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "splitNumber" INTEGER NOT NULL,
    "inSampleStart" TIMESTAMPTZ(6) NOT NULL,
    "inSampleEnd" TIMESTAMPTZ(6) NOT NULL,
    "outOfSampleStart" TIMESTAMPTZ(6) NOT NULL,
    "outOfSampleEnd" TIMESTAMPTZ(6) NOT NULL,
    "inSampleWinRate" DOUBLE PRECISION NOT NULL,
    "inSampleTradeCount" INTEGER NOT NULL,
    "inSampleProfitFactor" DOUBLE PRECISION,
    "outOfSampleWinRate" DOUBLE PRECISION NOT NULL,
    "outOfSampleTradeCount" INTEGER NOT NULL,
    "outOfSampleProfitFactor" DOUBLE PRECISION,
    "winRateDiff" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkForwardSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategyAlert_strategyId_key" ON "StrategyAlert"("strategyId");

-- CreateIndex
CREATE INDEX "idx_strategyalert_enabled_status" ON "StrategyAlert"("enabled", "status");

-- CreateIndex
CREATE INDEX "idx_strategyalertlog_alert_triggered" ON "StrategyAlertLog"("alertId", "triggeredAt");

-- CreateIndex
CREATE INDEX "idx_walkforwardrun_strategyid" ON "WalkForwardRun"("strategyId");

-- CreateIndex
CREATE INDEX "idx_walkforwardrun_status_created" ON "WalkForwardRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_walkforwardsplit_runid" ON "WalkForwardSplit"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_walkforwardsplit_run_number" ON "WalkForwardSplit"("runId", "splitNumber");

-- AddForeignKey
ALTER TABLE "StrategyAlert" ADD CONSTRAINT "StrategyAlert_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAlertLog" ADD CONSTRAINT "StrategyAlertLog_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "StrategyAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkForwardRun" ADD CONSTRAINT "WalkForwardRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkForwardSplit" ADD CONSTRAINT "WalkForwardSplit_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WalkForwardRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
