-- CreateEnum
CREATE TYPE "VirtualTradeStatus" AS ENUM ('pending', 'open', 'closed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "MarketResearch" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT 'multi',
    "featureVector" JSONB NOT NULL,
    "regime" TEXT NOT NULL,
    "regimeConfidence" INTEGER NOT NULL,
    "trend" JSONB NOT NULL,
    "volatility" JSONB NOT NULL,
    "keyLevels" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "aiModel" TEXT NOT NULL,
    "tokenUsage" INTEGER,
    "rawIndicators" JSONB,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AITradePlan" (
    "id" UUID NOT NULL,
    "researchId" UUID NOT NULL,
    "targetDate" DATE NOT NULL,
    "symbol" TEXT NOT NULL,
    "marketAnalysis" JSONB NOT NULL,
    "scenarios" JSONB NOT NULL,
    "overallConfidence" INTEGER,
    "warnings" TEXT[],
    "aiModel" TEXT,
    "tokenUsage" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AITradePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualTrade" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" "VirtualTradeStatus" NOT NULL DEFAULT 'pending',
    "plannedEntry" DECIMAL(18,8) NOT NULL,
    "actualEntry" DECIMAL(18,8),
    "enteredAt" TIMESTAMPTZ(6),
    "stopLoss" DECIMAL(18,8) NOT NULL,
    "takeProfit" DECIMAL(18,8) NOT NULL,
    "exitPrice" DECIMAL(18,8),
    "exitedAt" TIMESTAMPTZ(6),
    "exitReason" TEXT,
    "pnlPips" DECIMAL(18,8),
    "pnlAmount" DECIMAL(18,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "VirtualTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_market_research_symbol" ON "MarketResearch"("symbol");

-- CreateIndex
CREATE INDEX "idx_market_research_created" ON "MarketResearch"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_market_research_expires" ON "MarketResearch"("expiresAt");

-- CreateIndex
CREATE INDEX "idx_ai_trade_plan_date" ON "AITradePlan"("targetDate");

-- CreateIndex
CREATE INDEX "idx_ai_trade_plan_symbol" ON "AITradePlan"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_trade_plan_date_symbol" ON "AITradePlan"("targetDate", "symbol");

-- CreateIndex
CREATE INDEX "idx_virtual_trade_plan" ON "VirtualTrade"("planId");

-- CreateIndex
CREATE INDEX "idx_virtual_trade_status" ON "VirtualTrade"("status");

-- CreateIndex
CREATE INDEX "idx_virtual_trade_symbol" ON "VirtualTrade"("symbol");

-- AddForeignKey
ALTER TABLE "AITradePlan" ADD CONSTRAINT "AITradePlan_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "MarketResearch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualTrade" ADD CONSTRAINT "VirtualTrade_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AITradePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
