-- CreateTable
CREATE TABLE "ResearchOutput" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT 'multi',
    "rawOutput" JSONB NOT NULL,
    "ohlcvSnapshot" JSONB,
    "newsContext" JSONB,
    "sentimentContext" JSONB,
    "economicEvents" JSONB,
    "macroContext" JSONB,
    "fundamentalsContext" JSONB,
    "aiModel" TEXT NOT NULL,
    "tokenUsage" INTEGER,
    "apiCallCost" INTEGER,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_research_output_symbol" ON "ResearchOutput"("symbol");

-- CreateIndex
CREATE INDEX "idx_research_output_created" ON "ResearchOutput"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_research_output_expires" ON "ResearchOutput"("expiresAt");

-- EnableRLS (Phase A 新規テーブル、deny-by-default で service role からのみアクセス)
ALTER TABLE "ResearchOutput" ENABLE ROW LEVEL SECURITY;
