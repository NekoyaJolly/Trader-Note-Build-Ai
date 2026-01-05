-- AlterEnum
ALTER TYPE "VirtualTradeStatus" ADD VALUE 'invalidated';

-- CreateTable
CREATE TABLE "VirtualPortfolio" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "initialBalance" DECIMAL(18,2) NOT NULL DEFAULT 100000,
    "currentBalance" DECIMAL(18,2) NOT NULL DEFAULT 100000,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 3,
    "riskPercentPerTrade" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    "enableSpread" BOOLEAN NOT NULL DEFAULT false,
    "spreadPips" DECIMAL(5,2) NOT NULL DEFAULT 2.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "VirtualPortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_virtual_portfolio_name" ON "VirtualPortfolio"("name");
