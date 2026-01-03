-- AlterTable
ALTER TABLE "StrategyBacktestRun" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "MonteCarloRun" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "backtestRunId" UUID,
    "iterations" INTEGER NOT NULL DEFAULT 100,
    "seed" INTEGER,
    "timeframe" TEXT NOT NULL DEFAULT '1h',
    "expectedWinRate" DOUBLE PRECISION NOT NULL,
    "expectedProfitFactor" DOUBLE PRECISION,
    "simulatedMeanWinRate" DOUBLE PRECISION NOT NULL,
    "simulatedMeanProfitFactor" DOUBLE PRECISION,
    "winRatePercentile" DOUBLE PRECISION NOT NULL,
    "profitFactorPercentile" DOUBLE PRECISION,
    "maxDrawdownPercentile" DOUBLE PRECISION,
    "totalProfitPercentile" DOUBLE PRECISION,
    "winRate5thPercentile" DOUBLE PRECISION,
    "winRate95thPercentile" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonteCarloRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_montecarlorun_strategyid" ON "MonteCarloRun"("strategyId");

-- CreateIndex
CREATE INDEX "idx_montecarlorun_created" ON "MonteCarloRun"("createdAt");

-- CreateIndex
CREATE INDEX "idx_strategybacktestrun_source" ON "StrategyBacktestRun"("source");

-- AddForeignKey
ALTER TABLE "MonteCarloRun" ADD CONSTRAINT "MonteCarloRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
