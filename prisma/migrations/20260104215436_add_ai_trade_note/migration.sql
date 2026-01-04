-- CreateTable
CREATE TABLE "AITradeNote" (
    "id" UUID NOT NULL,
    "virtualTradeId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "pnlPips" DECIMAL(10,2) NOT NULL,
    "pnlPercentage" DECIMAL(10,4) NOT NULL,
    "rrActual" DECIMAL(5,2) NOT NULL,
    "holdingDuration" INTEGER NOT NULL,
    "entryAnalysis" JSONB NOT NULL,
    "exitAnalysis" JSONB NOT NULL,
    "planEvaluation" JSONB NOT NULL,
    "marketReview" JSONB NOT NULL,
    "learnings" JSONB NOT NULL,
    "similarPatterns" JSONB,
    "aiModel" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AITradeNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AINoteSummary" (
    "id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "statistics" JSONB NOT NULL,
    "analysis" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AINoteSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AITradeNote_virtualTradeId_key" ON "AITradeNote"("virtualTradeId");

-- CreateIndex
CREATE INDEX "idx_ai_trade_note_date" ON "AITradeNote"("date");

-- CreateIndex
CREATE INDEX "idx_ai_trade_note_outcome" ON "AITradeNote"("outcome");

-- CreateIndex
CREATE INDEX "idx_ai_trade_note_symbol" ON "AITradeNote"("symbol");

-- CreateIndex
CREATE INDEX "idx_ai_note_summary_period" ON "AINoteSummary"("period", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_note_summary_period" ON "AINoteSummary"("period", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "AITradeNote" ADD CONSTRAINT "AITradeNote_virtualTradeId_fkey" FOREIGN KEY ("virtualTradeId") REFERENCES "VirtualTrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITradeNote" ADD CONSTRAINT "AITradeNote_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AITradePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
