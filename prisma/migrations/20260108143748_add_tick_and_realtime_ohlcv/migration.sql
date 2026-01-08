-- CreateEnum
CREATE TYPE "OptimizationMethod" AS ENUM ('mean_variance', 'risk_parity', 'equal_weight', 'minimum_variance', 'max_sharpe');

-- CreateTable
CREATE TABLE "TickData" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "bid" DECIMAL(18,8) NOT NULL,
    "ask" DECIMAL(18,8) NOT NULL,
    "mid" DECIMAL(18,8) NOT NULL,
    "spread" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8),
    "source" TEXT NOT NULL DEFAULT 'ctrader',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TickData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealtimeOHLCV" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "open" DECIMAL(18,8) NOT NULL,
    "high" DECIMAL(18,8) NOT NULL,
    "low" DECIMAL(18,8) NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8) NOT NULL,
    "tickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealtimeOHLCV_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyComparisonSession" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "strategyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT '1h',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StrategyComparisonSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyComparisonResult" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "totalTrades" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "netProfit" DECIMAL(18,8) NOT NULL,
    "maxDrawdown" DECIMAL(18,8) NOT NULL,
    "sharpeRatio" DOUBLE PRECISION,
    "sortinoRatio" DOUBLE PRECISION,
    "calmarRatio" DOUBLE PRECISION,
    "dailyReturns" JSONB,
    "equityCurve" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyComparisonResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyCorrelation" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "strategyAId" UUID NOT NULL,
    "strategyBId" UUID NOT NULL,
    "pearsonCorr" DOUBLE PRECISION NOT NULL,
    "spearmanCorr" DOUBLE PRECISION,
    "coWinRate" DOUBLE PRECISION,
    "coLossRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyCorrelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioOptimization" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "method" "OptimizationMethod" NOT NULL,
    "weights" JSONB NOT NULL,
    "expectedReturn" DOUBLE PRECISION NOT NULL,
    "expectedRisk" DOUBLE PRECISION NOT NULL,
    "sharpeRatio" DOUBLE PRECISION,
    "efficientFrontier" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioOptimization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_tick_symbol_timestamp" ON "TickData"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "idx_tick_timestamp" ON "TickData"("timestamp");

-- CreateIndex
CREATE INDEX "idx_realtime_ohlcv_symbol_tf_ts" ON "RealtimeOHLCV"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "uq_realtime_ohlcv" ON "RealtimeOHLCV"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "idx_comparison_session_created" ON "StrategyComparisonSession"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_comparison_result_session" ON "StrategyComparisonResult"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_comparison_result_session_strategy" ON "StrategyComparisonResult"("sessionId", "strategyId");

-- CreateIndex
CREATE INDEX "idx_correlation_session" ON "StrategyCorrelation"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_correlation_session_pair" ON "StrategyCorrelation"("sessionId", "strategyAId", "strategyBId");

-- CreateIndex
CREATE INDEX "idx_optimization_session" ON "PortfolioOptimization"("sessionId");

-- AddForeignKey
ALTER TABLE "StrategyComparisonResult" ADD CONSTRAINT "StrategyComparisonResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StrategyComparisonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyCorrelation" ADD CONSTRAINT "StrategyCorrelation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StrategyComparisonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioOptimization" ADD CONSTRAINT "PortfolioOptimization_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StrategyComparisonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
